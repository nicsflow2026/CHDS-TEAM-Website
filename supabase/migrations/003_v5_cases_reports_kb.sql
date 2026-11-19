-- =====================================================================================
-- CHDS 003 — V5 upgrade
--   * strict Human Support case closure (database-enforced lock on every message source)
--   * case reopening (separate, audited), priority, escalation, SLA/response tracking, CSAT
--   * private report portal sessions, My Reports owner edits, report publication workflow,
--     public report feed (safe view), request-corrections status
--   * AI Knowledge Base, editable AI instructions, quick replies, staff notification center
--
-- Requires 001 + 002. ADDITIVE and IDEMPOTENT: no table/column is dropped, no row is deleted.
-- One-time data change (guarded by system_settings.key = 'migration_003'):
--   handoff requests with the old status 'closed' (which meant "chat ended, back to AI") are
--   relabelled 'ended', and every relabel is written to ai_handoff_history. From V5 on,
--   'closed' means a LOCKED case. Rollback steps: docs/MIGRATIONS.md.
-- Take a backup first.
-- =====================================================================================

-- ---------------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('close_support_cases','Close Human Support cases (own assigned cases; Founders/Administrators: any case)'),
  ('view_closed_cases','View the Closed Cases archive with full history'),
  ('reopen_support_cases','Reopen a closed Human Support case (separate audited workflow, reason required)'),
  ('publish_reports','Publish, unpublish and archive approved reports on the public report feed'),
  ('manage_knowledge_base','Manage the AI Knowledge Base, AI instructions, FAQs and quick replies')
on conflict (key) do update set description = excluded.description;
update public.roles set permissions = (select array_agg(key order by key) from public.permissions) where id = 'founder';

-- ---------------------------------------------------------------------------------
-- 2. Conversations: lock fields
-- ---------------------------------------------------------------------------------
alter table public.ai_support_conversations add column if not exists closed_at timestamptz;
alter table public.ai_support_conversations add column if not exists closed_by text;
alter table public.ai_support_conversations add column if not exists close_reason text;
alter table public.ai_support_conversations add column if not exists closed_request_id text;
create index if not exists ai_conv_closed on public.ai_support_conversations (closed_at desc) where closed_at is not null;

-- ---------------------------------------------------------------------------------
-- 3. Handoff requests (Human Support cases): new status 'ended', closure, reopen, priority,
--    escalation, CSAT, unread tracking
-- ---------------------------------------------------------------------------------
alter table public.ai_handoff_requests drop constraint if exists ai_handoff_requests_status_check;
alter table public.ai_handoff_requests add constraint ai_handoff_requests_status_check
  check (status in ('waiting','assigned','in_progress','waiting_customer','resolved','ended','closed','cancelled'));
alter table public.ai_handoff_requests add column if not exists priority text not null default 'normal';
alter table public.ai_handoff_requests drop constraint if exists ai_handoff_priority_check;
alter table public.ai_handoff_requests add constraint ai_handoff_priority_check check (priority in ('low','normal','high','urgent'));
alter table public.ai_handoff_requests add column if not exists closed_by text;
alter table public.ai_handoff_requests add column if not exists closed_by_name text;
alter table public.ai_handoff_requests add column if not exists close_reason text;
alter table public.ai_handoff_requests add column if not exists status_before_close text;
alter table public.ai_handoff_requests add column if not exists reopened_at timestamptz;
alter table public.ai_handoff_requests add column if not exists reopened_by text;
alter table public.ai_handoff_requests add column if not exists reopen_reason text;
alter table public.ai_handoff_requests add column if not exists reopen_count int not null default 0;
alter table public.ai_handoff_requests add column if not exists escalated_at timestamptz;
alter table public.ai_handoff_requests add column if not exists escalated_by text;
alter table public.ai_handoff_requests add column if not exists escalation_note text;
alter table public.ai_handoff_requests add column if not exists csat_rating int;
alter table public.ai_handoff_requests drop constraint if exists ai_handoff_csat_check;
alter table public.ai_handoff_requests add constraint ai_handoff_csat_check check (csat_rating is null or csat_rating between 1 and 5);
alter table public.ai_handoff_requests add column if not exists csat_comment text;
alter table public.ai_handoff_requests add column if not exists csat_at timestamptz;
alter table public.ai_handoff_requests add column if not exists last_customer_msg_at timestamptz;
alter table public.ai_handoff_requests add column if not exists last_agent_msg_at timestamptz;
alter table public.ai_handoff_requests add column if not exists agent_read_at timestamptz;
create index if not exists ai_handoff_closed on public.ai_handoff_requests (closed_at desc) where status = 'closed';
create index if not exists ai_handoff_assigned on public.ai_handoff_requests (assigned_uid, created_at desc) where assigned_uid is not null;

