# CHDS V7 — test report

Date: 2026-11-20 · Node 22.23.5 · headless Chromium (Playwright). Every result below comes from commands that were
actually run on the final code. V6 results: [docs/TEST_REPORT_V6.md](docs/TEST_REPORT_V6.md).

## Not tested (read first)

| Not tested | Why |
|---|---|
| Real Supabase, Telegram Bot API, Groq | no network in the build environment; everything ran against the in-memory test double (`tests/support/fake.mjs`) through the real API handlers and bot code |
| Safari / WebKit, Firefox, physical phones | only headless Chromium is installed |
| Deployment to Vercel | not performed |
| Visual design judgement beyond screenshots reviewed by the developer | no external design review |

## Summary

| Command | Result |
|---|---|
| `npm test` (unit, api, admin, v5, v6, imagemeta) | **132 / 132 passed** |
| `npm run check` (syntax of every JS file, module linking, `vercel.json` rules, secret scan of 27 public files) | **OK** — 9 functions (was 10; `api/human` removed) |
| `python3 tests/visual/run_v7.py` — V7 animation, content, responsive and functional checks at **13 widths** (320–1920) | **467 checks, 0 problems** (`tests/visual/report_v7.json`) |
| `python3 tests/visual/run_v6.py` — V6 features (gallery, lightbox, chat retry, photo manager, deletion modal, uploader) at 13 widths | **333 checks, 0 problems** |
| `python3 tests/visual/run_visual.py` — every public page and dashboard view at 13 widths, interactions, accessibility scans (4 complete runs: 3 with 0 problems, 1 with the intermittent failure below) | **0 problems** — 130 public-page checks, 364 dashboard checks, 41 interaction checks, 2 chat flows, 78 accessibility scans (`tests/visual/report.json`) |
| `python3 tests/visual/run_flows.py` — end-to-end UI flows | **17 / 17 flow checks passed**, 0 unexpected errors (Human Support retired in the widget, retired routes 404, reopen, publish → public feed, CSV export, knowledge base, quick replies, notifications, team photo, portal submit / edit / withdraw) |
| Comment audit (parser-verified tools) | **0** removable comments; 1 licence notice kept |
| Unused-import scan (`api/`, `lib/`, `scripts/`, `tests/`) | **0** |

## Page coverage checklist

"Tested" means at least one executed assertion of that kind passed for that page (sources in brackets).

| Page | Responsive Design | Animations | Loading States | Functional Tests |
|---|---|---|---|---|
| Public Homepage | Tested [v7, visual] | Tested [v7: reveal, stagger, once-only, hover, view transitions] | Tested [v7: chat boot] | Tested [v7, visual] |
| Admin Login | Tested [v7, visual] | Tested [v7: entrance, shake, success transition] | Tested [v7: size-locked loading button] | Tested [v7, flows: login, invalid input, step 2, password toggle] |
| Admin Dashboard | Tested [v7 sidebar 360/768, visual all views ×13] | Tested [v7: KPI, chart, sidebar indicator, dropdown] | Tested [visual: skeletons/timeouts; v7] | Tested [visual, flows, npm test: permissions] |
| Admin Reports | Tested [v6 drawer ×13, visual] | Tested [v7: table rows, drawer open/close] | Tested [v6: photo manager, deletion steps] | Tested [v6, flows, npm test: publish, delete] |
| Report Portal | Tested [v7 320/390/1366, v6, visual] | Tested [v7: upload rows, sections] | Tested [v7, v6: per-file progress, confirmed success] | Tested [v7, v6, flows: validation, submit, edit, withdraw] |
| Public Reports | Tested [v7, v6 ×13] | Tested [v7: card reveal, lightbox] | Tested [v7: search spinner; v6: skeleton, broken-image] | Tested [v6, npm test: published-only, public images only, search] |
| AI Support | Tested [v7, v6 ×13] | Tested [v7: panel transition, typing, message entrance] | Tested [v7, v6: skeleton, retry] | Tested [v7, v6, flows, npm test] |
| Services | Tested [v7 ×13] | Tested [v7: card hover] | Tested [v7: chat boot on page] | Tested [v7: item removed, cards present] |
| Other existing pages (Team, FAQ, Contact, Help, 404) | Tested [v7 ×13, visual] | **Partially** — FAQ checked (reveal visibility, reduced motion); Team/Contact/Help/404 use the same shared motion code and were checked only for overflow and errors | Tested [v7: chat boot on FAQ] | Tested [v7: exact notice; visual] |

## Post-delivery audit (independent re-check of the ZIP)

| Check | Result |
|---|---|
| Fresh extraction: `npm test`, `npm run check` | 132 / 132, OK |
| TypeScript `checkJs` on all frontend scripts (undefined names, redeclarations, wrong argument counts, broken syntax) | **0 real errors** |
| TypeScript `checkJs` on server code with Node types (also broken imports and missing modules) | 5 flags, all verified as typing limitations (promisified `scrypt` options argument; tuple arrays of `[name, function]`), **0 real errors** |
| Every dashboard operation called by the UI exists on the server (109 checked); portal, AI and public calls likewise | all present |
| References to removed routes or flags (`/api/human`, handoff, feedback, quota, `human_enabled`, `offer_human`, `#hu`) | none |
| HTML: duplicate IDs, internal links, in-page anchors, referenced assets, JSON-LD, tag balance (10 pages) | clean |
| CSS: brace balance; every selector in `site.css`, `ux.css`, `admin.css` present in the browser-parsed stylesheet (865 rules) | none dropped |
| Network audit: all public pages at 390 and 1366 px, portal, 27 dashboard views | no missing assets, no JS errors; only expected 401 session checks, the 404 page and the deliberate missing-photo fixture |
| Legacy (pre-V7 handed-off) conversation in the browser | read-only, explained, history kept, server refuses sends (409), new conversation works |
| Test-only routes in deployed code; secret files in the ZIP | none |

