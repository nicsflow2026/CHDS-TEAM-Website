-- =====================================================================================
-- CHDS 004 — V6 upgrade
--   * public report photos: a separate PUBLIC bucket (public-report-images) + report_public_images
--     (explicit, per-photo selection; the private report-evidence bucket stays private)
--   * permanent (hard) report deletion: delete_reports permission, a retryable deletion journal
--     (report_deletions), a deletion lock on the report row (deletion_pending_at) and two RPCs
--     (report_purge_begin / report_purge_finish)
--   * report_requeue: send an edited approved report back to review
--
-- Requires 001 + 002 + 003. ADDITIVE and IDEMPOTENT: no table or column is dropped and no existing row is
-- deleted by this migration. The only rows ever removed are those of a report an authorized administrator
-- permanently deletes, at that time, through report_purge_finish. Rollback steps: MIGRATION_GUIDE.md.
-- Take a backup first. Test on a development project before production.
-- =====================================================================================

-- ---------------------------------------------------------------------------------
-- 1. Permission
-- ---------------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('delete_reports', 'Permanently delete reports, their files and their report-specific records (irreversible)')
on conflict (key) do update set description = excluded.description;
update public.roles set permissions = (select array_agg(key order by key) from public.permissions) where id = 'founder';

-- ---------------------------------------------------------------------------------
-- 2. Deletion lock on the report row. While deletion_pending_at is set the report is invisible to the
--    public, cannot be edited, reviewed, published or given new files, and only the purge may finish it.
-- ---------------------------------------------------------------------------------
alter table public.reports add column if not exists deletion_pending_at timestamptz;
create index if not exists reports_deletion_pending on public.reports (deletion_pending_at) where deletion_pending_at is not null;

create or replace function public.reports_deletion_lock() returns trigger language plpgsql as $$
begin
  if old.deletion_pending_at is not null and coalesce(current_setting('chds.purge_report', true), '') <> old.id then
    raise exception 'deletion_pending' using errcode = 'PT423', detail = 'This report is being permanently deleted.';
  end if;
  return new;
end $$;
drop trigger if exists reports_deletion_lock on public.reports;
-- (fires after reports_before — same-timing triggers run in name order — and aborts the whole UPDATE either way)
create trigger reports_deletion_lock before update on public.reports for each row execute function public.reports_deletion_lock();

