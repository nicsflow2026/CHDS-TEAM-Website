import { api, E, sb, say, jsonBody, logError, limited } from "../lib/core.js";
import { timingSafeEqual, createHash } from "node:crypto";
const same = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());
import { tgUpdate } from "../lib/bot.js";
export default api(async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const sec = req.headers["x-telegram-bot-api-secret-token"];
  if (!E.WEBHOOK_SECRET || !sec || !same(sec, E.WEBHOOK_SECRET)) return res.status(403).end();
  if (await limited(req, "tg-webhook", 1200, 60)) return res.status(429).end(); // generous: Telegram retries later
  const u = jsonBody(req);
  try {
    if (u.update_id) { // Telegram retries are ignored (no duplicate reports); a DB hiccup here must not block the bot
      try {
        const ins = await sb("/tg_updates?on_conflict=update_id", { method: "POST", body: { update_id: u.update_id }, prefer: "resolution=ignore-duplicates,return=representation" });
        if (Array.isArray(ins) && !ins.length) return res.status(200).send("ok");
      } catch (e) { console.error("dedupe", e); }
    }
    await tgUpdate(u);
  } catch (e) {
    await logError("api/telegram", e, { update_id: u.update_id || null });
    const cid = u.message?.chat?.id || u.callback_query?.message?.chat?.id;
    if (cid) await say(cid, "⚠️ Something went wrong on our side. Please try again in a moment.");
  }
  res.status(200).send("ok");
});
