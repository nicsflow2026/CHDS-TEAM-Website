# Test report — V5 (new-upgraded.txt)

Environment: Node 22, headless Chromium (Playwright), **no PostgreSQL and no network access** in the build environment.

## Executed and passing

| Command | Result |
|---|---|
| `npm run check` | OK. Syntax and module linking of every file; `public/` secret scan (25 files); 6 `vercel.json` patterns cover the 10 functions exactly once. |
| `npm test` | **111 / 111 pass**: `unit` + `api` + `admin` (the 64 pre-V5 tests) + `v5` (47). |
| `node scripts/dev-server.mjs --fake` + `python3 tests/visual/run_flows.py` (fresh server) | **20 / 20** end-to-end UI flows: CSAT card after resolution, Reopen with mandatory reason, Publish → public feed, Reports CSV download, KB / quick reply creation, unsafe instructions refused, notifications marked read, team photo upload to the clicked member, portal submit / edit / delete. No unexpected browser errors. |
| `node scripts/dev-server.mjs --fake` + `python3 tests/visual/run_visual.py` | **0 problems.** 70 public-page checks, 196 dashboard checks (26 views + open/closed handoff detail + notification center × 7 widths), **41 interaction checks**, 2 chat flows, 78 accessibility scans, 63 JPEG screenshots in `tests/visual/screens/`. |

Before V5 work started, the baseline was 64/64 tests. Two pre-existing assertions were updated because V5 changes that behaviour on purpose:
* return-to-AI now produces `ended` (not `closed`);
* a Founder now holds 23 permissions (not 18).

### What the V5 tests cover
* **Case closure — all 22 required scenarios** (`tests/v5.test.mjs` `[1]`–`[22]`). The UI scenarios are also exercised in the browser:
  * the modal lists all six consequences;
  * Cancel leaves the case open (status re-read from the API);
  * Confirm closes it;
  * the customer widget turns read-only with input and send disabled;
  * a stale frontend submit adds nothing;
  * Start New Conversation works.
* **Further closure checks:**
  * Resolved ≠ Closed.
  * Telegram Close needs confirmation and permission.
  * A reply to an ended chat is never re-routed to another customer.
  * A reply generated while the case was being closed is discarded.
  * Simultaneous message + closure (3 races) always leaves the closing notice last.
* **Telegram:** `/report` removed, `/portal` added, multiple team UIDs parsed (spaces and invalid entries handled), deactivated members refused.
* **Password policy:**
  * redaction before storage, AI context and Telegram, with a customer notice;
  * agent requests blocked (dashboard and Telegram);
  * unsafe AI output replaced and not stored;
  * knowledge entries, quick replies and instructions that ask for credentials rejected;
  * official FAQ present;
  * unit tests for the redaction and detection rules, including false-positive checks.
* **Knowledge Base:** CRUD (audited); relevant enabled entries reach the prompt; disabled ones don't; admin instructions come before the fixed security policy.
* **Report portal:** sign-in without enumeration, code sent only to the authorized account, HttpOnly session, CSRF check, 401 without a session, server-set owner/status/source (forged fields ignored), validation, 2024/2025 activity dates, future dates only for planned types, duplicate blocking, redaction, approver alerts.
* **My Reports:** owner-only lists and details; other owners' IDs return 404 for read, update, delete, archive and evidence; search and date filters; corrections → edit → approve → publish; editing an approved+published report resets it to Pending, unpublishes it and notifies; delete/archive eligibility; deactivated member loses access on the next request.
* **Public feed:** only published reports; no private fields (owner ID, account info, description, revenue, actor IDs); search/category/date filters; archive removes the report.
* **Admin reports:** activity-date vs submission-date filters, archived view, CSV with both dates, audit of every action.
* **Team:** View (UID masked), safe delete; the UI click tests cover View, Edit, Delete and Deactivate acting on the clicked row.
* **Notifications:** permission-scoped, assignment notifications, one notification per unread burst, no message text, read/unread, badge.
* **Support:** priority, escalation (note required), SLA data, unread marking, CSAT (own case only, once, after handling); 3-per-hour limit with **5 simultaneous requests** (exactly 3 accepted) and idempotent retries.
* **Operations Analytics:** activity vs submission basis; sections scoped by permission.