-- ---------------------------------------------------------------------------------
-- 4. Reports: corrections status, portal source, private account info, publication, archive
-- ---------------------------------------------------------------------------------
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('pending','reviewed','approved','rejected','changes_requested'));
alter table public.reports drop constraint if exists reports_source_check;
alter table public.reports add constraint reports_source_check check (source in ('telegram','dashboard','admin','portal'));
alter table public.reports add column if not exists account_info text;
alter table public.reports add column if not exists correction_request text;
alter table public.reports add column if not exists public_title text;
alter table public.reports add column if not exists public_summary text;
alter table public.reports add column if not exists published_at timestamptz;
alter table public.reports add column if not exists published_by text;
alter table public.reports add column if not exists unpublished_at timestamptz;
alter table public.reports add column if not exists archived_at timestamptz;
alter table public.reports add column if not exists archived_by text;
alter table public.reports drop constraint if exists reports_account_len;
alter table public.reports add constraint reports_account_len check (account_info is null or char_length(account_info) <= 2000);
alter table public.reports drop constraint if exists reports_public_len;
alter table public.reports add constraint reports_public_len check ((public_title is null or char_length(public_title) between 3 and 120) and (public_summary is null or char_length(public_summary) <= 600));
create index if not exists reports_published on public.reports (published_at desc) where published_at is not null and deleted_at is null;
create index if not exists reports_created on public.reports (created_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------------
-- 5. New tables
-- ---------------------------------------------------------------------------------
create table if not exists public.portal_otps (
  uid text primary key check (uid ~ '^\d{1,20}$'),
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.portal_sessions (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  uid text not null check (uid ~ '^\d{1,20}$'),
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text
);
create index if not exists portal_sessions_uid on public.portal_sessions (uid, created_at desc);

create table if not exists public.ai_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  category text not null default 'general' check (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  body text not null check (char_length(body) between 1 and 4000),
  keywords text[] not null default '{}',
  is_faq boolean not null default false,
  enabled boolean not null default true,
  sort_order int not null default 100 check (sort_order between 0 and 100000),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ai_knowledge_live on public.ai_knowledge (enabled, sort_order) where deleted_at is null;
-- Official policy answer (required by the platform; can be edited but the AI security policy itself is fixed in code)
insert into public.ai_knowledge (title, category, body, keywords, is_faq, enabled, sort_order, created_by)
select 'Will CHDS Support ever ask for my password?', 'security',
       'No. CHDS Support will never ask you to share your account password. Never send your password through AI Support, Human Support, Telegram, chat messages, or any support form. Keep your password private.',
       '{password,otp,code,login,security,share}', true, true, 0, 'system:migration-003'
where not exists (select 1 from public.ai_knowledge where title = 'Will CHDS Support ever ask for my password?');

create table if not exists public.support_quick_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 60),
  body text not null check (char_length(body) between 1 and 1000),
  enabled boolean not null default true,
  sort_order int not null default 100 check (sort_order between 0 and 100000),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.staff_notifications (
  id bigint generated always as identity primary key,
  recipient_uid text not null,
  kind text not null,
  title text not null check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 600),
  link text,
  ref text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_notifications_unread on public.staff_notifications (recipient_uid, created_at desc) where read_at is null;
create index if not exists staff_notifications_recipient on public.staff_notifications (recipient_uid, id desc);

alter table public.audit_log add column if not exists actor_role text;

insert into public.system_settings (key, value) values ('ai', '{"instructions":""}') on conflict (key) do nothing;
update public.system_settings set value = value || '{"first_response_minutes":15,"resolution_hours":24}'::jsonb
 where key = 'support' and not (value ? 'first_response_minutes');

-- ---------------------------------------------------------------------------------
-- 6. One-time data change (guarded): default permissions for Support Agents and the
--    'closed' → 'ended' relabel of legacy handoff requests (each one recorded in history)
-- ---------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from public.system_settings where key = 'migration_003') then
    update public.roles set permissions = array(select distinct x from unnest(permissions || array['close_support_cases','view_closed_cases']) x order by 1)
     where id = 'support_agent';
    insert into public.ai_handoff_history (request_id, actor, action, from_status, to_status, detail)
    select id, 'system:migration-003', 'status_relabel', 'closed', 'ended',
           jsonb_build_object('note', 'V5: before this upgrade "closed" meant the human chat ended and the customer went back to AI. That is now called "ended"; "closed" means a locked case.')
      from public.ai_handoff_requests where status = 'closed' and closed_by is null;
    update public.ai_handoff_requests set status = 'ended' where status = 'closed' and closed_by is null;
    insert into public.system_settings (key, value) values ('migration_003', jsonb_build_object('applied_at', now()));
  end if;
end $$;

-- ---------------------------------------------------------------------------------
-- 7. CASE LOCK — enforced by the database for every message source (customer, agent,
--    AI, Telegram, retries, background jobs). Lock order used everywhere:
--    session → conversation → request (prevents deadlocks between writers).
-- ---------------------------------------------------------------------------------
-- 7a. No message can enter a closed conversation's transcript.
create or replace function public.ai_messages_case_lock() returns trigger language plpgsql as $$
declare cl timestamptz;
begin
  select closed_at into cl from public.ai_support_conversations where id = new.conversation_id for no key update;
  if cl is not null then
    raise exception 'case_closed' using errcode = 'PT409', detail = 'This Human Support case is closed. Start a new conversation.';
  end if;
  return new;
end $$;
drop trigger if exists ai_messages_case_lock on public.ai_support_messages;
create trigger ai_messages_case_lock before insert on public.ai_support_messages for each row execute function public.ai_messages_case_lock();

-- 7b. No message can enter the human room of a closed conversation.
create or replace function public.messages_case_lock() returns trigger language plpgsql as $$
declare cid uuid; cl timestamptz;
begin
  select conversation_id into cid from public.sessions where sid = new.sid;
  if cid is not null then
    select closed_at into cl from public.ai_support_conversations where id = cid for no key update;
    if cl is not null then
      raise exception 'case_closed' using errcode = 'PT409', detail = 'This Human Support case is closed.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists messages_case_lock on public.messages;
create trigger messages_case_lock before insert on public.messages for each row execute function public.messages_case_lock();

-- 7c. A closed conversation cannot be reopened, re-owned or re-routed except by reopen_support_case.
create or replace function public.ai_conv_case_lock() returns trigger language plpgsql as $$
begin
  if old.closed_at is not null and coalesce(current_setting('chds.case_op', true), '') <> 'reopen'
     and (new.closed_at is distinct from old.closed_at or new.status is distinct from old.status
          or new.owner is distinct from old.owner or new.human_sid is distinct from old.human_sid) then
    raise exception 'case_closed' using errcode = 'PT409', detail = 'Closed conversations stay closed. Use the reopen workflow.';
  end if;
  return new;
end $$;
drop trigger if exists ai_conv_case_lock on public.ai_support_conversations;
create trigger ai_conv_case_lock before update on public.ai_support_conversations for each row execute function public.ai_conv_case_lock();

-- 7d. Transcripts of closed conversations cannot be deleted.
create or replace function public.ai_messages_no_delete_closed() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.ai_support_conversations where id = old.conversation_id and closed_at is not null) then
    raise exception 'closed case history is read-only' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists ai_messages_no_delete_closed on public.ai_support_messages;
create trigger ai_messages_no_delete_closed before delete on public.ai_support_messages for each row execute function public.ai_messages_no_delete_closed();

