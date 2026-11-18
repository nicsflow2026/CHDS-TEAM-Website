-- CHDS: run in Supabase -> SQL Editor (safe to re-run after updates)
-- (old note) run this ONCE in Supabase -> SQL Editor -> New query -> Run
create table if not exists public.reports (
  id text primary key,
  uid text not null,
  name text not null,
  recovered int not null check (recovered between 0 and 9999),
  revenue numeric(12,2) not null check (revenue between 0 and 10000000),
  report_date date not null,
  status text not null default 'pending' check (status in ('pending','approved')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists reports_pub on public.reports (status, report_date);
create index if not exists reports_uid on public.reports (uid, created_at desc);

create table if not exists public.sessions (
  sid text primary key,
  name text not null default '',
  status text not null default 'ended' check (status in ('wait','live','ended')),
  joined jsonb not null default '{}',
  notif jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sid text not null references public.sessions(sid) on delete cascade,
  sender text not null check (sender in ('user','agent','sys')),
  author text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_sid on public.messages (sid, id);
create table if not exists public.agents (uid text primary key, active_sid text);
create table if not exists public.bot_state (uid text primary key, state jsonb not null, expires_at timestamptz not null);
create table if not exists public.tg_updates (update_id bigint primary key, created_at timestamptz not null default now());
create table if not exists public.rate_limits (key text primary key, n int not null, t timestamptz not null default now());

create table if not exists public.admin_sessions (id text primary key, uid text not null, ip text, created_at timestamptz not null default now(), expires_at timestamptz not null);
create table if not exists public.admin_otps (uid text primary key, code_hash text not null, attempts int not null default 0, expires_at timestamptz not null);
create table if not exists public.audit_log (id bigint generated always as identity primary key, at timestamptz not null default now(), actor text not null, action text not null, detail jsonb not null default '{}');

-- Row Level Security ON with no policies: the public/anon key can NOT read or write anything.
-- Only the server (service_role key in Vercel env) can access the data.
alter table public.reports enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.agents enable row level security;
alter table public.bot_state enable row level security;
alter table public.tg_updates enable row level security;
alter table public.rate_limits enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_otps enable row level security;
alter table public.audit_log enable row level security;

create or replace function public.stats_json(p_from date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'totals', (select jsonb_build_object('recovered', coalesce(sum(recovered),0), 'revenue', coalesce(sum(revenue),0), 'reports', count(*)) from public.reports where status='approved'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'recovered', r, 'revenue', v) order by d)
              from (select report_date as d, sum(recovered) r, sum(revenue) v from public.reports where status='approved' and report_date >= p_from group by report_date) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('n', name, 'recovered', recovered, 'revenue', revenue, 'ts', (extract(epoch from created_at)*1000)::bigint) order by created_at desc)
              from (select * from public.reports where status='approved' order by created_at desc limit 6) y), '[]'::jsonb)
  )
$$;

create or replace function public.user_totals(p_uid text) returns jsonb language sql stable as $$
  select jsonb_build_object('recovered', coalesce(sum(recovered),0), 'revenue', coalesce(sum(revenue),0)) from public.reports where uid = p_uid and status = 'approved'
$$;

create or replace function public.rate_hit(p_key text, p_max int, p_win int) returns boolean language plpgsql as $$
declare v int;
begin
  if random() < 0.02 then
    delete from public.rate_limits where t < now() - interval '1 day';
    delete from public.tg_updates where created_at < now() - interval '2 days';
    delete from public.admin_sessions where expires_at < now();
    delete from public.admin_otps where expires_at < now();
    delete from public.sessions where status = 'ended' and updated_at < now() - interval '30 days';
    delete from public.audit_log where at < now() - interval '180 days';
  end if;
  insert into public.rate_limits(key, n, t) values (p_key, 1, now())
  on conflict (key) do update set
    n = case when public.rate_limits.t < now() - make_interval(secs => p_win) then 1 else public.rate_limits.n + 1 end,
    t = case when public.rate_limits.t < now() - make_interval(secs => p_win) then now() else public.rate_limits.t end
  returning n into v;
  return v > p_max;
end $$;

create or replace function public.open_session(p_sid text, p_name text) returns jsonb language plpgsql as $$
declare s public.sessions;
begin
  insert into public.sessions(sid, name, status) values (p_sid, p_name, 'ended') on conflict (sid) do nothing;
  select * into s from public.sessions where sid = p_sid for update;
  if s.status <> 'ended' then return jsonb_build_object('existing', true); end if;
  delete from public.messages where sid = p_sid;
  update public.sessions set status='wait', name=p_name, joined='{}', notif='[]', created_at=now(), updated_at=now() where sid = p_sid;
  insert into public.messages(sid, sender, body) values (p_sid, 'sys', 'Request sent. Please wait for CHDS human support to join. AI replies are paused until then.');
  return jsonb_build_object('existing', false);
end $$;

