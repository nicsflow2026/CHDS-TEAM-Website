# Migration guide — V5 → V6

**Back up first** (Supabase → Database → Backups, or `pg_dump`). Apply on a **development** project before production.
Never reset the production database.

## Which file to run

| You are on | Run in Supabase → SQL Editor |
|---|---|
| V5 (migrations 001–003 applied) | **`supabase/migrations/004_v6_publishing_deletion.sql`** only |
| V4 | `003_v5_cases_reports_kb.sql`, then `004_v6_publishing_deletion.sql` |
| New project | all of `supabase.sql` (001 + 002 + 003 + 004, regenerated with `npm run build:sql`) |

Run the SQL **before** deploying the V6 code. V6 code against a V5 database answers `503 db_not_migrated` for the new
features; `/api/health` (with `X-Setup-Key`) lists `migration:004` as missing.

## What migration 004 does

Additive and idempotent (safe to run twice). No table or column is dropped and no existing row is deleted.

| Change | Detail |
|---|---|
| Permission `delete_reports` | inserted; the Founder role is refreshed to hold every permission. No other role receives it. |
| `reports.deletion_pending_at` | new nullable column + partial index; `reports_deletion_lock` BEFORE UPDATE trigger (SQLSTATE `PT423`) |
| `report_public_images` | new table (FK `report_id` → `reports` ON DELETE CASCADE, `evidence_id` → `report_evidence` ON DELETE SET NULL, unique `path`, unique `(report_id, evidence_id)`); insert/update lock trigger during deletion |
| `report_evidence` | insert lock trigger during deletion (no new files for a report being deleted) |
| `report_deletions` | new deletion journal; partial unique index = one open job per report; CHECK clears report ID + paths on completion |
| `audit_log_immutable()` | **replaced**: still raises for every UPDATE/DELETE/TRUNCATE, except — only inside `report_purge_finish`, keyed to the report being purged through transaction-local settings — deleting that report's `report_history` / `revenue_history` rows and redacting (never deleting) its `audit_log` rows |
| `report_purge_begin`, `report_purge_finish`, `report_requeue` | new functions (service role only) |
| `public_report_feed`, `stats_json` | recreated with the extra filter `deletion_pending_at is null` (same columns/shape) |
| Storage | bucket `public-report-images` (public, 5 MB, JPG/PNG/WebP); `report-evidence` re-asserted **private** |
| RLS / grants | RLS on both new tables, `anon`/`authenticated` revoked; every public function executable by `service_role` only |

## Verify

```sql
select key from permissions where key = 'delete_reports';
select column_name from information_schema.columns where table_name = 'reports' and column_name = 'deletion_pending_at';
select to_regclass('public.report_public_images'), to_regclass('public.report_deletions');
select id, public from storage.buckets where id in ('report-evidence','public-report-images');   -- false / true
select value from system_settings where key = 'migration_004';
```
Then Dashboard → System Health: no missing tables, migrations or buckets.

## Rollback

Only roll back if V6 code is **not** deployed (deploy V5 code first). Rolling back does not restore permanently
deleted reports — nothing can (PERMANENT_DELETION.md).

```sql
begin;
-- restore V5 behaviour of the append-only trigger function
create or replace function public.audit_log_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only' using errcode = '42501'; end $$;
drop trigger if exists reports_deletion_lock on public.reports;
drop trigger if exists report_evidence_deletion_lock on public.report_evidence;
drop function if exists public.reports_deletion_lock();
drop function if exists public.report_purge_begin(text, text, text, text, text);
drop function if exists public.report_purge_finish(text);
drop function if exists public.report_requeue(text, text, text);
-- re-run sections "public_report_feed" and "stats_json" of 003_v5_cases_reports_kb.sql (V5 definitions), then:
-- (optional, loses public photo selections and the deletion journal)
-- drop table public.report_public_images; drop table public.report_deletions; drop function public.report_child_deletion_lock();
-- alter table public.reports drop column deletion_pending_at;   -- only if no report is mid-deletion
-- delete from public.roles ... / update public.roles set permissions = array_remove(permissions, 'delete_reports');
-- delete from public.permissions where key = 'delete_reports';
commit;
```
Before dropping `deletion_pending_at`, check `select id from reports where deletion_pending_at is not null` — those
reports are mid-deletion; finish them (Retry) first. Objects in `public-report-images` can be removed in the Storage UI.

## Testing status of this migration

The SQL in 004 was **not executed against PostgreSQL** in the V6 build environment (no database was available).
Its contracts are emulated in `tests/support/fake.mjs` and exercised by `tests/v6.test.mjs`. Run it on a development
project first and use the verification queries above. See TEST_REPORT.md.
