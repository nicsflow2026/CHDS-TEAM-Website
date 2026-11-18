# CHDS Site — Vercel + Supabase

Pages: / (home + live results) · /services · /team · /faq · /contact · /help (Get help) · /admin (secured panel)

## Structure
public/            website (pages + assets/). Edit TEAM and CONFIG in public/assets/config.js
api/               Vercel serverless API (stats, chat, human chat, telegram webhook, admin, health, setup)
lib/               shared code + the Telegram bot
supabase.sql       database schema (run once)

## Setup (10 minutes)
1. Supabase: create a project -> SQL Editor -> paste ALL of supabase.sql -> Run.
   Project Settings -> API: copy the Project URL and the **service_role** key (secret, server only).
2. Push this folder to GitHub. Vercel: Add New Project -> import it (Framework: Other, no build command).
3. Vercel -> Settings -> Environment Variables: add everything in .env.example, then Redeploy.
4. Open https://YOUR-SITE.vercel.app/api/health -> groq_key, bot_token, webhook_secret, supabase_env, database_ok and admin_panel_ready must be true.
5. Every team member opens the bot in Telegram and presses /start once.
6. Go to https://YOUR-SITE.vercel.app/admin -> sign in (Telegram ID + password, then the 6-digit code the bot sends you)
   -> Overview -> "Connect Telegram bot" (sets webhook + commands) and "Test AI".
7. Edit public/assets/config.js (team names, photos, Telegram/Facebook links, currency, WhatsApp, email), push, done.

## Admin panel security
Password + one-time Telegram code (2 factors), only for UIDs in ADMIN_UIDS, 8-hour server-side sessions stored hashed,
HttpOnly + Secure + SameSite=Strict cookie, CSRF header + same-origin check, rate limits, lockout after 5 wrong codes,
audit log of every action, "Sign out everywhere". Rotate ADMIN_PASSWORD and SESSION_SECRET if you suspect a leak.

## Troubleshooting
- AI not answering: /api/health, or Admin -> Overview -> Test AI. Vercel -> Logs shows the exact Groq/Supabase error.
- No chat alerts: members must press /start in the bot, and their UID must be in ALLOWED_UIDS or ADMIN_UIDS.
- Admin code not arriving: your UID must be in ADMIN_UIDS and you must have pressed /start in the bot.