create or replace function public.join_session(p_sid text, p_uid text, p_name text) returns jsonb language plpgsql as $$
declare s public.sessions;
begin
  select * into s from public.sessions where sid = p_sid for update;
  if not found or s.status = 'ended' then return jsonb_build_object('ok', false); end if;
  if not (s.joined ? p_uid) then
    update public.sessions set joined = joined || jsonb_build_object(p_uid, p_name) where sid = p_sid;
    insert into public.messages(sid, sender, body) values (p_sid, 'sys', p_name || ' from CHDS Support joined the chat.');
  end if;
  update public.sessions set status='live', updated_at=now() where sid = p_sid;
  insert into public.agents(uid, active_sid) values (p_uid, p_sid) on conflict (uid) do update set active_sid = excluded.active_sid;
  return jsonb_build_object('ok', true, 'name', s.name,
    'tail', coalesce((select jsonb_agg(body order by id) from (select id, body from public.messages where sid = p_sid and sender = 'user' order by id desc limit 5) t), '[]'::jsonb),
    'others', coalesce((select jsonb_agg(k) from jsonb_object_keys(s.joined) k where k <> p_uid), '[]'::jsonb));
end $$;

create or replace function public.exit_session(p_sid text, p_uid text) returns jsonb language plpgsql as $$
declare s public.sessions; nm text; lft jsonb;
begin
  select * into s from public.sessions where sid = p_sid for update;
  if not found or s.status = 'ended' or not (s.joined ? p_uid) then
    update public.agents set active_sid = null where uid = p_uid and active_sid = p_sid;
    return jsonb_build_object('ok', false);
  end if;
  nm := s.joined ->> p_uid;
  update public.sessions set joined = joined - p_uid, updated_at = now() where sid = p_sid returning * into s;
  update public.agents set active_sid = null where uid = p_uid and active_sid = p_sid;
  if s.joined = '{}'::jsonb then
    update public.sessions set status = 'ended' where sid = p_sid;
    insert into public.messages(sid, sender, body) values (p_sid, 'sys', nm || ' left the chat. CHDS AI Support is back to assist you.');
    return jsonb_build_object('ok', true, 'ended', true, 'nm', nm, 'left', '[]'::jsonb, 'notif', s.notif);
  end if;
  select jsonb_agg(k) into lft from jsonb_object_keys(s.joined) k;
  insert into public.messages(sid, sender, body) values (p_sid, 'sys', nm || ' left the chat.');
  return jsonb_build_object('ok', true, 'ended', false, 'nm', nm, 'left', coalesce(lft, '[]'::jsonb));
end $$;

create or replace function public.end_session(p_sid text) returns jsonb language plpgsql as $$
declare s public.sessions;
begin
  update public.sessions set status = 'ended', updated_at = now() where sid = p_sid and status <> 'ended' returning * into s;
  if not found then return jsonb_build_object('ok', true, 'joined', '[]'::jsonb, 'notif', '[]'::jsonb, 'name', ''); end if;
  insert into public.messages(sid, sender, body) values (p_sid, 'sys', 'Chat closed. CHDS AI Support is back to assist you.');
  update public.agents set active_sid = null where active_sid = p_sid;
  return jsonb_build_object('ok', true, 'name', s.name, 'notif', s.notif, 'joined', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(s.joined) k));
end $$;

create or replace function public.post_message(p_sid text, p_sender text, p_author text, p_body text) returns jsonb language plpgsql as $$
declare s public.sessions;
begin
  select * into s from public.sessions where sid = p_sid;
  if not found or s.status = 'ended' then return jsonb_build_object('ok', false); end if;
  insert into public.messages(sid, sender, author, body) values (p_sid, p_sender, p_author, p_body);
  update public.sessions set updated_at = now() where sid = p_sid;
  return jsonb_build_object('ok', true, 'st', s.status, 'name', s.name, 'joined', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(s.joined) k));
end $$;

create or replace function public.poll_session(p_sid text, p_after bigint) returns jsonb language plpgsql as $$
declare s public.sessions; expd jsonb;
begin
  update public.sessions set status = 'ended', updated_at = now() where sid = p_sid and status = 'wait' and created_at < now() - interval '15 minutes' returning * into s;
  if found then
    expd := s.notif;
    insert into public.messages(sid, sender, body) values (p_sid, 'sys', 'No agent is available right now. CHDS AI Support will keep assisting you, or message us on Telegram.');
  end if;
  select * into s from public.sessions where sid = p_sid;
  if not found then return jsonb_build_object('st', 'ended', 'n', 0, 'msgs', '[]'::jsonb); end if;
  return jsonb_build_object('st', s.status, 'n', (select count(*) from jsonb_object_keys(s.joined)), 'expired', expd,
    'msgs', coalesce((select jsonb_agg(jsonb_build_object('i', id, 'f', sender, 't', body, 'a', author) order by id) from public.messages where sid = p_sid and id > p_after and sender <> 'user'), '[]'::jsonb));
end $$;

create or replace function public.agent_chats(p_uid text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'act', (select active_sid from public.agents where uid = p_uid),
    'chats', coalesce((select jsonb_agg(jsonb_build_object('sid', sid, 'name', name) order by updated_at) from public.sessions where status <> 'ended' and joined ? p_uid), '[]'::jsonb))
$$;

-- Only the server (service_role) may call these functions
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('stats_json','user_totals','rate_hit','open_session','join_session','exit_session','end_session','post_message','poll_session','agent_chats')
  loop
    execute 'revoke all on function ' || f.sig || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f.sig || ' to service_role';
  end loop;
end $$;
