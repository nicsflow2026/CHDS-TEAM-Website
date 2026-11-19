// Dashboard notification center: one row per recipient, de-duplicated by dedupe_key, permission-scoped.
// Bodies carry references and labels only (no customer message text, no secrets).
import { E, ids, sb, warn } from "./core.js";

// Staff holding a permission (Founders hold all). roles: restrict to role ids instead.
export async function staffRecipients({ perm = null, roles = null } = {}) {
  const set = new Set(ids(E.ADMIN_UIDS));
  try {
    const rows = await sb("/admin_users?status=eq.active&deleted_at=is.null&select=uid,grants,role_id,source,role:roles(id,permissions)");
    for (const r of rows) {
      if (r.source === "env") continue; // env founders come from ADMIN_UIDS only
      const rid = r.role ? r.role.id : r.role_id, perms = [...((r.role && r.role.permissions) || []), ...(r.grants || [])];
      if (roles ? roles.includes(rid) : (rid === "founder" || (perm && perms.includes(perm)))) set.add(r.uid);
    }
  } catch (e) { console.error("staff recipients", String(e.message).slice(0, 100)); }
  return [...set];
}

// staffOnly: deliver to the given uids only if they can open the dashboard (env founders or active staff accounts).
export async function notifyStaff({ uids = [], perm = null, roles = null, kind, title, body = "", link = null, ref = null, key = null, exclude = [], staffOnly = false }) {
  let given = uids.filter(Boolean).map(String);
  if (staffOnly && given.length) {
    const env = ids(E.ADMIN_UIDS);
    const rows = await sb(`/admin_users?uid=in.(${given.filter(u => /^\d{1,20}$/.test(u)).join(",") || "0"})&status=eq.active&deleted_at=is.null&select=uid`).catch(warn("staff lookup", []));
    given = given.filter(u => env.has(u) || rows.some(r => r.uid === u));
  }
  const list = new Set(given);
  if (perm || roles) for (const u of await staffRecipients({ perm, roles })) list.add(u);
  for (const x of exclude) list.delete(String(x));
  if (!list.size) return 0;
  const rows = [...list].map(uid => ({ recipient_uid: uid, kind, title: String(title).slice(0, 160), body: String(body || "").slice(0, 600), link, ref: ref ? String(ref) : null,
    dedupe_key: `${kind}:${key || ref || Date.now()}:${uid}`.slice(0, 200) }));
  await sb("/staff_notifications?on_conflict=dedupe_key", { method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=minimal" }).catch(warn("staff notification"));
  return rows.length;
}
