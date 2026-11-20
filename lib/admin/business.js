import { randomBytes, createHash } from "node:crypto";
import { sb, rpc, q, like, UUID, RID, UID, isUnique, hit, settings, say, esc, rid, warn } from "../core.js";
import { cleanName, text, oneOf, isDate, int, amount, httpsUrl, tgUsername, decodeFile, toCsv } from "../validate.js";
import { today, range, addDays, weekStart, monthStart, yearStart, MIN_DATE } from "../time.js";
import { can, teamScope, isFounder, envFounders } from "../rbac.js";
import { upload, publicUrl, signedUrl, remove, EVIDENCE_BUCKET } from "../storage.js";
import { syncAfterUnpublish } from "../publicimages.js";
import { deletionJobs } from "../deletion.js";
import { notifyText } from "../notify.js";
import { recipients } from "../handoff.js";
import { REPORT_CATEGORIES, reportFields, dateCheck, activityDateError, STATUS_LABEL as REPORT_STATUS } from "../reports.js";
import { notifyStaff } from "../staffnotify.js";
import { fail, need, actor, page, v, reasonOf, diff } from "./util.js";

export { REPORT_CATEGORIES };
const MATERIAL = ["title", "description", "account_info", "category", "recovered", "revenue", "report_date"];
const PUBLIC_FACTS = ["category", "recovered", "report_date"];
export async function storeEvidence(reportId, f, by) {
  const path = `${reportId}/${randomBytes(6).toString("hex")}.${f.ext}`;
  await upload(EVIDENCE_BUCKET, path, f.buf, f.mime);
  try { return (await sb("/report_evidence", { method: "POST", body: { report_id: reportId, path, mime: f.mime, size_bytes: f.buf.length, sha256: createHash("sha256").update(f.buf).digest("hex"), uploaded_by: by }, prefer: "return=representation" }))[0]; }
  catch (e) { await remove(EVIDENCE_BUCKET, [path]).catch(warn("evidence rollback")); throw e; }
}
const memberOut = r => ({ ...r, photo_url: publicUrl("team-photos", r.photo_path) });
const scopeFilter = (scope, idCol, uidCol) => !scope ? "" : `&or=(${idCol}.in.(${scope.ids.join(",") || "00000000-0000-0000-0000-000000000000"}),${uidCol}.in.(${scope.uids.map(u => `"${u}"`).join(",") || '"-"'}))`;
async function inScope(ctx, member_id, uid) {
  const s = await teamScope(ctx.p);
  return !s || s.ids.includes(member_id) || s.uids.includes(uid);
}
async function lockedRevenue() { return (await settings()).emergency.revenue_edits_locked; }

