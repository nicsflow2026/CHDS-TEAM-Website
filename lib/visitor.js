// Persistent anonymous visitor identity for CHDS AI Support.
// A 256-bit random token lives only in an HttpOnly, Secure, SameSite=Strict cookie (JavaScript cannot read it);
// the database stores its SHA-256 hash. The token is never returned in any API response.
import { randomBytes } from "node:crypto";
import { sb, rpc, sha256, cookies, clientIp, userAgent, q } from "./core.js";

export const VCOOKIE = "__Host-chds_vid";
const MAX_AGE = 400 * 86400; // browsers cap cookie lifetime at 400 days; renewed on every visit
export function appendCookie(res, c) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : prev ? [prev] : []), c]);
}
const setCookie = (res, tok, age = MAX_AGE) => appendCookie(res, `${VCOOKIE}=${tok}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);

// -> { user, hash } | null.  Blocked visitors are returned with user.status === 'blocked' so callers can refuse.
export async function getVisitor(req, res) {
  const tok = cookies(req)[VCOOKIE];
  if (!tok || !/^[a-f0-9]{64}$/.test(tok)) return null;
  const hash = sha256(tok);
  const row = (await sb(`/ai_support_sessions?token_hash=eq.${hash}&revoked_at=is.null&select=token_hash,last_seen_at,user:ai_support_users(id,display_name,status,first_seen_at,last_seen_at,created_at)`))[0];
  if (!row || !row.user) return null;
  if (Date.now() - Date.parse(row.last_seen_at) > 6 * 36e5) { // refresh activity + cookie lifetime a few times a day
    await sb(`/ai_support_sessions?token_hash=eq.${hash}`, { method: "PATCH", body: { last_seen_at: new Date().toISOString() }, prefer: "return=minimal" })
      .catch(e => console.error("visitor touch", String(e.message).slice(0, 100)));
    if (res) setCookie(res, tok);
  }
  return { user: row.user, hash };
}

// Creates the profile + server session atomically, then sets the cookie. Throws on DB failure (no cookie set).
export async function createVisitor(req, res, name) {
  const tok = randomBytes(32).toString("hex");
  const u = await rpc("ai_identity_create", { p_name: name, p_token_hash: sha256(tok), p_ip: clientIp(req), p_ua: userAgent(req) });
  setCookie(res, tok);
  return u;
}
export const forgetVisitorCookie = res => setCookie(res, "", 0);
export const publicProfile = u => ({ id: u.id, short_id: String(u.id).slice(0, 8), display_name: u.display_name, first_seen_at: u.first_seen_at || u.created_at, status: u.status });

export async function ownConversation(userId, convId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(convId || ""))) return null;
  return (await sb(`/ai_support_conversations?id=eq.${q(convId)}&user_id=eq.${q(userId)}&select=*`))[0] || null;
}
