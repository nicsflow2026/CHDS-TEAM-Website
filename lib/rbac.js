// Role-based access control. Every admin API operation declares the permission it needs; the check
// happens here, on the server, for every request. The dashboard only hides what the API would refuse.
import { E, ids, sb, q } from "./core.js";

export const PERMISSIONS = ["manage_users", "manage_ai_support", "view_ai_conversations", "manage_team", "manage_reports", "approve_reports",
  "manage_revenue", "view_revenue", "manage_support", "manage_admins", "manage_roles", "manage_announcements", "manage_settings",
  "view_audit_logs", "manage_backups", "manage_security", "view_system_health", "manage_system"];
export const SYSTEM_ROLES = ["founder", "administrator", "team_leader", "support_agent"];
export const envFounders = () => ids(E.ADMIN_UIDS);

// Resolve who a Telegram UID is in the dashboard. Env founders (ADMIN_UIDS) always exist and hold every
// permission (this preserves the original admin behaviour). Everyone else needs an active admin_users row.
export async function principal(uid) {
  const env = envFounders().has(uid);
  const row = (await sb(`/admin_users?uid=eq.${q(uid)}&select=uid,display_name,role_id,grants,status,source,team_member_id,deleted_at,password_hash,last_login_at`))[0] || null;
  if (env) {
    return { uid, name: row?.display_name || "Founder", role: "founder", roleName: "Founder / Super Admin", perms: new Set(PERMISSIONS), scope: "all",
      source: "env", status: "active", team_member_id: row?.team_member_id || null, hasOwnPassword: !!row?.password_hash, row };
  }
  if (!row || row.deleted_at || row.status !== "active" || row.source === "env") return null; // env rows removed from ADMIN_UIDS lose access
  const role = (await sb(`/roles?id=eq.${q(row.role_id)}&deleted_at=is.null&select=id,name,permissions,scope`))[0];
  if (!role) return null;
  const perms = role.id === "founder" ? new Set(PERMISSIONS) : new Set([...(role.permissions || []), ...(row.grants || [])].filter(p => PERMISSIONS.includes(p)));
  return { uid, name: row.display_name, role: role.id, roleName: role.name, perms, scope: role.scope, source: "db", status: row.status,
    team_member_id: row.team_member_id, hasOwnPassword: !!row.password_hash, row };
}
export const can = (p, perm) => !!p && (p.role === "founder" || p.perms.has(perm));
export const canAny = (p, list) => list.some(x => can(p, x));
export const isFounder = p => !!p && p.role === "founder";

// Team Leaders only see members whose leader is their own team member record (plus themselves).
export async function teamScope(p) {
  if (!p || p.scope !== "team") return null; // null = unrestricted
  if (!p.team_member_id) return { ids: [], uids: [] };
  const rows = await sb(`/team_members?or=(id.eq.${q(p.team_member_id)},leader_id.eq.${q(p.team_member_id)})&deleted_at=is.null&select=id,telegram_uid`);
  return { ids: rows.map(r => r.id), uids: rows.map(r => r.telegram_uid).filter(Boolean) };
}

// Privilege-escalation guard: nobody can hand out permissions they do not hold themselves.
export const grantable = (p, list) => (list || []).every(x => PERMISSIONS.includes(x) && can(p, x));
