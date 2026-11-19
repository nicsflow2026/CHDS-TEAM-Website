// Private report portal (not linked from public navigation). Authorized CHDS team identities only.
// Sign-in: Telegram user ID → one-time code sent by the CHDS bot to THAT Telegram account → short-lived session
// (HttpOnly cookie, hashed server-side, 30 min idle / 2 h absolute). Every protected call re-validates the
// session AND the team authorization (deactivated members lose access immediately). Report ownership is the
// session's verified UID — never a UID, owner or status sent by the browser.
import { randomBytes, randomInt, createHash } from "node:crypto";
import { api, sb, rpc, jsonBody, limited, hit, sameOrigin, audit, securityEvent, clientIp, userAgent, cookies, say, esc, q, UID, RID, settings, isUnique, warn, like, money } from "../../lib/core.js";
import { isDate, decodeFile, oneOf } from "../../lib/validate.js";
import { today, addDays } from "../../lib/time.js";
import { isAuthorizedReporter, approverUids, reporterProfile } from "../../lib/reporters.js";
import { reportFields, dateCheck, ownerView, REPORT_CATEGORIES, CATEGORY_LABEL, FUTURE_DAYS, STATUS_LABEL } from "../../lib/reports.js";
import { REDACTION_NOTICE } from "../../lib/secrets.js";
import { upload, signedUrl } from "../../lib/storage.js";
import { notifyText } from "../../lib/notify.js";
import { notifyStaff } from "../../lib/staffnotify.js";
import { hex, same } from "../../lib/admin/auth.js";