-- 7e. Mirror human-room messages into the transcript; keep status + unread/response timestamps current.
create or replace function public.messages_mirror() returns trigger language plpgsql as $$
declare s public.sessions; h public.ai_handoff_requests;
begin
  select * into s from public.sessions where sid = new.sid;
  if s.conversation_id is null then return new; end if;
  insert into public.ai_support_messages (conversation_id, user_id, role, author, body, meta)
  values (s.conversation_id, s.ai_user_id, case new.sender when 'user' then 'user' when 'agent' then 'agent' else 'system' end,
          new.author, left(new.body, 8000), jsonb_build_object('sid', new.sid, 'msg_id', new.id, 'channel', 'human'));
  if s.request_id is not null then
    select * into h from public.ai_handoff_requests where id = s.request_id for update;
    if new.sender = 'agent' then
      update public.ai_handoff_requests set last_agent_msg_at = now(),
             status = case when h.status in ('assigned','in_progress') then 'waiting_customer' else status end,
             first_response_at = case when h.status in ('assigned','in_progress','waiting_customer') then coalesce(first_response_at, now()) else first_response_at end,
             updated_at = now()
       where id = h.id;
      if h.status in ('assigned','in_progress') then
        insert into public.ai_handoff_history (request_id, actor, action, from_status, to_status) values (h.id, 'system', 'status', h.status, 'waiting_customer');
      end if;
    elsif new.sender = 'user' then
      update public.ai_handoff_requests set last_customer_msg_at = now(),
             status = case when h.status in ('assigned','waiting_customer') then 'in_progress' else status end, updated_at = now()
       where id = h.id;
      if h.status in ('assigned','waiting_customer') then
        insert into public.ai_handoff_history (request_id, actor, action, from_status, to_status) values (h.id, 'system', 'status', h.status, 'in_progress');
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------
-- 8. Case closure / reopening RPCs
-- ---------------------------------------------------------------------------------
-- Close (atomic, idempotent). Authorization is checked by the API AND re-checked here:
-- p_force=false requires the actor to be the assigned agent. Only the conversation's latest
-- request can be closed (a newer request would otherwise be locked by an old one).
create or replace function public.close_support_case(p_request text, p_actor text, p_actor_uid text, p_actor_name text, p_force boolean, p_reason text)
returns jsonb language plpgsql as $$
declare h public.ai_handoff_requests; c public.ai_support_conversations; s public.sessions;
        v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), ''); v_joined jsonb;
begin
  select * into h from public.ai_handoff_requests where id = p_request;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into s from public.sessions where sid = h.sid for update;
  select * into c from public.ai_support_conversations where id = h.conversation_id for update;
  select * into h from public.ai_handoff_requests where id = p_request for update;
  if h.status = 'closed' then
    return jsonb_build_object('ok', true, 'already_closed', true, 'request_id', h.id, 'closed_at', h.closed_at, 'closed_by', h.closed_by, 'conversation_id', h.conversation_id);
  end if;
  if c.closed_at is not null then
    return jsonb_build_object('ok', true, 'already_closed', true, 'request_id', c.closed_request_id, 'closed_at', c.closed_at, 'closed_by', c.closed_by, 'conversation_id', c.id);
  end if;
  if c.human_sid is distinct from h.sid then return jsonb_build_object('ok', false, 'reason', 'not_latest'); end if;
  if not coalesce(p_force, false) and (h.assigned_uid is null or h.assigned_uid <> coalesce(p_actor_uid, '')) then
    return jsonb_build_object('ok', false, 'reason', 'not_assigned');
  end if;
  v_joined := coalesce((select jsonb_agg(k) from jsonb_object_keys(coalesce(s.joined, '{}'::jsonb)) k), '[]'::jsonb);
  -- the closing notice is the last message the case accepts (written before the lock is set)
  insert into public.messages (sid, sender, body) values (h.sid, 'sys',
    'This case was closed by CHDS Support. This conversation is now read-only: messages can no longer be sent here. To get help again, start a new conversation.');
  update public.sessions set status = 'ended', joined = '{}', updated_at = now() where sid = h.sid;
  update public.agents set active_sid = null where active_sid = h.sid;
  update public.ai_handoff_requests set status = 'closed', status_before_close = h.status, closed_at = now(), closed_by = p_actor,
         closed_by_name = left(p_actor_name, 60), close_reason = v_reason, updated_at = now()
   where id = h.id;
  insert into public.ai_handoff_history (request_id, actor, action, from_status, to_status, detail)
  values (h.id, p_actor, 'case_closed', h.status, 'closed', jsonb_build_object('reason', v_reason, 'forced', coalesce(p_force, false), 'assigned_uid', h.assigned_uid));
  update public.ai_support_conversations set status = 'closed', owner = 'human', closed_at = now(), closed_by = p_actor, close_reason = v_reason,
         closed_request_id = h.id, updated_at = now()
   where id = c.id;
  return jsonb_build_object('ok', true, 'already_closed', false, 'request_id', h.id, 'sid', h.sid, 'conversation_id', c.id, 'previous_status', h.status,
         'notif', coalesce(s.notif, '[]'::jsonb), 'joined', v_joined, 'assigned_uid', h.assigned_uid, 'customer', s.name);
end $$;

-- Reopen (administrator workflow, reason required). The closure event and the closure fields on the
-- request are preserved; the conversation is unlocked and handed back to AI Support.
create or replace function public.reopen_support_case(p_request text, p_actor text, p_reason text) returns jsonb language plpgsql as $$
declare h public.ai_handoff_requests; c public.ai_support_conversations; v_reason text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if char_length(v_reason) < 3 then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
  select * into h from public.ai_handoff_requests where id = p_request;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into c from public.ai_support_conversations where id = h.conversation_id for update;
  select * into h from public.ai_handoff_requests where id = p_request for update;
  if h.status <> 'closed' then return jsonb_build_object('ok', false, 'reason', 'not_closed'); end if;
  perform set_config('chds.case_op', 'reopen', true);
  update public.ai_support_conversations set closed_at = null, closed_by = null, close_reason = null, closed_request_id = null,
         status = 'active', owner = 'ai', updated_at = now()
   where id = c.id;
  perform set_config('chds.case_op', '', true);
  update public.ai_handoff_requests set status = 'ended', reopened_at = now(), reopened_by = p_actor, reopen_reason = v_reason,
         reopen_count = reopen_count + 1, updated_at = now()
   where id = h.id;
  insert into public.ai_handoff_history (request_id, actor, action, from_status, to_status, detail)
  values (h.id, p_actor, 'case_reopened', 'closed', 'ended', jsonb_build_object('reason', v_reason, 'closed_at', h.closed_at, 'closed_by', h.closed_by));
  insert into public.ai_support_messages (conversation_id, user_id, role, body, meta)
  values (c.id, c.user_id, 'system', 'This conversation was reopened by CHDS Support. CHDS AI Support can assist you here again.',
          jsonb_build_object('kind', 'case_reopened', 'request_id', h.id));
  return jsonb_build_object('ok', true, 'request_id', h.id, 'conversation_id', c.id, 'closed_by', h.closed_by, 'assigned_uid', h.assigned_uid);
