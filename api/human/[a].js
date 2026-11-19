// Human Support room transport for the visitor (poll / send / end). Every call requires the visitor identity
// cookie and the room must belong to that visitor. /api/human/request is kept as an alias of /api/ai/handoff.
// V5: a closed case rejects every message with HTTP 409 (also enforced by database triggers).
import { api, rpc, say, photos, toBlob, esc, SID, limited, jsonBody, sameOrigin, closeNotifs, sb, q, settings, isCaseClosed } from "../../lib/core.js";
import { redactSecrets, REDACTION_NOTICE } from "../../lib/secrets.js";
import { notifyStaff } from "../../lib/staffnotify.js";
import { requireVisitor, createHandoff } from "../../lib/support.js";
import { agentProfile } from "../../lib/handoff.js";
import { closeHumanRoom } from "../../lib/rooms.js";

async function ownRoom(v, sid) {
  if (!SID.test(sid)) return null;
  return (await sb(`/sessions?sid=eq.${q(sid)}&ai_user_id=eq.${q(v.user.id)}&select=sid,status,owner_uid,owner_name,request_id,conversation_id`))[0] || null;
}
const lockedConv = async room => room.conversation_id ? !!(await sb(`/ai_support_conversations?id=eq.${q(room.conversation_id)}&select=closed_at`))[0]?.closed_at : false;
const caseClosed = res => res.status(409).json({ error: "case_closed", st: "ended", locked: true, message: "This case is closed. Start a new conversation to get help." });

export default api(async (req, res) => {
  const a = String(req.query.a || ""), no = s => res.status(s).json({ error: s === 404 ? "not_found" : "bad_request" });
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" && !sameOrigin(req, "x-chds-client")) return res.status(403).json({ error: "forbidden" });
  if (a === "request" && req.method === "POST") return createHandoff(req, res, jsonBody(req)); // legacy route, same rules

  const v = await requireVisitor(req, res); if (!v) return;
  if (a === "poll" && req.method === "GET") {
    if (await limited(req, "hpoll", 90, 60)) return res.status(429).json({ error: "rate_limited" });
    const sid = String(req.query.sid || ""), room = await ownRoom(v, sid);
    if (!room) return no(404);
    const o = await rpc("poll_session", { p_sid: sid, p_after: Math.max(0, parseInt(req.query.after) || 0) });
    if (o.expired && o.expired.length) await closeNotifs(o.expired, "⏹ <b>Request expired</b> — no one joined in time.");
    return res.json({ st: o.st, n: o.n, msgs: o.msgs, request_id: o.request_id, status: o.hstatus, locked: !!o.locked, closed_at: o.locked ? o.closed_at : null,
      agent: o.st === "live" && o.owner_uid ? await agentProfile(o.owner_uid, o.owner_name) : null });
  }
  if (req.method !== "POST") return no(404);
  const b = jsonBody(req), sid = String(b.sid || "");
  if (await limited(req, "human", 40, 60)) return res.status(429).json({ error: "rate_limited" });
  const room = await ownRoom(v, sid);
  if (!room) return no(404);

  if (a === "send") {
    if ((await settings()).emergency.maintenance_mode) return res.status(503).json({ error: "maintenance" });
    if (await lockedConv(room)) return caseClosed(res);
    const raw = String(b.text || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, 1000), blob = b.img ? toBlob(b.img) : null;
    if (!raw && !blob) return no(400);
    const red = redactSecrets(raw), t = red.text; // never store or forward credentials
    let o;
    try { o = await rpc("post_message", { p_sid: sid, p_sender: "user", p_author: null, p_body: t || "[screenshot]" }); }
    catch (e) { if (isCaseClosed(e)) return caseClosed(res); throw e; } // closure committed between the check and the write
    if (!o.ok) return res.json({ st: "ended", locked: await lockedConv(room) });
    const failed = [];
    await Promise.all(o.joined.map(async uid => {
      const cap = `💬 <b>${esc(o.name)}</b> ${o.request_id ? `<code>${esc(o.request_id)}</code> ` : ""}<code>#${sid}</code>${t ? "\n" + esc(t) : ""}`;
      const ok = blob ? !!(await photos(uid, [{ b: blob }], cap)) : !!(await say(uid, cap)).ok;
      if (!ok) failed.push(uid);
    }));
    if (failed.length) console.error("relay to agent failed", sid, failed.length); // message is stored and visible in the dashboard
    if (o.request_id) { // dashboard unread notification for the assigned agent (one per unread burst, no message text)
      const h = (await sb(`/ai_handoff_requests?id=eq.${q(o.request_id)}&select=id,assigned_uid,agent_read_at`))[0];
      if (h && h.assigned_uid) await notifyStaff({ uids: [h.assigned_uid], kind: "customer_message", title: `New customer message in ${h.id}`, link: `#/handoffs/${h.id}`, ref: h.id, key: h.id + ":" + (h.agent_read_at || "unread") });
    }
    return res.json({ ok: true, st: o.st, delivered: o.joined.length - failed.length, redacted: red.found, ...(red.found.length ? { notice: REDACTION_NOTICE } : {}) });
  }

  if (a === "end") {
    if (await lockedConv(room)) return caseClosed(res);
    await closeHumanRoom(sid, "visitor:" + v.user.id, room.status === "wait" ? "customer_cancelled" : "customer_closed");
    return res.json({ ok: true });
  }
  return no(404);
}, { name: "api/human" });
