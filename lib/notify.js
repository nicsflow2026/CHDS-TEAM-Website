import { rpc, say, settings, warn } from "./core.js";

export async function notifyOnce(kind, ref, chatId, send) {
  const s = await settings().catch(warn("notify settings"));
  if (s && s.emergency.telegram_notifications_disabled) return { ok: false, skipped: "disabled" };
  let claimed;
  try { claimed = await rpc("notify_claim", { p_kind: kind, p_ref: String(ref), p_chat: String(chatId) }); }
  catch (e) { console.error("notify_claim", String(e.message).slice(0, 120)); return { ok: false, error: "log_unavailable" }; }
  if (!claimed) return { ok: false, skipped: "duplicate" };
  let r;
  try { r = await send(chatId); } catch (e) { r = { ok: false, description: String(e).slice(0, 200) }; }
  const ok = !!(r && r.ok), mid = ok && r.result && r.result.message_id ? r.result.message_id : null;
  await rpc("notify_done", { p_kind: kind, p_ref: String(ref), p_chat: String(chatId), p_ok: ok, p_message_id: mid, p_error: ok ? null : String((r && r.description) || "failed") })
    .catch(e => console.error("notify_done", String(e.message).slice(0, 120)));
  return ok ? { ok: true, message_id: mid } : { ok: false, error: (r && r.description) || "failed" };
}
export const notifyText = (kind, ref, chatId, text, extra) => notifyOnce(kind, ref, chatId, c => say(c, text, extra));
