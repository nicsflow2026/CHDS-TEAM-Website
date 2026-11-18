// Staff accounts (User Management), roles & permissions, sessions, Security Center, audit logs, own profile.
import { E, sb, rpc, q, like, UID, audit, say, esc, settings, warn } from "../core.js";
import { PERMISSIONS, SYSTEM_ROLES, envFounders, grantable, can, isFounder, principal } from "../rbac.js";
import { cleanName, text, oneOf } from "../validate.js";
import { hashPassword, verifyPassword, passwordPolicy, revokeSessions, hex } from "./auth.js";
import { fail, need, actor, page, v, reasonOf, diff } from "./util.js";

const staffOut = (r, roles) => ({ uid: r.uid, display_name: r.display_name, role_id: r.role_id, role_name: (roles.find(x => x.id === r.role_id) || {}).name || r.role_id,
  grants: r.grants || [], status: r.status, status_reason: r.status_reason, source: envFounders().has(r.uid) ? "env" : r.source, team_member_id: r.team_member_id,
  has_password: !!r.password_hash, created_at: r.created_at, last_login_at: r.last_login_at, last_seen_at: r.last_seen_at, deleted_at: r.deleted_at });
const allRoles = () => sb("/roles?deleted_at=is.null&order=is_system.desc,name.asc&select=*");

// Who may change target t? Not yourself; env founders never; founders only by founders.
function assertCanManage(ctx, t) {
  need(t.uid !== ctx.p.uid, 403, "self", "You cannot change your own account here. Use My profile.");
  need(!envFounders().has(t.uid), 403, "env_managed", "This founder is defined by ADMIN_UIDS in the environment and cannot be changed in the dashboard.");
  if (t.role_id === "founder") need(isFounder(ctx.p), 403, "founder_only", "Only a Founder can change another Founder.");
}