export const PCOOKIE = "__Host-chds_portal";
const IDLE = 30 * 6e4, ABS = 2 * 36e5;
const setCookie = (res, v, age) => res.setHeader("Set-Cookie", `${PCOOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);
const ready = () => (process.env.SESSION_SECRET || "").length >= 24;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = t => encodeURIComponent(new Date(t).toISOString());
const reviewKb = id => ({ inline_keyboard: [[{ text: "✅ Approve", callback_data: "a:" + id }, { text: "❌ Reject", callback_data: "r:" + id }]] });

async function guard(keys, op) {
  try { return await rpc("login_guard", { p_keys: keys, p_op: op }); }
  catch (e) { console.error("portal login_guard", String(e.message).slice(0, 120)); return { locked: true, retry_after: 60 }; } // fail closed
}
async function session(req, res) {
  const t = cookies(req)[PCOOKIE];
  if (!t || !/^[a-f0-9]{64}$/.test(t)) return null;
  const id = hex("portal:" + t);
  const r = (await sb(`/portal_sessions?id=eq.${id}&revoked_at=is.null&expires_at=gt.${iso(Date.now())}&select=*`))[0];
  if (!r || Date.parse(r.created_at) + ABS < Date.now()) return null;
  if (!(await isAuthorizedReporter(r.uid))) { // access removed since sign-in (deactivated, removed from the team list)
    await sb(`/portal_sessions?id=eq.${id}`, { method: "PATCH", body: { revoked_at: new Date().toISOString(), revoke_reason: "access_removed" }, prefer: "return=minimal" }).catch(warn("portal revoke"));
    setCookie(res, "", 0);
    return null;
  }
  const next = Math.min(Date.now() + IDLE, Date.parse(r.created_at) + ABS);
  if (next - Date.parse(r.expires_at) > 60000) await sb(`/portal_sessions?id=eq.${id}`, { method: "PATCH", body: { expires_at: new Date(next).toISOString(), last_seen_at: new Date().toISOString() }, prefer: "return=minimal" }).catch(warn("portal touch"));
  return { id, uid: r.uid, row: r };
}
const own = async (uid, id) => RID.test(id) ? (await sb(`/reports?id=eq.${q(id)}&uid=eq.${q(uid)}&deleted_at=is.null&select=*`))[0] || null : null;
const actor = uid => "portal:" + uid;
const fieldErr = (res, errors) => res.status(400).json({ error: "invalid", message: errors[0], errors });
const cardText = r => `Reference: <code>${r.id}</code>\nTitle: ${esc(r.title)}\nCategory: ${esc(CATEGORY_LABEL[r.category] || r.category)}\nActivity date: <b>${r.report_date}</b>\nRecovered: ${r.recovered} · Earnings: ${money(r.revenue)}`;

export default api(async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const a = String(req.query.a || ""), post = req.method === "POST";
  if (post && !sameOrigin(req, "x-chds-portal")) { await securityEvent("csrf_blocked", { severity: "warning", req, detail: { route: "portal", op: a.slice(0, 30) } }); return res.status(403).json({ error: "forbidden" }); }
  const b = post ? jsonBody(req) : {};
  if (!ready()) return res.status(503).json({ error: "not_configured" });

  /* ---------------- sign-in ---------------- */
  if (a === "start" && post) {
    if (await limited(req, "pstart", 6, 900)) return res.status(429).json({ error: "rate_limited" });
    const uid = String(b.uid || "").trim();
    if (!UID.test(uid)) return res.status(400).json({ error: "invalid", message: "Enter your numeric Telegram user ID." });
    const g = await guard(["pip:" + clientIp(req), "pu:" + uid], "check");
    if (g.locked) return res.status(429).json({ error: "locked", retry_after: g.retry_after });
    if (await hit("pstart-u:" + uid, 3, 900)) return res.status(429).json({ error: "rate_limited" });
    await sleep(150 + Math.random() * 200);
    if (await isAuthorizedReporter(uid)) {
      const code = String(randomInt(0, 1e6)).padStart(6, "0");
      await sb("/portal_otps?on_conflict=uid", { method: "POST", body: { uid, code_hash: hex("portal-otp:" + code + uid), attempts: 0, expires_at: new Date(Date.now() + 3e5).toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
      const r = await say(uid, `🔐 <b>CHDS report portal</b>\nYour sign-in code: <code>${code}</code>\nValid for 5 minutes. Enter it only on the CHDS website.\nNever share this code with anyone — CHDS staff will never ask for it.`);
      if (!r.ok) console.error("portal code not delivered"); // same answer either way (no account enumeration)
    } else if (!(await hit("sec-portal:" + clientIp(req), 1, 600))) await securityEvent("portal_denied", { severity: "info", req, detail: { reason: "not_authorized" } });
    return res.json({ ok: true, step: "code", message: "If this Telegram ID belongs to an authorized CHDS team member, a sign-in code was sent by the CHDS bot." });
  }
  if (a === "verify" && post) {
    if (await limited(req, "pverify", 10, 900)) return res.status(429).json({ error: "rate_limited" });
    const uid = String(b.uid || "").trim(), code = String(b.code || "").trim();
    if (!UID.test(uid) || !/^\d{6}$/.test(code)) return res.status(401).json({ error: "invalid" });
    const keys = ["pip:" + clientIp(req), "pu:" + uid], g = await guard(keys, "check");
    if (g.locked) return res.status(429).json({ error: "locked", retry_after: g.retry_after });
    const row = (await sb(`/portal_otps?uid=eq.${uid}&select=*`))[0];
    if (!row || Date.parse(row.expires_at) < Date.now() || row.attempts >= 5) { await sb(`/portal_otps?uid=eq.${uid}`, { method: "DELETE" }); return res.status(401).json({ error: "invalid" }); }
    if (!same(hex("portal-otp:" + code + uid), row.code_hash)) {
      await sb(`/portal_otps?uid=eq.${uid}`, { method: "PATCH", body: { attempts: row.attempts + 1 }, prefer: "return=minimal" });
      await guard(keys, "fail");
      await securityEvent("portal_login_failed", { severity: "warning", actor: uid, req });
      return res.status(401).json({ error: "invalid" });
    }
    await sb(`/portal_otps?uid=eq.${uid}`, { method: "DELETE" });
    if (!(await isAuthorizedReporter(uid))) return res.status(401).json({ error: "invalid" });
    await guard(keys, "success");
    const tok = randomBytes(32).toString("hex");
    await sb("/portal_sessions", { method: "POST", body: { id: hex("portal:" + tok), uid, ip: clientIp(req), user_agent: userAgent(req), expires_at: new Date(Date.now() + IDLE).toISOString() }, prefer: "return=minimal" });
    setCookie(res, tok, Math.floor(ABS / 1000));
    await audit(actor(uid), "portal_login", {}, { target: uid, req });
    return res.json({ ok: true });
  }

  /* ---------------- everything below needs a valid portal session ---------------- */
  const ses = await session(req, res);
  if (!ses) return res.status(401).json({ error: "unauthorized" });
  const uid = ses.uid;
  if (await hit("portal:" + uid, 300, 60)) return res.status(429).json({ error: "rate_limited" });

  if (a === "logout" && post) {
    await sb(`/portal_sessions?id=eq.${ses.id}`, { method: "PATCH", body: { revoked_at: new Date().toISOString(), revoke_reason: "logout" }, prefer: "return=minimal" });
    setCookie(res, "", 0);
    await audit(actor(uid), "portal_logout", {}, { target: uid, req });
    return res.json({ ok: true });
  }
  if (a === "me" && req.method === "GET") {
    const prof = await reporterProfile(uid), st = await settings();
    return res.json({ uid_tail: uid.slice(-4), name: prof.name, linked_member: !!prof.member_id, today: today(), reports_disabled: st.emergency.reports_disabled,
      categories: REPORT_CATEGORIES.map(k => ({ id: k, label: CATEGORY_LABEL[k], future_days: FUTURE_DAYS[k] || 0 })), statuses: STATUS_LABEL,
      session_expires_at: new Date(Math.min(Date.parse(ses.row.created_at) + ABS, Date.now() + IDLE)).toISOString() });
  }

  /* ---------------- My Reports (owner only) ---------------- */
  if (a === "reports" && req.method === "GET") {
    const qy = req.query, limit = Math.max(1, Math.min(50, parseInt(qy.limit) || 20)), offset = Math.max(0, Math.min(10000, parseInt(qy.offset) || 0));
    const basis = qy.basis === "submission" ? "created_at" : "report_date";
    const dt = d => basis === "created_at" ? `${d}T00:00:00%2B08:00` : d;
    const f = [oneOf(qy.status, Object.keys(STATUS_LABEL)) ? `&status=eq.${qy.status}` : qy.status === "published" ? "&published_at=not.is.null" : "",
      qy.archived === "1" ? "&archived_at=not.is.null" : qy.archived === "all" ? "" : "&archived_at=is.null",
      isDate(qy.from) ? `&${basis}=gte.${dt(qy.from)}` : "", isDate(qy.to) ? `&${basis}=${basis === "created_at" ? "lt" : "lte"}.${basis === "created_at" ? dt(addDays(qy.to, 1)) : qy.to}` : "",
      qy.q ? `&or=(id.ilike.${like(qy.q)},title.ilike.${like(qy.q)},description.ilike.${like(qy.q)})` : ""].join("");
    const r = await sb(`/reports?uid=eq.${q(uid)}&deleted_at=is.null${f}&select=*&order=${qy.sort === "submitted" ? "created_at.desc" : "report_date.desc,created_at.desc"}&limit=${limit}&offset=${offset}`, { count: true });
    return res.json({ total: r.total, offset, limit, rows: r.rows.map(x => ownerView(x, uid)) });
  }
  if (a === "report" && req.method === "GET") {
    const r = await own(uid, String(req.query.id || "").toUpperCase());
    if (!r) return res.status(404).json({ error: "not_found" }); // also for other people's reports (no existence leak)
    const [ev, hist] = await Promise.all([sb(`/report_evidence?report_id=eq.${r.id}&select=id,mime,size_bytes,created_at`), sb(`/report_history?report_id=eq.${r.id}&order=id.asc&select=action,from_status,to_status,reason,changes,at,actor`)]);
    return res.json({ report: ownerView(r, uid), evidence: ev,
      history: hist.map(h => ({ action: h.action, from_status: h.from_status, to_status: h.to_status, reason: h.reason, at: h.at, by: h.actor === actor(uid) || h.actor === "tg:" + uid ? "You" : "CHDS team",
        fields: h.action === "edited" ? Object.keys(h.changes || {}) : [] })) });
  }
  if (a === "evidence" && req.method === "GET") {
    const eid = parseInt(req.query.id); if (!(eid > 0)) return res.status(400).json({ error: "bad_request" });
    const e = (await sb(`/report_evidence?id=eq.${eid}&select=id,path,mime,report_id,report:reports(uid,deleted_at)`))[0];
    if (!e || !e.report || e.report.uid !== uid || e.report.deleted_at) return res.status(404).json({ error: "not_found" });
    await audit(actor(uid), "report_evidence_viewed", { via: "portal" }, { target: e.report_id, req });
    return res.json({ url: await signedUrl("report-evidence", e.path, 120), mime: e.mime, expires_in: 120 }); // private bucket, short-lived signed URL
  }
  if (!post) return res.status(404).json({ error: "not_found" });

  if (a === "submit") {
    if ((await settings()).emergency.reports_disabled) return res.status(423).json({ error: "reports_disabled", message: "Report submissions are temporarily disabled." });
    if (await hit("psub:" + uid, 10, 600)) return res.status(429).json({ error: "rate_limited", message: "Too many reports in a short time. Please wait a few minutes." });
    const v = reportFields(b, { requireDescription: true });
    if (v.errors.length) return fieldErr(res, v.errors);
    const de = dateCheck(v.values); if (de) return fieldErr(res, [de]);
    let file = null;
    if (b.evidence) { file = decodeFile(b.evidence, { allow: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 3 * 1048576 }); if (file.error) return res.status(400).json({ error: "invalid_file", message: file.error }); }
    const prof = await reporterProfile(uid);
    const row = { uid, name: prof.name, team_member_id: prof.member_id, ...v.values, status: "pending", source: "portal", submitted_by: actor(uid) };
    let created = null;
    for (let i = 0; i < 3 && !created; i++) {
      try { created = (await sb("/reports", { method: "POST", body: { ...row, id: "R" + randomBytes(4).toString("hex").toUpperCase().slice(0, 5) }, prefer: "return=representation" }))[0]; }
      catch (e) {
        if (isUnique(e) && /dedupe/.test(e.message)) return res.status(409).json({ error: "duplicate", message: "An identical report (same activity date, numbers and title) already exists." });
        if (!isUnique(e) || i === 2) throw e;
      }
    }
    let warning = null;
    if (file) {
      const path = `${created.id}/${randomBytes(6).toString("hex")}.${file.ext}`;
      try {
        await upload("report-evidence", path, file.buf, file.mime);
        await sb("/report_evidence", { method: "POST", body: { report_id: created.id, path, mime: file.mime, size_bytes: file.buf.length, sha256: createHash("sha256").update(file.buf).digest("hex"), uploaded_by: actor(uid) }, prefer: "return=minimal" });
      } catch (e) { console.error("portal evidence upload", String(e.message).slice(0, 120)); warning = "The report was saved, but the evidence file could not be uploaded. Add it again from the report details."; }
    }
    await audit(actor(uid), "report_submitted", { via: "portal", activity_date: created.report_date, evidence: !!file && !warning, redacted: v.redacted }, { target: created.id, req });
    const approvers = (await approverUids()).filter(x => x !== uid);
    await Promise.allSettled(approvers.map(x => notifyText("report_review", created.id, x, `📝 <b>New report for review</b>\nFrom: ${esc(created.name)}\n${cardText(created)}`, { reply_markup: reviewKb(created.id) })));
    await notifyStaff({ perm: "approve_reports", exclude: [uid], kind: "report_new", title: `New report ${created.id} awaiting review`, body: `${created.name} · activity date ${created.report_date}`, link: `#/reports`, ref: created.id });
    return res.json({ ok: true, report: ownerView(created, uid), warning, redacted: v.redacted, ...(v.redacted.length ? { notice: REDACTION_NOTICE } : {}) });
  }

  const id = String(b.id || "").toUpperCase(), cur = await own(uid, id);
  if (!cur) return res.status(404).json({ error: "not_found" });

  if (a === "update") {
    const v = reportFields(b, { partial: true, requireDescription: true });
    if (v.errors.length) return fieldErr(res, v.errors);
    const patch = {};
    for (const [k, val] of Object.entries(v.values)) if (String(val ?? "") !== String(cur[k] ?? "")) patch[k] = val;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no_change", message: "Nothing changed." });
    if (patch.report_date !== undefined || patch.category !== undefined) { const de = dateCheck(patch, cur); if (de) return fieldErr(res, [de]); }
    if (cur.status === "approved" && patch.revenue !== undefined && (await settings()).emergency.revenue_edits_locked) return res.status(423).json({ error: "revenue_locked", message: "Revenue edits are locked by an administrator right now." });
    const o = await rpc("report_owner_update", { p_id: id, p_uid: uid, p_patch: patch });
    if (!o.ok) return res.status(o.error === "not_found" ? 404 : 409).json({ error: o.error, message: o.error === "archived" ? "Restore the report before editing it." : undefined });
    await audit(actor(uid), "report_owner_edited", { fields: Object.keys(patch), reset_to_pending: o.prev_status !== "pending", was_published: !!o.was_published, redacted: v.redacted }, { target: id, prev: { status: o.prev_status }, next: { status: "pending" }, req });
    if (o.prev_status !== "pending") { // material change of a reviewed / approved / returned report → re-validation
      await notifyStaff({ perm: "approve_reports", exclude: [uid], kind: "report_changed", title: `Report ${id} was edited by its owner`, body: `${STATUS_LABEL[o.prev_status] || o.prev_status} → Pending review${o.was_published ? " (unpublished)" : ""}`, link: "#/reports", ref: id, key: id + ":" + o.report.updated_at });
      const approvers = (await approverUids()).filter(x => x !== uid);
      await Promise.allSettled(approvers.map(x => notifyText("report_rereview", id + ":" + o.report.updated_at, x, `✏️ <b>Report edited by its owner — review again</b>\nWas: ${esc(STATUS_LABEL[o.prev_status] || o.prev_status)}${o.was_published ? " (it was removed from the public feed)" : ""}\n${cardText(o.report)}`, { reply_markup: reviewKb(id) })));
    }
    return res.json({ ok: true, report: ownerView(o.report, uid), reset: o.prev_status !== "pending", redacted: v.redacted, ...(v.redacted.length ? { notice: REDACTION_NOTICE } : {}) });
  }
  if (a === "delete" || a === "archive") {
    const patch = a === "delete" ? { delete: true } : { archive: b.archived !== false };
    const o = await rpc("report_owner_update", { p_id: id, p_uid: uid, p_patch: patch });
    if (!o.ok) {
      const msg = { not_eligible: a === "delete" ? "Only reports that are not approved or published can be deleted. Ask an administrator for help with approved reports." : "Only approved or rejected reports that are not published can be archived.",
        archived_by_admin: "An administrator archived this report; only an administrator can restore it.", already_archived: "Already archived.", not_archived: "This report is not archived." }[o.error];
      return res.status(o.error === "not_found" ? 404 : 409).json({ error: o.error, message: msg });
    }
    await audit(actor(uid), a === "delete" ? "report_deleted" : patch.archive ? "report_archived" : "report_restored", { via: "portal" }, { target: id, prev: { status: o.prev_status }, req });
    return res.json({ ok: true, report: a === "delete" ? null : ownerView(o.report, uid) });
  }
  if (a === "evidence_add") {
    if (cur.archived_at) return res.status(409).json({ error: "archived" });
    const f = decodeFile(b.file, { allow: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 3 * 1048576 });
    if (f.error) return res.status(400).json({ error: "invalid_file", message: f.error });
    const n = (await sb(`/report_evidence?report_id=eq.${id}&select=id`, { count: true })).total;
    if (n >= 10) return res.status(409).json({ error: "too_many", message: "A report can have at most 10 evidence files." });
    const path = `${id}/${randomBytes(6).toString("hex")}.${f.ext}`;
    await upload("report-evidence", path, f.buf, f.mime);
    const e = (await sb("/report_evidence", { method: "POST", body: { report_id: id, path, mime: f.mime, size_bytes: f.buf.length, sha256: createHash("sha256").update(f.buf).digest("hex"), uploaded_by: actor(uid) }, prefer: "return=representation" }))[0];
    await audit(actor(uid), "report_evidence_added", { via: "portal", type: f.mime }, { target: id, req });
    return res.json({ ok: true, evidence: { id: e.id, mime: e.mime, size_bytes: e.size_bytes } });
  }
  return res.status(404).json({ error: "not_found" });
}, { name: "api/portal", cors: false });
