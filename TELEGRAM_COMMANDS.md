# Telegram bot commands (V6)

The bot exposes **exactly seven** custom slash commands. The spelling **`/quene`** is intentional and must not be
changed to `/queue`.

| Command | What it does | Side effects |
|---|---|---|
| `/help` | Lists the seven commands and how support and report reviews work | none |
| `/portal` | Sends the private report portal link (`APP_URL/report-portal`). The link carries no token or user data; sign-in uses a one-time code sent by the bot | none |
| `/chats` | Your **active** conversations: reference (HS-…), customer display name, status, last activity, with *Type to …* and *View* buttons. Resolved, ended, cancelled and closed cases are never listed | switching the active chat (button) |
| `/quene` | Requests waiting for an agent with **Accept** and **View Details** buttons. Accepting is atomic (`join_session` locks the row): if two agents tap Accept, exactly one gets it and the other is told who did | assignment (on Accept) |
| `/offline` | Sets your availability to offline. Your current conversations **stay assigned to you** | `agents.available = false`, audited |
| `/online` | Sets your availability to online and shows how many requests are waiting | `agents.available = true`, audited |
| `/cancel` | Cancels **your own** pending bot step (e.g. a rejection reason or a hand-back summary the bot is waiting for) by expiring it | none other: no report, conversation, case, availability or other agent's state is changed; nothing is deleted |

Access: authorized CHDS team members only (`TELEGRAM_TEAM_UIDS` / `ALLOWED_UIDS` / `ADMIN_UIDS`, minus members
deactivated in Team Management, plus dashboard staff with `approve_reports`). Everyone else gets "Access restricted".

## `/start`

Telegram sends `/start` automatically when someone opens the bot for the first time. That first contact is what
allows the bot to deliver portal and dashboard sign-in codes, so the bot still answers it (with the same text as
`/help`). It is **not** registered in the command menu.

## Removed

`/myreports`, `/total`, `/delete`, `/pending`, `/queue`, `/report` and the text command `/skip` were removed.
Typing them now gets "I didn't recognize that" plus the help text; none of them performs any action. The old
report **delete buttons** (`d:` / `dq:` callbacks) still visible in chat history answer "This button was retired"
and do nothing. `/skip` in the hand-back flow was replaced by the inline button **Continue without a summary**.

## Inline buttons (callbacks, not commands)

Accept Request · View Details · Type to … · Return to AI · Resolve · Close case (with confirmation) ·
Continue without a summary · Approve / Reject (report review cards). Every callback re-checks the user's
authorization and the current state (a closed case or a deleted report is refused).

## Registering the menu

Dashboard → **System Health → Connect Telegram bot**, or `POST /api/setup` with header `X-Setup-Key: <WEBHOOK_SECRET>`.
Both call `syncCommands()` (`lib/tgcommands.js`), which:

1. **deletes** the command menu in every scope (`default`, `all_private_chats`, `all_group_chats`,
   `all_chat_administrators`, and the private chat of every team UID) and every checked language
   (none, `en`, `tl`, plus `TELEGRAM_COMMAND_LANGS`);
2. **sets** the seven commands for `default` and `all_private_chats`;
3. **reads every combination back** and reports `problems` unless the two target scopes hold exactly the seven
   commands in order and every other combination is empty.

If your bot ever had commands in another language, add its two-letter code to `TELEGRAM_COMMAND_LANGS`
(comma separated) and run the sync again. The response of `/api/setup` lists `command_menu`, `scopes_checked`
and `command_problems`.

## Notification quality

New-request alerts are de-duplicated per request and recipient (`notification_log`), re-check before **every**
recipient that the request is still waiting and its conversation is not closed (a case closed mid-broadcast stops
the remaining alerts), and are edited in place when another agent accepts ("Already accepted by …"), when a case
is closed, and when a report is permanently deleted. Telegram API failures are logged and never undo the business action.
