# Permanent report deletion (V6)

> **Deleted reports and their files cannot be recovered through CHDS.** There is no archive, no trash, no
> scheduled purge and no "undo". Only a database or storage backup taken *before* the deletion could still
> contain the data (see [Recovery limitations](#recovery-limitations)).

## Who can delete

| Requirement | Enforced where |
|---|---|
| Signed-in dashboard session | `api/admin/[a].js` (every request) |
| Permission **`delete_reports`** | router, before the handler runs (`lib/admin/v6.js` → `report_purge`). Founders (`ADMIN_UIDS` and the Founder role) hold it; **no other role has it by default** — grant it per role or per user in Roles & Permissions. |
| Password re-confirmation within the last few minutes | router (`reauth: true`), HTTP 428 otherwise; the dashboard prompts automatically |
| Report inside the administrator's team scope | `report()` helper in `lib/admin/v6.js` |
| Reason (3–500 characters) | API **and** `report_purge_begin` |
| The report ID typed back exactly | API (`confirm` must equal the ID) |

The browser only hides the button; every rule above is checked on the server. A report owner's **Withdraw**
action in My Reports is *not* a permanent deletion (it hides the report from the owner and from review;
administrators can then delete it permanently).

Works for pending, reviewed, approved, published, unpublished, archived, edited and owner-withdrawn reports.
A published report does **not** need to be unpublished first.

## What is deleted

| Data | Where | How |
|---|---|---|
| The report row | `reports` | deleted |
| Evidence records + **files** | `report_evidence` + bucket `report-evidence` | files removed, then rows deleted |
| Public photo records + **public copies** | `report_public_images` + bucket `public-report-images` | files removed, then rows deleted |
| Orphaned uploads in the report's own folder (an upload interrupted before its row was written) | both buckets, folder `<report ID>/` | removed (folder sweep) |
| Report history | `report_history` (append-only) | deleted under a transaction-scoped exception |
| Report-derived revenue + its history | `revenue_records` (`report_id`) + `revenue_history` (append-only) | deleted |
| Internal notes | `internal_notes` (`subject_type='report'`) | deleted |
| Dashboard notifications | `staff_notifications` (`ref` = report ID or `ID:…`) | deleted |
| Telegram delivery log | `notification_log` (same refs) | deleted; the approvers' Telegram review cards are first **edited** to "This report was permanently deleted" so no report content stays in their chats |
| Pending Telegram step referencing the report | `bot_state` | deleted |
| Audit entries that target the report | `audit_log` (append-only) | **redacted, not deleted**: `target` becomes the deletion reference, `prev`/`next` (which can contain old field values) are cleared, `detail` becomes `{"redacted":true}`; actor, action and time are kept |

Nothing else is touched: every statement is filtered by the exact report ID, storage paths outside
`<report ID>/` are never removed (a corrupt row pointing at another report's file is skipped and logged),
and the tests verify a control report is byte-for-byte unchanged after every scenario.

### What remains (the minimal security record)

* `report_deletions`: job ID, **deletion reference** (HMAC-SHA-256 of the report ID keyed with `SESSION_SECRET`,
  first 32 hex characters — not reversible without the secret), reason, administrator, requested/completed
  times, attempt count. While a job is **open** it also holds the report ID and the storage paths it must remove
  (needed to resume); both are cleared when it completes (enforced by a CHECK constraint).
* Two `audit_log` events targeting the deletion reference: `report_permanent_delete_started` and
  `report_permanently_deleted` (reason, administrator, file/row counts — no report content).

## Sequence

1. Authenticate · 2. check `delete_reports` (+ password re-confirmation) · 3. validate the ID, reason and typed confirmation
4. **`report_purge_begin`** (one transaction): lock the row (`deletion_pending_at`), unpublish it, stop its revenue
   counting, journal the job with the storage paths *saved in the database*. Idempotent: an open job is resumed.
5. Audit `report_permanent_delete_started` · 6–7. the report is already invisible to the public feed, search,
   homepage totals and the owner; the lock (database trigger `reports_deletion_lock`, SQLSTATE PT423 → HTTP 423)
   blocks edits, reviews, publication and new files or photos.
8. Remove the objects from **both buckets**, then **verify each one is gone** (a HEAD request per object; if
   Storage cannot confirm, the step fails — it is never assumed). Job → `storage_deleted`.
9. Edit Telegram review cards · **`report_purge_finish`** (one transaction): delete every row listed above, redact
   the audit entries, verify inside the transaction, close the job. Any error rolls the whole step back.
10–11. Verify again from outside (no report, evidence or photo rows).
12–13. Public endpoints (`/api/public/reports`, `/api/stats`) are `no-store`, so totals, search and the feed change
   on the next request; the public feed's polling sees a new version hash.
14. Respond `200 { ok, deletion_ref, files_deleted, rows_deleted }` — or **502** with `job_id` and the failed `step`.

## Failures and retry

| Situation | Result | Retry |
|---|---|---|
| Storage delete fails, an object survives, or Storage cannot confirm | 502 `step: storage`; job `pending` with `last_error`; report stays hidden + locked | "Retry permanent deletion" in the report, the banner on Reports, or `report_purge_retry` |
| Database step fails | 502 `step: database`; the transaction rolled back (no partial row deletion); files already gone; job `storage_deleted` | same; storage step re-verifies (idempotent), then the database step runs |
| Two administrators / double click / network retry | one open job per report (unique index); later requests resume it; a request after completion gets 404 | — |
| Verification mismatch after the database step | 502 `verification_failed` | retry |

The dashboard never shows "deleted" unless the server returned 200, and never retries a deletion automatically.

## Recovery limitations

* **Through the application: none.** Deleted rows and files are gone.
* **Existing backups:** CHDS backups (Backup & Recovery) and Supabase's own database backups / point-in-time
  recovery taken *before* the deletion still contain the report row and history (CHDS backups do not contain
  storage files). This is outside the application's control; restoring such a backup would bring the row back.
  Treat backups accordingly (retention, access).
* **CDN/browser caches:** public photo copies are served with `Cache-Control: public, max-age=300`. A browser or the
  Supabase CDN can keep showing a removed public photo for up to ~5 minutes (Supabase Smart CDN invalidates sooner).
  Private evidence was never public.
* **Telegram:** review cards are edited; messages the bot cannot edit (e.g. older than 48 h or deleted by the user)
  stay as they are in that user's chat.

## Operator checklist

1. Apply migration **004** (MIGRATION_GUIDE.md). 2. Grant `delete_reports` only to the people who need it.
3. Make sure the bucket `public-report-images` exists (STORAGE_CONFIGURATION.md). 4. Check **System Health** →
   storage shows no missing buckets. 5. Watch **Reports** for the "permanent deletion did not finish" banner.