## Defects found during this work and fixed
1. **Team Management Edit/Delete (and Session Revoke, Announcement Edit/Publish/Archive).** Row buttons received `null` because `table()` only set `data-row` on clickable tables. Reproduced in Chromium first: Edit opened an empty "Add" form, and Delete threw `Cannot read properties of null`.
2. **Stale list handlers.** Every list attached handlers to the persistent `#main` element, so one click ran the handlers of earlier lists. "Edit announcement" also opened a team member form and a session-revoke dialog. Found by the new interaction tests.
3. **AI reopened closed conversations.** `/api/chat` reset `closed` to `active` on any new message.
4. **Wrong-customer routing in Telegram.** A reply to an ended chat was sent to the agent's other active chat.
5. **`hidden` attribute overridden by `.btn`** on public pages ("Load more" shown when nothing was left; it would also have shown the portal's Sign out button).
6. Layout overflow on the new handoff detail page at ≤1024 px (inline grid) — fixed before delivery.

### Found in the post-delivery audit (second pass) and fixed
7. **Homepage "Recent results" showed every approved report, published or not**, with the reporter's name and revenue. That contradicted the publication rule (§7) and the Publish dialog. It now shows published reports only, using their public fields and no per-report revenue (`stats_json` replaced in 003). Totals and the chart remain aggregates of approved reports, as before.
8. **Telegram `/delete` bypassed the website rules.** Owners could delete their own approved or published reports, and any approver could delete reports. Telegram now applies the same rules as the portal and dashboard: owners can delete only reports that are not approved and not published; staff need `manage_reports`. `/myreports` offers delete buttons only for deletable reports and says "Approved total" instead of the misleading "Published total".
9. **A dashboard dialog could stay open over another page** after Back, a notification link, or a page change following Publish, blocking that page's buttons. A route change now closes open dialogs.
10. **Portal form validation:** an unticked confirmation box marked all 10 fields red instead of only the checkbox. Fixed. The last native `alert()` in the portal was replaced by an accessible dialog.
11. The test double lacked `user_totals`, so `/myreports` had never been exercised by tests. It is now emulated and tested.

## NOT verified here (needs live services) — please run these
* **The SQL was not executed against PostgreSQL** (none was available). Migration 003 was reviewed statement by statement against 001/002: constraint names, append-only history triggers, the relabel, and a line-by-line diff of every replaced function. The RPCs and triggers are JavaScript emulations in the tests. **Run the verification queries and the lock smoke test in [docs/MIGRATIONS.md](docs/MIGRATIONS.md) on staging first.** Real lock contention between simultaneous transactions can only be confirmed on PostgreSQL.
* Telegram delivery: portal codes, `/portal`, Close-case buttons and the notification messages. Members must have pressed /start in the bot to receive codes.
* Groq: live answer quality with the knowledge base.
* Vercel deployment: 10 functions, headers on `/report-portal`.
* Supabase Storage signed URLs for portal evidence.
* The manual checklist in [docs/TESTING.md](docs/TESTING.md#manual-checks-that-need-live-services).

## Known limitations
* **Secret detection is pattern-based.** It catches the common forms in English and Filipino ("password is …", "password ko ay …", OTP/login/recovery codes of 6–10 digits, cookies, tokens, JWTs). It can miss unusual phrasing, and the ask-detector deliberately ignores negated sentences ("never share your password").
* **Public feed and notification counts update by polling** (30 s and 30 s), not push.
* **Telegram "Close case"** requires the agent to have a dashboard role with `close_support_cases`. Telegram-only team members must ask someone with a dashboard account.
* **Reopening returns the conversation to AI Support**, not into the old human chat. The customer can request a human again, which creates a new case.
* **Owners cannot delete approved reports** (by design); an administrator can.