-- ---------------------------------------------------------------------------------
-- 3. Public report photos (explicitly selected copies of image evidence)
--    path is NULL while the photo is selected but not materialized (the report is unpublished):
--    the public object only exists while it may be shown.
-- ---------------------------------------------------------------------------------
create table if not exists public.report_public_images (
  id bigint generated always as identity primary key,
  report_id text not null references public.reports(id) on delete cascade,
  evidence_id bigint references public.report_evidence(id) on delete set null,
  path text unique,
  mime text check (mime is null or mime in ('image/jpeg','image/png','image/webp')),
  width int check (width is null or width between 1 and 20000),
  height int check (height is null or height between 1 and 20000),
  size_bytes int check (size_bytes is null or size_bytes > 0),
  alt_text text not null default '' check (char_length(alt_text) <= 200),
  sort_order int not null default 100 check (sort_order between 0 and 100000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists report_public_images_once on public.report_public_images (report_id, evidence_id) where evidence_id is not null;
create index if not exists report_public_images_report on public.report_public_images (report_id, sort_order, id);

-- no new files or photo selections for a report that is being deleted
create or replace function public.report_child_deletion_lock() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.reports where id = new.report_id and deletion_pending_at is not null) then
    raise exception 'deletion_pending' using errcode = 'PT423', detail = 'This report is being permanently deleted.';
  end if;
  return new;
end $$;
drop trigger if exists report_evidence_deletion_lock on public.report_evidence;
create trigger report_evidence_deletion_lock before insert on public.report_evidence for each row execute function public.report_child_deletion_lock();
drop trigger if exists report_public_images_deletion_lock on public.report_public_images;
create trigger report_public_images_deletion_lock before insert or update on public.report_public_images for each row execute function public.report_child_deletion_lock();

-- ---------------------------------------------------------------------------------
-- 4. Deletion journal (retryable job). It never stores report content. While a job is open it keeps the
--    report ID and the storage object paths it must remove (needed to resume after a partial failure);
--    on completion both are cleared and only the keyed, non-reversible deletion_ref remains.
-- ---------------------------------------------------------------------------------
create table if not exists public.report_deletions (
  id text primary key check (id ~ '^DEL-[A-Z0-9]{10}$'),
  deletion_ref text not null check (deletion_ref ~ '^[a-f0-9]{16,64}$'),
  report_id text,
  status text not null default 'pending' check (status in ('pending','storage_deleted','completed')),
  storage_paths jsonb not null default '[]',
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  check (status <> 'completed' or (report_id is null and storage_paths = '[]'::jsonb))
);
-- one open job per report: a duplicate request resumes the open job instead of starting a second one
create unique index if not exists report_deletions_open on public.report_deletions (report_id) where status <> 'completed';
create index if not exists report_deletions_status on public.report_deletions (status, requested_at desc);

-- ---------------------------------------------------------------------------------
-- 5. Append-only tables: narrowly scoped exception used ONLY inside report_purge_finish, which sets the
--    transaction-local settings below. Everything else stays append-only exactly as before.
--    * report_history: rows of the report being purged may be deleted
--    * revenue_history: rows of that report's revenue record may be deleted
--    * audit_log: rows that target that report may be REDACTED (never deleted) — content-bearing
--      columns are cleared and the target becomes the non-reversible deletion reference
-- ---------------------------------------------------------------------------------
create or replace function public.audit_log_immutable() returns trigger language plpgsql as $$
declare pr text := nullif(current_setting('chds.purge_report', true), '');
begin
  if pr is not null and tg_level = 'ROW' then
    if tg_table_name = 'report_history' and tg_op = 'DELETE' then
      if old.report_id = pr then return old; end if;
    elsif tg_table_name = 'revenue_history' and tg_op = 'DELETE' then
      if old.record_id = any (string_to_array(coalesce(current_setting('chds.purge_revenue', true), ''), ',')) then return old; end if;
    elsif tg_table_name = 'audit_log' and tg_op = 'UPDATE' then
      if old.target = pr and new.target = current_setting('chds.purge_ref', true) and new.prev is null and new.next is null
         and new.actor = old.actor and new.action = old.action and new.at = old.at then
        return new;
      end if;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------------
-- 6. Deletion RPCs
-- ---------------------------------------------------------------------------------
-- Step 1 (atomic): lock the report, hide it from the public immediately, record the job and return the
-- exact storage paths saved in the database. Idempotent: an open job for the report is returned as is.
create or replace function public.report_purge_begin(p_id text, p_job text, p_ref text, p_actor text, p_reason text) returns jsonb language plpgsql as $$
declare r public.reports; j public.report_deletions; paths jsonb;
begin
  if coalesce(char_length(btrim(p_reason)), 0) < 3 then return jsonb_build_object('ok', false, 'error', 'reason_required'); end if;
  select * into j from public.report_deletions where report_id = p_id and status <> 'completed' for update;
  if found then
    return jsonb_build_object('ok', true, 'resumed', true, 'job', to_jsonb(j));
  end if;
  select * into r from public.reports where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform set_config('chds.actor', p_actor, true);
  perform set_config('chds.reason', 'Permanent deletion started', true);
  update public.reports set deletion_pending_at = now(), published_at = null,
         unpublished_at = case when r.published_at is not null then now() else unpublished_at end
   where id = p_id;
  -- revenue derived from this report stops counting immediately
  update public.revenue_records set deleted_at = coalesce(deleted_at, now()), updated_at = now() where report_id = p_id;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into paths from (
    select jsonb_build_object('bucket', 'report-evidence', 'path', path) x from public.report_evidence where report_id = p_id
    union all
    select jsonb_build_object('bucket', 'public-report-images', 'path', path) from public.report_public_images where report_id = p_id and path is not null
  ) s;
  insert into public.report_deletions (id, deletion_ref, report_id, status, storage_paths, reason, requested_by)
  values (p_job, p_ref, p_id, 'pending', paths, left(btrim(p_reason), 500), p_actor) returning * into j;
  return jsonb_build_object('ok', true, 'resumed', false, 'job', to_jsonb(j));
end $$;

-- Step 3 (after the API removed and verified the storage objects): delete every report-specific row in ONE
-- transaction, redact the report's audit entries, verify, and close the job. Any error rolls the whole
-- step back and leaves the job open for a retry.
create or replace function public.report_purge_finish(p_job text) returns jsonb language plpgsql as $$
declare j public.report_deletions; rid text; rv text[]; n jsonb := '{}'::jsonb; c int;
begin
  select * into j from public.report_deletions where id = p_job for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'job_not_found'); end if;
  if j.status = 'completed' then return jsonb_build_object('ok', true, 'already_completed', true, 'deletion_ref', j.deletion_ref); end if;
  if j.status <> 'storage_deleted' then return jsonb_build_object('ok', false, 'error', 'storage_not_deleted'); end if;
  rid := j.report_id;
  select coalesce(array_agg(id), '{}') into rv from public.revenue_records where report_id = rid;
  perform set_config('chds.purge_report', rid, true);
  perform set_config('chds.purge_ref', j.deletion_ref, true);
  perform set_config('chds.purge_revenue', array_to_string(rv, ','), true);

  delete from public.report_public_images where report_id = rid;          get diagnostics c = row_count; n := n || jsonb_build_object('public_images', c);
  delete from public.report_evidence where report_id = rid;               get diagnostics c = row_count; n := n || jsonb_build_object('evidence', c);
  delete from public.revenue_history where record_id = any (rv);          get diagnostics c = row_count; n := n || jsonb_build_object('revenue_history', c);
  delete from public.revenue_records where report_id = rid;               get diagnostics c = row_count; n := n || jsonb_build_object('revenue_records', c);
  delete from public.report_history where report_id = rid;                get diagnostics c = row_count; n := n || jsonb_build_object('report_history', c);
  delete from public.internal_notes where subject_type = 'report' and subject_id = rid;  get diagnostics c = row_count; n := n || jsonb_build_object('notes', c);
  delete from public.staff_notifications where ref = rid or ref like rid || ':%';         get diagnostics c = row_count; n := n || jsonb_build_object('staff_notifications', c);
  delete from public.notification_log where ref = rid or ref like rid || ':%';           get diagnostics c = row_count; n := n || jsonb_build_object('notification_log', c);
  delete from public.bot_state where state ->> 'id' = rid;                                get diagnostics c = row_count; n := n || jsonb_build_object('bot_state', c);
  update public.audit_log set target = j.deletion_ref, prev = null, next = null,
         detail = jsonb_build_object('redacted', true, 'note', 'Report permanently deleted; details removed.')
   where target = rid;                                                   get diagnostics c = row_count; n := n || jsonb_build_object('audit_redacted', c);
  delete from public.reports where id = rid;                             get diagnostics c = row_count; n := n || jsonb_build_object('reports', c);

  -- verification inside the same transaction
  if exists (select 1 from public.reports where id = rid) or exists (select 1 from public.report_evidence where report_id = rid)
     or exists (select 1 from public.report_public_images where report_id = rid) or exists (select 1 from public.revenue_records where report_id = rid)
     or exists (select 1 from public.report_history where report_id = rid) then
    raise exception 'purge verification failed for %', rid;
  end if;

  update public.report_deletions set status = 'completed', completed_at = now(), report_id = null, storage_paths = '[]'::jsonb,
         last_error = null, updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'already_completed', false, 'deletion_ref', j.deletion_ref, 'deleted', n);
