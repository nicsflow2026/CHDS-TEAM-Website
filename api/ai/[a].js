// CHDS AI Support visitor API: identity, profile, conversations, resolution, handoff, quota.
// Every route except GET /api/ai/me requires the identity cookie (direct API calls cannot skip registration).
import { api, sb, settings, jsonBody, limited, sameOrigin, audit, q, isCaseClosed } from "../../lib/core.js";
import { cleanName, text as cleanText, int } from "../../lib/validate.js";
import { redactSecrets } from "../../lib/secrets.js";
import { notifyStaff } from "../../lib/staffnotify.js";
import { getVisitor, createVisitor, publicProfile, ownConversation } from "../../lib/visitor.js";
import { requireVisitor, createHandoff, quotaInfo, validConvId } from "../../lib/support.js";
import { agentProfile } from "../../lib/handoff.js";
import { closeHumanRoom } from "../../lib/rooms.js";

const VISIBLE = "role=in.(user,assistant,agent,system)";
const greeting = (name, back) => back ? `Hello, ${name}! Welcome back to CHDS AI Support. How may I help you today?` : `Hello, ${name}! Welcome to CHDS AI Support. How may I help you today?`;
// closed_at = the case is LOCKED (read-only). The internal closure reason is never sent to the customer.
const convOut = c => ({ id: c.id, status: c.status, owner: c.owner, title: c.title, category: c.category, created_at: c.created_at, updated_at: c.updated_at, last_message_at: c.last_message_at, resolved_at: c.resolved_at, message_count: c.message_count,
  locked: !!c.closed_at, closed_at: c.closed_at || null });
const caseClosed = (res, c) => res.status(409).json({ error: "case_closed", closed_at: c ? c.closed_at : null, message: "This conversation is closed. Start a new conversation to get help." });

async function newConversation(v, back) {
  const c = (await sb("/ai_support_conversations", { method: "POST", body: { user_id: v.user.id }, prefer: "return=representation" }))[0];
  const m = (await sb("/ai_support_messages", { method: "POST", body: { conversation_id: c.id, user_id: v.user.id, role: "assistant", body: greeting(v.user.display_name, back), meta: { kind: "greeting" } }, prefer: "return=representation" }))[0];
  return { conversation: convOut(c), messages: [{ id: m.id, role: m.role, body: m.body, created_at: m.created_at }] };
}
async function handoffState(c) {
  if (!c.human_sid) return null;
  const h = (await sb(`/ai_handoff_requests?sid=eq.${q(c.human_sid)}&select=id,status,created_at,assigned_at,assigned_uid,assigned_name,closed_at,csat_rating`))[0];
  if (!h) return null;
  const open = ["waiting", "assigned", "in_progress", "waiting_customer"].includes(h.status);
  return { request_id: h.id, sid: c.human_sid, status: h.status, open, created_at: h.created_at, assigned_at: h.assigned_at, closed: h.status === "closed", closed_at: h.status === "closed" ? h.closed_at : null,
    can_rate: !!h.assigned_at && h.csat_rating === null && ["resolved", "closed", "ended"].includes(h.status), rated: h.csat_rating !== null && h.csat_rating !== undefined,
    agent: h.assigned_uid && open ? await agentProfile(h.assigned_uid, h.assigned_name) : null };
}

