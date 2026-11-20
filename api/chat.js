// CHDS AI Support message endpoint (Groq). Stateful: the server stores every message under the visitor's
// persistent identity and builds the model context from the database, never from client-supplied history.
// V5: secrets are redacted before storage/AI; the knowledge base and admin instructions shape the prompt (the
// security policy is always last); a closed case is never answered — the reply is written through
// ai_append_message, which re-checks the lock at write time, so a reply generated before a closure is discarded.
import { api, sb, rpc, settings, jsonBody, limited, hit, sameOrigin, aiChat, q, isCaseClosed } from "../lib/core.js";
import { text as cleanText } from "../lib/validate.js";
import { ownConversation } from "../lib/visitor.js";
import { requireVisitor, validConvId } from "../lib/support.js";
import { parseSignal, decide, historyFor } from "../lib/ai.js";
import { systemPrompt } from "../lib/knowledge.js";
import { redactSecrets, asksForSecret, REDACTION_NOTICE, SAFE_REPLY } from "../lib/secrets.js";

const closed = (res, c) => res.status(409).json({ error: "case_closed", closed_at: c ? c.closed_at : null, message: "This conversation is closed. Start a new conversation to get help." });
async function append(c, userId, role, body, meta, patch) {
  try { return await rpc("ai_append_message", { p_conv: c.id, p_user: userId, p_role: role, p_body: body, p_meta: meta, p_patch: patch }); }
  catch (e) { if (isCaseClosed(e)) return { ok: false, reason: "case_closed" }; throw e; }
}

export default api(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!sameOrigin(req, "x-chds-client")) return res.status(403).json({ error: "forbidden" });
  const st = await settings();
  if (st.emergency.maintenance_mode) return res.status(503).json({ error: "maintenance" });
  if (await limited(req, "chat", 20, 60)) return res.status(429).json({ error: "rate_limited" });
  const v = await requireVisitor(req, res); if (!v) return;
  if (await hit("chat-v:" + v.user.id, 30, 60)) return res.status(429).json({ error: "rate_limited" });

  const b = jsonBody(req);
  // V6 retry: { retry_of: <user message id> } asks again for the reply to a message that is ALREADY saved
  // (after a timeout or upstream failure). The message is never stored twice.
  const retryOf = b.retry_of === undefined || b.retry_of === null ? null : Number(b.retry_of);
  if (retryOf !== null && !(Number.isInteger(retryOf) && retryOf > 0)) return res.status(400).json({ error: "bad_request" });
  const t = retryOf ? { value: "" } : cleanText(b.text, { max: 2000, multiline: true, label: "Message" });
  const ocrRaw = retryOf ? "" : cleanText(b.ocr, { max: 1500, multiline: true }).value || "";
  if (!retryOf && (t.error || (!t.value && !ocrRaw))) return res.status(400).json({ error: "bad_request", message: t.error || "Message is empty." });
  if (!validConvId(b.conversation_id)) return res.status(400).json({ error: "conversation_required" });
  const c = await ownConversation(v.user.id, b.conversation_id);
  if (!c) return res.status(404).json({ error: "not_found" });
  if (c.closed_at) return closed(res, c); // locked case: rejected regardless of the AI/human flags below
  if (st.emergency.ai_disabled) return res.status(503).json({ error: "ai_disabled", offer_human: !st.emergency.human_requests_disabled });
  if (!(process.env.GROQ_API_KEY || "").trim()) return res.status(503).json({ error: "not_configured", offer_human: true });
  if (c.owner === "human") return res.status(409).json({ error: "human_owned", sid: c.human_sid }); // AI never answers over a human agent

  let body, redacted = [], um;
  if (retryOf) {
    // only the LATEST user message, and only while it has no reply yet
    const last = (await sb(`/ai_support_messages?conversation_id=eq.${q(c.id)}&role=in.(user,assistant,agent)&order=id.desc&limit=1&select=id,role,body`))[0];
    if (!last || last.id !== retryOf || last.role !== "user") return res.status(409).json({ error: "retry_not_needed", message: "This message was already answered." });
    body = last.body; um = { ok: true, id: last.id };
  } else {
    // never store or forward credentials as ordinary support content
    const red = redactSecrets(t.value || "Please review my screenshot."), redOcr = redactSecrets(ocrRaw);
    redacted = [...new Set([...red.found, ...redOcr.found])];
    body = red.text;
    const reopenLegacy = c.status === "resolved" || c.status === "closed"; // resolved (not locked) concerns may continue
    um = await append(c, v.user.id, "user", body, { ...(redOcr.text ? { ocr: redOcr.text } : {}), ...(redacted.length ? { redacted } : {}) },
      { title: body.replace(/\s+/g, " ").slice(0, 80), ...(reopenLegacy ? { status: "active" } : {}) });
    if (!um.ok) return um.reason === "case_closed" ? closed(res, null) : um.reason === "human_owned" ? res.status(409).json({ error: "human_owned", sid: um.sid }) : res.status(404).json({ error: "not_found" });
  }

  const rows = await sb(`/ai_support_messages?conversation_id=eq.${q(c.id)}&order=id.desc&limit=30&select=role,author,body,meta`);
  const sys = await systemPrompt(rows.filter(r => r.role === "user").slice(0, 3).map(r => r.body).join(" "));
  const o = await aiChat([{ role: "system", content: sys.content }, ...historyFor(rows.reverse())]);
  if (!o.ok) {
    console.error("chat failed", o.error); // upstream detail stays out of responses
    return res.status(502).json({ error: o.error === "bad_key" ? "bad_key" : "upstream", saved_message_id: um.id, offer_human: true, reason: "knowledge_limit", redacted, ...(redacted.length ? { notice: REDACTION_NOTICE } : {}) });
  }
  const { text, signal } = parseSignal(o.reply);
  const d = decide({ userText: body, signal, failureCount: c.failure_count, threshold: Math.max(1, Number(st.support.handoff_after_failures) || 2), priorConfirm: c.status === "awaiting_confirmation" });
  let reply = text || "Sorry, I could not prepare an answer. You can try again, or tap Talk to a Human Agent.";
  const unsafe = asksForSecret(reply);
  if (unsafe) reply = SAFE_REPLY; // the model must never ask for credentials; the unsafe text is discarded, not stored
  const am = await append(c, v.user.id, "assistant", reply.slice(0, 8000),
    { model: o.model, signal: { state: signal.state, parsed: signal.parsed }, decision: { offer_human: d.offerHuman, reason: d.reason, ask: d.askConfirm }, knowledge: sys.knowledge_ids, ...(unsafe ? { policy_filtered: true } : {}) },
    { failure_count: d.failures, status: d.askConfirm ? "awaiting_confirmation" : "active", ...(d.category ? { category: d.category } : {}) });
  // The case may have been closed (or taken by a human) while Groq was answering: discard the reply.
  if (!am.ok) return am.reason === "case_closed" ? closed(res, null) : res.status(409).json({ error: "human_owned", sid: am.sid, discarded: true });
  res.json({ reply, message_id: am.id, user_message_id: um.id, ask_confirmation: d.askConfirm, offer_human: d.offerHuman, reason: d.reason, category: d.category || c.category || null, model: o.model,
    redacted, ...(redacted.length ? { notice: REDACTION_NOTICE } : {}) });
}, { name: "api/chat" });
