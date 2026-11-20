// Telegram command menu: exactly the seven approved custom commands, in every place Telegram can show a menu.
// Older deployments may have registered commands in other scopes or languages; those are cleared, then the
// result is READ BACK and verified (a successful setMyCommands alone does not prove the menu is right).
import { E, tg, team } from "./core.js";

// Spelling of "quene" is intentional (product requirement) — do not rename it to "queue".
export const COMMANDS = [
  { command: "help", description: "How to use this bot" },
  { command: "portal", description: "Private report portal link" },
  { command: "chats", description: "Your active customer conversations" },
  { command: "quene", description: "Support requests waiting for an agent" },
  { command: "offline", description: "Set your availability to offline" },
  { command: "online", description: "Set your availability to online" },
  { command: "cancel", description: "Cancel your pending bot action" }
];
const BROAD = [{ type: "default" }, { type: "all_private_chats" }, { type: "all_group_chats" }, { type: "all_chat_administrators" }];
const TARGET = ["default", "all_private_chats"]; // where the seven commands are registered (no language code)
// Language-specific menus override the default for users with that app language. Clear the likely ones;
// TELEGRAM_COMMAND_LANGS adds more (comma separated ISO 639-1 codes).
export const languages = () => ["", ...new Set(["en", "tl", ...String(E.TELEGRAM_COMMAND_LANGS || "").split(",").map(s => s.trim().toLowerCase()).filter(s => /^[a-z]{2}$/.test(s))])];
const key = (scope, lang) => scope.type + (scope.chat_id ? ":" + scope.chat_id : "") + (lang ? "/" + lang : "");
async function inChunks(list, n, fn) { const out = []; for (let i = 0; i < list.length; i += n) out.push(...await Promise.all(list.slice(i, i + n).map(fn))); return out; }

export async function syncCommands({ uids = team() } = {}) {
  const langs = languages(), problems = [];
  const scopes = [...BROAD, ...uids.filter(u => /^\d{1,20}$/.test(u)).map(u => ({ type: "chat", chat_id: Number(u) }))];
  const combos = scopes.flatMap(scope => langs.map(lang => ({ scope, lang })));
  // 1. clear every combination (removes /myreports, /total, /delete, /pending, /queue, /report and anything else)
  await inChunks(combos, 10, ({ scope, lang }) => tg("deleteMyCommands", { scope, ...(lang ? { language_code: lang } : {}) }));
  // 2. register the approved seven
  for (const type of TARGET) { const r = await tg("setMyCommands", { commands: COMMANDS, scope: { type } }); if (!r.ok) problems.push(`setMyCommands(${type}): ${r.description || "failed"}`); }
  // 3. verify by reading back every combination
  const want = JSON.stringify(COMMANDS.map(c => c.command));
  const seen = await inChunks(combos, 10, async ({ scope, lang }) => ({ k: key(scope, lang), target: !lang && TARGET.includes(scope.type), r: await tg("getMyCommands", { scope, ...(lang ? { language_code: lang } : {}) }) }));
  for (const s of seen) {
    if (!s.r.ok) { if (!/^chat:/.test(s.k)) problems.push(`getMyCommands(${s.k}): ${s.r.description || "failed"}`); continue; } // a chat the bot never saw cannot be read: nothing to clean there
    const got = JSON.stringify((s.r.result || []).map(c => c.command));
    if (s.target ? got !== want : got !== "[]") problems.push(`${s.k}: ${got}`);
  }
  return { ok: problems.length === 0, commands: COMMANDS.map(c => "/" + c.command), scopes_checked: seen.length, problems };
}