export const ops = {
  team_list: { perm: "manage_team", method: "GET", fn: async ctx => {
    const { qy } = ctx;
    const f = [qy.deleted === "1" ? "&deleted_at=not.is.null" : "&deleted_at=is.null", oneOf(qy.status, ["active", "inactive"]) ? `&status=eq.${qy.status}` : "",
      qy.q ? `&or=(display_name.ilike.${like(qy.q)},role_title.ilike.${like(qy.q)},telegram_username.ilike.${like(qy.q)})` : ""].join("");
    const rows = await sb(`/team_members?select=*${f}&order=display_order.asc,display_name.asc&limit=500`);
    return { rows: rows.map(memberOut) };
  } },

  team_options: { perm: null, method: "GET", fn: async ctx => {
    const scope = await teamScope(ctx.p);
    const rows = await sb(`/team_members?deleted_at=is.null&select=id,display_name,status,telegram_uid${scope ? `&id=in.(${scope.ids.join(",") || "00000000-0000-0000-0000-000000000000"})` : ""}&order=display_order.asc,display_name.asc`);
    return { rows: rows.map(r => ({ id: r.id, name: r.display_name, status: r.status, has_telegram: !!r.telegram_uid })), self: ctx.p.team_member_id };
  } },

  team_save: { perm: "manage_team", method: "POST", fn: async ctx => {
    const { b } = ctx;
    const body = {
      display_name: v(cleanName(b.display_name, { min: 1, max: 60 })),
      role_title: v(text(b.role_title, { min: 1, max: 60, required: true, label: "Role" })),
      member_group: oneOf(b.member_group, ["founder", "admin", "member"], "member"),
      telegram_username: v(tgUsername(b.telegram_username)),
      telegram_uid: b.telegram_uid ? (UID.test(String(b.telegram_uid).trim()) ? String(b.telegram_uid).trim() : fail(400, "invalid", "Telegram UID must be digits only.")) : null,
      facebook_url: v(httpsUrl(b.facebook_url, ["facebook.com", "fb.com"])),
      bio: v(text(b.bio, { max: 400, multiline: true, label: "Description" })),
      display_order: int(b.display_order ?? 100, 0, 100000) ?? fail(400, "invalid", "Display order must be 0–100000."),
      is_public: b.is_public !== false, show_telegram: b.show_telegram !== false,
      leader_id: b.leader_id ? (UUID.test(b.leader_id) ? b.leader_id : fail(400, "invalid", "Invalid team leader.")) : null
    };
    const existing = b.id ? (await sb(`/team_members?id=eq.${q(b.id)}&deleted_at=is.null&select=*`))[0] : null;
    if (b.id) need(existing, 404, "not_found");
    need(!existing || body.leader_id !== existing.id, 400, "invalid", "A member cannot lead themselves.");
    try {
      if (existing) {
        const r = (await sb(`/team_members?id=eq.${q(existing.id)}`, { method: "PATCH", body, prefer: "return=representation" }))[0];
        const d = diff(existing, r, Object.keys(body));
        if (d.prev.telegram_uid !== undefined) { d.prev.telegram_uid = d.prev.telegram_uid ? "(set)" : null; d.next.telegram_uid = d.next.telegram_uid ? "(set)" : null; }
        await ctx.audit("team_member_updated", {}, { target: r.id, prev: d.prev, next: d.next });
        return { ok: true, member: memberOut(r) };
      }
      const r = (await sb("/team_members", { method: "POST", body: { ...body, status: "active", created_by: actor(ctx) }, prefer: "return=representation" }))[0];
      await ctx.audit("team_member_added", {}, { target: r.id, next: { display_name: r.display_name, role_title: r.role_title, member_group: r.member_group } });
      return { ok: true, member: memberOut(r) };
    } catch (e) { if (isUnique(e)) fail(409, "duplicate", "Another member already uses that Telegram UID."); throw e; }
  } },

  team_photo: { perm: "manage_team", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(UUID.test(id), 400, "bad_request");
    const m = (await sb(`/team_members?id=eq.${id}&deleted_at=is.null&select=id,photo_path`))[0]; need(m, 404, "not_found");
    const f = decodeFile(ctx.b.file, { allow: ["image/jpeg", "image/png", "image/webp"], maxBytes: 2 * 1048576 });
    if (f.error) fail(400, "invalid_file", f.error);
    const path = `${id}/${randomBytes(6).toString("hex")}.${f.ext}`;
    await upload("team-photos", path, f.buf, f.mime);
    await sb(`/team_members?id=eq.${id}`, { method: "PATCH", body: { photo_path: path }, prefer: "return=minimal" });
    if (m.photo_path) await remove("team-photos", [m.photo_path]).catch(e => console.error("old photo remove", String(e.message).slice(0, 100)));
    await ctx.audit("team_member_photo", { bytes: f.buf.length, type: f.mime }, { target: id });
    return { ok: true, photo_url: publicUrl("team-photos", path) };
  } },

  team_status: { perm: "manage_team", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""), status = oneOf(ctx.b.status, ["active", "inactive"]); need(UUID.test(id) && status, 400, "bad_request");
    const reason = reasonOf(ctx.b);
    const r = (await sb(`/team_members?id=eq.${id}&deleted_at=is.null`, { method: "PATCH", body: { status }, prefer: "return=representation" }))[0]; need(r, 404, "not_found");
    await ctx.audit(status === "active" ? "team_member_activated" : "team_member_deactivated", { reason }, { target: id, next: { status } });
    return { ok: true };
  } },

  team_delete: { perm: "manage_team", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(UUID.test(id), 400, "bad_request");
    const reason = reasonOf(ctx.b);
    const led = await sb(`/team_members?leader_id=eq.${id}&deleted_at=is.null&select=display_name&limit=5`);
    need(!led.length, 409, "leads_members", `Reassign the members this person leads first (${led.map(x => x.display_name).join(", ")}). Deactivation is usually the better choice.`);
    const r = (await sb(`/team_members?id=eq.${id}&deleted_at=is.null`, { method: "PATCH", body: { deleted_at: new Date().toISOString(), status: "inactive" }, prefer: "return=representation" }))[0]; need(r, 404, "not_found");
    await ctx.audit("team_member_removed", { reason, note: "soft delete — history and performance are preserved" }, { target: id, prev: { display_name: r.display_name } });
    return { ok: true };
  } },

  reports_list: { perm: ["manage_reports", "approve_reports"], method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy, 25), scope = await teamScope(ctx.p);
    const basis = qy.basis === "submission" ? "created_at" : "report_date", ph = (d, end) => basis === "created_at" ? `${d}T${end ? "23:59:59.999" : "00:00:00"}%2B08:00` : d;
    const f = [oneOf(qy.status, Object.keys(REPORT_STATUS)) ? `&status=eq.${qy.status}` : qy.status === "open" ? "&status=in.(pending,reviewed)" : "",
      qy.published === "1" ? "&published_at=not.is.null" : qy.published === "0" ? "&published_at=is.null" : "",
      qy.archived === "withdrawn" ? "&deleted_at=not.is.null" : (qy.archived === "1" ? "&archived_at=not.is.null" : qy.archived === "all" ? "" : "&archived_at=is.null") + "&deleted_at=is.null",
      UUID.test(qy.member || "") ? `&team_member_id=eq.${qy.member}` : "", oneOf(qy.category, REPORT_CATEGORIES) ? `&category=eq.${qy.category}` : "",
      isDate(qy.from) ? `&${basis}=gte.${ph(qy.from)}` : "", isDate(qy.to) ? `&${basis}=lte.${ph(qy.to, true)}` : "",
      qy.q ? `&or=(id.ilike.${like(qy.q)},title.ilike.${like(qy.q)},name.ilike.${like(qy.q)})` : "", scopeFilter(scope, "team_member_id", "uid")].join("");
    const r = await sb(`/reports?select=id,uid,name,title,category,recovered,revenue,report_date,status,source,created_at,reviewed_at,reviewed_by,rejection_reason,team_member_id,published_at,archived_at,deleted_at,deletion_pending_at${f}&order=${qy.sort === "activity" ? "report_date.desc,created_at.desc" : "created_at.desc"}${pg.range}`, { count: true });
    return r;
  } },

  report_get: { perm: ["manage_reports", "approve_reports"], method: "GET", fn: async ctx => {
    const id = String(ctx.qy.id || "").toUpperCase(); need(RID.test(id), 400, "bad_request");
    const r = (await sb(`/reports?id=eq.${id}&select=*`))[0]; need(r, 404, "not_found");
    need(await inScope(ctx, r.team_member_id, r.uid), 403, "forbidden");
    const [evidence, history, notes, jobs] = await Promise.all([sb(`/report_evidence?report_id=eq.${id}&select=id,mime,size_bytes,created_at,uploaded_by`), sb(`/report_history?report_id=eq.${id}&order=id.asc&select=*`), sb(`/internal_notes?subject_type=eq.report&subject_id=eq.${id}&order=id.desc&select=*`),
      can(ctx.p, "delete_reports") && r.deletion_pending_at ? deletionJobs({ open: true, limit: 200 }) : []]);
    const job = jobs.find(j => j.report_id === id);
    return { report: r, evidence, history, notes, deletion_job: job ? { id: job.id, status: job.status, attempts: job.attempts, last_error: job.last_error, requested_at: job.requested_at } : null,
      can: { delete: can(ctx.p, "delete_reports") } };
  } },

  report_submit: { perm: null, method: "POST", fn: async ctx => {
    const { b, p } = ctx;
    need((await settings()).emergency.reports_disabled === false, 423, "reports_disabled", "Report submissions are temporarily disabled (Emergency Control).");
    if (await hit("rep-sub:" + p.uid, 10, 600)) fail(429, "rate_limited", "Too many reports in a short time. Please wait a few minutes.");
    const memberId = String(b.team_member_id || "");
    need(UUID.test(memberId), 400, "invalid", "Choose the team member.");
    need(can(p, "manage_reports") || p.team_member_id === memberId, 403, "forbidden", "You can only submit reports for yourself.");
    if (can(p, "manage_reports")) need(await inScope(ctx, memberId, null), 403, "forbidden", "That member is outside your team.");
    const m = (await sb(`/team_members?id=eq.${memberId}&deleted_at=is.null&select=id,display_name,telegram_uid,status`))[0];
    need(m, 400, "invalid", "That team member does not exist.");
    const val = reportFields(b);
    if (val.errors.length) fail(400, "invalid", val.errors[0]);
    const de = dateCheck(val.values); if (de) fail(400, "invalid", de);
    const { title, description, account_info, category, recovered, revenue, additional_info: info } = val.values;
    let file = null;
    if (b.evidence) { file = decodeFile(b.evidence, { allow: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 3 * 1048576 }); if (file.error) fail(400, "invalid_file", file.error); }
    const row = { uid: m.telegram_uid || "tm:" + m.id, name: m.display_name, team_member_id: m.id, title, description: description || null, account_info: account_info || null, category, recovered, revenue,
      report_date: b.report_date, additional_info: info || null, status: "pending", source: "dashboard", submitted_by: actor(ctx) };
    let created = null;
    for (let i = 0; i < 3 && !created; i++) {
      try { created = (await sb("/reports", { method: "POST", body: { ...row, id: "R" + randomBytes(4).toString("hex").toUpperCase().slice(0, 5) }, prefer: "return=representation" }))[0]; }
      catch (e) {
        if (isUnique(e) && /dedupe/.test(e.message)) fail(409, "duplicate", "An identical report (same member, date, numbers and title) already exists.");
        if (!isUnique(e) || i === 2) throw e;
      }
    }
    let evidence = null, warning = null;
    if (file) {
      const path = `${created.id}/${randomBytes(6).toString("hex")}.${file.ext}`;
      try {
        evidence = await storeEvidence(created.id, file, actor(ctx));
      } catch (e) { console.error("evidence upload", e); warning = "The report was saved, but the evidence file could not be uploaded. Attach it again from the report details."; }
    }
    await ctx.audit("report_submitted", { recovered, revenue, date: b.report_date, evidence: !!evidence }, { target: created.id });
    if (b.approve_now === true && can(p, "approve_reports") && (isFounder(p) || created.team_member_id !== p.team_member_id)) {
      const o = await rpc("report_review", { p_id: created.id, p_actor: actor(ctx), p_action: "approve", p_reason: null, p_note: "Approved at submission" });
      if (o.ok) { created = o.report; await ctx.audit("report_approved", { at_submission: true }, { target: created.id }); }
    }
    return { ok: true, report: created, evidence_id: evidence ? evidence.id : null, warning, redacted: val.redacted };
  } },

  report_evidence_add: { perm: ["manage_reports", "approve_reports"], method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || "").toUpperCase(); need(RID.test(id), 400, "bad_request");
    const r = (await sb(`/reports?id=eq.${id}&deleted_at=is.null&select=id,team_member_id,uid,deletion_pending_at`))[0]; need(r, 404, "not_found");
    need(await inScope(ctx, r.team_member_id, r.uid), 403, "forbidden");
    need(!r.deletion_pending_at, 423, "deletion_pending", "This report is being permanently deleted.");
    const f = decodeFile(ctx.b.file, { allow: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 3 * 1048576 }); if (f.error) fail(400, "invalid_file", f.error);
    need((await sb(`/report_evidence?report_id=eq.${id}&select=id`, { count: true })).total < 10, 409, "too_many", "A report can have at most 10 evidence files.");
    const e = await storeEvidence(id, f, actor(ctx));
    await ctx.audit("report_evidence_added", { type: f.mime }, { target: id });
    return { ok: true, evidence: { id: e.id, mime: e.mime, size_bytes: e.size_bytes } };
  } },

  report_evidence_url: { perm: ["manage_reports", "approve_reports"], method: "GET", fn: async ctx => {
    const eid = int(ctx.qy.id, 1, 1e12); need(eid, 400, "bad_request");
    const e = (await sb(`/report_evidence?id=eq.${eid}&select=*,report:reports(team_member_id,uid)`))[0]; need(e, 404, "not_found");
    need(await inScope(ctx, e.report?.team_member_id, e.report?.uid), 403, "forbidden");
    await ctx.audit("report_evidence_viewed", {}, { target: e.report_id });
    return { url: await signedUrl("report-evidence", e.path, 300), mime: e.mime, expires_in: 300 };
  } },

  report_review: { perm: "approve_reports", method: "POST", fn: async ctx => {
    const { b } = ctx, id = String(b.id || "").toUpperCase(), action = oneOf(b.action, ["approve", "reject", "review", "request_changes"]);
    need(RID.test(id) && action, 400, "bad_request");
    const r = (await sb(`/reports?id=eq.${id}&deleted_at=is.null&select=*`))[0]; need(r, 404, "not_found");
    need(await inScope(ctx, r.team_member_id, r.uid), 403, "forbidden", "That report is outside your team.");
    need(isFounder(ctx.p) || (r.uid !== ctx.p.uid && r.submitted_by !== actor(ctx) && (!ctx.p.team_member_id || r.team_member_id !== ctx.p.team_member_id)), 403, "own_report", "You cannot review your own report.");
    const reason = action === "reject" ? reasonOf(b, "A rejection reason") : action === "request_changes" ? reasonOf(b, "A description of the corrections needed") : null;
    const note = v(text(b.note, { max: 500, multiline: true, label: "Remarks" }));
    const o = await rpc("report_review", { p_id: id, p_actor: actor(ctx), p_action: action, p_reason: reason, p_note: note || null });
    if (!o.ok) fail(409, o.error, o.error === "already_handled" ? `Already ${REPORT_STATUS[o.status] || o.status}.` : o.error === "archived" ? "Restore the report from the archive first." : o.error);
    await ctx.audit("report_" + { approve: "approved", reject: "rejected", review: "reviewed", request_changes: "corrections_requested" }[action], { reason, note }, { target: id, prev: { status: r.status }, next: { status: o.report.status } });
    const msg = { approve: `✅ <b>Report approved</b>\n<code>${id}</code> was approved. It appears on the public report feed only if an administrator publishes it.`,
      reject: `❌ <b>Report not approved</b>\n<code>${id}</code> was rejected.\nReason: ${esc(reason)}`,
      request_changes: `✏️ <b>Corrections requested</b>\n<code>${id}</code> needs changes before it can be approved:\n${esc(reason)}\nEdit it in My Reports (/portal).` }[action];
    if (UID.test(r.uid) && msg) await say(r.uid, msg).catch(warn("notify member of review"));
    if (action !== "review") await notifyStaff({ uids: [r.uid], staffOnly: true, kind: "report_" + action, title: { approve: `Your report ${id} was approved`, reject: `Your report ${id} was rejected`, request_changes: `Corrections requested for your report ${id}` }[action], body: reason ? reason.slice(0, 300) : "", link: "#/reports", ref: id, key: id + ":" + action + ":" + Date.now() });
    return { ok: true, report: o.report };
  } },

  report_edit: { perm: "manage_reports", method: "POST", fn: async ctx => {
    const { b } = ctx, id = String(b.id || "").toUpperCase(); need(RID.test(id), 400, "bad_request");
    const r = (await sb(`/reports?id=eq.${id}&deleted_at=is.null&select=*`))[0]; need(r, 404, "not_found");
    need(await inScope(ctx, r.team_member_id, r.uid), 403, "forbidden");
    need(!r.deletion_pending_at, 423, "deletion_pending", "This report is being permanently deleted.");
    if (r.status === "approved" && Number(b.revenue ?? r.revenue) !== Number(r.revenue)) need(!(await lockedRevenue()), 423, "revenue_locked", "Revenue edits are locked (Emergency Control).");
    const patch = {};
    if (b.title !== undefined) patch.title = v(text(b.title, { min: 3, max: 120, required: true, label: "Title" }));
    if (b.description !== undefined) patch.description = v(text(b.description, { max: 4000, multiline: true, label: "Description" })) || null;
    if (b.account_info !== undefined) patch.account_info = v(text(b.account_info, { max: 2000, multiline: true, label: "Account or case information" })) || null;
    if (b.category !== undefined) patch.category = oneOf(b.category, REPORT_CATEGORIES) || fail(400, "invalid", "Choose a category.");
    if (b.additional_info !== undefined) patch.additional_info = v(text(b.additional_info, { max: 2000, multiline: true })) || null;
    if (b.recovered !== undefined) patch.recovered = int(b.recovered, 0, 9999) ?? fail(400, "invalid", "Recovered must be 0–9999.");
    if (b.revenue !== undefined) patch.revenue = amount(b.revenue) ?? fail(400, "invalid", "Invalid revenue amount.");
    if (b.report_date !== undefined || b.category !== undefined) { const de = activityDateError(patch.category ?? r.category, b.report_date ?? r.report_date); if (de) fail(400, "invalid", de); if (b.report_date !== undefined) patch.report_date = b.report_date; }
    const d = diff(r, { ...r, ...patch }, Object.keys(patch));
    need(d.changed, 400, "no_change", "Nothing changed.");
    const reason = reasonOf(b, "A reason for the change");
    const o = await rpc("report_update", { p_id: id, p_actor: actor(ctx), p_reason: reason, p_patch: d.next });
    if (!o.ok) fail(409, o.error);
    let report = o.report, effect = null;
    const changed = Object.keys(d.next);
    const ownReport = !isFounder(ctx.p) && (r.uid === ctx.p.uid || (!!ctx.p.team_member_id && r.team_member_id === ctx.p.team_member_id));
    if (r.status === "approved" && changed.some(k => MATERIAL.includes(k)) && (!can(ctx.p, "approve_reports") || ownReport)) {
      const x = await rpc("report_requeue", { p_id: id, p_actor: actor(ctx), p_reason: "Material change by an editor without approval rights: " + reason });
      if (x.ok) { report = x.report; effect = "returned_to_review"; }
    } else if (r.published_at && changed.some(k => PUBLIC_FACTS.includes(k))) {
      const x = await rpc("report_publish", { p_id: id, p_actor: actor(ctx), p_action: "unpublish", p_title: null, p_summary: null, p_reason: "Public facts changed: " + reason });
      if (x.ok) { report = x.report; effect = "unpublished"; }
    }
    if (r.published_at && !report.published_at) await syncAfterUnpublish(id);
    await ctx.audit("report_modified", { reason, effect }, { target: id, prev: d.prev, next: d.next });
    return { ok: true, report, effect };
  } },


  report_note: { perm: ["manage_reports", "approve_reports"], method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || "").toUpperCase(); need(RID.test(id), 400, "bad_request");
    const body = v(text(ctx.b.body, { min: 1, max: 2000, multiline: true, label: "Remark" }));
    const n = (await sb("/internal_notes", { method: "POST", body: { subject_type: "report", subject_id: id, author: actor(ctx), body }, prefer: "return=representation" }))[0];
    await ctx.audit("report_remark_added", {}, { target: id });
    return { ok: true, note: n };
  } },

  revenue_list: { perm: "view_revenue", method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy, 50, 200), scope = await teamScope(ctx.p);
    const f = revenueFilter(qy, scope);
    const r = await sb(`/revenue_records?select=*,member:team_members(display_name)${f}&order=revenue_date.desc,created_at.desc${pg.range}`, { count: true });
    return { ...r, locked: await lockedRevenue(), today: today() };
  } },

  revenue_get: { perm: "view_revenue", method: "GET", fn: async ctx => {
    const id = String(ctx.qy.id || ""); need(/^RV[A-Z0-9]{6,12}$/.test(id), 400, "bad_request");
    const r = (await sb(`/revenue_records?id=eq.${id}&select=*,member:team_members(display_name)`))[0]; need(r, 404, "not_found");
    need(await inScope(ctx, r.team_member_id, r.member_uid), 403, "forbidden");
    return { record: r, history: await sb(`/revenue_history?record_id=eq.${id}&order=id.asc&select=*`) };
  } },

  revenue_save: { perm: "manage_revenue", method: "POST", fn: async ctx => {
    const { b } = ctx;
    need(!(await lockedRevenue()), 423, "revenue_locked", "Revenue edits are locked (Emergency Control).");
    const amt = amount(b.amount); need(amt !== null, 400, "invalid", "Amount must be between 0 and 10,000,000 with up to 2 decimals.");
    need(isDate(b.revenue_date) && b.revenue_date >= MIN_DATE && b.revenue_date <= "2100-12-31", 400, "invalid", "Date must be from 2020-01-01.");
    const description = v(text(b.description, { min: 3, max: 500, required: true, label: "Description" }));
    let member = null;
    if (b.team_member_id) { need(UUID.test(b.team_member_id), 400, "invalid"); member = (await sb(`/team_members?id=eq.${b.team_member_id}&select=id,display_name,telegram_uid`))[0]; need(member, 400, "invalid", "Unknown team member."); }
    const base = { amount: amt, revenue_date: b.revenue_date, description, team_member_id: member ? member.id : "", member_name: member ? member.display_name : null, member_uid: member ? member.telegram_uid : null, today: today(), actor: actor(ctx) };
    if (b.id) {
      const before = (await sb(`/revenue_records?id=eq.${q(b.id)}&deleted_at=is.null&select=*`))[0]; need(before, 404, "not_found");
      const reason = reasonOf(b, "A reason for this manual adjustment");
      const o = await rpc("revenue_mutate", { p: { ...base, op: "edit", id: before.id, reason } });
      if (!o.ok) fail(o.error === "duplicate" ? 409 : 400, o.error, o.error === "report_linked" ? "This record comes from a report. Edit the report instead." : o.error === "duplicate" ? "An identical revenue record already exists." : o.error);
      const d = diff(before, o.record, ["amount", "revenue_date", "description", "team_member_id", "status"]);
      await ctx.audit("revenue_adjusted", { reason }, { target: before.id, prev: d.prev, next: d.next });
      return { ok: true, record: o.record };
    }
    const o = await rpc("revenue_mutate", { p: { ...base, op: "create", id: rid("RV", 10), status: b.status === "projected" ? "projected" : "pending" } });
    if (!o.ok) fail(o.error === "duplicate" ? 409 : 400, o.error, o.error === "duplicate" ? "An identical revenue record already exists." : o.error);
    await ctx.audit("revenue_created", {}, { target: o.record.id, next: { amount: amt, revenue_date: b.revenue_date, status: o.record.status, member: member ? member.display_name : null } });
    return { ok: true, record: o.record };
  } },

  revenue_action: { perm: "manage_revenue", method: "POST", fn: async ctx => {
    const { b } = ctx, op = oneOf(b.op, ["verify", "reject", "delete"]); need(op && /^RV[A-Z0-9]{6,12}$/.test(String(b.id || "")), 400, "bad_request");
    need(!(await lockedRevenue()), 423, "revenue_locked", "Revenue edits are locked (Emergency Control).");
    const reason = op === "verify" ? null : reasonOf(b);
    const before = (await sb(`/revenue_records?id=eq.${b.id}&select=status,amount`))[0];
    const o = await rpc("revenue_mutate", { p: { op, id: b.id, reason, today: today(), actor: actor(ctx) } });
    if (!o.ok) fail(409, o.error, { report_linked: "This record comes from a report. Review the report instead.", future_date: "Future-dated revenue stays projected until its date.", already_handled: "Already handled.", reason_required: "A reason is required." }[o.error] || o.error);
    await ctx.audit("revenue_" + (op === "verify" ? "verified" : op === "reject" ? "rejected" : "deleted"), { reason }, { target: b.id, prev: before || null, next: { status: o.record.status } });
    return { ok: true, record: o.record };
  } },

  revenue_export: { perm: "view_revenue", method: "GET", raw: true, fn: async ctx => {
    const { qy } = ctx, scope = await teamScope(ctx.p);
    if (qy.kind === "members") {
      const r = range(qy.preset || "this_month", qy.from, qy.to); if (r.error) fail(400, "invalid", r.error);
      const a = await analytics(r, scope);
      const csv = toCsv([["name", "Member"], ["status", "Member status"], ["actual", "Actual revenue (PHP)"], ["pending", "Pending revenue (PHP)"], ["recovered", "Recovered accounts"], ["reports", "Reports"], ["approved_reports", "Approved reports"], ["open_reports", "Open reports"], ["rejected_reports", "Rejected reports"], ["contribution", "Contribution %"]], a.members);
      await ctx.audit("revenue_exported", { kind: "members", from: r.from, to: r.to }, {});
      return csvOut(ctx.res, `chds-performance-${r.from}-to-${r.to}.csv`, csv);
    }
    const rows = [], fq = { ...qy };
    if (qy.preset && qy.preset !== "custom" && !qy.from && !qy.to) { const r = range(qy.preset); if (r.error) fail(400, "invalid", r.error); fq.from = r.from; fq.to = r.to; }
    for (let off = 0; off < 50000; off += 1000) {
      const chunk = await sb(`/revenue_records?select=*,member:team_members(display_name)${revenueFilter(fq, scope)}&order=revenue_date.asc,created_at.asc&limit=1000&offset=${off}`);
      rows.push(...chunk); if (chunk.length < 1000) break;
    }
    const csv = toCsv([["id", "Record ID"], ["revenue_date", "Date (PH)"], [r => r.member?.display_name || r.member_name || "", "Member"], ["amount", "Amount (PHP)"], ["status", "Status"], ["source", "Source"], ["report_id", "Report ID"], ["description", "Description"], ["verified_by", "Verified by"], ["verified_at", "Verified at"], ["created_at", "Created at"]], rows);
    await ctx.audit("revenue_exported", { kind: "records", rows: rows.length, filters: { status: qy.status || null, from: fq.from || null, to: fq.to || null } }, {});
    return csvOut(ctx.res, `chds-revenue-${today()}.csv`, csv);
  } },

  revenue_analytics: { perm: "view_revenue", method: "GET", fn: async ctx => {
    const { qy } = ctx, r = range(qy.preset || "this_month", qy.from, qy.to); if (r.error) fail(400, "invalid", r.error);
    if (oneOf(qy.group, ["day", "week", "month", "year"])) r.group = qy.group;
    const scope = await teamScope(ctx.p);
    const a = await analytics(r, scope);
    let growth = null;
    if (r.preset !== "all") {
      const len = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 864e5) + 1, pTo = addDays(r.from, -1), pFrom = addDays(pTo, -(len - 1));
      if (pFrom >= MIN_DATE) { const prev = await analytics({ from: pFrom, to: pTo, group: r.group }, scope); growth = { from: pFrom, to: pTo, actual: prev.totals.actual, change_pct: Number(prev.totals.actual) > 0 ? Math.round((a.totals.actual - prev.totals.actual) / prev.totals.actual * 1000) / 10 : null }; }
    }
    const ranked = a.members.filter(m => m.status === "active" || Number(m.actual) > 0);
    return { ...a, growth, scope: scope ? "team" : "all", top: ranked.length ? ranked[0] : null, lowest: ranked.length > 1 ? ranked[ranked.length - 1] : null };
  } },

  performance: { perm: "view_revenue", method: "GET", fn: async ctx => {
    const { qy } = ctx, r = range(qy.preset || "this_month", qy.from, qy.to); if (r.error) fail(400, "invalid", r.error);
    const scope = await teamScope(ctx.p);
    const [a, members, rh, vh] = await Promise.all([analytics(r, scope),
      sb(`/team_members?select=id,display_name,role_title,telegram_username,show_telegram,photo_path,status,deleted_at,updated_at${scope ? `&id=in.(${scope.ids.join(",") || "00000000-0000-0000-0000-000000000000"})` : ""}`),
      sb(`/report_history?order=id.desc&limit=15&select=report_id,actor,action,to_status,at`),
      sb(`/revenue_history?order=id.desc&limit=15&select=record_id,actor,action,at`)]);
    const byId = Object.fromEntries(members.map(m => [m.id, m]));
    let rank = 0;
    const rows = a.members.map(m => { const t = byId[m.key]; return { ...m, rank: ++rank, role: t?.role_title || null, telegram: t && t.show_telegram ? t.telegram_username : null,
      photo_url: t ? publicUrl("team-photos", t.photo_path) : null, member_status: t ? (t.deleted_at ? "removed" : t.status) : "unlinked" }; });
    const recent = [...rh.map(x => ({ at: x.at, kind: "report", ref: x.report_id, action: x.action + (x.to_status ? " → " + x.to_status : ""), actor: x.actor })),
      ...vh.map(x => ({ at: x.at, kind: "revenue", ref: x.record_id, action: x.action, actor: x.actor }))].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 15);
    const body = { range: a.range, totals: a.totals, rows, recent };
    return { ...body, version: createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16), polled_at: new Date().toISOString() };
  } },

  ann_list: { perm: "manage_announcements", method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy, 50);
    const f = [oneOf(qy.status, ["draft", "published", "archived"]) ? `&status=eq.${qy.status}` : "", oneOf(qy.audience, ["all", "team", "selected_members", "admins", "groups"]) ? `&audience=eq.${qy.audience}` : ""].join("");
    return sb(`/announcements?select=*${f}&order=created_at.desc${pg.range}`, { count: true });
  } },

  ann_save: { perm: "manage_announcements", method: "POST", fn: async ctx => {
    const { b } = ctx;
    const audience = oneOf(b.audience, ["all", "team", "selected_members", "admins", "groups"]) || fail(400, "invalid", "Choose an audience.");
    let targets = Array.isArray(b.target_ids) ? [...new Set(b.target_ids.map(String))].slice(0, 200) : [];
    if (audience === "selected_members") need(targets.length && targets.every(x => UUID.test(x)), 400, "invalid", "Select at least one team member.");
    else if (audience === "groups") need(targets.length && targets.every(x => /^[a-z][a-z0-9_]{1,39}$/.test(x)), 400, "invalid", "Select at least one role.");
    else targets = [];
    const pub = b.publish_at ? new Date(b.publish_at) : new Date(), exp = b.expires_at ? new Date(b.expires_at) : null;
    need(!isNaN(pub) && (!exp || (!isNaN(exp) && exp > pub)), 400, "invalid", "Expiry must be after the publish date.");
    const body = { title: v(text(b.title, { min: 3, max: 120, required: true, label: "Title" })), message: v(text(b.message, { min: 1, max: 4000, multiline: true, required: true, label: "Message" })),
      priority: oneOf(b.priority, ["low", "normal", "high", "critical"], "normal"), audience, target_ids: targets, publish_at: pub.toISOString(), expires_at: exp ? exp.toISOString() : null,
      send_telegram: b.send_telegram === true && audience !== "all", updated_by: actor(ctx), updated_at: new Date().toISOString() };
    if (b.id) {
      const before = (await sb(`/announcements?id=eq.${q(b.id)}&select=*`))[0]; need(before, 404, "not_found");
      need(before.status !== "archived", 409, "archived", "Archived announcements are kept as history and cannot be edited.");
      const r = (await sb(`/announcements?id=eq.${q(b.id)}`, { method: "PATCH", body, prefer: "return=representation" }))[0];
      const d = diff(before, r, ["title", "message", "priority", "audience", "target_ids", "publish_at", "expires_at"]);
      await ctx.audit("announcement_updated", {}, { target: r.id, prev: d.prev, next: d.next });
      return { ok: true, announcement: r };
    }
    const r = (await sb("/announcements", { method: "POST", body: { ...body, status: "draft", created_by: actor(ctx) }, prefer: "return=representation" }))[0];
    await ctx.audit("announcement_created", { audience }, { target: r.id });
    return { ok: true, announcement: r };
  } },

  ann_status: { perm: "manage_announcements", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""), status = oneOf(ctx.b.status, ["draft", "published", "archived"]); need(UUID.test(id) && status, 400, "bad_request");
    const a = (await sb(`/announcements?id=eq.${id}&select=*`))[0]; need(a, 404, "not_found");
    need(a.status !== "archived", 409, "archived", "Archived announcements cannot be changed.");
    const r = (await sb(`/announcements?id=eq.${id}`, { method: "PATCH", body: { status, updated_by: actor(ctx), updated_at: new Date().toISOString() }, prefer: "return=representation" }))[0];
    let delivery = null;
    if (status === "published" && a.send_telegram) delivery = await broadcast(r);
    if (status === "published") await notifyStaff(await annAudience(r));
    await ctx.audit("announcement_" + status, { delivery }, { target: id, prev: { status: a.status }, next: { status } });
    return { ok: true, announcement: r, delivery };
  } },

  my_announcements: { perm: null, method: "GET", fn: async ctx => {
    const now = encodeURIComponent(new Date().toISOString()), p = ctx.p;
    const rows = await sb(`/announcements?status=eq.published&publish_at=lte.${now}&or=(expires_at.is.null,expires_at.gt.${now})&order=publish_at.desc&limit=30&select=id,title,message,priority,audience,target_ids,publish_at,expires_at`);
    const inTeam = !!p.team_member_id || (await recipients()).includes(p.uid);
    return { rows: rows.filter(a => a.audience === "all" || a.audience === "admins" || (a.audience === "team" && inTeam) || (a.audience === "selected_members" && p.team_member_id && a.target_ids.includes(p.team_member_id)) || (a.audience === "groups" && a.target_ids.includes(p.role)))
      .map(({ target_ids, ...x }) => x) };
  } }
};