export default api(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const a = String(req.query.a || ""), post = req.method === "POST";
  if (post && !sameOrigin(req, "x-chds-client")) return res.status(403).json({ error: "forbidden" });
  const st = await settings();
  const flags = { maintenance: st.emergency.maintenance_mode, ai_enabled: !st.emergency.ai_disabled && !st.emergency.maintenance_mode, human_enabled: !st.emergency.human_requests_disabled && !st.emergency.maintenance_mode };
  const b = post ? jsonBody(req) : {};

  if (a === "me" && req.method === "GET") {
    if (await limited(req, "ai-me", 60, 60)) return res.status(429).json({ error: "rate_limited" });
    const v = await getVisitor(req, res);
    if (!v) return res.json({ identity: null, flags });
    if (v.user.status !== "active") return res.status(403).json({ error: "blocked", flags });
    const convs = await sb(`/ai_support_conversations?user_id=eq.${q(v.user.id)}&order=updated_at.desc&limit=20&select=*`);
    return res.json({ identity: publicProfile(v.user), greeting: greeting(v.user.display_name, true), conversations: convs.map(convOut), flags, quota: await quotaInfo(req, v.user.id) });
  }

  if (a === "identity" && post) {
    if (await limited(req, "ai-id", 10, 3600)) return res.status(429).json({ error: "rate_limited" });
    const existing = await getVisitor(req, res);
    if (existing) return res.status(409).json({ error: "already_registered", identity: publicProfile(existing.user) });
    const n = cleanName(b.name);
    if (n.error) return res.status(400).json({ error: "invalid_name", message: n.error });
    let u;
    try { u = await createVisitor(req, res, n.value); }
    catch (e) { console.error("identity create", e); return res.status(503).json({ error: "save_failed", message: "We could not save your name. Please try again." }); }
    await audit("visitor:" + u.id, "ai_identity_created", {}, { target: u.id, next: { display_name: u.display_name }, req });
    const first = await newConversation({ user: { id: u.id, display_name: u.display_name } }, false);
    return res.json({ identity: publicProfile({ ...u, status: "active" }), ...first });
  }

  // everything below requires a registered visitor
  const v = await requireVisitor(req, res); if (!v) return;

  if (a === "profile" && post) {
    if (await limited(req, "ai-rename", 5, 3600)) return res.status(429).json({ error: "rate_limited" });
    const n = cleanName(b.name);
    if (n.error) return res.status(400).json({ error: "invalid_name", message: n.error });
    if (n.value === v.user.display_name) return res.json({ identity: publicProfile(v.user) });
    const r = (await sb(`/ai_support_users?id=eq.${q(v.user.id)}`, { method: "PATCH", body: { display_name: n.value, updated_at: new Date().toISOString() }, prefer: "return=representation" }))[0];
    if (!r) return res.status(503).json({ error: "save_failed" });
    await sb(`/sessions?ai_user_id=eq.${q(v.user.id)}&status=neq.ended`, { method: "PATCH", body: { name: n.value }, prefer: "return=minimal" }).catch(e => console.error("rename rooms", e));
    await audit("visitor:" + v.user.id, "ai_identity_renamed", {}, { target: v.user.id, prev: { display_name: v.user.display_name }, next: { display_name: n.value }, req });
    return res.json({ identity: publicProfile(r) });
  }

  if (a === "conversations" && req.method === "GET") {
    const convs = await sb(`/ai_support_conversations?user_id=eq.${q(v.user.id)}&order=updated_at.desc&limit=50&select=*`);
    return res.json({ conversations: convs.map(convOut) });
  }

  if (a === "new" && post) {
    if (await limited(req, "ai-new", 20, 3600)) return res.status(429).json({ error: "rate_limited" });
    return res.json(await newConversation(v, true));
  }

  if (a === "conversation" && req.method === "GET") {
    const c = await ownConversation(v.user.id, req.query.id);
    if (!c) return res.status(404).json({ error: "not_found" }); // also for other visitors' conversations
    const msgs = await sb(`/ai_support_messages?conversation_id=eq.${q(c.id)}&${VISIBLE}&order=id.asc&limit=400&select=id,role,author,body,created_at,kind:meta->>kind`);
    return res.json({ conversation: convOut(c), messages: msgs, handoff: await handoffState(c), quota: await quotaInfo(req, v.user.id) });
  }

  if (a === "resolve" && post) {
    if (!validConvId(b.conversation_id)) return res.status(400).json({ error: "bad_request" });
    const c = await ownConversation(v.user.id, b.conversation_id);
    if (!c) return res.status(404).json({ error: "not_found" });
    if (c.closed_at) return caseClosed(res, c);
    if (c.owner !== "ai") return res.status(409).json({ error: "human_owned" });
    const now = new Date().toISOString();
    if (b.outcome === "resolved") {
      const r = (await sb(`/ai_support_conversations?id=eq.${q(c.id)}&owner=eq.ai`, { method: "PATCH", body: { status: "resolved", resolved_at: now, resolved_by: "visitor", updated_at: now }, prefer: "return=representation" }))[0];
      if (!r) return res.status(409).json({ error: "conflict" });
      await sb("/ai_support_messages", { method: "POST", body: { conversation_id: c.id, user_id: v.user.id, role: "system", body: "Marked as resolved by you. Thank you for contacting CHDS AI Support.", meta: { kind: "resolved" } }, prefer: "return=minimal" });
      await audit("visitor:" + v.user.id, "ai_conversation_resolved", {}, { target: c.id, req });
      return res.json({ ok: true, conversation: convOut(r) });
    }
    if (b.outcome === "not_resolved") {
      const r = (await sb(`/ai_support_conversations?id=eq.${q(c.id)}&closed_at=is.null`, { method: "PATCH", body: { status: "active", failure_count: c.failure_count + 1, updated_at: now }, prefer: "return=representation" }))[0];
      if (!r) return res.status(409).json({ error: "conflict" });
      await sb("/ai_support_messages", { method: "POST", body: { conversation_id: c.id, user_id: v.user.id, role: "system", body: "You told us the concern is not resolved yet.", meta: { kind: "not_resolved" } }, prefer: "return=minimal" });
      return res.json({ ok: true, conversation: convOut(r), offer_human: true, reason: "rejected_resolution" });
    }
    return res.status(400).json({ error: "bad_request" });
  }

  if (a === "handoff" && post) return createHandoff(req, res, b);

  if (a === "cancel" && post) {
    const c = await ownConversation(v.user.id, b.conversation_id);
    if (!c || !c.human_sid) return res.status(404).json({ error: "not_found" });
    if (c.closed_at) return caseClosed(res, c);
    await closeHumanRoom(c.human_sid, "visitor:" + v.user.id, "customer_cancelled");
    await audit("visitor:" + v.user.id, "handoff_cancelled_by_customer", {}, { target: c.human_sid, req });
    return res.json({ ok: true });
  }

  // Satisfaction feedback for a Human Support case the visitor owns (resolved, ended or closed). Feedback is stored on
  // the case, never appended to the conversation, so it is allowed after closure. First rating wins (no overwrite).
  if (a === "feedback" && post) {
    if (await limited(req, "ai-csat", 10, 3600)) return res.status(429).json({ error: "rate_limited" });
    const id = String(b.request_id || "");
    if (!/^HS-[A-Z0-9]{8}$/.test(id)) return res.status(400).json({ error: "bad_request" });
    const rating = int(b.rating, 1, 5);
    if (rating === null) return res.status(400).json({ error: "invalid", message: "Choose a rating from 1 to 5." });
    const cm = cleanText(b.comment, { max: 500, multiline: true, label: "Comment" });
    if (cm.error) return res.status(400).json({ error: "invalid", message: cm.error });
    const h = (await sb(`/ai_handoff_requests?id=eq.${q(id)}&user_id=eq.${q(v.user.id)}&select=id,status,assigned_at,assigned_uid,csat_rating`))[0];
    if (!h) return res.status(404).json({ error: "not_found" }); // also for other visitors' cases
    if (!h.assigned_at || !["resolved", "closed", "ended"].includes(h.status)) return res.status(409).json({ error: "not_eligible", message: "Feedback opens after an agent has handled your request." });
    const comment = cm.value ? redactSecrets(cm.value).text : null;
    const r = (await sb(`/ai_handoff_requests?id=eq.${q(id)}&csat_rating=is.null`, { method: "PATCH", body: { csat_rating: rating, csat_comment: comment, csat_at: new Date().toISOString() }, prefer: "return=representation" }))[0];
    if (!r) return res.status(409).json({ error: "already_rated" });
    await audit("visitor:" + v.user.id, "csat_submitted", { rating }, { target: id, req });
    if (h.assigned_uid) await notifyStaff({ uids: [h.assigned_uid], kind: "csat", title: `Customer rated ${id}: ${rating}/5`, link: `#/handoffs/${id}`, ref: id });
    return res.json({ ok: true });
  }

  if (a === "quota" && req.method === "GET") return res.json(await quotaInfo(req, v.user.id));
  return res.status(404).json({ error: "not_found" });
}, { name: "api/ai" });
