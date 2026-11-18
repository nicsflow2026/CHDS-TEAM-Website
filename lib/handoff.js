// AI → Human Support handoff helpers shared by the visitor API, the Telegram bot and the admin dashboard.
import { randomBytes } from "node:crypto";
import { sb, rpc, say, photos, team, esc, appUrl, closeNotifs, q, tzo } from "./core.js";
import { notifyOnce } from "./notify.js";
import { REASON_LABEL, CATEGORY_LABEL } from "./ai.js";
import { publicUrl } from "./storage.js";

export const newSid = () => randomBytes(8).toString("hex");
export const newRequestId = () => "HS-" + randomBytes(8).toString("base64").replace(/[^A-Za-z0-9]/g, "").toUpperCase().padEnd(8, "X").slice(0, 8);
export const phTime = iso => new Date(Date.parse(iso) + tzo() * 36e5).toISOString().slice(0, 16).replace("T", " ") + ` (UTC+${tzo()})`;
export const STATUS_LABEL = { waiting: "Waiting for Agent", assigned: "Assigned", in_progress: "In Progress", waiting_customer: "Waiting for Customer", resolved: "Resolved", closed: "Closed", cancelled: "Cancelled" };

// Configured team UIDs minus members an admin marked inactive (or removed) in Team Management.
export async function recipients() {
  const all = team();
  if (!all.length) return [];
  let rows = [];
  try { rows = await sb(`/team_members?telegram_uid=in.(${all.join(",")})&select=telegram_uid,status,deleted_at`); }
  catch (e) { console.error("recipients lookup", String(e.message).slice(0, 120)); }
  const off = new Set(rows.filter(r => r.status !== "active" || r.deleted_at).map(r => r.telegram_uid));
  return all.filter(u => !off.has(u));
}
export async function isActiveMember(uid) {
  if (!team().includes(uid)) return false;
  const r = (await sb(`/team_members?telegram_uid=eq.${q(uid)}&select=status,deleted_at`).catch(() => []))[0];
  return !r || (r.status === "active" && !r.deleted_at);
}

export function requestText(h, userName, { ocr = "", shots = 0 } = {}) {
  const s = h.summary || {};
  const link = appUrl() ? `\n🔗 ${esc(appUrl())}/admin#/handoffs/${h.id}` : "\nReference: Admin → Human Handoff Queue";
  const att = (s.attempted || []).length ? `\n<b>Already covered by AI:</b> ${esc(s.attempted.slice(0, 4).join("; ").slice(0, 400))}` : "";
  return `🆘 <b>CHDS HUMAN SUPPORT REQUEST</b>
Request ID: <code>${h.id}</code>
Customer: <b>${esc(userName)}</b> <i>(name given by the visitor)</i>
User ID: <code>${esc(String(h.user_id).slice(0, 8))}</code>
Issue category: ${esc(CATEGORY_LABEL[h.category] || h.category || "Not classified")}
Reason for escalation: ${esc(REASON_LABEL[h.reason] || h.reason)}

🤖 <b>AI summary</b> <i>(auto-generated, not the customer's words)</i>
${esc(String(s.summary || "(none)").slice(0, 900))}${s.unresolved ? `\n<b>Unresolved:</b> ${esc(String(s.unresolved).slice(0, 300))}` : ""}${att}${ocr ? `\n\n📄 <b>Screenshot text (OCR)</b>\n${esc(ocr.slice(0, 300))}` : ""}${shots ? `\n📷 Screenshots attached: ${shots}` : ""}
${link}
Requested: ${phTime(h.created_at || new Date().toISOString())}
Status: ⏳ ${STATUS_LABEL[h.status] || "Waiting for Agent"}`;
}
export const requestKb = (sid, id) => ({ inline_keyboard: [[{ text: "✅ Accept Request", callback_data: "ha:" + sid }, { text: "🔎 View Details", callback_data: "hd:" + sid }],
  ...(appUrl().startsWith("https://") ? [[{ text: "Open in dashboard", url: `${appUrl()}/admin#/handoffs/${id}` }]] : [])] });

// Send the new-request alert to every active recipient once (de-duplicated per request + recipient).
export async function notifyNewRequest(h, userName, { blobs = [], ocr = "" } = {}) {
  const list = await recipients();
  const text = requestText(h, userName, { ocr, shots: blobs.length }), kb = requestKb(h.sid, h.id);
  let fids = null; const notif = [], failed = [];
  for (const uid of list) {
    const r = await notifyOnce("handoff_new", h.id, uid, async c => {
      if (blobs.length) {
        const f = await photos(c, fids ? fids.map(x => ({ f: x })) : blobs.map(x => ({ b: x })));
        if (f) fids = fids || f; // screenshots are best-effort; the text alert is what counts
      }
      return say(c, text, { reply_markup: kb });
    });
    if (r.ok) notif.push([uid, r.message_id]);
    else if (!r.skipped || r.skipped === "disabled") failed.push({ uid, error: r.error || r.skipped });
  }
  await saveNotif(h.sid, notif);
  await sb(`/ai_handoff_requests?id=eq.${q(h.id)}`, { method: "PATCH", body: { notified_count: notif.length + (h.notified_count || 0), notify_failed: failed.length, updated_at: new Date().toISOString() }, prefer: "return=minimal" })
    .catch(e => console.error("handoff notify count", String(e.message).slice(0, 120)));
  return { sent: notif.length, failed: failed.length, recipients: list.length };
}
async function saveNotif(sid, add) {
  if (!add.length) return;
  const s = (await sb(`/sessions?sid=eq.${q(sid)}&select=notif`))[0];
  const cur = Array.isArray(s && s.notif) ? s.notif : [];
  const merged = [...cur.filter(([c]) => !add.some(([a]) => String(a) === String(c))), ...add];
  await sb(`/sessions?sid=eq.${q(sid)}`, { method: "PATCH", body: { notif: merged }, prefer: "return=minimal" });
}

