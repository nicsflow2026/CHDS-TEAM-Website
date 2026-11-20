# V7 file changes

Compared with the V6 archive (`chds-platform-v6.zip`). Screenshot folders and generated JSON reports are not listed.

## Modified (77)
* `CHANGELOG.md`
* `README.md`
* `TEST_REPORT.md`
* `api/admin/[a].js`
* `api/ai/[a].js`
* `api/chat.js`
* `api/health.js`
* `api/portal/[a].js`
* `api/public/[a].js`
* `api/setup.js`
* `api/stats.js`
* `api/telegram.js`
* `lib/admin/auth.js`
* `lib/admin/business.js`
* `lib/admin/people.js`
* `lib/admin/support.js`
* `lib/admin/system.js`
* `lib/admin/util.js`
* `lib/admin/v5.js`
* `lib/admin/v6.js`
* `lib/ai.js`
* `lib/bot.js`
* `lib/cases.js`
* `lib/core.js`
* `lib/deletion.js`
* `lib/handoff.js`
* `lib/imagemeta.js`
* `lib/knowledge.js`
* `lib/notify.js`
* `lib/publicimages.js`
* `lib/rbac.js`
* `lib/reporters.js`
* `lib/reports.js`
* `lib/rooms.js`
* `lib/secrets.js`
* `lib/staffnotify.js`
* `lib/storage.js`
* `lib/support.js`
* `lib/tgcommands.js`
* `lib/time.js`
* `lib/validate.js`
* `lib/visitor.js`
* `public/admin.html`
* `public/assets/admin-views-ops.js`
* `public/assets/admin-views-v5.js`
* `public/assets/admin-views.js`
* `public/assets/admin.css`
* `public/assets/admin.js`
* `public/assets/config.js`
* `public/assets/icons.js`
* `public/assets/portal.js`
* `public/assets/reports.js`
* `public/assets/site.css`
* `public/assets/site.js`
* `public/assets/ux.css`
* `public/assets/ux.js`
* `public/contact.html`
* `public/faq.html`
* `public/index.html`
* `public/services.html`
* `public/team.html`
* `scripts/build-sql.mjs`
* `scripts/check-env.mjs`
* `scripts/check.mjs`
* `scripts/dev-server.mjs`
* `tests/admin.test.mjs`
* `tests/api.test.mjs`
* `tests/imagemeta.test.mjs`
* `tests/support/fake.mjs`
* `tests/support/fixtures.mjs`
* `tests/unit.test.mjs`
* `tests/v5.test.mjs`
* `tests/v6.test.mjs`
* `tests/visual/run_flows.py`
* `tests/visual/run_v6.py`
* `tests/visual/run_visual.py`
* `vercel.json`

## Added (7)
* `ANIMATION_SYSTEM.md`
* `RESPONSIVE_DESIGN.md`
* `V7_UPGRADE_NOTES.md`
* `docs/TEST_REPORT_V6.md`
* `tests/support/cases.mjs`
* `tests/visual/run_v7.py`
* `V7_FILE_CHANGES.md`

## Removed files (1)
* `api/human/[a].js`

## Removed components and handlers

| Component | Where | Reason |
|---|---|---|
| Customer human room endpoint (`request`, `poll`, `send`, `end`) | `api/human/[a].js` + `vercel.json` entry | customer-facing Human Support removed |
| `POST /api/ai/handoff`, `POST /api/ai/cancel`, `POST /api/ai/feedback`, `GET /api/ai/quota` | `api/ai/[a].js` | same |
| `createHandoff`, `quotaInfo`, `quotaKeys` | `lib/support.js` | only used by the removed routes |
| `summarize`, `HUMAN_RE`, `AUTHORIZED_RE`, escalation branches of `decide()`, `human` control state | `lib/ai.js` | escalation retired |
| `newSid`, `newRequestId` | `lib/handoff.js` | only used by `createHandoff` |
| `handoffState`, `offer_human` / `human_enabled` / `quota` / `handoff` response fields | `api/ai/[a].js`, `api/chat.js`, `api/public/[a].js` | same |
| Widget: Talk to a Human Agent button, handoff dialog, waiting/connected banner, agent card, Cancel/Leave, poll loop, `sendHuman`, rating card, quota countdown, human option in the resolution card | `public/assets/site.js`, `site.css` | same |
| Homepage section "A real person, without starting over" (`#human-support`), "Real human support" badge, "AI plus humans" card | `public/index.html` | Human Support promotion |
| Contact "Human agents" card and agent-joining text; FAQ "How do I reach a human?" | `public/contact.html`, `public/faq.html` | Human Support promotion |
| Services/home list item "Ask for your password, login codes or ID documents in chat" | `public/services.html`, `public/index.html` | requested removal |
| Duplicate scroll-reveal observer | `public/assets/site.js` (now `UX.reveal`) | consolidated into the shared system |
| 20 unused imports | various `api/` and `lib/` files | dead code |