end $$;

-- Atomic append for AI Support: re-checks the lock and ownership at write time (so a reply generated
-- before a closure is discarded, never delivered).
create or replace function public.ai_append_message(p_conv uuid, p_user uuid, p_role text, p_body text, p_meta jsonb, p_patch jsonb)
returns jsonb language plpgsql as $$
declare c public.ai_support_conversations; m public.ai_support_messages;
begin
  if p_role not in ('user','assistant','system') then return jsonb_build_object('ok', false, 'reason', 'bad_role'); end if;
  select * into c from public.ai_support_conversations where id = p_conv and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.closed_at is not null then return jsonb_build_object('ok', false, 'reason', 'case_closed', 'closed_at', c.closed_at); end if;
  if c.owner <> 'ai' then return jsonb_build_object('ok', false, 'reason', 'human_owned', 'sid', c.human_sid); end if;
  insert into public.ai_support_messages (conversation_id, user_id, role, body, meta)
  values (c.id, c.user_id, p_role, left(p_body, 8000), coalesce(p_meta, '{}'::jsonb)) returning * into m;
  update public.ai_support_conversations set
         title = case when p_patch ? 'title' and title is null then left(p_patch->>'title', 80) else title end,
         status = coalesce(p_patch->>'status', status),
         failure_count = coalesce((p_patch->>'failure_count')::int, failure_count),
         category = coalesce(p_patch->>'category', category),
         updated_at = now()
   where id = c.id;
  return jsonb_build_object('ok', true, 'id', m.id, 'created_at', m.created_at);
end $$;

-- create_handoff: unchanged contract + refuses closed conversations + priority
create or replace function public.create_handoff(p jsonb) returns jsonb language plpgsql as $$
declare c public.ai_support_conversations; h public.ai_handoff_requests; q jsonb; v_id text; v_sid text; v_name text;
begin
  select * into c from public.ai_support_conversations where id = (p->>'conversation_id')::uuid and user_id = (p->>'user_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if c.closed_at is not null then return jsonb_build_object('error', 'case_closed'); end if;
  select * into h from public.ai_handoff_requests where idempotency_key = p->>'idempotency_key';
  if found then return jsonb_build_object('existing', true, 'id', h.id, 'sid', h.sid, 'status', h.status); end if;
  select * into h from public.ai_handoff_requests where conversation_id = c.id and status in ('waiting','assigned','in_progress','waiting_customer');
  if found then return jsonb_build_object('existing', true, 'id', h.id, 'sid', h.sid, 'status', h.status); end if;
  q := public.support_quota(array(select jsonb_array_elements_text(p->'quota_keys')), (p->>'limit')::int, (p->>'cooldown_min')::int, true);
  if not (q->>'allowed')::boolean then return jsonb_build_object('blocked', true, 'retry_after', (q->>'retry_after')::int, 'limit', (q->>'limit')::int); end if;
  select display_name into v_name from public.ai_support_users where id = c.user_id;
  v_id := p->>'id'; v_sid := p->>'sid';
  insert into public.sessions (sid, name, status, joined, notif, ai_user_id, conversation_id, request_id)
  values (v_sid, v_name, 'wait', '{}', '[]', c.user_id, c.id, v_id);
  insert into public.ai_handoff_requests (id, conversation_id, user_id, sid, status, reason, reason_detail, category, summary, idempotency_key, priority)
  values (v_id, c.id, c.user_id, v_sid, 'waiting', p->>'reason', left(p->>'reason_detail', 500), p->>'category', coalesce(p->'summary', '{}'), p->>'idempotency_key',
          coalesce(nullif(p->>'priority', ''), 'normal'));
  insert into public.ai_handoff_history (request_id, actor, action, to_status, detail)
  values (v_id, 'visitor:' || c.user_id, 'created', 'waiting', jsonb_build_object('reason', p->>'reason'));
  update public.ai_support_conversations set owner = 'human', status = 'handoff', human_sid = v_sid,
         category = coalesce(p->>'category', category), updated_at = now() where id = c.id;
  insert into public.ai_support_messages (conversation_id, user_id, role, author, body, meta)
  values (c.id, c.user_id, 'summary', 'CHDS AI (generated summary)', left(coalesce(p->'summary'->>'summary', '(no summary)'), 8000),
          jsonb_build_object('kind', 'handoff_summary', 'request_id', v_id, 'summary', p->'summary'));
  insert into public.messages (sid, sender, body) values (v_sid, 'sys', 'Request ' || v_id || ' sent to CHDS Human Support. Please wait for an agent to accept it. AI replies are paused for this conversation.');
  return jsonb_build_object('existing', false, 'id', v_id, 'sid', v_sid, 'status', 'waiting', 'remaining', (q->>'remaining')::int, 'retry_after', (q->>'retry_after')::int);
end $$;

-- return_to_ai: 'ended' instead of the old 'closed'; refuses locked cases; lock order session → conversation → request
create or replace function public.return_to_ai(p_sid text, p_actor text, p_actor_uid text, p_force boolean, p_summary text, p_unresolved text, p_resolve boolean) returns jsonb language plpgsql as $$
declare s public.sessions; h public.ai_handoff_requests; nm text; to_st text; cl timestamptz;
begin
  select * into s from public.sessions where sid = p_sid for update;
  if not found or s.status = 'ended' then return jsonb_build_object('ok', false, 'reason', 'ended'); end if;
  if s.conversation_id is not null then
    select closed_at into cl from public.ai_support_conversations where id = s.conversation_id for update;
    if cl is not null then return jsonb_build_object('ok', false, 'reason', 'case_closed'); end if;
  end if;
  if not coalesce(p_force, false) and (p_actor_uid is null or (coalesce(s.owner_uid, '') <> p_actor_uid and not coalesce(s.joined ? p_actor_uid, false))) then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  nm := coalesce(s.owner_name, s.joined ->> p_actor_uid, 'CHDS Support');
  update public.sessions set status = 'ended', joined = '{}', updated_at = now() where sid = p_sid;
  update public.agents set active_sid = null where active_sid = p_sid;
  to_st := case when p_resolve then 'resolved' else 'ended' end;
  if s.request_id is not null then
    select * into h from public.ai_handoff_requests where id = s.request_id for update;
    update public.ai_handoff_requests set status = case when h.status = 'waiting' then 'cancelled' else to_st end,
           agent_summary = left(p_summary, 2000), unresolved_tasks = left(p_unresolved, 2000),
           resolved_at = case when p_resolve then now() end, closed_at = now(),
           cancelled_at = case when h.status = 'waiting' then now() end, updated_at = now()
     where id = h.id;
    insert into public.ai_handoff_history (request_id, actor, action, from_status, to_status, detail)
    values (h.id, p_actor, case when p_resolve then 'resolved' else 'returned_to_ai' end, h.status,
            case when h.status = 'waiting' then 'cancelled' else to_st end, jsonb_build_object('summary', left(p_summary, 500), 'unresolved', left(p_unresolved, 500)));
  end if;
  if s.conversation_id is not null then
    if coalesce(p_summary, '') <> '' or coalesce(p_unresolved, '') <> '' then
      insert into public.ai_support_messages (conversation_id, user_id, role, author, body, meta)
      values (s.conversation_id, s.ai_user_id, 'note', nm || ' (CHDS agent handback note)',
              left('Agent summary: ' || coalesce(nullif(p_summary, ''), '(none)') || E'\nUnresolved tasks: ' || coalesce(nullif(p_unresolved, ''), '(none)'), 8000),
              jsonb_build_object('kind', 'agent_handback', 'request_id', s.request_id));
    end if;
    update public.ai_support_conversations set owner = 'ai',
           status = case when p_resolve then 'resolved' else 'active' end,
           resolved_at = case when p_resolve then now() else resolved_at end,
           resolved_by = case when p_resolve then p_actor else resolved_by end, updated_at = now()
     where id = s.conversation_id;
  end if;
  insert into public.messages (sid, sender, body) values (p_sid, 'sys',
    case when p_resolve then nm || ' marked your concern as resolved. CHDS AI Support is available if you need anything else.'
         else nm || ' returned this conversation to CHDS AI Support, which now has the full context.' end);
  return jsonb_build_object('ok', true, 'name', s.name, 'nm', nm, 'notif', s.notif, 'request_id', s.request_id, 'conversation_id', s.conversation_id);
end $$;

-- end_session (customer cancel / leave, admin "End chat"): 'ended' instead of the old 'closed'. Never locks.
create or replace function public.end_session(p_sid text) returns jsonb language plpgsql as $$
declare s public.sessions; h public.ai_handoff_requests; to_st text;
begin
  update public.sessions set status = 'ended', updated_at = now() where sid = p_sid and status <> 'ended' returning * into s;
  if not found then return jsonb_build_object('ok', true, 'joined', '[]'::jsonb, 'notif', '[]'::jsonb, 'name', ''); end if;
  insert into public.messages (sid, sender, body) values (p_sid, 'sys', 'Chat ended. CHDS AI Support is back to assist you.');
  update public.agents set active_sid = null where active_sid = p_sid;
  if s.request_id is not null then
    select * into h from public.ai_handoff_requests where id = s.request_id for update;
    if h.status in ('waiting','assigned','in_progress','waiting_customer') then
      to_st := case when h.status = 'waiting' then 'cancelled' else 'ended' end;
      update public.ai_handoff_requests set status = to_st, closed_at = now(), cancelled_at = case when to_st = 'cancelled' then now() end, updated_at = now() where id = h.id;
      insert into public.ai_handoff_history (request_id, actor, action, from_status, to_status)
      values (h.id, public.chds_actor('customer'), case when to_st = 'cancelled' then 'cancelled' else 'ended' end, h.status, to_st);
    end if;
  end if;
  if s.conversation_id is not null then
    update public.ai_support_conversations set owner = 'ai', status = case when status = 'handoff' then 'active' else status end, updated_at = now()
     where id = s.conversation_id and closed_at is null;
  end if;
  return jsonb_build_object('ok', true, 'name', s.name, 'notif', s.notif, 'request_id', s.request_id,
    'joined', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(s.joined) k));