function revenueFilter(qy, scope) {
  return [oneOf(qy.status, ["actual", "pending", "projected", "rejected"]) ? `&status=eq.${qy.status}` : "", oneOf(qy.source, ["manual", "report"]) ? `&source=eq.${qy.source}` : "",
    UUID.test(qy.member || "") ? `&team_member_id=eq.${qy.member}` : "", isDate(qy.from) ? `&revenue_date=gte.${qy.from}` : "", isDate(qy.to) ? `&revenue_date=lte.${qy.to}` : "",
    qy.q ? `&or=(id.ilike.${like(qy.q)},description.ilike.${like(qy.q)},member_name.ilike.${like(qy.q)},report_id.ilike.${like(qy.q)})` : "",
    "&deleted_at=is.null", scopeFilter(scope, "team_member_id", "member_uid")].join("");
}
async function analytics(r, scope) {
  const t = today();
  await rpc("revenue_promote_due", { p_today: t }).catch(warn("promote projected revenue"));
  return rpc("revenue_analytics", { p_from: r.from, p_to: r.to, p_group: r.group, p_today: t, p_week: weekStart(t), p_month: monthStart(t), p_year: yearStart(t),
    p_members: scope ? scope.ids : null, p_uids: scope ? scope.uids : null });
}
function csvOut(res, name, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`);
  res.status(200).send(csv);
  return undefined;
}
async function annAudience(a) {
  const base = { kind: "announcement", title: a.title, body: a.message.slice(0, 300), link: null, ref: a.id };
  if (a.audience === "groups") return { ...base, roles: a.target_ids };
  if (a.audience === "selected_members") return { ...base, uids: (await sb(`/admin_users?team_member_id=in.(${a.target_ids.join(",")})&status=eq.active&deleted_at=is.null&select=uid`)).map(x => x.uid) };
  return { ...base, roles: ["founder", "administrator", "team_leader", "support_agent", ...(await sb("/roles?is_system=is.false&deleted_at=is.null&select=id")).map(x => x.id)] };
}
async function broadcast(a) {
  let uids = [];
  if (a.audience === "team") uids = await recipients();
  else if (a.audience === "selected_members") uids = (await sb(`/team_members?id=in.(${a.target_ids.join(",")})&status=eq.active&deleted_at=is.null&telegram_uid=not.is.null&select=telegram_uid`)).map(x => x.telegram_uid);
  else if (a.audience === "admins") uids = [...new Set([...envFounders(), ...(await sb("/admin_users?status=eq.active&deleted_at=is.null&select=uid")).map(x => x.uid)])];
  else if (a.audience === "groups") uids = (await sb(`/admin_users?status=eq.active&deleted_at=is.null&role_id=in.(${a.target_ids.join(",")})&select=uid`)).map(x => x.uid);
  const icon = { low: "ℹ️", normal: "📣", high: "⚠️", critical: "🚨" }[a.priority] || "📣";
  let sent = 0, failed = 0;
  for (const uid of uids) { const r = await notifyText("announcement", a.id, uid, `${icon} <b>${esc(a.title)}</b>\n\n${esc(a.message.slice(0, 3500))}`); if (r.ok) sent++; else if (!r.skipped || r.skipped === "disabled") failed++; }
  return { recipients: uids.length, sent, failed };
}
