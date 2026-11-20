import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { E, sb, rpc, tg, say, esc, statsData, settings, clearSettingsCache, EMERGENCY_DEFAULTS, dbCheck, aiChat, aiModels, team, teamConfigIssues, botToken, serviceKey, rid, appUrl, warn, envReport } from "../core.js";
import { syncCommands } from "../tgcommands.js";
import { can, canAny, envFounders } from "../rbac.js";
import { upload, download, signedUrl, buckets } from "../storage.js";
import { toCsv, int } from "../validate.js";
import { today, weekStart, monthStart, yearStart, phStartIso } from "../time.js";
import { fail, need, actor, reasonOf } from "./util.js";
import { notifyStaff } from "../staffnotify.js";

const EMERGENCY_LABEL = { maintenance_mode: "Maintenance mode", human_requests_disabled: "New Human Support requests disabled", reports_disabled: "Report submissions disabled",
  revenue_edits_locked: "Revenue edits locked", telegram_notifications_disabled: "Telegram notifications disabled", ai_disabled: "AI Support disabled" };

const BACKUP_TABLES = { reports: "*", report_history: "*", report_evidence: "*", revenue_records: "*", revenue_history: "*", team_members: "*", roles: "*", permissions: "*",
  admin_users: "uid,display_name,role_id,grants,status,status_reason,team_member_id,source,created_by,created_at,updated_at,last_login_at,last_seen_at,deleted_at",
  system_settings: "*", announcements: "*", ai_support_users: "*", ai_support_conversations: "*", ai_support_messages: "*", ai_handoff_requests: "*", ai_handoff_history: "*",
  sessions: "*", messages: "*", agents: "*", internal_notes: "*", audit_log: "*", security_events: "*", notification_log: "*", backups: "*",
  ai_knowledge: "*", support_quick_replies: "*", staff_notifications: "*" };
const ORDER = { messages: "id", ai_support_messages: "id", audit_log: "id", security_events: "id", report_history: "id", revenue_history: "id", ai_handoff_history: "id", notification_log: "id", internal_notes: "id", report_evidence: "id", staff_notifications: "id",
  admin_users: "uid", sessions: "sid", agents: "uid", system_settings: "key", permissions: "key" };
const DATASETS = {
  reports: { table: "reports", cols: ["id", "report_date", "created_at", "name", "title", "category", "recovered", "revenue", "status", "source", "reviewed_by", "reviewed_at", "rejection_reason", "correction_request", "published_at", "archived_at"], filter: "&deleted_at=is.null", order: "created_at" },
  revenue: { table: "revenue_records", cols: ["id", "revenue_date", "member_name", "amount", "status", "source", "report_id", "description", "verified_by", "verified_at", "created_at"], filter: "&deleted_at=is.null", order: "revenue_date" },
  team: { table: "team_members", cols: ["id", "display_name", "role_title", "member_group", "telegram_username", "status", "is_public", "display_order", "created_at", "deleted_at"], filter: "", order: "display_order" },
  ai_conversations: { table: "ai_support_conversations", cols: ["id", "user_id", "status", "owner", "category", "title", "message_count", "created_at", "resolved_at"], filter: "", order: "created_at" },
  handoffs: { table: "ai_handoff_requests", cols: ["id", "user_id", "conversation_id", "status", "priority", "reason", "category", "assigned_name", "created_at", "assigned_at", "first_response_at", "resolved_at", "closed_at", "closed_by_name", "close_reason", "reopened_at", "reopen_reason", "cancelled_at", "csat_rating"], filter: "", order: "created_at" },
  audit: { table: "audit_log", cols: ["id", "at", "actor", "action", "target", "ip"], filter: "", order: "id", perm: "view_audit_logs" }
};