end $$;

-- poll_session: also reports the case lock to the customer's widget
create or replace function public.poll_session(p_sid text, p_after bigint) returns jsonb language plpgsql as $$
declare s public.sessions; expd jsonb; cl timestamptz;
begin
  update public.sessions set status = 'ended', updated_at = now()
   where sid = p_sid and status = 'wait' and request_id is null and created_at < now() - interval '15 minutes' returning * into s;
  if found then
    expd := s.notif;
    insert into public.messages(sid, sender, body) values (p_sid, 'sys', 'No agent is available right now. CHDS AI Support will keep assisting you, or message us on Telegram.');
  end if;
  select * into s from public.sessions where sid = p_sid;
  if not found then return jsonb_build_object('st', 'ended', 'n', 0, 'msgs', '[]'::jsonb); end if;
  if s.conversation_id is not null then select closed_at into cl from public.ai_support_conversations where id = s.conversation_id; end if;
  return jsonb_build_object('st', s.status, 'n', (select count(*) from jsonb_object_keys(s.joined)), 'expired', expd,
    'owner_uid', s.owner_uid, 'owner_name', s.owner_name, 'request_id', s.request_id,
    'hstatus', (select status from public.ai_handoff_requests where id = s.request_id), 'locked', cl is not null, 'closed_at', cl,
    'msgs', coalesce((select jsonb_agg(jsonb_build_object('i', id, 'f', sender, 't', body, 'a', author) order by id)
                        from public.messages where sid = p_sid and id > p_after and sender <> 'user'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------
-- 9. Reports: publication invariant, history, projected revenue for future activity dates
-- ---------------------------------------------------------------------------------
create or replace function public.reports_before() returns trigger language plpgsql as $$
begin
  if new.team_member_id is null then
    select id into new.team_member_id from public.team_members where telegram_uid = new.uid and deleted_at is null limit 1;
  end if;
  if tg_op = 'INSERT' and new.title is not null and new.dedupe_key is null then
    new.dedupe_key := md5(concat_ws('|', coalesce(new.team_member_id::text, new.uid), new.report_date, new.recovered, new.revenue, lower(btrim(new.title))));
  end if;
  -- only approved, non-archived, non-deleted reports can be public
  if new.published_at is not null and (new.status <> 'approved' or new.archived_at is not null or new.deleted_at is not null) then
    new.published_at := null; new.unpublished_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.reports_after() returns trigger language plpgsql as $$
declare st text; changes jsonb := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.report_history (report_id, actor, action, to_status, changes)
    values (new.id, public.chds_actor(coalesce(new.submitted_by, 'tg:' || new.uid)), 'created', new.status,
            jsonb_build_object('recovered', new.recovered, 'revenue', new.revenue, 'report_date', new.report_date, 'source', new.source));
  else
    if new.deleted_at is not null and old.deleted_at is null then
      insert into public.report_history (report_id, actor, action, from_status, to_status, reason)
      values (new.id, public.chds_actor(coalesce(new.deleted_by, 'system')), 'deleted', old.status, new.status, public.chds_reason());
    elsif new.status is distinct from old.status then
      insert into public.report_history (report_id, actor, action, from_status, to_status, reason)
      values (new.id, public.chds_actor(coalesce(new.reviewed_by, 'system')), 'status', old.status, new.status,
              coalesce(public.chds_reason(), case when new.status = 'rejected' then new.rejection_reason when new.status = 'changes_requested' then new.correction_request end));
    end if;
    select coalesce(jsonb_object_agg(k, jsonb_build_object('old', to_jsonb(old) -> k, 'new', to_jsonb(new) -> k)), '{}') into changes
      from unnest(array['title','description','account_info','category','recovered','revenue','report_date','additional_info','team_member_id','name']) k
     where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
    if changes <> '{}' then
      insert into public.report_history (report_id, actor, action, from_status, to_status, changes, reason)
      values (new.id, public.chds_actor('system'), 'edited', old.status, new.status, changes, public.chds_reason());
    end if;
    if old.published_at is null and new.published_at is not null then
      insert into public.report_history (report_id, actor, action, from_status, to_status, changes, reason)
      values (new.id, public.chds_actor(coalesce(new.published_by, 'system')), 'published', new.status, new.status,
              jsonb_build_object('public_title', new.public_title, 'public_summary', new.public_summary), public.chds_reason());
    elsif old.published_at is not null and new.published_at is null then
      insert into public.report_history (report_id, actor, action, from_status, to_status, reason)
      values (new.id, public.chds_actor('system'), 'unpublished', old.status, new.status, public.chds_reason());
    end if;
    if old.archived_at is null and new.archived_at is not null then
      insert into public.report_history (report_id, actor, action, from_status, to_status, reason)
      values (new.id, public.chds_actor(coalesce(new.archived_by, 'system')), 'archived', new.status, new.status, public.chds_reason());
    elsif old.archived_at is not null and new.archived_at is null then
      insert into public.report_history (report_id, actor, action, from_status, to_status, reason)
      values (new.id, public.chds_actor('system'), 'restored', new.status, new.status, public.chds_reason());
    end if;
  end if;

  -- revenue sync: one revenue record per report. Approved reports with a FUTURE activity date
  -- (Philippine calendar) are projected revenue until that date.
  if new.report_date < date '2020-01-01' then return new; end if;
  st := case when new.deleted_at is not null or coalesce(new.revenue, 0) <= 0 then null
             when new.status = 'approved' and new.report_date > (now() at time zone 'Asia/Manila')::date then 'projected'
             when new.status = 'approved' then 'actual'
             when new.status = 'rejected' then 'rejected'
             else 'pending' end;
  if st is null then
    update public.revenue_records set deleted_at = now(), updated_at = now() where report_id = new.id and deleted_at is null;
    return new;
  end if;
  insert into public.revenue_records (id, team_member_id, member_uid, member_name, report_id, amount, revenue_date, description, status, source,
                                      verified_by, verified_at, rejection_reason, created_by)
  values ('RV' || upper(substr(md5('report:' || new.id), 1, 10)), new.team_member_id, new.uid, new.name, new.id, new.revenue, new.report_date,
          left(coalesce(new.title, 'Report ' || new.id), 500), st, 'report',
          case when st = 'actual' then coalesce(new.reviewed_by, 'auto-approved') end,
          case when st = 'actual' then coalesce(new.approved_at, now()) end,
          case when st = 'rejected' then new.rejection_reason end,
          coalesce(new.submitted_by, 'tg:' || new.uid))
  on conflict (report_id) do update set
    team_member_id = excluded.team_member_id, member_uid = excluded.member_uid, member_name = excluded.member_name,
    amount = excluded.amount, revenue_date = excluded.revenue_date, description = excluded.description, status = excluded.status,
    verified_by = excluded.verified_by, verified_at = excluded.verified_at, rejection_reason = excluded.rejection_reason,
    deleted_at = null, updated_at = now();
  return new;
end $$;

-- Projected report revenue becomes actual once its activity date has arrived (called by the API).
create or replace function public.revenue_promote_due(p_today date) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('chds.actor', 'system:projected-due', true);
  update public.revenue_records r set status = 'actual', verified_by = coalesce(x.reviewed_by, 'auto'), verified_at = now(), updated_at = now()
    from public.reports x
   where r.source = 'report' and r.status = 'projected' and r.deleted_at is null and r.report_id = x.id
     and x.status = 'approved' and x.deleted_at is null and r.revenue_date <= p_today;
  get diagnostics n = row_count;
  return n;
end $$;

-- Review: pending/reviewed → approved | rejected | changes_requested (reason required for the last two)
create or replace function public.report_review(p_id text, p_actor text, p_action text, p_reason text, p_note text) returns jsonb language plpgsql as $$
declare r public.reports; to_st text;
begin
  select * into r from public.reports where id = p_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.archived_at is not null then return jsonb_build_object('ok', false, 'error', 'archived'); end if;
  to_st := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' when 'review' then 'reviewed' when 'request_changes' then 'changes_requested' end;
  if to_st is null then return jsonb_build_object('ok', false, 'error', 'bad_action'); end if;
  if (to_st in ('approved','reviewed') and r.status not in ('pending','reviewed'))
     or (to_st = 'reviewed' and r.status <> 'pending')
     or (to_st = 'rejected' and r.status not in ('pending','reviewed','changes_requested'))
     or (to_st = 'changes_requested' and r.status not in ('pending','reviewed')) then
    return jsonb_build_object('ok', false, 'error', 'already_handled', 'status', r.status);
  end if;
  if to_st in ('rejected','changes_requested') and coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'error', 'reason_required'); end if;
  perform set_config('chds.actor', p_actor, true);
  perform set_config('chds.reason', coalesce(p_reason, ''), true);
  update public.reports set status = to_st, reviewed_by = p_actor, reviewed_at = now(),
         review_note = coalesce(nullif(btrim(p_note), ''), review_note),
         rejection_reason = case when to_st = 'rejected' then left(btrim(p_reason), 500) end,
         correction_request = case when to_st = 'changes_requested' then left(btrim(p_reason), 1000) else correction_request end,
         approved_at = case when to_st = 'approved' then now() else approved_at end
   where id = p_id returning * into r;
  return jsonb_build_object('ok', true, 'report', to_jsonb(r));
end $$;

-- Admin edits (kept contract) + account_info
create or replace function public.report_update(p_id text, p_actor text, p_reason text, p_patch jsonb) returns jsonb language plpgsql as $$
declare r public.reports;
begin
  if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'error', 'reason_required'); end if;
  perform set_config('chds.actor', p_actor, true);
  perform set_config('chds.reason', p_reason, true);
  select * into r from public.reports where id = p_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_patch ? 'delete' then
    update public.reports set deleted_at = now(), deleted_by = p_actor where id = p_id returning * into r;
  else
    update public.reports set
      title = case when p_patch ? 'title' then p_patch->>'title' else title end,
      description = case when p_patch ? 'description' then p_patch->>'description' else description end,
      account_info = case when p_patch ? 'account_info' then p_patch->>'account_info' else account_info end,
      category = case when p_patch ? 'category' then p_patch->>'category' else category end,
      additional_info = case when p_patch ? 'additional_info' then p_patch->>'additional_info' else additional_info end,
      recovered = case when p_patch ? 'recovered' then (p_patch->>'recovered')::int else recovered end,
      revenue = case when p_patch ? 'revenue' then (p_patch->>'revenue')::numeric else revenue end,
      report_date = case when p_patch ? 'report_date' then (p_patch->>'report_date')::date else report_date end
    where id = p_id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'report', to_jsonb(r));
