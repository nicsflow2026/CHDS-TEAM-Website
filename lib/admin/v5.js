// V5 dashboard operations: strict case closure/reopen, Closed Cases, priority/escalation, quick replies,
// AI Knowledge Base + instructions, notification center, report publication/export, operations analytics,
// team member details. Every operation declares its permission (enforced by the router before it runs).
import { sb, rpc, q, like, UUID, HSID, RID, settings, clearSettingsCache, esc, warn } from "../core.js";
import { text, oneOf, isDate, int, toCsv } from "../validate.js";
import { today, range } from "../time.js";
import { can, canAny, teamScope, isFounder } from "../rbac.js";
import { closeCase, reopenCase } from "../cases.js";
import { asksForSecret } from "../secrets.js";
import { clearKnowledgeCache } from "../knowledge.js";
import { notifyStaff } from "../staffnotify.js";
import { REPORT_CATEGORIES, CATEGORY_LABEL, STATUS_LABEL } from "../reports.js";
import { publicUrl } from "../storage.js";
import { materializeAll, syncAfterUnpublish, PhotoError } from "../publicimages.js";
import { fail, need, actor, page, v, reasonOf, diff } from "./util.js";

const PRIORITIES = ["low", "normal", "high", "urgent"];
const noSecretAsk = (s, label) => need(!asksForSecret(s), 400, "policy", `${label} asks for a password, code, cookie or token. CHDS Support never asks for those (Never-Ask-For-Password policy).`);
const send = (ctx, o) => { ctx.res.status(o.status).json(o.body); return undefined; };
const phIso = (d, end) => end ? `${d}T23:59:59.999%2B08:00` : `${d}T00:00:00%2B08:00`;

