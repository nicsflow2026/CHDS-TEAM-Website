// Who may use the private report portal and the Telegram bot: authorized CHDS team identities only.
// Same rule as the bot: TELEGRAM_TEAM_UIDS / ALLOWED_UIDS / ADMIN_UIDS (minus members deactivated in Team
// Management) plus dashboard staff whose role grants approve_reports. Checked on the server for every action.
import { E, ids, sb, q, warn } from "./core.js";
import { isActiveMember } from "./handoff.js";
import { principal, can } from "./rbac.js";

const envAdmins = () => ids(E.ADMIN_UIDS);
export async function isApprover(uid) {
  if (envAdmins().has(uid)) return true;
  try { return can(await principal(uid), "approve_reports"); } catch (e) { console.error("approver lookup", String(e.message).slice(0, 100)); return false; }
}
export async function approverUids() {
  const set = new Set(envAdmins());
  try {
    const rows = await sb("/admin_users?status=eq.active&deleted_at=is.null&source=eq.db&select=uid,grants,role:roles(id,permissions)");
    for (const r of rows) if (r.role && (r.role.id === "founder" || (r.role.permissions || []).includes("approve_reports") || (r.grants || []).includes("approve_reports"))) set.add(r.uid);
  } catch (e) { console.error("approver list", String(e.message).slice(0, 100)); }
  return [...set];
}
export async function isAuthorizedReporter(uid) {
  if (!/^\d{1,20}$/.test(String(uid || ""))) return false;
  return (await isActiveMember(uid)) || (await isApprover(uid));
}
// Team member record for a verified UID (name shown on reports), never trusted from the browser.
export async function reporterProfile(uid) {
  const m = (await sb(`/team_members?telegram_uid=eq.${q(uid)}&deleted_at=is.null&select=id,display_name,status`).catch(warn("reporter profile", [])))[0];
  return { member_id: m ? m.id : null, name: m ? m.display_name : "Team member " + String(uid).slice(-4) };
}