end $$;

-- Owner (My Reports) changes. Ownership = the verified Telegram UID of the portal session (p_uid),
-- never an ID supplied by the browser. Any material edit returns the report to Pending and
-- unpublishes it (re-validation by an approver).
create or replace function public.report_owner_update(p_id text, p_uid text, p_patch jsonb) returns jsonb language plpgsql as $$
declare r public.reports; b public.reports; act text := 'portal:' || p_uid;
begin
  select * into b from public.reports where id = p_id and uid = p_uid and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform set_config('chds.actor', act, true);
  if p_patch ? 'delete' then
    if b.status not in ('pending','reviewed','changes_requested','rejected') or b.published_at is not null then
      return jsonb_build_object('ok', false, 'error', 'not_eligible', 'status', b.status);
    end if;
    perform set_config('chds.reason', 'Deleted by the owner in My Reports', true);
    update public.reports set deleted_at = now(), deleted_by = act where id = p_id returning * into r;
    return jsonb_build_object('ok', true, 'report', to_jsonb(r), 'prev_status', b.status);
  end if;
  if p_patch ? 'archive' then
    if (p_patch->>'archive')::boolean then
      if b.archived_at is not null then return jsonb_build_object('ok', false, 'error', 'already_archived'); end if;
      if b.status not in ('approved','rejected') or b.published_at is not null then return jsonb_build_object('ok', false, 'error', 'not_eligible', 'status', b.status); end if;
      perform set_config('chds.reason', 'Archived by the owner in My Reports', true);
      update public.reports set archived_at = now(), archived_by = act where id = p_id returning * into r;
    else
      if b.archived_at is null then return jsonb_build_object('ok', false, 'error', 'not_archived'); end if;
      if b.archived_by is distinct from act then return jsonb_build_object('ok', false, 'error', 'archived_by_admin'); end if;
      perform set_config('chds.reason', 'Restored by the owner in My Reports', true);
      update public.reports set archived_at = null, archived_by = null where id = p_id returning * into r;
    end if;
    return jsonb_build_object('ok', true, 'report', to_jsonb(r), 'prev_status', b.status);
  end if;
  if b.archived_at is not null then return jsonb_build_object('ok', false, 'error', 'archived'); end if;
  perform set_config('chds.reason', coalesce(nullif(p_patch->>'_reason', ''), 'Edited by the owner in My Reports'), true);
  update public.reports set
    title = case when p_patch ? 'title' then p_patch->>'title' else title end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    account_info = case when p_patch ? 'account_info' then p_patch->>'account_info' else account_info end,
    category = case when p_patch ? 'category' then p_patch->>'category' else category end,
    additional_info = case when p_patch ? 'additional_info' then p_patch->>'additional_info' else additional_info end,
    recovered = case when p_patch ? 'recovered' then (p_patch->>'recovered')::int else recovered end,
    revenue = case when p_patch ? 'revenue' then (p_patch->>'revenue')::numeric else revenue end,
    report_date = case when p_patch ? 'report_date' then (p_patch->>'report_date')::date else report_date end,
    status = 'pending', reviewed_by = null, reviewed_at = null, rejection_reason = null,
    approved_at = case when b.status = 'approved' then null else approved_at end
  where id = p_id returning * into r;
  return jsonb_build_object('ok', true, 'report', to_jsonb(r), 'prev_status', b.status, 'was_published', b.published_at is not null);
