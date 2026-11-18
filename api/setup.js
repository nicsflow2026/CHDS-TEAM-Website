import { api, E, tg } from "../lib/core.js";
import { COMMANDS } from "../lib/bot.js";
import { timingSafeEqual, createHash } from "node:crypto";
const same = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());
// Optional CLI alternative to the admin panel button: POST /api/setup with header X-Setup-Key: <WEBHOOK_SECRET>
export default api(async (req, res) => {
  const key = req.headers["x-setup-key"];
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!E.WEBHOOK_SECRET || !key || !same(key, E.WEBHOOK_SECRET)) return res.status(403).json({ error: "forbidden" });
  const host = req.headers["x-forwarded-host"] || req.headers.host, url = `https://${host}/api/telegram`;
  const w = await tg("setWebhook", { url, secret_token: E.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], max_connections: 20 });
  const c = await tg("setMyCommands", { commands: COMMANDS }), n = await tg("setMyName", { name: "CHDS Report" });
  res.json({ webhook: !!w.ok, commands: !!c.ok, name: !!n.ok, url, error: w.ok ? undefined : w.description });
}, { name: "api/setup" });
