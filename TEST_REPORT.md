# CHDS V6 — test report

Date: 2026-11-20 · Node 22.23.5 · headless Chromium (Playwright) · **all results below were produced by actually
running the commands listed; nothing is claimed that was not executed.**

## What could NOT be tested here (read first)

| Not tested | Why | What to do |
|---|---|---|
| Migration `004_v6_publishing_deletion.sql` on **PostgreSQL** | no database server was available in the build environment (no network, no `psql`) | apply it to a **development** Supabase project first; run the verification queries in MIGRATION_GUIDE.md |
| Real **Supabase Storage** (bucket creation, `HEAD` existence check, folder listing, deletion) | same | follow the smoke test in DEPLOYMENT_GUIDE.md |
| Real **Telegram Bot API** (command menus per scope/language, message edits) | no network | run *Connect Telegram bot* and check the reported `scopes_checked` / problems |
| Real **Groq** AI | no network | *Test AI* in System Health |
| **Deployment** to Vercel | not performed | DEPLOYMENT_GUIDE.md |
| Actual touch hardware, Safari/WebKit, Firefox | only Chromium is installed | test on real devices |

All server logic ran end to end through the **real API handlers and bot code** against an in-memory test double
(`tests/support/fake.mjs`) that emulates PostgREST, the SQL functions' **contracts** (including transaction rollback
of `report_purge_finish`, the deletion lock, unique open jobs, append-only tables), Supabase Storage (upload,
download, exact-key delete, HEAD, folder list, failure injection) and the Telegram Bot API. The emulation proves the
application logic; it does **not** prove the SQL text itself.

## Summary of executed runs

| Command | Result |
|---|---|
| `npm test` (unit, api, admin, v5, **v6**, **imagemeta**) | **135 / 135 passed**, 0 failed |
| `npm run check` (syntax of every JS file, server module linking, vercel.json rules, secret scan of 27 public files) | **OK** |
| `python3 tests/visual/run_v6.py` (V6 UI at **13 widths**: 320, 360, 375, 390, 430, 480, 768, 820, 1024, 1280, 1366, 1440, 1920) | **333 checks, 0 problems** (`tests/visual/report_v6.json`, screenshots in `tests/visual/screens_v6/`) |
| `python3 tests/visual/run_visual.py` (V5 responsive suite, now at the same **13 widths**) | **0 problems** — 130 public-page checks, 364 dashboard checks, 41 interaction checks, 2 chat flows, 78 accessibility scans (`tests/visual/report.json`, screenshots in `tests/visual/screens/`) |
| `python3 tests/visual/run_flows.py` (V5 end-to-end UI flows) | **20 / 20 flow checks passed**, 0 unexpected errors (CSAT, reopen, publish → public feed, CSV export, knowledge base, notifications, team photo, portal submit / edit / withdraw) |
| Browser smoke test of the whole V6 path (gallery → lightbox → chat → photo selection → permanent deletion with password re-confirmation → 3-file portal upload) | passed, **0 JS errors, 0 CSP violations** |
| `lib/imagemeta.js` against real JPEG/PNG/WebP files written by Pillow (GPS EXIF, camera make, JPEG comment, PNG text chunks, WebP EXIF), outputs re-decoded by Pillow | all metadata removed, JPEG orientation kept, all outputs decode |

### V5 tests changed on purpose

Three V5 assertions described behaviour the V6 specification removes; they were rewritten, not deleted:

1. `v5: Telegram: /report was removed …` — now asserts `/myreports` is **not** a command and `/report` is unrecognized.
2. `v5: Telegram /delete follows the website rules …` → `… the retired /delete and /myreports commands and old delete buttons no longer delete anything`.
3. `api: founder … holds every permission` — permission count 23 → **24** (`delete_reports`).

The two Telegram tests also had a hidden coupling: when the first assertion of the old `/delete` test failed, its
clean-up line never ran and a published fixture leaked into two later tests (public feed, admin filters). The
rewritten test keeps the clean-up, and both later tests pass unchanged.