end $$;

-- Publication workflow (publish / unpublish / archive / unarchive), history written by the trigger
create or replace function public.report_publish(p_id text, p_actor text, p_action text, p_title text, p_summary text, p_reason text) returns jsonb language plpgsql as $$
declare r public.reports;
begin
  select * into r from public.reports where id = p_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform set_config('chds.actor', p_actor, true);
  perform set_config('chds.reason', coalesce(p_reason, ''), true);
  if p_action = 'publish' then
    if r.status <> 'approved' then return jsonb_build_object('ok', false, 'error', 'not_approved'); end if;
    if r.archived_at is not null then return jsonb_build_object('ok', false, 'error', 'archived'); end if;
    if r.published_at is not null then return jsonb_build_object('ok', false, 'error', 'already_published'); end if;
    if char_length(btrim(coalesce(p_title, ''))) not between 3 and 120 then return jsonb_build_object('ok', false, 'error', 'title_required'); end if;
    update public.reports set public_title = btrim(p_title), public_summary = nullif(left(btrim(coalesce(p_summary, '')), 600), ''),
           published_at = now(), published_by = p_actor, unpublished_at = null where id = p_id returning * into r;
  elsif p_action = 'unpublish' then
    if r.published_at is null then return jsonb_build_object('ok', false, 'error', 'not_published'); end if;
    update public.reports set published_at = null, unpublished_at = now() where id = p_id returning * into r;
  elsif p_action = 'archive' then
    if r.archived_at is not null then return jsonb_build_object('ok', false, 'error', 'already_archived'); end if;
    update public.reports set archived_at = now(), archived_by = p_actor where id = p_id returning * into r;
  elsif p_action = 'unarchive' then
    if r.archived_at is null then return jsonb_build_object('ok', false, 'error', 'not_archived'); end if;
    update public.reports set archived_at = null, archived_by = null where id = p_id returning * into r;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  return jsonb_build_object('ok', true, 'report', to_jsonb(r));
