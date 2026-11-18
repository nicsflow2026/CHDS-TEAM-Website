// Visitor-side Human Support request: identity → ownership → flags → idempotency → quota → summary → atomic create → notify.
import { sb, rpc, toBlob, clientIp, settings, audit, q, limited, UUID } from "./core.js";
import { getVisitor, ownConversation } from "./visitor.js";
import { summarize, REASONS } from "./ai.js";
import { newSid, newRequestId, notifyNewRequest, recipients } from "./handoff.js";

export const quotaKeys = (req, userId) => ["v:" + userId, "ip:" + clientIp(req)];

export async function requireVisitor(req, res) {
  const v = await getVisitor(req, res);
  if (!v) { res.status(401).json({ error: "identity_required" }); return null; }
  if (v.user.status !== "active") { res.status(403).json({ error: "blocked" }); return null; }
  return v;
}

export async function quotaInfo(req, userId) {
  const s = (await settings()).support;
  const o = await rpc("support_quota", { p_keys: quotaKeys(req, userId), p_limit: s.request_limit, p_cooldown_min: s.cooldown_minutes, p_consume: false });
  return { allowed: o.allowed, remaining: o.remaining, retry_after: o.retry_after, limit: o.limit, cooldown_minutes: s.cooldown_minutes };
}

// body: { conversation_id, idempotency_key, reason?, imgs?: [jpeg data URLs], ocr? }
export async function createHandoff(req, res, body) {
  const st = await settings();
  if (st.emergency.maintenance_mode) return res.status(503).json({ error: "maintenance" });
  if (st.emergency.human_requests_disabled) return res.status(503).json({ error: "human_disabled" });
  const v = await requireVisitor(req, res); if (!v) return;
  if (await limited(req, "handoff", 12, 600)) return res.status(429).json({ error: "rate_limited", retry_after: 60 });
  const conv = await ownConversation(v.user.id, body.conversation_id);
  if (!conv) return res.status(404).json({ error: "not_found" });
  const idem = typeof body.idempotency_key === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(body.idempotency_key) ? body.idempotency_key : null;
  if (!idem) return res.status(400).json({ error: "idempotency_key_required" });

  // Already open for this conversation (double click, second tab, retry): return it, consume nothing.
  const open = (await sb(`/ai_handoff_requests?conversation_id=eq.${q(conv.id)}&status=in.(waiting,assigned,in_progress,waiting_customer)&select=id,sid,status`))[0]
    || (await sb(`/ai_handoff_requests?idempotency_key=eq.${q(idem)}&select=id,sid,status`))[0];
  if (open) return res.json({ ok: true, existing: true, request_id: open.id, sid: open.sid, status: open.status });

  const quota = await quotaInfo(req, v.user.id);
  if (!quota.allowed) return res.status(429).json({ error: "support_limit", retry_after: quota.retry_after, limit: quota.limit, cooldown_minutes: quota.cooldown_minutes });
  if (!(await recipients()).length) return res.status(503).json({ error: "no_team" });

  const reason = REASONS.includes(body.reason) ? body.reason : "user_requested";
  const rows = await sb(`/ai_support_messages?conversation_id=eq.${q(conv.id)}&order=id.desc&limit=40&select=role,author,body,meta,created_at`);
  const summary = await summarize(rows.reverse(), reason);
  const id = newRequestId(), sid = newSid();
  const o = await rpc("create_handoff", { p: {
    id, sid, conversation_id: conv.id, user_id: v.user.id, reason, reason_detail: null, category: summary.category || conv.category || null,
    summary, idempotency_key: idem, quota_keys: quotaKeys(req, v.user.id), limit: st.support.request_limit, cooldown_min: st.support.cooldown_minutes } });
  if (o.error === "not_found") return res.status(404).json({ error: "not_found" });
  if (o.blocked) return res.status(429).json({ error: "support_limit", retry_after: o.retry_after, limit: o.limit, cooldown_minutes: st.support.cooldown_minutes });
  if (o.existing) return res.json({ ok: true, existing: true, request_id: o.id, sid: o.sid, status: o.status });

  await audit("visitor:" + v.user.id, "handoff_requested", { reason, category: summary.category, summary_by: summary.generated_by }, { target: id, req });
  const blobs = (Array.isArray(body.imgs) ? body.imgs : []).slice(-3).map(toBlob).filter(Boolean);
  const h = { id, sid, user_id: v.user.id, reason, category: summary.category || conv.category, summary, status: "waiting", created_at: new Date().toISOString() };
  let n = { sent: 0, failed: 0, recipients: 0 };
  try { n = await notifyNewRequest(h, v.user.display_name, { blobs, ocr: String(body.ocr || "").slice(0, 300) }); }
  catch (e) { console.error("handoff notify", e); } // request stays valid and queued; failures are logged in notification_log
  return res.json({ ok: true, existing: false, request_id: id, sid, status: "waiting", notified: n.sent > 0, notified_count: n.sent,
    remaining: o.remaining, retry_after: o.retry_after, summary: { category: h.category } });
}

export const validConvId = v => typeof v === "string" && UUID.test(v);
