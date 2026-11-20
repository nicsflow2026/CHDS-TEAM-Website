# Deployment guide — CHDS V6

Hosting: Vercel (Framework "Other", no build step besides `scripts/check-env.mjs`), data in Supabase, AI by Groq,
staff notifications via Telegram. The detailed V5 guide is still valid: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
This page lists what V6 adds. **V6 was not deployed by the build process; nothing here has been verified on a live
Vercel or Supabase project.**

## Order of steps

1. **Back up** Supabase.
2. Apply **`supabase/migrations/004_v6_publishing_deletion.sql`** (MIGRATION_GUIDE.md) and run its verification queries.
3. Check **Storage**: bucket `public-report-images` exists and is public; `report-evidence` is private
   (STORAGE_CONFIGURATION.md).
4. Environment variables: no new required variable. Optional: `TELEGRAM_COMMAND_LANGS` (comma-separated two-letter
   language codes whose old command menus should also be cleared, e.g. `es,ms`; Telegram accepts ISO 639-1 codes only). Existing: `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`, `BOT_TOKEN`, `WEBHOOK_SECRET`, `GROQ_API_KEY`, `SESSION_SECRET`, `ADMIN_UIDS`,
   `ADMIN_PASSWORD`, `TELEGRAM_TEAM_UIDS`, `APP_URL`, … (`.env.example`). `SESSION_SECRET` now also keys the
   deletion reference — keep it stable.
5. Deploy the code (still 10 serverless functions; Vercel Hobby allows 12).
6. Dashboard → **System Health** → *Connect Telegram bot*. This re-registers the webhook and synchronizes the command
   menu to exactly the seven commands, then verifies it (TELEGRAM_COMMANDS.md). The result must show no problems.
7. Roles & Permissions: grant **`delete_reports`** only to the administrators who need it (Founders already have it).
8. Smoke test (below).

No `npm install` is needed: the project has no runtime dependencies. Node 22.x.

## Smoke test after deploying

* `/api/health` → `{ ok: true, database_ok: true }`; with `X-Setup-Key` → `missing: []`.
* `/reports` loads; a published report with selected photos shows the carousel; photo URLs are on
  `…/storage/v1/object/public/public-report-images/…`, never `report-evidence`.
* Report drawer → Public photos: select a photo of an approved test report, publish, check `/reports`, unpublish,
  check the photo URL now returns 400/404.
* Create a throw-away report, delete it permanently, confirm it is gone from the dashboard, `/reports` and the totals.
* Telegram: open the command menu (`/`) — exactly `/help /portal /chats /quene /offline /online /cancel`.
* AI Support: open the launcher, send a message, request a human, accept in Telegram with `/quene`, close the case,
  confirm the chat is read-only.

## Caching

`/api/public/reports` and `/api/stats` send `Cache-Control: no-store` (V6) so publications, unpublications and
permanent deletions are visible on the next request; they stay rate limited (120/min per IP). Static JS/CSS use
`must-revalidate` and versioned URLs (`?v=10`). Public photos: `public, max-age=300`.

## Content Security Policy

Unchanged. Public photos load from your Supabase project over `https:` (allowed by `img-src … https:`).