export const ops = {
  /* ---------------- Case closure (strict lock) ---------------- */
  case_close: { perm: "close_support_cases", method: "POST", raw: true, fn: async ctx => {
    const reason = v(text(ctx.b.reason, { max: 500, multiline: true, label: "Closure reason" }));
    return send(ctx, await closeCase({ p: ctx.p, requestId: String(ctx.b.id || ""), reason, actor: actor(ctx), via: "dashboard", req: ctx.req }));
  } },
  case_reopen: { perm: "reopen_support_cases", method: "POST", raw: true, fn: async ctx =>
    send(ctx, await reopenCase({ p: ctx.p, requestId: String(ctx.b.id || ""), reason: ctx.b.reason, actor: actor(ctx), req: ctx.req })) },

  closed_cases_list: { perm: "view_closed_cases", method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy, 25);
    const f = [qy.q ? `&or=(id.ilike.${like(qy.q)},close_reason.ilike.${like(qy.q)},closed_by_name.ilike.${like(qy.q)})` : "",
      isDate(qy.from) ? `&closed_at=gte.${phIso(qy.from)}` : "", isDate(qy.to) ? `&closed_at=lte.${phIso(qy.to, true)}` : "",
      /^\d{1,20}$/.test(qy.agent || "") ? `&assigned_uid=eq.${qy.agent}` : "",
      /^\d{1,20}$/.test(qy.closer || "") ? `&closed_by=in.(admin:${qy.closer},tg:${qy.closer})` : ""].join("");
    const r = await sb(`/ai_handoff_requests?status=eq.closed${f}&select=id,status,status_before_close,priority,category,reason,created_at,assigned_uid,assigned_name,closed_at,closed_by,closed_by_name,close_reason,csat_rating,conversation_id,user:ai_support_users(id,display_name)&order=closed_at.desc${pg.range}`, { count: true });
    const people = await sb("/ai_handoff_requests?status=eq.closed&select=assigned_uid,assigned_name,closed_by,closed_by_name&order=closed_at.desc&limit=500");
    const agents = {}, closers = {};
    for (const x of people) { if (x.assigned_uid) agents[x.assigned_uid] = x.assigned_name || "Agent"; const u = /^(?:admin|tg):(\d+)$/.exec(x.closed_by || ""); if (u) closers[u[1]] = x.closed_by_name || "Staff"; }
    return { ...r, agents: Object.entries(agents), closers: Object.entries(closers) };
  } },

  handoff_priority: { perm: "manage_support", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""), priority = oneOf(ctx.b.priority, PRIORITIES); need(HSID.test(id) && priority, 400, "bad_request");
    const h = (await sb(`/ai_handoff_requests?id=eq.${q(id)}&select=id,status,priority`))[0]; need(h, 404, "not_found");
    need(h.status !== "closed", 409, "case_closed", "Closed cases are read-only.");
    if (h.priority === priority) return { ok: true, priority };
    await sb(`/ai_handoff_requests?id=eq.${q(id)}&status=neq.closed`, { method: "PATCH", body: { priority, updated_at: new Date().toISOString() }, prefer: "return=minimal" });
    await sb("/ai_handoff_history", { method: "POST", body: { request_id: id, actor: actor(ctx), action: "priority", detail: { from: h.priority, to: priority } }, prefer: "return=minimal" });
    await ctx.audit("handoff_priority_changed", {}, { target: id, prev: { priority: h.priority }, next: { priority } });
    return { ok: true, priority };
  } },
  handoff_escalate: { perm: "manage_support", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(HSID.test(id), 400, "bad_request");
    const note = reasonOf({ reason: ctx.b.note ?? ctx.b.reason }, "An escalation note");
    const h = (await sb(`/ai_handoff_requests?id=eq.${q(id)}&select=id,status,priority`))[0]; need(h, 404, "not_found");
    need(!["closed", "cancelled"].includes(h.status), 409, "not_open", "Only open cases can be escalated.");
    await sb(`/ai_handoff_requests?id=eq.${q(id)}`, { method: "PATCH", body: { priority: "urgent", escalated_at: new Date().toISOString(), escalated_by: actor(ctx), escalation_note: note, updated_at: new Date().toISOString() }, prefer: "return=minimal" });
    await sb("/ai_handoff_history", { method: "POST", body: { request_id: id, actor: actor(ctx), action: "escalated", detail: { note, from_priority: h.priority } }, prefer: "return=minimal" });
    await ctx.audit("handoff_escalated", { note }, { target: id, prev: { priority: h.priority }, next: { priority: "urgent" } });
    await notifyStaff({ roles: ["founder", "administrator"], exclude: [ctx.p.uid], kind: "escalation", title: `Case ${id} escalated`, body: `${ctx.p.name}: ${note.slice(0, 200)}`, link: `#/handoffs/${id}`, ref: id, key: id + ":" + Date.now() });
    return { ok: true };
  } },

  /* ---------------- Quick replies ---------------- */
  quick_replies_list: { perm: ["manage_support", "manage_knowledge_base"], method: "GET", fn: async ctx => ({
    rows: await sb(`/support_quick_replies?deleted_at=is.null${ctx.qy.all === "1" && can(ctx.p, "manage_knowledge_base") ? "" : "&enabled=is.true"}&order=sort_order.asc,title.asc&select=id,title,body,enabled,sort_order,updated_at`) }) },
  quick_reply_save: { perm: "manage_knowledge_base", method: "POST", fn: async ctx => {
    const { b } = ctx;
    const body = { title: v(text(b.title, { min: 2, max: 60, required: true, label: "Title" })), body: v(text(b.body, { min: 1, max: 1000, multiline: true, required: true, label: "Reply text" })),
      enabled: b.enabled !== false, sort_order: int(b.sort_order ?? 100, 0, 100000) ?? fail(400, "invalid", "Order must be 0–100000."), updated_by: actor(ctx), updated_at: new Date().toISOString() };
    noSecretAsk(body.body, "This quick reply");
    if (b.id) {
      need(UUID.test(b.id), 400, "bad_request");
      const before = (await sb(`/support_quick_replies?id=eq.${b.id}&deleted_at=is.null&select=*`))[0]; need(before, 404, "not_found");
      const r = (await sb(`/support_quick_replies?id=eq.${b.id}`, { method: "PATCH", body, prefer: "return=representation" }))[0];
      const d = diff(before, r, ["title", "body", "enabled", "sort_order"]);
      await ctx.audit("quick_reply_updated", {}, { target: r.id, prev: d.prev, next: d.next });
      return { ok: true, row: r };
    }
    const r = (await sb("/support_quick_replies", { method: "POST", body: { ...body, created_by: actor(ctx) }, prefer: "return=representation" }))[0];
    await ctx.audit("quick_reply_created", {}, { target: r.id, next: { title: r.title } });
    return { ok: true, row: r };
  } },
  quick_reply_delete: { perm: "manage_knowledge_base", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(UUID.test(id), 400, "bad_request");
    const r = (await sb(`/support_quick_replies?id=eq.${id}&deleted_at=is.null`, { method: "PATCH", body: { deleted_at: new Date().toISOString(), updated_by: actor(ctx) }, prefer: "return=representation" }))[0]; need(r, 404, "not_found");
    await ctx.audit("quick_reply_deleted", {}, { target: id, prev: { title: r.title } });
    return { ok: true };
  } },

  /* ---------------- AI Knowledge Base + instructions ---------------- */
  kb_list: { perm: "manage_knowledge_base", method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy, 50, 200);
    const f = [qy.q ? `&or=(title.ilike.${like(qy.q)},body.ilike.${like(qy.q)})` : "", /^[a-z][a-z0-9_]{1,39}$/.test(qy.category || "") ? `&category=eq.${qy.category}` : "",
      qy.enabled === "1" ? "&enabled=is.true" : qy.enabled === "0" ? "&enabled=is.false" : "", qy.faq === "1" ? "&is_faq=is.true" : ""].join("");
    const r = await sb(`/ai_knowledge?deleted_at=is.null${f}&select=*&order=sort_order.asc,title.asc${pg.range}`, { count: true });
    const cats = [...new Set((await sb("/ai_knowledge?deleted_at=is.null&select=category")).map(x => x.category))].sort();
    return { ...r, categories: cats };
  } },
  kb_save: { perm: "manage_knowledge_base", method: "POST", fn: async ctx => {
    const { b } = ctx;
    const category = String(b.category || "general").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "general";
    need(/^[a-z][a-z0-9_]{1,39}$/.test(category), 400, "invalid", "Category: 2–40 lowercase letters, digits or underscores, starting with a letter.");
    const keywords = [...new Set(String(Array.isArray(b.keywords) ? b.keywords.join(",") : b.keywords || "").split(",").map(x => x.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "")).filter(x => x.length >= 2))].slice(0, 20);
    const body = { title: v(text(b.title, { min: 3, max: 120, required: true, label: "Title" })), body: v(text(b.body, { min: 1, max: 4000, multiline: true, required: true, label: "Answer / content" })),
      category, keywords, is_faq: b.is_faq === true, enabled: b.enabled !== false, sort_order: int(b.sort_order ?? 100, 0, 100000) ?? fail(400, "invalid", "Order must be 0–100000."),
      updated_by: actor(ctx), updated_at: new Date().toISOString() };
    noSecretAsk(body.title + "\n" + body.body, "This knowledge entry");
    let r;
    if (b.id) {
      need(UUID.test(b.id), 400, "bad_request");
      const before = (await sb(`/ai_knowledge?id=eq.${b.id}&deleted_at=is.null&select=*`))[0]; need(before, 404, "not_found");
      r = (await sb(`/ai_knowledge?id=eq.${b.id}`, { method: "PATCH", body, prefer: "return=representation" }))[0];
      const d = diff(before, r, ["title", "body", "category", "keywords", "is_faq", "enabled", "sort_order"]);
      await ctx.audit("knowledge_updated", {}, { target: r.id, prev: d.prev, next: d.next });
    } else {
      r = (await sb("/ai_knowledge", { method: "POST", body: { ...body, created_by: actor(ctx) }, prefer: "return=representation" }))[0];
      await ctx.audit("knowledge_created", {}, { target: r.id, next: { title: r.title, category: r.category, enabled: r.enabled } });
    }
    clearKnowledgeCache();
    return { ok: true, row: r };
  } },
  kb_toggle: { perm: "manage_knowledge_base", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(UUID.test(id), 400, "bad_request");
    const enabled = ctx.b.enabled === true;
    const r = (await sb(`/ai_knowledge?id=eq.${id}&deleted_at=is.null`, { method: "PATCH", body: { enabled, updated_by: actor(ctx), updated_at: new Date().toISOString() }, prefer: "return=representation" }))[0]; need(r, 404, "not_found");
    await ctx.audit(enabled ? "knowledge_enabled" : "knowledge_disabled", {}, { target: id });
    clearKnowledgeCache();
    return { ok: true, row: r };
  } },
  kb_delete: { perm: "manage_knowledge_base", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(UUID.test(id), 400, "bad_request");
    const r = (await sb(`/ai_knowledge?id=eq.${id}&deleted_at=is.null`, { method: "PATCH", body: { deleted_at: new Date().toISOString(), enabled: false, updated_by: actor(ctx) }, prefer: "return=representation" }))[0]; need(r, 404, "not_found");
    await ctx.audit("knowledge_deleted", {}, { target: id, prev: { title: r.title } });
    clearKnowledgeCache();
    return { ok: true };
  } },
  ai_instructions_get: { perm: "manage_knowledge_base", method: "GET", fn: async () => {
    const s = await settings({ fresh: true });
    return { instructions: s.ai.instructions || "", note: "The original CHDS AI rules and the mandatory security policy (never ask for passwords, codes, cookies or tokens) are fixed in code and always apply after these instructions." };
  } },
  ai_instructions_save: { perm: "manage_knowledge_base", method: "POST", fn: async ctx => {
    const instructions = v(text(ctx.b.instructions, { max: 3000, multiline: true, label: "Instructions" }));
    noSecretAsk(instructions, "These instructions");
    const before = (await settings({ fresh: true })).ai.instructions || "";
    await sb("/system_settings?on_conflict=key", { method: "POST", body: { key: "ai", value: { instructions }, updated_by: actor(ctx), updated_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
    clearSettingsCache();
    await ctx.audit("ai_instructions_changed", { length: instructions.length }, { target: "ai", prev: { instructions: before.slice(0, 500) }, next: { instructions: instructions.slice(0, 500) } });
    return { ok: true };
  } },

  /* ---------------- Notification center (own notifications only) ---------------- */
  notif_list: { perm: null, method: "GET", fn: async ctx => {
    const pg = page(ctx.qy, 30, 100);
    const r = await sb(`/staff_notifications?recipient_uid=eq.${q(ctx.p.uid)}${ctx.qy.unread === "1" ? "&read_at=is.null" : ""}&select=id,kind,title,body,link,ref,read_at,created_at&order=id.desc${pg.range}`, { count: true });
    const unread = (await sb(`/staff_notifications?recipient_uid=eq.${q(ctx.p.uid)}&read_at=is.null&select=id&limit=1`, { count: true })).total;
    return { ...r, unread };
  } },
  notif_read: { perm: null, method: "POST", fn: async ctx => {
    const all = ctx.b.all === true, idsIn = Array.isArray(ctx.b.ids) ? ctx.b.ids.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 100) : [];
    need(all || idsIn.length, 400, "bad_request");
    await sb(`/staff_notifications?recipient_uid=eq.${q(ctx.p.uid)}&read_at=is.null${all ? "" : `&id=in.(${idsIn.join(",")})`}`, { method: "PATCH", body: { read_at: new Date().toISOString() }, prefer: "return=minimal" });
    return { ok: true };
  } },

  /* ---------------- Reports: publication workflow + export ---------------- */
  report_publish: { perm: "publish_reports", method: "POST", fn: async ctx => {
    const { b } = ctx, id = String(b.id || "").toUpperCase(), action = oneOf(b.action, ["publish", "unpublish", "archive", "unarchive"]);
    need(RID.test(id) && action, 400, "bad_request");
    const r = (await sb(`/reports?id=eq.${id}&deleted_at=is.null&select=*`))[0]; need(r, 404, "not_found");
    const scope = await teamScope(ctx.p);
    need(!scope || scope.ids.includes(r.team_member_id) || scope.uids.includes(r.uid), 403, "forbidden", "That report is outside your team.");
    let title = null, summary = null, reason = null;
    if (action === "publish") {
      title = v(text(b.public_title, { min: 3, max: 120, required: true, label: "Public title" }));
      summary = v(text(b.public_summary, { max: 600, multiline: true, label: "Public summary" }));
      noSecretAsk(title + " " + summary, "The public text");
    } else reason = reasonOf(b);
    need(!r.deletion_pending_at, 423, "deletion_pending", "This report is being permanently deleted.");
    if (action === "publish" && r.status === "approved" && !r.archived_at && !r.published_at) { // selected photos must exist publicly BEFORE the report goes live
      try { await materializeAll(id); }
      catch (e) { if (e instanceof PhotoError) fail(e.status, e.code, "Not published: a selected photo could not be prepared. " + e.message); throw e; }
    }
    const o = await rpc("report_publish", { p_id: id, p_actor: actor(ctx), p_action: action, p_title: title, p_summary: summary, p_reason: reason });
    if (!o.ok) fail(409, o.error, { not_approved: "Only approved reports can be published.", archived: "Restore the report from the archive first.", already_published: "Already published.", not_published: "This report is not published.", already_archived: "Already archived.", not_archived: "This report is not archived.", title_required: "A public title is required." }[o.error] || o.error);
    let photos_warning = null;
    if (!o.report.published_at && r.published_at && (await syncAfterUnpublish(id)) < 0) photos_warning = "The report is no longer public, but its public photo copies could not all be removed. Use “Remove public copies” in Public photos.";
    await ctx.audit("report_" + { publish: "published", unpublish: "unpublished", archive: "archived", unarchive: "restored" }[action], { reason }, { target: id,
      prev: { status: r.status, published: !!r.published_at, archived: !!r.archived_at }, next: { status: o.report.status, published: !!o.report.published_at, archived: !!o.report.archived_at, ...(title ? { public_title: title } : {}) } });
    return { ok: true, report: o.report, photos_warning };
  } },
  reports_export: { perm: ["manage_reports", "approve_reports"], method: "GET", raw: true, fn: async ctx => {
    const { qy } = ctx, scope = await teamScope(ctx.p), basis = qy.basis === "submission" ? "created_at" : "report_date";
    const f = [oneOf(qy.status, Object.keys(STATUS_LABEL)) ? `&status=eq.${qy.status}` : "", oneOf(qy.category, REPORT_CATEGORIES) ? `&category=eq.${qy.category}` : "",
      isDate(qy.from) ? `&${basis}=gte.${basis === "created_at" ? phIso(qy.from) : qy.from}` : "", isDate(qy.to) ? `&${basis}=lte.${basis === "created_at" ? phIso(qy.to, true) : qy.to}` : "",
      qy.published === "1" ? "&published_at=not.is.null" : "", qy.archived === "1" ? "&archived_at=not.is.null" : qy.archived === "all" ? "" : "&archived_at=is.null", "&deletion_pending_at=is.null",
      scope ? `&or=(team_member_id.in.(${scope.ids.join(",") || "00000000-0000-0000-0000-000000000000"}),uid.in.(${scope.uids.map(u => `"${u}"`).join(",") || '"-"'}))` : ""].join("");
    const rows = [];
    for (let off = 0; off < 50000; off += 1000) {
      const chunk = await sb(`/reports?deleted_at=is.null${f}&select=id,report_date,created_at,name,title,category,recovered,revenue,status,source,reviewed_at,published_at,archived_at,rejection_reason,correction_request&order=${basis}.asc,id.asc&limit=1000&offset=${off}`);
      rows.push(...chunk); if (chunk.length < 1000) break;
    }
    const csv = toCsv([["id", "Report ID"], ["report_date", "Activity date (PH)"], [r => new Date(r.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }), "Submitted (Asia/Manila)"], ["name", "Member"], ["title", "Title"],
      [r => CATEGORY_LABEL[r.category] || r.category || "", "Category"], ["recovered", "Recovered"], ["revenue", "Revenue (PHP)"], [r => STATUS_LABEL[r.status] || r.status, "Status"], [r => r.published_at ? "yes" : "no", "Published"],
      [r => r.archived_at ? "yes" : "no", "Archived"], ["source", "Source"], ["reviewed_at", "Reviewed at"], ["rejection_reason", "Rejection reason"], ["correction_request", "Corrections requested"]], rows);
    await ctx.audit("reports_exported", { rows: rows.length, basis: basis === "created_at" ? "submission" : "activity", filters: { status: qy.status || null, from: qy.from || null, to: qy.to || null } }, {});
    ctx.res.setHeader("Content-Type", "text/csv; charset=utf-8");
    ctx.res.setHeader("Content-Disposition", `attachment; filename="chds-reports-${today()}.csv"`);
    ctx.res.status(200).send(csv);
    return undefined;
  } },

  /* ---------------- Operations analytics (reports + Human Support) ---------------- */
  ops_analytics: { perm: ["manage_reports", "approve_reports", "manage_support", "view_ai_conversations"], method: "GET", fn: async ctx => {
    const r = range(ctx.qy.preset || "this_month", ctx.qy.from, ctx.qy.to); if (r.error) fail(400, "invalid", r.error);
    const basis = ctx.qy.basis === "submission" ? "submission" : "activity";
    const to = r.to > "2100-12-31" ? "2100-12-31" : r.to;
    const a = await rpc("ops_analytics", { p_from: r.from, p_to: to, p_basis: basis });
    const st = (await settings()).support;
    return { range: { from: r.from, to, preset: r.preset }, basis, sla: { first_response_minutes: st.first_response_minutes, resolution_hours: st.resolution_hours },
      reports: canAny(ctx.p, ["manage_reports", "approve_reports"]) ? a.reports : null, support: canAny(ctx.p, ["manage_support", "view_ai_conversations"]) ? a.support : null };
  } },

  /* ---------------- Team member details (Team Management "View") ---------------- */
  team_get: { perm: "manage_team", method: "GET", fn: async ctx => {
    const id = String(ctx.qy.id || ""); need(UUID.test(id), 400, "bad_request");
    const m = (await sb(`/team_members?id=eq.${id}&select=*`))[0]; need(m, 404, "not_found");
    const [accounts, reports, led, leader] = await Promise.all([
      sb(`/admin_users?team_member_id=eq.${id}&deleted_at=is.null&select=uid,display_name,role_id,grants,status,last_login_at`),
      sb(`/reports?team_member_id=eq.${id}&deleted_at=is.null&select=status`),
      sb(`/team_members?leader_id=eq.${id}&deleted_at=is.null&select=id,display_name,status`),
      m.leader_id ? sb(`/team_members?id=eq.${m.leader_id}&select=id,display_name`).then(x => x[0] || null) : null]);
    const counts = reports.reduce((o, r) => (o[r.status] = (o[r.status] || 0) + 1, o), {});
    return { member: { ...m, telegram_uid: m.telegram_uid ? "…" + m.telegram_uid.slice(-4) : null, has_telegram_uid: !!m.telegram_uid, photo_url: publicUrl("team-photos", m.photo_path) },
      accounts: accounts.map(x => ({ ...x, uid_tail: "…" + x.uid.slice(-4), uid: can(ctx.p, "manage_users") ? x.uid : undefined })), report_counts: { total: reports.length, ...counts }, leads: led, leader,
      can_manage_access: can(ctx.p, "manage_admins") };
  } }
};
