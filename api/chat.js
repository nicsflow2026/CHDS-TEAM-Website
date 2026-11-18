// CHDS AI Support message endpoint (Groq). Stateful: the server stores every message under the visitor's
// persistent identity and builds the model context from the database, never from client-supplied history.
import { api, sb, settings, jsonBody, limited, hit, sameOrigin, aiChat, q } from "../lib/core.js";
import { text as cleanText } from "../lib/validate.js";
import { ownConversation } from "../lib/visitor.js";
import { requireVisitor, validConvId } from "../lib/support.js";
import { SYSTEM, parseSignal, decide, historyFor } from "../lib/ai.js";

export default api(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!sameOrigin(req, "x-chds-client")) return res.status(403).json({ error: "forbidden" });
  const st = await settings();
  if (st.emergency.maintenance_mode) return res.status(503).json({ error: "maintenance" });
  if (st.emergency.ai_disabled) return res.status(503).json({ error: "ai_disabled", offer_human: !st.emergency.human_requests_disabled });
  if (!(process.env.GROQ_API_KEY || "").trim()) return res.status(503).json({ error: "not_configured", offer_human: true });
  if (await limited(req, "chat", 20, 60)) return res.status(429).json({ error: "rate_limited" });
  const v = await requireVisitor(req, res); if (!v) return;
  if (await hit("chat-v:" + v.user.id, 30, 60)) return res.status(429).json({ error: "rate_limited" });

  const b = jsonBody(req);
  const t = cleanText(b.text, { max: 2000, multiline: true, label: "Message" });
  const ocr = cleanText(b.ocr, { max: 1500, multiline: true }).value || "";
  if (t.error || (!t.value && !ocr)) return res.status(400).json({ error: "bad_request", message: t.error || "Message is empty." });
  if (!validConvId(b.conversation_id)) return res.status(400).json({ error: "conversation_required" });
  const c = await ownConversation(v.user.id, b.conversation_id);
  if (!c) return res.status(404).json({ error: "not_found" });
  if (c.owner === "human") return res.status(409).json({ error: "human_owned", sid: c.human_sid }); // AI never answers over a human agent

  const body = t.value || "Please review my screenshot.";
  const um = (await sb("/ai_support_messages", { method: "POST", body: { conversation_id: c.id, user_id: v.user.id, role: "user", body, meta: ocr ? { ocr } : {} }, prefer: "return=representation" }))[0];
  const patch = { updated_at: new Date().toISOString() };
  if (!c.title) patch.title = body.replace(/\s+/g, " ").slice(0, 80);
  if (c.status === "resolved" || c.status === "closed") patch.status = "active"; // a new message reopens the concern

  const rows = await sb(`/ai_support_messages?conversation_id=eq.${q(c.id)}&order=id.desc&limit=30&select=role,author,body,meta`);
  const o = await aiChat([{ role: "system", content: SYSTEM }, ...historyFor(rows.reverse())]);
  if (!o.ok) {
    await sb(`/ai_support_conversations?id=eq.${q(c.id)}`, { method: "PATCH", body: patch, prefer: "return=minimal" }).catch(e => console.error("conv patch", e));
    console.error("chat failed", o.error, o.detail);
    return res.status(502).json({ error: o.error === "bad_key" ? "bad_key" : "upstream", saved_message_id: um.id, offer_human: true, reason: "knowledge_limit" });
  }
  const { text, signal } = parseSignal(o.reply);
  const d = decide({ userText: body, signal, failureCount: c.failure_count, threshold: Math.max(1, Number(st.support.handoff_after_failures) || 2), priorConfirm: c.status === "awaiting_confirmation" });
  const reply = text || "Sorry, I could not prepare an answer. You can try again, or tap Talk to a Human Agent.";
  const am = (await sb("/ai_support_messages", { method: "POST", body: { conversation_id: c.id, user_id: v.user.id, role: "assistant", body: reply.slice(0, 8000),
    meta: { model: o.model, signal: { state: signal.state, parsed: signal.parsed }, decision: { offer_human: d.offerHuman, reason: d.reason, ask: d.askConfirm } } }, prefer: "return=representation" }))[0];
  Object.assign(patch, { failure_count: d.failures, status: d.askConfirm ? "awaiting_confirmation" : "active", ...(d.category ? { category: d.category } : {}) });
  await sb(`/ai_support_conversations?id=eq.${q(c.id)}&owner=eq.ai`, { method: "PATCH", body: patch, prefer: "return=minimal" });
  res.json({ reply, message_id: am.id, user_message_id: um.id, ask_confirmation: d.askConfirm, offer_human: d.offerHuman, reason: d.reason, category: d.category || c.category || null, model: o.model });
}, { name: "api/chat" });
