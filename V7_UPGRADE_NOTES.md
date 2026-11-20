# CHDS V7 upgrade notes

V7 is a direct upgrade of V6: same architecture (static `public/` + 9 Vercel functions + Supabase + Telegram + Groq),
same database (**no migration**), same environment variables. It was **not deployed** by the build process.

## Before you deploy

1. **Close or return open Human Support cases.** Customers can no longer see agent replies in the chat. In the
   dashboard open *Human Handoff Queue* / *Human Support* and close each open case (or return it to AI). Cases
   that stay open are shown to the customer as a read-only earlier conversation.
2. Deploy. No SQL to run, no new environment variables.
3. Smoke test: Admin Login (desktop and phone), dashboard, Report Portal submission with two photos, `/reports`,
   `/faq` (security notice), the chat (no "Talk to a Human Agent").

## Customer-facing Human Support removed

**Interface (removed):** "Talk to a Human Agent" button and confirmation dialog, waiting-for-agent banner and
status, connected-agent card, Cancel request / Leave chat buttons, agent typing/poll loop, satisfaction rating card,
quota countdown, "Talk to a Human Agent" option in the resolution card, homepage section *A real person, without
starting over*, "Real human support" hero badge, "AI plus humans" card, Contact page "Human agents" card and
"A human agent can join" text, FAQ question *How do I reach a human?*, and all other "Talk to a Human Agent" copy.

**Backend (removed, no remaining production dependency):**

| Removed | Was used by |
|---|---|
| `api/human/[a].js` (customer room: `request`, `poll`, `send`, `end`) and its `vercel.json` entry | the removed widget only |
| `POST /api/ai/handoff`, `POST /api/ai/cancel`, `POST /api/ai/feedback`, `GET /api/ai/quota` | the removed widget only |
| `lib/support.js` `createHandoff`, `quotaInfo`, `quotaKeys` | the routes above |
| `lib/ai.js` `summarize`, `HUMAN_RE`, `AUTHORIZED_RE`, escalation branches of `decide()`, the `human` control state | `createHandoff` / escalation offers |
| `lib/handoff.js` `newSid`, `newRequestId` | `createHandoff` |
| `offer_human`, `reason`, `human_enabled`, `quota`, `handoff` fields in customer responses | the removed widget |

**AI behaviour:** the system prompt no longer sends customers to a button. When someone asks for a person, a quote
or a case review, the AI says live chat with an agent is not available here and points to the Get help page or
the Contact page. Fallback, security and knowledge-base replies no longer offer Human Support.

**Kept (data and admin functionality):** every table and record (`ai_handoff_requests`, `sessions`, `messages`,
history, CSAT, notes, audit), the dashboard Human Support / Handoff Queue / Closed Cases / Escalations views, case
close / reopen / return-to-AI, agent tools, Telegram callbacks and all seven Telegram commands, handoff
notifications for existing cases, analytics. The database functions `create_handoff` and `support_quota` remain
in the database unused (nothing is dropped). The Emergency Control flag "human requests disabled" and the support
request limits in Settings no longer affect customers.

**Legacy conversations:** a conversation that was handed to the team before V7 opens read-only with *Start New
Conversation*; `/api/chat` keeps answering `409 human_owned` for it.

## Services and security notice

* Removed the exact item **"Ask for your password, login codes or ID documents in chat"**. It appeared in two
  "what we never do" lists, on the Services page and on the homepage; both were removed. The remaining items keep
  the panels balanced (no empty card). Other statements about passwords were left as they were.
* The approved notice is shown, word for word, as a highlighted security card at the top of the FAQ page (it was
  previously hidden inside a collapsed answer). It appears once on the page (plus once in the FAQ structured data
  for search engines). The same wording already exists in `lib/secrets.js` and the knowledge base.

## Redesign

| Page | Changes |
|---|---|
| Admin Login | two-column layout (brand panel + card) on desktop, single card on phones, two-step progress, show/hide password, focus rings, loading button with fixed size, shake on error, success state, fade into the dashboard |
| Admin Dashboard | animated sidebar indicator, KPI stagger, table row entrance, chart growth/draw, card hover, animated dropdown, modal/drawer open-close transitions, sidebar scroll lock |
| Report Portal | form grouped into four numbered sections, focus/hover states, styled evidence picker, animated upload rows and success box |
| Public Reports | staggered card reveal, image fade-in, animated lightbox, search spinner |
| AI Support | Human Support removed, read-only states for closed/legacy conversations, shorter password hint |
| Public site | page transitions, scroll reveal with stagger, card and nav hover, ambient background, mobile drawer with scrim and scroll lock, security notice card |

Details: ANIMATION_SYSTEM.md, RESPONSIVE_DESIGN.md.

## Code quality

All application and test source files (`api/`, `lib/`, `public/`, `scripts/`, `tests/`) are free of descriptive
comments. They were removed with parser-verified tooling (the JavaScript token stream and the Python program had
to be identical before and after). The only remaining comment is the Lucide icon licence notice in
`public/assets/icons.js`. The SQL migrations 001–004 were not modified in V7 and keep their original comments
(they are already-applied historical files; editing them has no benefit). `.env.example` was not modified.

Unused imports: 20 removed (verified by token scan); none remain in `api/`, `lib/`, `scripts/` or `tests/`.

## Dependencies

None added, none removed. No animation library is used.