async function fetchAll(table, cols, extra = "", order = "created_at", cap = 200000) {
  const out = [];
  for (let off = 0; off < cap; off += 1000) {
    const rows = await sb(`/${table}?select=${cols}${extra}&order=${order}.asc&limit=1000&offset=${off}`, { timeout: 15000 });
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}

export const ops = {
  overview: { perm: null, method: "GET", fn: async ctx => {
    const p = ctx.p, s = await settings(), t = today(), out = { flags: s.emergency, me: { name: p.name, role: p.role_name || p.roleName } };
    const jobs = [];
    if (can(p, "view_revenue")) jobs.push(rpc("revenue_analytics", { p_from: monthStart(t), p_to: t, p_group: "day", p_today: t, p_week: weekStart(t), p_month: monthStart(t), p_year: yearStart(t), p_members: null, p_uids: null }).then(a => { out.revenue = { fixed: a.fixed, month: a.totals, series: a.series }; }));
    if (can(p, "view_revenue")) jobs.push(statsData().then(st => { out.public_stats = st; }));
    if (canAny(p, ["manage_reports", "approve_reports"])) jobs.push(sb("/reports?status=in.(pending,reviewed)&deleted_at=is.null&select=id", { count: true }).then(r => { out.pending_reports = r.total; }));
    if (canAny(p, ["manage_support", "view_ai_conversations"])) jobs.push(sb("/ai_handoff_requests?status=in.(waiting,assigned,in_progress,waiting_customer)&select=id,status,created_at&order=created_at.asc").then(r => { out.handoffs = { open: r.length, waiting: r.filter(x => x.status === "waiting").length, oldest_waiting: (r.find(x => x.status === "waiting") || {}).created_at || null }; }));
    if (can(p, "view_ai_conversations")) jobs.push(rpc("ai_support_analytics", { p_from: new Date(Date.now() - 30 * 864e5).toISOString(), p_to: new Date().toISOString() }).then(a => { out.ai = { ...a, resolution_rate: a.conversations ? Math.round(a.ai_resolved / a.conversations * 1000) / 10 : null }; }));
    if (can(p, "view_ai_conversations")) jobs.push(sb(`/ai_support_conversations?created_at=gte.${encodeURIComponent(phStartIso(t))}&select=id`, { count: true }).then(r => { out.ai_today = r.total; }));
    if (can(p, "view_audit_logs")) jobs.push(sb("/audit_log?order=id.desc&limit=8&select=id,at,actor,action,target").then(r => { out.recent_audit = r; }));
    if (can(p, "view_system_health")) jobs.push(sb("/notification_log?status=eq.failed&select=id", { count: true }).then(r => { out.failed_notifications = r.total; }));
    await Promise.all(jobs.map(j => j.catch(e => { console.error("overview part", String(e.message).slice(0, 120)); out.partial = true; })));
    return out;
  } },

  badges: { perm: null, method: "GET", fn: async ctx => {
    const p = ctx.p, out = {}, c = async (path, k) => { out[k] = (await sb(path + "&limit=1", { count: true })).total; };
    const jobs = [];
    if (canAny(p, ["manage_support", "view_ai_conversations"])) jobs.push(c("/ai_handoff_requests?status=eq.waiting&select=id", "handoffs"));
    if (canAny(p, ["manage_reports", "approve_reports"])) jobs.push(c("/reports?status=in.(pending,reviewed)&deleted_at=is.null&select=id", "reports"));
    if (can(p, "manage_support")) jobs.push(c("/notification_log?status=eq.failed&select=id", "support"));
    if (can(p, "view_system_health")) jobs.push(c(`/app_errors?at=gte.${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}&select=id`, "health"));
    if (can(p, "manage_security")) jobs.push(c(`/security_events?severity=neq.info&at=gte.${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}&select=id`, "security"));
    jobs.push(c(`/staff_notifications?recipient_uid=eq.${encodeURIComponent(p.uid)}&read_at=is.null&select=id`, "notifications"));
    if (can(p, "manage_support")) jobs.push(c(`/ai_handoff_requests?assigned_uid=eq.${encodeURIComponent(p.uid)}&status=in.(assigned,in_progress,waiting_customer)&select=id`, "my_cases"));
    const now = encodeURIComponent(new Date().toISOString());
    jobs.push(sb(`/announcements?status=eq.published&publish_at=lte.${now}&or=(expires_at.is.null,expires_at.gt.${now})&select=id,audience,target_ids`).then(rows => { out.announcements = rows.filter(a => ["all", "admins", "team"].includes(a.audience) || (a.audience === "groups" && a.target_ids.includes(p.role)) || (a.audience === "selected_members" && p.team_member_id && a.target_ids.includes(p.team_member_id))).length; }));
    await Promise.all(jobs.map(j => j.catch(warn("badge count"))));
    return out;
  } },

  emergency_get: { perm: "manage_system", method: "GET", fn: async () => {
    const row = (await sb("/system_settings?key=eq.emergency&select=value,updated_by,updated_at"))[0];
    const hist = await sb("/audit_log?action=eq.emergency_changed&order=id.desc&limit=20&select=id,at,actor,detail,prev,next");
    return { flags: { ...EMERGENCY_DEFAULTS, ...(row ? row.value : {}) }, labels: EMERGENCY_LABEL, updated_by: row?.updated_by || null, updated_at: row?.updated_at || null, history: hist };
  } },

  emergency_set: { perm: "manage_system", method: "POST", reauth: true, fn: async ctx => {
    const { b } = ctx, key = String(b.flag || "");
    need(Object.prototype.hasOwnProperty.call(EMERGENCY_DEFAULTS, key), 400, "bad_request");
    need(b.confirm === true, 400, "confirm_required", "Confirm the action.");
    const reason = reasonOf(b);
    const cur = { ...EMERGENCY_DEFAULTS, ...((await sb("/system_settings?key=eq.emergency&select=value"))[0]?.value || {}) };
    const nextVal = b.value === true;
    need(cur[key] !== nextVal, 409, "no_change", "Already in that state.");
    const next = { ...cur, [key]: nextVal };
    await sb("/system_settings?on_conflict=key", { method: "POST", body: { key: "emergency", value: next, updated_by: actor(ctx), updated_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
    clearSettingsCache();
    await ctx.audit("emergency_changed", { flag: key, label: EMERGENCY_LABEL[key], reason }, { target: key, prev: { [key]: cur[key] }, next: { [key]: nextVal } });
    await notifyStaff({ perm: "manage_system", exclude: [ctx.p.uid], kind: "system_alert", title: `Emergency Control: ${EMERGENCY_LABEL[key]} ${nextVal ? "ON" : "OFF"}`, body: `By ${ctx.p.name}: ${reason.slice(0, 200)}`, link: "#/emergency", ref: key, key: key + ":" + Date.now() });
    await Promise.allSettled([...envFounders()].filter(u => u !== ctx.p.uid).map(u => say(u, `🚨 <b>Emergency Control</b>\n${esc(EMERGENCY_LABEL[key])}: <b>${nextVal ? "ON" : "OFF"}</b>\nBy: ${esc(ctx.p.name)}\nReason: ${esc(reason)}`)));
    return { ok: true, flags: next };
  } },

  settings_get: { perm: "manage_settings", method: "GET", fn: async () => {
    const s = await settings({ fresh: true });
    return { support: s.support, site: s.site, env: { currency: E.CURRENCY || "₱", tz_offset: E.TZ_OFFSET || "8", admin_idle_min: E.ADMIN_IDLE_MIN || "10", auto_approve: /^(1|true|yes|on)$/i.test(String(E.AUTO_APPROVE || "")), app_url: appUrl() || null, ai_models: aiModels() } };
  } },

  settings_save: { perm: "manage_settings", method: "POST", fn: async ctx => {
    const { b } = ctx, s = await settings({ fresh: true });
    const support = { request_limit: int(b.request_limit, 1, 20), cooldown_minutes: int(b.cooldown_minutes, 5, 1440), handoff_after_failures: int(b.handoff_after_failures, 1, 5),
      first_response_minutes: int(b.first_response_minutes ?? s.support.first_response_minutes, 1, 1440), resolution_hours: int(b.resolution_hours ?? s.support.resolution_hours, 1, 720) };
    need(Object.values(support).every(x => x !== null), 400, "invalid", "Request limit 1–20, cooldown 5–1440 minutes, failures before escalation 1–5, first-response SLA 1–1440 minutes, resolution SLA 1–720 hours.");
    const site = { announcement_banner: b.announcement_banner === true };
    const now = new Date().toISOString();
    await sb("/system_settings?on_conflict=key", { method: "POST", body: [{ key: "support", value: support, updated_by: actor(ctx), updated_at: now }, { key: "site", value: site, updated_by: actor(ctx), updated_at: now }], prefer: "resolution=merge-duplicates,return=minimal" });
    clearSettingsCache();
    await ctx.audit("settings_changed", {}, { target: "support,site", prev: { support: s.support, site: s.site }, next: { support, site } });
    return { ok: true, support, site };
  } },

  backups_list: { perm: "manage_backups", method: "GET", fn: async () => ({ rows: await sb("/backups?order=created_at.desc&limit=50&select=*"), tables: Object.keys(BACKUP_TABLES), datasets: Object.keys(DATASETS) }) },

  backup_create: { perm: "manage_backups", method: "POST", reauth: true, fn: async ctx => {
    const running = await sb(`/backups?status=eq.running&created_at=gt.${encodeURIComponent(new Date(Date.now() - 5 * 6e4).toISOString())}&select=id`);
    need(!running.length, 409, "busy", "Another backup is still running.");
    const id = rid("BK-", 10), started = Date.now();
    await sb("/backups", { method: "POST", body: { id, kind: "full_export", status: "running", created_by: actor(ctx) }, prefer: "return=minimal" });
    try {
      const data = {}, counts = {};
      for (const [t, cols] of Object.entries(BACKUP_TABLES)) {
        if (Date.now() - started > 40000) throw new Error("time budget exceeded before all tables were read");
        data[t] = await fetchAll(t, cols, "", ORDER[t] || (t === "roles" ? "id" : "created_at"));
        counts[t] = data[t].length;
      }
      const json = JSON.stringify({ format: "chds-backup-v1", created_at: new Date().toISOString(), created_by: actor(ctx), excluded: ["admin_sessions", "admin_otps", "ai_support_sessions", "admin_users.password_hash", "bot_state", "tg_updates", "rate_limits", "login_guards", "support_rate_limits", "app_errors", "storage files"], row_counts: counts, data });
      const gz = gzipSync(Buffer.from(json)), sha = createHash("sha256").update(gz).digest("hex"), path = `${id}.json.gz`;
      await upload("backups", path, gz, "application/gzip");
      await sb(`/backups?id=eq.${id}`, { method: "PATCH", body: { status: "completed", path, size_bytes: gz.length, sha256: sha, row_counts: counts, completed_at: new Date().toISOString() }, prefer: "return=minimal" });
      const back = await download("backups", path);
      const okHash = createHash("sha256").update(back).digest("hex") === sha;
      const parsed = okHash ? JSON.parse(gunzipSync(back).toString()) : null;
      const okRows = parsed && Object.entries(counts).every(([t, n]) => Array.isArray(parsed.data[t]) && parsed.data[t].length === n);
      if (!okHash || !okRows) {
        await sb(`/backups?id=eq.${id}`, { method: "PATCH", body: { status: "failed", error: okHash ? "row count mismatch after download" : "checksum mismatch after upload" }, prefer: "return=minimal" });
        await ctx.audit("backup_failed", { reason: "verification" }, { target: id });
        fail(502, "verify_failed", "The backup was written but did not pass verification. It is marked as failed.");
      }
      await sb(`/backups?id=eq.${id}`, { method: "PATCH", body: { status: "verified", verified_at: new Date().toISOString() }, prefer: "return=minimal" });
      await ctx.audit("backup_created", { size: gz.length, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b2) => a + b2, 0) }, { target: id });
      return { ok: true, id, status: "verified", size_bytes: gz.length, sha256: sha, row_counts: counts };
    } catch (e) {
      if (e && e.status) throw e;
      await sb(`/backups?id=eq.${id}`, { method: "PATCH", body: { status: "failed", error: String(e.message || e).slice(0, 300) }, prefer: "return=minimal" }).catch(warn("backup status update"));
      await ctx.audit("backup_failed", { error: String(e.message || e).slice(0, 200) }, { target: id });
      fail(502, "backup_failed", "Backup failed: " + String(e.message || e).slice(0, 160));
    }
  } },

  backup_download: { perm: "manage_backups", method: "POST", reauth: true, fn: async ctx => {
    const id = String(ctx.b.id || ""); need(/^BK-[0-9A-Z]{8,14}$/.test(id), 400, "bad_request");
    const r = (await sb(`/backups?id=eq.${id}&select=*`))[0]; need(r && r.path && (r.status === "verified" || r.status === "completed"), 404, "not_found");
    await ctx.audit("backup_downloaded", {}, { target: id });
    return { url: await signedUrl("backups", r.path, 120), expires_in: 120, sha256: r.sha256 };
  } },

  export_dataset: { perm: "manage_backups", method: "GET", raw: true, fn: async ctx => {
    const d = DATASETS[ctx.qy.dataset]; need(d, 400, "bad_request");
    if (d.perm) need(can(ctx.p, d.perm), 403, "forbidden");
    const rows = await fetchAll(d.table, d.cols.join(","), d.filter, d.order, 50000);
    await ctx.audit("dataset_exported", { dataset: ctx.qy.dataset, rows: rows.length }, {});
    ctx.res.setHeader("Content-Type", "text/csv; charset=utf-8");
    ctx.res.setHeader("Content-Disposition", `attachment; filename="chds-${ctx.qy.dataset}-${today()}.csv"`);
    ctx.res.status(200).send(toCsv(d.cols.map(c => [c, c]), rows));
  } },

  health: { perm: "view_system_health", method: "GET", fn: async ctx => {
    const t0 = Date.now();
    const [db, me, wh, bk, waiting, failed, errs, errCount] = await Promise.all([
      dbCheck().catch(e => ({ ok: false, missing: ["(check failed: " + String(e.message).slice(0, 80) + ")"] })),
      botToken() ? tg("getMe", {}) : Promise.resolve({ ok: false, description: "BOT_TOKEN not set" }),
      botToken() ? tg("getWebhookInfo", {}) : Promise.resolve({ ok: false }),
      buckets().then(b => ({ ok: true, names: b.map(x => x.name) })).catch(e => ({ ok: false, error: String(e.message).slice(0, 120) })),
      sb("/ai_handoff_requests?status=eq.waiting&order=created_at.asc&select=created_at").catch(warn("health waiting handoffs")),
      sb("/notification_log?status=eq.failed&select=id", { count: true }).then(r => r.total).catch(warn("health failed notifications")),
      sb("/app_errors?order=id.desc&limit=20&select=id,at,route,message").catch(warn("health app errors", [])),
      sb(`/app_errors?at=gte.${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}&select=id`, { count: true }).then(r => r.total).catch(warn("health error count"))]);
    const need3 = ["team-photos", "report-evidence", "backups", "public-report-images"];
    return {
      checked_at: new Date().toISOString(), took_ms: Date.now() - t0,
      api: { ok: true, node: process.version, region: E.VERCEL_REGION || null, env: E.VERCEL_ENV || null, commit: (E.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null, deployment_url: E.VERCEL_URL ? "set" : null },
      supabase: { configured: !!(E.SUPABASE_URL && serviceKey()), ok: db.ok, missing: db.missing, latency_ms: db.ms ?? null },
      telegram: { configured: !!botToken(), ok: !!me.ok, bot: me.ok ? "@" + me.result.username : null, error: me.ok ? null : me.description || null,
        webhook_url_set: !!(wh.result && wh.result.url), webhook_pending: wh.result?.pending_update_count ?? null, webhook_last_error: wh.result?.last_error_message || null,
        team_uids: team().length, uid_errors: teamConfigIssues(), failed_notifications: failed },
      ai: { configured: !!E.GROQ_API_KEY, models: aiModels() },
      storage: { ok: bk.ok, error: bk.error || null, missing_buckets: bk.ok ? need3.filter(n => !bk.names.includes(n)) : need3 },
      background: { waiting_handoffs: waiting ? waiting.length : null, oldest_waiting: waiting && waiting[0] ? waiting[0].created_at : null },
      errors: { last_24h: errCount, recent: errs },
      env: envReport(),
      config: { session_secret: (E.SESSION_SECRET || "").length >= 24, webhook_secret: !!E.WEBHOOK_SECRET, admin_password: (E.ADMIN_PASSWORD || "").length >= 12, env_founders: envFounders().size, app_url: !!appUrl() }
    };
  } },

  webhook_connect: { perm: "manage_system", method: "POST", fn: async ctx => {
    const host = ctx.req.headers["x-forwarded-host"] || ctx.req.headers.host;
    const w = await tg("setWebhook", { url: `https://${host}/api/telegram`, secret_token: E.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], max_connections: 20 });
    const c = await syncCommands(); await tg("setMyName", { name: "CHDS Report" });
    await ctx.audit("connect_webhook", { ok: !!w.ok, commands_ok: c.ok, command_problems: c.problems.length }, { target: "telegram" });
    return { ok: !!(w.ok && c.ok), error: !w.ok ? w.description : c.ok ? undefined : "Command menu not verified: " + c.problems.slice(0, 3).join("; "), commands: c.commands, scopes_checked: c.scopes_checked };
  } },

  test_ai: { perm: "view_system_health", method: "POST", fn: async () => {
    const o = await aiChat([{ role: "user", content: "Reply with the single word OK." }], { max: 40, budget: 25000 });
    return o.ok ? { ok: true, detail: `AI answered using ${o.model}.` } : { ok: false, detail: o.detail || o.error };
  } }
};