end $$;

-- Material edit of an approved report by someone who may not approve it: back to review (history row
-- written by reports_after; the publication invariant in reports_before unpublishes it).
create or replace function public.report_requeue(p_id text, p_actor text, p_reason text) returns jsonb language plpgsql as $$
declare r public.reports;
begin
  perform set_config('chds.actor', p_actor, true);
  perform set_config('chds.reason', coalesce(p_reason, 'Material change: review required again'), true);
  update public.reports set status = 'pending', reviewed_by = null, reviewed_at = null, approved_at = null, published_at = null
   where id = p_id and deleted_at is null and status = 'approved' returning * into r;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_approved'); end if;
  return jsonb_build_object('ok', true, 'report', to_jsonb(r));
end $$;

-- ---------------------------------------------------------------------------------
-- 7. Public projections exclude reports that are being deleted
-- ---------------------------------------------------------------------------------
create or replace view public.public_report_feed as
select r.id, r.public_title as title, r.public_summary as summary, r.category, r.report_date as activity_date, r.published_at, r.recovered,
       case when t.is_public and t.status = 'active' and t.deleted_at is null then t.display_name end as member_name
  from public.reports r
  left join public.team_members t on t.id = r.team_member_id
 where r.published_at is not null and r.status = 'approved' and r.deleted_at is null and r.archived_at is null and r.deletion_pending_at is null;

create or replace function public.stats_json(p_from date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'totals', (select jsonb_build_object('recovered', coalesce(sum(recovered),0), 'revenue', coalesce(sum(revenue),0), 'reports', count(*)) from public.reports where status='approved' and deleted_at is null and deletion_pending_at is null),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'recovered', r, 'revenue', v) order by d)
              from (select report_date as d, sum(recovered) r, sum(revenue) v from public.reports where status='approved' and deleted_at is null and deletion_pending_at is null and report_date >= p_from group by report_date) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'n', coalesce(member_name, 'CHDS Team'), 'recovered', recovered,
                                                            'ts', (extract(epoch from published_at)*1000)::bigint) order by published_at desc)
              from (select * from public.public_report_feed order by published_at desc limit 6) y), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------------
-- 8. Storage: separate PUBLIC bucket for approved public photos only (images, 5 MB max).
--    The private report-evidence bucket is unchanged (private). No storage.objects policies are created:
--    browsers never write to Storage; the server uses the service role. Anonymous users can only fetch
--    a public object by its exact (random, unguessable) URL and cannot list the bucket.
-- ---------------------------------------------------------------------------------
do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('public-report-images', 'public-report-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  update storage.buckets set public = false where id = 'report-evidence';
exception
  when undefined_column then
    insert into storage.buckets (id, name, public) values ('public-report-images', 'public-report-images', true) on conflict (id) do nothing;
    update storage.buckets set public = false where id = 'report-evidence';
  when undefined_table then
    raise notice 'storage schema not found: create the bucket public-report-images (PUBLIC, images only) in Supabase -> Storage';
end $$;

-- ---------------------------------------------------------------------------------
-- 9. RLS + privileges for the new objects (Supabase grants new objects to anon by default)
-- ---------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['report_public_images','report_deletions'] loop
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

insert into public.system_settings (key, value) values ('migration_004', jsonb_build_object('applied_at', now())) on conflict (key) do nothing;
notify pgrst, 'reload schema';