## Requirement checks (V7)

| Requirement | Evidence | Result |
|---|---|---|
| Exact item "Ask for your password, login codes or ID documents in chat" removed, no empty card | v7: absent on all 10 pages × 13 widths; services cards present | pass |
| Approved password notice, exact wording, shown once | v7: `.secnote p` equals the approved text; count on page = 1 | pass |
| Customer-facing Human Support removed | v7: no Human Support interface text on any page × 13 widths; no `#hu`/waiting/rating controls; flows: `/api/ai/handoff` and `/api/ai/feedback` return 404; npm test: handoff/cancel/feedback/quota 404, `api/human` absent | pass |
| AI Support still works; asking for a person gets an AI answer, no handoff | npm test (`V7: asking for a human …`), v7, flows | pass |
| Historical data and admin tools intact | npm test: agent, closure, reopen, Telegram, analytics tests on seeded cases; visual: case close/reopen UI | pass |
| Reduced motion | v7: no looping animations and all content visible on `/`, `/reports`, `/faq`, `/admin` | pass |
| Mobile drawer scroll lock, outside tap closes without activating the page | v7 at 360/390/768; 15 extra trials at 320–768 | pass |
| V6 regression (publishing, permanent deletion, Telegram seven commands, uploads) | npm test (v6 suite), run_v6 | pass |

## Bugs found during V7 testing (fixed)

| Bug | Found by | Fix |
|---|---|---|
| Mobile menu closed immediately: the menu button swaps its icon, and the detached icon looked like an "outside" tap | `run_visual.py` ("mobile nav opens") | dispatch path (`composedPath`) |
| Phones: the dimming backdrop did not exist (shared pseudo-element hidden below 640 px), so an "outside" tap could open a link under the menu; this also produced a View Transition abort error | `run_v7.py` page error + reproduction | real backdrop element; view-transition promises guarded |
| Login error shake was cancelled by the step reset | smoke test | step reset no longer removes the shake class |
| Test harness: public API rate limit (429) after many page loads from one IP; typing indicator matched "bot reply" waits | `run_v7.py` | reset fake rate counters between sections; waits exclude `.typing` |
| Search-field spinner and deletion step markers rendered 18 px instead of 14 px (pseudo-elements were `content-box`), leaving the spinner 2 px off-centre | post-delivery audit (rendered-size measurement) | `box-sizing: border-box` on both; measured 14 × 14 px |
| Test double compared timestamps as text, so the Closed Cases date filter test failed between 16:00 and 24:00 UTC (after midnight in the Philippines). The application was correct: it sends time-zone-aware bounds that Postgres compares as instants | `npm test` at 18:11 UTC | the double now compares full timestamps as instants; verified at 18:12 UTC |

## Tests changed in V7

* Removed (feature retired): "duplicate clicks never create a second request", "three requests, then a cooldown",
  "support request limit … simultaneous requests".
* Replaced: Human Support customer routes → "V7: customer-facing Human Support routes are retired"; escalation
  tests → "V7: asking for a human gets an AI answer … no handoff"; unit decision tests → "resolution decisions (V7: no escalation)".
* Case creation in agent/closure/Telegram tests now uses `tests/support/cases.mjs` (the same `create_handoff`
  database function and alert sender the removed route used); all agent-side assertions are unchanged.
* Browser suites: Human Support UI flows replaced by absence checks; drawer selectors use `[open]` (closing
  drawers stay in the DOM 280 ms for their exit animation). The case-closure UI flow seeds the case through a
  fake-server-only route (`/__test/seed-case`), closes it in the real dashboard UI, then opens the closed
  conversation from the customer's history list (V7 has no live agent polling; a reload starts a fresh conversation).

## Code quality report

| Check | Result |
|---|---|
| Descriptive comments in `api/`, `lib/`, `public/`, `scripts/`, `tests/` (JS, MJS, CSS, HTML, Python) | **0** — 620 JS/CSS/HTML and 38 Python comments/docstrings removed. Each JS file's token stream and each Python program (minus docstrings) was verified identical before writing |
| Kept on purpose | the Lucide icon licence notice (`public/assets/icons.js`), `"use strict"` directives, shebangs |
| Not modified in V7 (keep their original comments) | SQL migrations 001–004 and the generated `supabase.sql`, `.env.example` |
| TODO / FIXME markers | none |
| Syntax / module linking | `npm run check` OK; `node --check` on every JS file OK |
| Unused imports | 0 (20 removed) |
| Dependencies added | none (package has no runtime dependencies) |
| Environment variables | unchanged |
| Lint | no linter is configured in the project; the checks above are the project's static gates |

## Known issues / limitations

* **Intermittent browser-test failure (cause not found):** in 1 of 4 complete runs of `run_visual.py`, two Team
  Management checks failed at 1366 px ("team delete confirms the clicked member", "team view drawer"); the very
  next check on the same row passed. They passed in the other 3 full runs and in a replay of the exact test lines
  at both widths. The checks now record every dialog's state when they fail, to diagnose a recurrence. No user-facing
  defect was observed; treat it as an unresolved test-reliability issue.

* Not tested on Safari, Firefox or real devices; View Transitions are Chromium-only (other browsers navigate normally).
* Open Human Support cases at deployment time: customers no longer see agent replies; close or return them first (V7_UPGRADE_NOTES.md).
* The Emergency Control "human requests disabled" flag and the support request limits in Settings remain in the
  dashboard but no longer affect customers.
* Database functions `create_handoff` and `support_quota` remain in the database unused (nothing was dropped).
* The deletion progress list in the dashboard reflects the server's final answer (one request), not live progress.
