// Ending a Human Support room (customer leaves/cancels, or an admin uses "End chat"). This never locks the case:
// the strict, locked closure is lib/cases.js (close_support_case).
import { rpc, say, esc, closeNotifs } from "./core.js";
export async function closeHumanRoom(sid, actor, reason) {
  const o = await rpc("close_support_session", { p_sid: sid, p_actor: actor, p_reason: reason || "" });
  const by = actor.startsWith("visitor:") ? "the customer" : "an admin";
  await Promise.allSettled((o.joined || []).map(uid => say(uid, `⏹ <b>${esc(o.name)}</b> ${o.request_id ? `(<code>${esc(o.request_id)}</code>) ` : ""}ended — the chat was closed by ${by}.`)));
  if (o.notif && o.notif.length) await closeNotifs(o.notif, `⏹ <b>${esc(o.request_id || "Session")}</b> ended by ${by}.`);
  return o;
}