## Requirement coverage (automated)

### Report portal photo publishing — `tests/v6.test.mjs`
| Scenario | Result |
|---|---|
| Submit report with multiple images (portal) | pass |
| Selection refused before approval; approval alone does not publish | pass |
| Select 2 of 3 photos, publish → exactly 2 photos public; public bucket URLs; width/height (EXIF-rotated) and alt text | pass |
| Unselected photos stay private; originals stay in `report-evidence`; public copies metadata-free | pass |
| Public JSON contains no `report-evidence`, evidence IDs, hashes, uploader, account info, sizes | pass |
| Replace (old object deleted), alt text, remove (object deleted), PDF refused | pass |
| Unpublish → public objects deleted, report gone from API; republish → **new** URLs | pass |
| Search finds published reports only | pass |
| Support agent without `publish_reports` → 403 | pass |
| Material edit by editor without `approve_reports` → back to Pending + unpublished + public copies removed; public-fact edit → unpublished; internal edit by approver → unchanged; owner edit of published report → copies removed | pass |

### Permanent deletion — `tests/v6.test.mjs` (a control report is verified byte-identical after every scenario)
| Scenario | Result |
|---|---|
| Pending report with one photo | pass — row, history, revenue, notes, notifications, Telegram log, bot state and file gone; audit redacted; Telegram cards edited |
| Published report with multiple public photos (+ private evidence), no unpublish first | pass — 6 files gone; feed, search and homepage totals (revenue −5000, reports −1) updated |
| Private evidence only; no attachments; approved; previously edited; owner-withdrawn | pass |
| Multiple related records (2 notes, revenue + revenue history, staff notifications, pending Telegram reject step) | pass |
| Failed storage deletion → 502, report hidden + locked (edit/publish/photo 423, owner 404), job open, retry completes | pass |
| Object survives removal / Storage cannot confirm → **never** reported as deleted; same job resumed | pass |
| Failed database deletion → transaction rolled back, job `storage_deleted`, retry completes | pass |
| Duplicate requests (3 concurrent) → one job, no damage; repeat after success → 404 | pass |
| Unauthorized: administrator / support agent 403, no password re-confirmation 428, wrong typed ID 400, no reason 400, no session 401 — nothing deleted, no job | pass |
| Orphaned upload in the report folder swept; a DB path pointing at another report's file is **not** deleted | pass |
| After success: no row in any report table, no audit entry targets the ID, no report text in the audit log, no object in either bucket, not in public API or search, journal keeps no report ID / paths / content | pass (checked by `assertGone` for every scenario) |

### AI Support
| Scenario | Where | Result |
|---|---|---|
| Open launcher, load, send, receive (13 widths) | run_v6.py | pass |
| Failed reply → Retry answers the saved message; user message stored once; repeat retry refused; another visitor cannot retry | v6.test.mjs | pass |
| Network failure → Retry → no duplicate in the UI; stable after page refresh | run_v6.py | pass |
| Human handoff → agent accepts → agent reply; refresh resumes after mirrored message IDs (0 re-delivered); no internal metadata sent | v6.test.mjs | pass |
| Waiting state shows the request ID | run_v6.py | pass |
| Close case → customer send 409, retry 409 `case_closed` | v6.test.mjs | pass |
| Delayed new-request alert after closure → 0 Telegram messages, stopped; retry → `not_waiting` | v6.test.mjs | pass |
| Start a new conversation after closure; V5 closure scenarios (22) | v5.test.mjs | pass |

### Loading system
| Scenario | Where | Result |
|---|---|---|
| Skeletons (feed, chat, admin tables), button loading/disabled states, duplicate submission ignored, upload progress, confirmed-only success, reduced motion (no infinite animations running) | run_v6.py + smoke | pass |
| Request timeout / failed request → error + retry state (chat network abort) | run_v6.py | pass |
| Stale list responses ignored (dashboard, public feed) | code review only — no automated race test | — |

