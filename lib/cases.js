import { sb, rpc, say, esc, closeNotifs, q, audit, warn } from "./core.js";
import { can } from "./rbac.js";
import { notifyStaff } from "./staffnotify.js";

export const isCaseAdmin = p => !!p && (p.role === "founder" || p.role === "administrator");
export const CLOSE_EFFECTS = [
  "The case becomes permanently read-only under normal operation.",
  "The customer can no longer send messages to this conversation.",
  "The assigned agent can no longer reply in this conversation.",
  "AI Support will no longer respond in this conversation.",
  "Pending and queued responses are blocked.",
  "The customer must start a new conversation to request support again."
];
const uidOf = actor => (/^(admin|tg):(\d{1,20})$/.exec(String(actor || "")) || [])[2] || null;

export async function closeCase({ p, requestId, reason, actor, via, req = null }) {
  if (!p || !can(p, "close_support_cases")) return { status: 403, body: { error: "forbidden", message: "Your role does not include close_support_cases." } };
  if (!/^HS-[A-Z0-9]{8}$/.test(String(requestId || ""))) return { status: 400, body: { error: "bad_request" } };
  const h = (await sb(`/ai_handoff_requests?id=eq.${q(requestId)}&select=id,sid,status,assigned_uid,assigned_name,conversation_id`))[0];
  if (!h) return { status: 404, body: { error: "not_found" } };
  const assigned = !!h.assigned_uid && h.assigned_uid === p.uid;
  if (!assigned && !isCaseAdmin(p)) {
    return { status: 403, body: { error: "not_assigned", message: "Only the assigned agent, or a Founder/Administrator with close permission, can close this case." } };
  }
  const why = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const o = await rpc("close_support_case", { p_request: h.id, p_actor: actor, p_actor_uid: p.uid, p_actor_name: String(p.name || "Agent").slice(0, 60), p_force: !assigned, p_reason: why });
  if (!o.ok) {
    const map = { not_found: [404, "Not found."], not_assigned: [403, "Only the assigned agent can close this case."], not_latest: [409, "A newer request exists for this conversation; close that one instead."] };
    const [s, m] = map[o.reason] || [409, o.reason];
    return { status: s, body: { error: o.reason, message: m } };
  }
  if (o.already_closed) return { status: 200, body: { ok: true, already_closed: true, request_id: o.request_id, closed_at: o.closed_at } };
  await audit(actor, "case_closed", { reason: why, via, forced: !assigned }, { target: h.id, prev: { status: o.previous_status }, next: { status: "closed" }, req, role: p.role });
  const by = esc(p.name || "CHDS Support");
  await closeNotifs(o.notif || [], `🔒 <b>${esc(h.id)}</b> was closed by ${by}. This case is read-only.`).catch(warn("close alert edits"));
  await Promise.allSettled((o.joined || []).map(u => say(u, `🔒 <b>Case ${esc(h.id)} closed</b> by ${by}${why ? `\nReason: ${esc(why)}` : ""}.\nThe conversation is read-only: replies can no longer be sent to it.`)));
  if (h.assigned_uid && h.assigned_uid !== p.uid) await notifyStaff({ uids: [h.assigned_uid], kind: "case_closed", title: `Case ${h.id} was closed`, body: `Closed by ${p.name || "an administrator"}.`, link: `#/handoffs/${h.id}`, ref: h.id });
  return { status: 200, body: { ok: true, already_closed: false, request_id: h.id, previous_status: o.previous_status } };
}

export async function reopenCase({ p, requestId, reason, actor, req = null }) {
  if (!p || !can(p, "reopen_support_cases")) return { status: 403, body: { error: "forbidden", message: "Reopening needs the reopen_support_cases permission." } };
  if (!/^HS-[A-Z0-9]{8}$/.test(String(requestId || ""))) return { status: 400, body: { error: "bad_request" } };
  const why = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (why.length < 3) return { status: 400, body: { error: "reason_required", message: "A reopening reason is required (at least 3 characters)." } };
  const o = await rpc("reopen_support_case", { p_request: requestId, p_actor: actor, p_reason: why });
  if (!o.ok) {
    const map = { not_found: [404, "Not found."], not_closed: [409, "This case is not closed."], reason_required: [400, "A reopening reason is required."] };
    const [s, m] = map[o.reason] || [409, o.reason];
    return { status: s, body: { error: o.reason, message: m } };
  }
  await audit(actor, "case_reopened", { reason: why }, { target: requestId, prev: { status: "closed" }, next: { status: "ended" }, req, role: p.role });
  await notifyStaff({ uids: [o.assigned_uid, uidOf(o.closed_by)], exclude: [p.uid], kind: "case_reopened", title: `Case ${requestId} was reopened`, body: `Reopened by ${p.name || "an administrator"}: ${why.slice(0, 200)}`, link: `#/handoffs/${requestId}`, ref: requestId, key: requestId + ":" + Date.now() });
  return { status: 200, body: { ok: true, request_id: requestId } };
}