export const ops = {
  me: { perm: null, method: "GET", fn: async ctx => {
    const p = ctx.p;
    return { uid: p.uid, name: p.name, role: p.role, role_name: p.roleName, perms: [...p.perms], scope: p.scope, source: p.source, has_own_password: p.hasOwnPassword,
      team_member_id: p.team_member_id, reauth_valid: ctx.ses.reauthOk, idle_ms: ctx.idle, flags: (await settings()).emergency };
  } },

  profile_password: { perm: null, method: "POST", reauth: true, fn: async ctx => {
    const { b } = ctx;
    need(passwordPolicy(b.new_password), 400, "weak_password", "Use at least 12 characters with some variety.");
    need(b.new_password === b.confirm_password, 400, "mismatch", "The two new passwords do not match.");
    const h = await hashPassword(b.new_password);
    if (ctx.p.source === "env") {
      // env founders may set a personal password, which then replaces ADMIN_PASSWORD for them
      await sb("/admin_users?on_conflict=uid", { method: "POST", body: { uid: ctx.p.uid, display_name: ctx.p.name, role_id: "founder", source: "env" }, prefer: "resolution=ignore-duplicates,return=minimal" });
      await sb(`/admin_users?uid=eq.${q(ctx.p.uid)}`, { method: "PATCH", body: { password_hash: h, password_changed_at: new Date().toISOString() }, prefer: "return=minimal" });
    } else {
      await sb(`/admin_users?uid=eq.${q(ctx.p.uid)}`, { method: "PATCH", body: { password_hash: h, password_changed_at: new Date().toISOString() }, prefer: "return=minimal" });
    }
    await revokeSessions(`uid=eq.${q(ctx.p.uid)}&id=neq.${ctx.ses.id}`, actor(ctx), "password_changed");
    await ctx.audit("password_changed", {}, { target: ctx.p.uid });
    return { ok: true };
  } },

  profile_name: { perm: null, method: "POST", fn: async ctx => {
    const n = v(cleanName(ctx.b.display_name, { min: 1, max: 60 }));
    await sb("/admin_users?on_conflict=uid", { method: "POST", body: { uid: ctx.p.uid, display_name: n, role_id: ctx.p.role, source: ctx.p.source }, prefer: "resolution=ignore-duplicates,return=minimal" });
    await sb(`/admin_users?uid=eq.${q(ctx.p.uid)}`, { method: "PATCH", body: { display_name: n, updated_at: new Date().toISOString() }, prefer: "return=minimal" });
    await ctx.audit("profile_renamed", {}, { target: ctx.p.uid, prev: { display_name: ctx.p.name }, next: { display_name: n } });
    return { ok: true };
  } },

  /* ---------------- User Management (staff accounts) ---------------- */
  staff_list: { perm: "manage_users", method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy);
    const f = [qy.q ? `&or=(display_name.ilike.${like(qy.q)},uid.ilike.${like(qy.q)})` : "", oneOf(qy.status, ["active", "suspended", "banned"]) ? `&status=eq.${qy.status}` : "",
      qy.role ? `&role_id=eq.${q(qy.role)}` : "", qy.deleted === "1" ? "&deleted_at=not.is.null" : "&deleted_at=is.null"].join("");
    const [r, roles] = await Promise.all([sb(`/admin_users?select=*${f}&order=created_at.desc${pg.range}`, { count: true }), allRoles()]);
    // ADMIN_UIDS founders who never signed in still appear (they exist through the environment)
    const listed = new Set(r.rows.map(x => x.uid));
    const envOnly = qy.q || qy.status || qy.role || qy.deleted === "1" || pg.offset ? [] : [...envFounders()].filter(u => !listed.has(u)).map(u => ({ uid: u, display_name: "Founder (ADMIN_UIDS)", role_id: "founder", source: "env", status: "active", grants: [] }));
    return { rows: [...envOnly, ...r.rows].map(x => staffOut(x, roles)), total: r.total + envOnly.length, roles: roles.map(x => ({ id: x.id, name: x.name })) };
  } },

  staff_get: { perm: "manage_users", method: "GET", fn: async ctx => {
    const uid = String(ctx.qy.uid || ""); need(UID.test(uid), 400, "bad_request");
    const [row, roles, notes, activity, sessions, handled] = await Promise.all([
      sb(`/admin_users?uid=eq.${q(uid)}&select=*`).then(r => r[0]), allRoles(),
      sb(`/internal_notes?subject_type=eq.staff&subject_id=eq.${q(uid)}&order=id.desc&limit=50&select=*`),
      sb(`/audit_log?actor=in.("admin:${uid}","tg:${uid}","${uid}")&order=id.desc&limit=40&select=id,at,action,target,detail`),
      sb(`/admin_sessions?uid=eq.${q(uid)}&order=created_at.desc&limit=20&select=id,ip,device,created_at,last_seen_at,expires_at,revoked_at,revoke_reason`),
      sb(`/ai_handoff_requests?assigned_uid=eq.${q(uid)}&order=created_at.desc&limit=20&select=id,status,category,reason,created_at,assigned_at,resolved_at,user:ai_support_users(display_name)`)]);
    const base = row || (envFounders().has(uid) ? { uid, display_name: "Founder (ADMIN_UIDS)", role_id: "founder", source: "env", status: "active", grants: [] } : null);
    need(base, 404, "not_found");
    const now = Date.now();
    return { user: staffOut(base, roles), notes, activity, support_history: handled,
      sessions: sessions.map(s => ({ ...s, id: s.id.slice(0, 12), active: !s.revoked_at && Date.parse(s.expires_at) > now })) };
  } },

  staff_save: { perm: "manage_admins", method: "POST", reauth: true, fn: async ctx => {
    const { b } = ctx, uid = String(b.uid || "").trim();
    need(UID.test(uid), 400, "invalid", "Telegram user ID must be digits only.");
    const existing = (await sb(`/admin_users?uid=eq.${q(uid)}&select=*`))[0];
    const roles = await allRoles();
    const role = roles.find(r => r.id === b.role_id);
    need(role, 400, "invalid", "Choose a role.");
    if (role.id === "founder") need(isFounder(ctx.p), 403, "founder_only", "Only a Founder can assign the Founder role.");
    const grants = Array.isArray(b.grants) ? [...new Set(b.grants)] : [];
    need(grantable(ctx.p, grants), 403, "escalation", "You can only grant permissions you hold yourself.");
    need(grantable(ctx.p, role.permissions || []) || isFounder(ctx.p), 403, "escalation", "You cannot assign a role with permissions you do not hold.");
    if (existing) assertCanManage(ctx, existing); else need(uid !== ctx.p.uid && !envFounders().has(uid), 403, "env_managed", "That ID is managed by ADMIN_UIDS or is your own.");
    const body = { uid, display_name: v(cleanName(b.display_name, { min: 1, max: 60 })), role_id: role.id, grants, actor: actor(ctx),
      ...(b.team_member_id !== undefined ? { team_member_id: b.team_member_id || "" } : {}) };
    if (b.password) { need(passwordPolicy(b.password), 400, "weak_password", "Initial password: at least 12 characters with some variety."); body.password_hash = await hashPassword(b.password); }
    need(existing || body.password_hash, 400, "password_required", "Set an initial password for the new account.");
    const o = await rpc("admin_user_save", { p: body, p_env_founders: envFounders().size });
    if (!o.ok) fail(o.error === "last_super_admin" ? 409 : 400, o.error, o.error === "last_super_admin" ? "At least one active Super Admin must remain." : o.error);
    const d = diff(existing, o.user, ["display_name", "role_id", "grants", "team_member_id"]);
    await ctx.audit(existing ? "staff_updated" : "staff_created", { password_set: !!body.password_hash }, { target: uid, prev: existing ? d.prev : null, next: existing ? d.next : { display_name: body.display_name, role_id: body.role_id, grants } });
    if (existing && (d.prev.role_id !== undefined || d.prev.grants !== undefined)) await ctx.audit("permissions_changed", {}, { target: uid, prev: { role_id: existing.role_id, grants: existing.grants }, next: { role_id: o.user.role_id, grants: o.user.grants } });
    if (!existing) await say(uid, `👋 <b>CHDS dashboard access</b>\nAn administrator created a ${esc(role.name)} account for you. Sign in at /admin with your Telegram ID and the password you were given, then change it under My profile.`).catch(warn("welcome message to new staff"));
    return { ok: true, user: o.user };
  } },

  staff_status: { perm: "manage_users", method: "POST", fn: async ctx => {
    const { b } = ctx, uid = String(b.uid || ""), status = oneOf(b.status, ["active", "suspended", "banned"]);
    need(UID.test(uid) && status, 400, "bad_request");
    const t = (await sb(`/admin_users?uid=eq.${q(uid)}&deleted_at=is.null&select=*`))[0];
    need(t, 404, "not_found");
    assertCanManage(ctx, t);
    if (status === "banned" || t.role_id !== "support_agent") need(can(ctx.p, "manage_admins"), 403, "forbidden", "Banning, or changing accounts with administrative roles, needs manage_admins.");
    const reason = reasonOf(b);
    const o = await rpc("admin_user_save", { p: { uid, status, status_reason: reason }, p_env_founders: envFounders().size });
    if (!o.ok) fail(409, o.error, o.error === "last_super_admin" ? "At least one active Super Admin must remain." : o.error);
    if (status !== "active") await revokeSessions(`uid=eq.${q(uid)}`, actor(ctx), "account_" + status);
    await ctx.audit("staff_" + (status === "active" ? "restored" : status), { reason }, { target: uid, prev: { status: t.status }, next: { status } });
    return { ok: true };
  } },

  staff_delete: { perm: "manage_admins", method: "POST", reauth: true, fn: async ctx => {
    const uid = String(ctx.b.uid || ""); need(UID.test(uid), 400, "bad_request");
    const t = (await sb(`/admin_users?uid=eq.${q(uid)}&deleted_at=is.null&select=*`))[0];
    need(t, 404, "not_found"); assertCanManage(ctx, t);
    const reason = reasonOf(ctx.b);
    const o = await rpc("admin_user_save", { p: { uid, delete: true, status_reason: reason }, p_env_founders: envFounders().size });
    if (!o.ok) fail(409, o.error, o.error === "last_super_admin" ? "At least one active Super Admin must remain." : o.error);
    await revokeSessions(`uid=eq.${q(uid)}`, actor(ctx), "account_deleted");
    await ctx.audit("staff_soft_deleted", { reason }, { target: uid, prev: { status: t.status, role_id: t.role_id } });
    return { ok: true };
  } },

  staff_note: { perm: "manage_users", method: "POST", fn: async ctx => {
    const uid = String(ctx.b.uid || ""); need(UID.test(uid), 400, "bad_request");
    const body = v(text(ctx.b.body, { min: 1, max: 2000, multiline: true, label: "Note" }));
    const n = (await sb("/internal_notes", { method: "POST", body: { subject_type: "staff", subject_id: uid, author: actor(ctx), body }, prefer: "return=representation" }))[0];
    await ctx.audit("staff_note_added", {}, { target: uid });
    return { ok: true, note: n };
  } },

  staff_revoke_sessions: { perm: "manage_users", method: "POST", fn: async ctx => {
    const uid = String(ctx.b.uid || ""); need(UID.test(uid), 400, "bad_request");
    if (uid !== ctx.p.uid) { const t = (await sb(`/admin_users?uid=eq.${q(uid)}&select=*`))[0]; if (t && t.role_id === "founder") need(isFounder(ctx.p), 403, "founder_only"); }
    const r = await revokeSessions(`uid=eq.${q(uid)}${uid === ctx.p.uid ? `&id=neq.${ctx.ses.id}` : ""}`, actor(ctx), "revoked_by_admin");
    await ctx.audit("sessions_revoked", { count: r.length }, { target: uid });
    return { ok: true, revoked: r.length };
  } },

  /* ---------------- Roles & permissions ---------------- */
  roles_list: { perm: "manage_roles", method: "GET", fn: async () => {
    const [roles, perms, users] = await Promise.all([allRoles(), sb("/permissions?select=*&order=key.asc"), sb("/admin_users?deleted_at=is.null&select=role_id")]);
    const counts = users.reduce((m, u) => (m[u.role_id] = (m[u.role_id] || 0) + 1, m), {});
    return { roles: roles.map(r => ({ ...r, users: counts[r.id] || 0 })), permissions: perms, env_founders: envFounders().size };
  } },

  role_save: { perm: "manage_roles", method: "POST", reauth: true, fn: async ctx => {
    const { b } = ctx;
    const perms = [...new Set(Array.isArray(b.permissions) ? b.permissions : [])];
    need(perms.every(x => PERMISSIONS.includes(x)), 400, "invalid", "Unknown permission.");
    need(grantable(ctx.p, perms), 403, "escalation", "You can only include permissions you hold yourself.");
    const name = v(text(b.name, { min: 2, max: 60, required: true, label: "Role name" })), description = v(text(b.description, { max: 300, label: "Description" }));
    const scope = oneOf(b.scope, ["all", "team"], "all");
    const existing = b.id ? (await sb(`/roles?id=eq.${q(b.id)}&deleted_at=is.null&select=*`))[0] : null;
    if (existing) {
      need(existing.id !== "founder", 403, "immutable", "The Founder role always has every permission and cannot be edited.");
      const r = (await sb(`/roles?id=eq.${q(existing.id)}`, { method: "PATCH", body: { name, description, permissions: perms, scope, updated_at: new Date().toISOString() }, prefer: "return=representation" }))[0];
      const d = diff(existing, r, ["name", "description", "permissions", "scope"]);
      await ctx.audit("role_updated", {}, { target: r.id, prev: d.prev, next: d.next });
      if (d.prev.permissions) await ctx.audit("permissions_changed", { role: r.id }, { target: "role:" + r.id, prev: { permissions: existing.permissions }, next: { permissions: perms } });
      return { ok: true, role: r };
    }
    const id = String(b.slug || name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    need(/^[a-z][a-z0-9_]{1,39}$/.test(id) && !SYSTEM_ROLES.includes(id), 400, "invalid", "Choose a different role name.");
    try {
      const r = (await sb("/roles", { method: "POST", body: { id, name, description, permissions: perms, scope, created_by: actor(ctx) }, prefer: "return=representation" }))[0];
      await ctx.audit("role_created", {}, { target: id, next: { name, permissions: perms, scope } });
      return { ok: true, role: r };
    } catch (e) { if (String(e.message).includes("23505")) fail(409, "duplicate", "A role with that ID already exists."); throw e; }
  } },

  role_delete: { perm: "manage_roles", method: "POST", reauth: true, fn: async ctx => {
    const r = (await sb(`/roles?id=eq.${q(ctx.b.id)}&deleted_at=is.null&select=*`))[0];
    need(r, 404, "not_found"); need(!r.is_system, 403, "immutable", "Built-in roles cannot be deleted.");
    const users = await sb(`/admin_users?role_id=eq.${q(r.id)}&deleted_at=is.null&select=uid&limit=1`);
    need(!users.length, 409, "in_use", "Move the accounts that use this role to another role first.");
    await sb(`/roles?id=eq.${q(r.id)}`, { method: "PATCH", body: { deleted_at: new Date().toISOString() }, prefer: "return=minimal" });
    await ctx.audit("role_deleted", {}, { target: r.id, prev: { name: r.name, permissions: r.permissions } });
    return { ok: true };
  } },

  /* ---------------- Session Manager ---------------- */
  sessions_list: { perm: "manage_security", method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy, 50), now = new Date().toISOString();
    const f = qy.state === "active" ? `&revoked_at=is.null&expires_at=gt.${encodeURIComponent(now)}` : qy.state === "ended" ? `&or=(revoked_at.not.is.null,expires_at.lte.${encodeURIComponent(now)})` : "";
    const r = await sb(`/admin_sessions?select=id,uid,ip,device,user_agent,created_at,last_seen_at,expires_at,revoked_at,revoked_by,revoke_reason,reauth_at${f}${qy.uid && UID.test(qy.uid) ? `&uid=eq.${qy.uid}` : ""}&order=created_at.desc${pg.range}`, { count: true });
    const names = Object.fromEntries((await sb(`/admin_users?select=uid,display_name`)).map(x => [x.uid, x.display_name]));
    return { total: r.total, rows: r.rows.map(s => ({ ...s, key: s.id.slice(0, 16), id: undefined, name: names[s.uid] || s.uid, current: s.id === ctx.ses.id, active: !s.revoked_at && s.expires_at > now })) };
  } },

  session_revoke: { perm: "manage_security", method: "POST", fn: async ctx => {
    const key = String(ctx.b.key || ""); need(/^[a-f0-9]{16}$/.test(key), 400, "bad_request");
    const rows = await sb(`/admin_sessions?id=like.${key}*&revoked_at=is.null&select=id,uid`);
    need(rows.length === 1, 404, "not_found");
    const t = (await sb(`/admin_users?uid=eq.${q(rows[0].uid)}&select=role_id`))[0];
    if ((t && t.role_id === "founder") || envFounders().has(rows[0].uid)) need(isFounder(ctx.p) || rows[0].uid === ctx.p.uid, 403, "founder_only", "Only a Founder can end a Founder's session.");
    await revokeSessions(`id=eq.${rows[0].id}`, actor(ctx), "revoked_by_admin");
    await ctx.audit("session_revoked", {}, { target: rows[0].uid });
    return { ok: true, self: rows[0].id === ctx.ses.id };
  } },

  my_sessions: { perm: null, method: "GET", fn: async ctx => {
    const now = new Date().toISOString();
    const rows = await sb(`/admin_sessions?uid=eq.${q(ctx.p.uid)}&order=created_at.desc&limit=30&select=id,ip,device,created_at,last_seen_at,expires_at,revoked_at,revoke_reason`);
    return { rows: rows.map(s => ({ ...s, key: s.id.slice(0, 16), id: undefined, current: s.id === ctx.ses.id, active: !s.revoked_at && s.expires_at > now })) };
  } },

  /* ---------------- Security Center ---------------- */
  security_overview: { perm: "manage_security", method: "GET", fn: async ctx => {
    const since = new Date(Date.now() - 864e5).toISOString(), since7 = new Date(Date.now() - 7 * 864e5).toISOString(), now = new Date().toISOString();
    const c = async f => (await sb(`/security_events?select=id&limit=1${f}`, { count: true })).total;
    const [failed24, failed7, locked24, rate24, unauth24, active, events, locks, notifFailed, logins] = await Promise.all([
      c(`&type=eq.login_failed&at=gte.${encodeURIComponent(since)}`), c(`&type=eq.login_failed&at=gte.${encodeURIComponent(since7)}`),
      c(`&type=eq.login_locked&at=gte.${encodeURIComponent(since)}`), c(`&type=eq.rate_limited&at=gte.${encodeURIComponent(since)}`),
      c(`&type=in.(unauthorized,forbidden)&at=gte.${encodeURIComponent(since)}`),
      sb(`/admin_sessions?revoked_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=id`, { count: true }).then(r => r.total),
      sb(`/security_events?order=id.desc&limit=60&select=*${ctx.qy.type ? `&type=eq.${q(ctx.qy.type)}` : ""}`),
      sb(`/login_guards?locked_until=gt.${encodeURIComponent(now)}&select=key,fails,locked_until`),
      sb("/notification_log?status=eq.failed&select=id", { count: true }).then(r => r.total),
      sb(`/audit_log?action=in.(login,login_failed,logout,logout_all,reauth)&order=id.desc&limit=30&select=id,at,actor,action,ip,user_agent`)]);
    return { counts: { failed_logins_24h: failed24, failed_logins_7d: failed7, lockouts_24h: locked24, rate_limited_24h: rate24, unauthorized_24h: unauth24, active_sessions: active, telegram_failed_notifications: notifFailed },
      events, locks, logins,
      config: { session_secret_ok: (E.SESSION_SECRET || "").length >= 24, admin_password_set: (E.ADMIN_PASSWORD || "").length >= 12, idle_minutes: Number(E.ADMIN_IDLE_MIN) || 10, env_founders: envFounders().size, two_factor: "Telegram one-time code (always on)" } };
  } },

  security_unlock: { perm: "manage_security", method: "POST", fn: async ctx => {
    const key = String(ctx.b.key || ""); need(/^(ip|u):[\w.:-]{1,80}$/.test(key), 400, "bad_request");
    await sb(`/login_guards?key=eq.${q(key)}`, { method: "DELETE" });
    await ctx.audit("login_lock_cleared", {}, { target: key });
    return { ok: true };
  } },

  /* ---------------- Audit logs ---------------- */
  audit_list: { perm: "view_audit_logs", method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy, 50, 200);
    const f = [qy.actor ? `&actor=ilike.${like(qy.actor)}` : "", qy.action ? `&action=ilike.${like(qy.action)}` : "", qy.target ? `&target=ilike.${like(qy.target)}` : "",
      /^\d{4}-\d{2}-\d{2}$/.test(qy.from || "") ? `&at=gte.${qy.from}T00:00:00%2B08:00` : "", /^\d{4}-\d{2}-\d{2}$/.test(qy.to || "") ? `&at=lt.${qy.to}T23:59:59.999%2B08:00` : ""].join("");
    const r = await sb(`/audit_log?select=*${f}&order=id.desc${pg.range}`, { count: true });
    return { total: r.total, rows: r.rows };
  } }
};