// Re-send alerts that failed (or never went out) for an open request. Safe to call repeatedly.
export async function retryRequest(id) {
  const h = (await sb(`/ai_handoff_requests?id=eq.${q(id)}&select=*,user:ai_support_users(display_name)`))[0];
  if (!h) return { error: "not_found" };
  if (h.status !== "waiting") return { error: "not_waiting" };
  return notifyNewRequest(h, h.user ? h.user.display_name : "Customer");
}

// After an agent accepted: replace everyone else's Accept button with who took it.
export async function announceAccepted(notif, sid, agentUid, agentName, requestId) {
  const others = (Array.isArray(notif) ? notif : []).filter(([c]) => String(c) !== String(agentUid));
  await closeNotifs(others, `✅ <b>${esc(requestId || "#" + sid)}</b> was accepted by <b>${esc(agentName)}</b>.\nNo action needed.`);
}

// Full context for an authorized team member ("View Details" button)
export async function detailsText(sid) {
  const s = (await sb(`/sessions?sid=eq.${q(sid)}&select=sid,name,status,request_id,conversation_id,owner_name,created_at`))[0];
  if (!s) return null;
  const h = s.request_id ? (await sb(`/ai_handoff_requests?id=eq.${q(s.request_id)}&select=*`))[0] : null;
  const rows = s.conversation_id ? await sb(`/ai_support_messages?conversation_id=eq.${q(s.conversation_id)}&role=in.(user,assistant,agent)&order=id.desc&limit=14&select=role,author,body,created_at`) : [];
  const lines = rows.reverse().map(m => `${m.role === "user" ? "👤" : m.role === "assistant" ? "🤖" : "🧑‍💼"} ${esc(m.body.slice(0, 260))}`);
  let body = lines.join("\n");
  if (body.length > 2600) body = "…" + body.slice(-2600).replace(/^[^\n]*\n/, "");
  const sm = h && h.summary ? h.summary : {};
  return `🔎 <b>Request ${esc(s.request_id || "#" + sid)}</b> · ${esc(STATUS_LABEL[h ? h.status : ""] || s.status)}
Customer: <b>${esc(s.name)}</b>${s.owner_name ? `\nAssigned to: ${esc(s.owner_name)}` : ""}
${h ? `Reason: ${esc(REASON_LABEL[h.reason] || h.reason)}\nCategory: ${esc(CATEGORY_LABEL[h.category] || h.category || "-")}\n` : ""}
🤖 <b>AI summary</b> <i>(auto-generated)</i>
${esc(String(sm.summary || "(none)").slice(0, 700))}${sm.attempted && sm.attempted.length ? `\nAI already covered: ${esc(sm.attempted.join("; ").slice(0, 300))}` : ""}${sm.unresolved ? `\nUnresolved: ${esc(String(sm.unresolved).slice(0, 300))}` : ""}

<b>Conversation (latest)</b>
${body || "(no messages)"}`;
}

export async function queueText() {
  const rows = await sb("/ai_handoff_requests?status=eq.waiting&order=created_at.asc&limit=10&select=id,sid,reason,category,created_at,user:ai_support_users(display_name)");
  return { rows, text: rows.length ? `⏳ <b>Waiting for an agent</b> (${rows.length})\n\n` + rows.map(r => `<code>${r.id}</code> · ${esc(r.user ? r.user.display_name : "Customer")} · ${esc(CATEGORY_LABEL[r.category] || "-")}\n${esc(REASON_LABEL[r.reason] || r.reason)} · since ${phTime(r.created_at)}`).join("\n\n") : "✅ No requests are waiting." };
}

// Approved public profile of the agent shown to the customer ("Connected to Human Agent")
export async function agentProfile(uid, fallbackName) {
  const m = uid ? (await sb(`/team_members?telegram_uid=eq.${q(uid)}&deleted_at=is.null&select=display_name,role_title,photo_path,is_public,status`).catch(() => []))[0] : null;
  if (m && m.is_public) return { name: m.display_name, role: m.role_title, photo: publicUrl("team-photos", m.photo_path) };
  return { name: fallbackName || "CHDS Support", role: "CHDS Support", photo: null };
}

export const closeAll = (notif, text) => closeNotifs(notif, text);
export const statusOf = async id => (await sb(`/ai_handoff_requests?id=eq.${q(id)}&select=status`))[0]?.status || null;
export { rpc };