### Telegram — `tests/v6.test.mjs`
| Scenario | Result |
|---|---|
| Exactly `/help /portal /chats /quene /offline /online /cancel`; spelling `quene` | pass |
| Sync clears seeded old commands in `default`, `default/en`, `chat:1000`, `all_group_chats`, then verifies by reading back; re-pollution of `tl` cleaned | pass |
| `/help` lists only the seven; `/myreports /total /delete /pending /queue /report /skip` unrecognized; `/start` onboards; `/portal` link has no credentials | pass |
| `/quene` Accept + View Details; two agents accept concurrently → assigned exactly once, loser told who accepted | pass (fake is single-threaded; the SQL uses `SELECT … FOR UPDATE`) |
| `/chats` reference, name, status, last activity; resolved chats not listed | pass |
| `/offline` keeps assignment; `/online`; `/cancel` expires only own step, availability unchanged, other agent's step untouched, case untouched; "Nothing to cancel" | pass |
| Skip-summary button replaces `/skip` | pass |

### Responsive (13 widths)
`run_v6.py`: no horizontal overflow on `/reports`, chat and portal; chat panel, launcher, lightbox image and controls,
and the delete modal inside the viewport; gallery frames keep 4:3. `run_visual.py`: every public page and dashboard
view at all 13 widths (see result above).

### A regression the V5 suite caught during V6 work

The first 13-width run of `run_visual.py` reported 4 problems: the redesigned chat header said "Waiting for an agent"
and "Read-only · …" where the rest of the platform says **"Waiting for Agent"** and **"Closed · read-only"**. The
widget was corrected (not the tests) to keep one vocabulary; the rerun reported 0 problems. Two other first-run
failures were in the test scripts themselves (they assumed 360 px was the first width; fixed to use the first
configured width).

## Bugs found and fixed (with regression tests)

| Bug | Fix | Test |
|---|---|---|
| Chat: pressing Enter while a reply was pending cleared the input and dropped the text | input kept until a send is accepted | run_v6.py (send states) |
| Chat: after a refresh during a human chat, every agent/system message appeared twice | transcript exposes the room message ID; polling resumes after it; client de-duplicates | v6.test.mjs + run_v6.py |
| Chat: a failed AI reply could only be "retried" by sending the message again (stored twice) | `retry_of` | v6.test.mjs + run_v6.py |
| Telegram alerts could continue after a case was closed mid-broadcast | per-recipient state check | v6.test.mjs |
| Evidence upload failing after the file reached Storage left an orphaned file | upload → row, rollback on failure | covered by deletion orphan sweep test |
| Dashboard requests had no timeout (spinner could run forever); lists could render stale responses | timeouts + stale guards | smoke / code review |
| Owner-withdrawn reports were invisible to administrators | "Withdrawn by owner" filter | v6.test.mjs |
| Homepage heading said "Latest approved reports" for published-only data | label corrected | — |
| Test double: Storage DELETE was a no-op (deletion could never be proven) | real exact-key delete, HEAD, list, failure injection | all deletion tests |

## Known issues / remaining risks

* Migration 004 not executed on PostgreSQL (see top). The SQL was reviewed by hand; the PL/pgSQL field accesses in
  `audit_log_immutable()` are nested so no branch reads a column the current table lacks.
* Earlier backups (CHDS and Supabase) still contain deleted reports; caches may show a removed public photo for up
  to ~5 minutes (PERMANENT_DELETION.md).
* Dashboard and public-feed stale-response guards and the dashboard request timeout have no automated race/timeout test.
* The deletion step list in the dashboard reflects the server's final result, not live progress (the deletion is one request).
* Telegram cannot edit messages older than 48 hours: such review cards keep their old text after a deletion.
* Language-specific Telegram menus are cleared for none/`en`/`tl` plus `TELEGRAM_COMMAND_LANGS`; Telegram offers no
  API to list which languages a bot ever used.
* `docs/` (V5 documents) were left as historical references; the V6 documents at the repository root supersede them where they differ.