end $$;

-- Public feed: dedicated projection of explicitly published reports. It has NO uid, account info,
-- description, evidence, notes, revenue or reviewer columns. The API reads only this view.
create or replace view public.public_report_feed as
select r.id, r.public_title as title, r.public_summary as summary, r.category, r.report_date as activity_date, r.published_at, r.recovered,
       case when t.is_public and t.status = 'active' and t.deleted_at is null then t.display_name end as member_name
  from public.reports r
  left join public.team_members t on t.id = r.team_member_id
 where r.published_at is not null and r.status = 'approved' and r.deleted_at is null and r.archived_at is null;

-- Public homepage stats: totals and the daily chart stay aggregates of approved reports (as before), but the
-- per-report "recent" list now shows ONLY explicitly published reports, with their public fields (no revenue).
create or replace function public.stats_json(p_from date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'totals', (select jsonb_build_object('recovered', coalesce(sum(recovered),0), 'revenue', coalesce(sum(revenue),0), 'reports', count(*)) from public.reports where status='approved' and deleted_at is null),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'recovered', r, 'revenue', v) order by d)
              from (select report_date as d, sum(recovered) r, sum(revenue) v from public.reports where status='approved' and deleted_at is null and report_date >= p_from group by report_date) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'n', coalesce(member_name, 'CHDS Team'), 'recovered', recovered,
                                                            'ts', (extract(epoch from published_at)*1000)::bigint) order by published_at desc)
              from (select * from public.public_report_feed order by published_at desc limit 6) y), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------------
-- 10. Operations analytics (activity date vs submission date kept separate; Asia/Manila)
-- ---------------------------------------------------------------------------------
create or replace function public.ops_analytics(p_from date, p_to date, p_basis text) returns jsonb language sql stable as $$
  with rep as (
    select r.*, case when p_basis = 'submission' then (r.created_at at time zone 'Asia/Manila')::date else r.report_date end as d
      from public.reports r where r.deleted_at is null
  ), rr as (select * from rep where d between p_from and p_to),
  h as (select * from public.ai_handoff_requests where (created_at at time zone 'Asia/Manila')::date between p_from and p_to)
  select jsonb_build_object(
    'basis', case when p_basis = 'submission' then 'submission' else 'activity' end, 'from', p_from, 'to', p_to,
    'reports', jsonb_build_object(
      'total', (select count(*) from rr),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from rr group by status) x), '{}'::jsonb),
      'approved', (select count(*) from rr where status = 'approved'),
      'rejected', (select count(*) from rr where status = 'rejected'),
      'published', (select count(*) from rr where published_at is not null),
      'archived', (select count(*) from rr where archived_at is not null),
      'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'total', n, 'approved', a, 'published', pb) order by m) from (
          select to_char(d, 'YYYY-MM') m, count(*) n, count(*) filter (where status = 'approved') a, count(*) filter (where published_at is not null) pb
            from rr group by 1) x), '[]'::jsonb)),
    'support', jsonb_build_object(
      'active_now', (select count(*) from public.ai_handoff_requests where status in ('waiting','assigned','in_progress','waiting_customer')),
      'created', (select count(*) from h),
      'resolved', (select count(*) from h where status = 'resolved'),
      'closed', (select count(*) from h where status = 'closed'),
      'closed_in_range', (select count(*) from public.ai_handoff_requests where status = 'closed' and (closed_at at time zone 'Asia/Manila')::date between p_from and p_to),
      'avg_first_response_sec', (select round(avg(extract(epoch from first_response_at - created_at))) from h where first_response_at is not null),
      'avg_resolution_sec', (select round(avg(extract(epoch from coalesce(resolved_at, closed_at) - created_at))) from h where status in ('resolved','closed') and coalesce(resolved_at, closed_at) is not null),
      'csat_avg', (select round(avg(csat_rating)::numeric, 2) from h where csat_rating is not null),
      'csat_count', (select count(*) from h where csat_rating is not null),
      'by_priority', coalesce((select jsonb_object_agg(priority, n) from (select priority, count(*) n from h group by priority) x), '{}'::jsonb),
      'workload', coalesce((select jsonb_agg(jsonb_build_object('agent', coalesce(nm, 'Agent'), 'uid_tail', right(assigned_uid, 4), 'handled', n, 'open', o, 'closed', cl,
                 'avg_first_response_sec', fr, 'csat', cs) order by n desc) from (
          select assigned_uid, max(assigned_name) nm, count(*) n,
                 count(*) filter (where status in ('assigned','in_progress','waiting_customer')) o,
                 count(*) filter (where status = 'closed') cl,
                 round(avg(extract(epoch from first_response_at - created_at))) fr,
                 round(avg(csat_rating)::numeric, 2) cs
            from h where assigned_uid is not null group by assigned_uid) w), '[]'::jsonb))
  )
$$;

-- ---------------------------------------------------------------------------------
-- 11. RLS + privileges for every new object (Supabase grants new objects to anon by default)
-- ---------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['portal_otps','portal_sessions','ai_knowledge','support_quick_replies','staff_notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on table public.public_report_feed from anon, authenticated;
grant select on table public.public_report_feed to service_role;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute 'revoke all on function ' || f.sig || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f.sig || ' to service_role';
  end loop;
end $$;

notify pgrst, 'reload schema';
