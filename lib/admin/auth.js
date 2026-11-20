import { createHash, randomBytes, randomInt, timingSafeEqual, scrypt as _scrypt } from "node:crypto";
import { promisify } from "node:util";
import { E, sb, rpc, say, clientIp, userAgent, limited, hit, audit, securityEvent, q, UID, cookies, botToken, warn } from "../core.js";
import { principal, envFounders } from "../rbac.js";
import { fail, need } from "./util.js";

const scrypt = promisify(_scrypt);
export const COOKIE = "__Host-chds_admin";
const dig = s => createHash("sha256").update(s).digest();
export const same = (a, b) => timingSafeEqual(dig(String(a)), dig(String(b)));
export const hex = s => createHash("sha256").update(s + (E.SESSION_SECRET || "")).digest("hex");
export const IDLE = () => Math.max(1, Math.min(120, Number(E.ADMIN_IDLE_MIN) || 10)) * 6e4;
export const ABS = 8 * 36e5, REAUTH_MS = 10 * 6e4;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = t => encodeURIComponent(new Date(t).toISOString());
export const ready = () => (E.SESSION_SECRET || "").length >= 24 && !!botToken();
export const setCookie = (res, v, age) => res.setHeader("Set-Cookie", `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);
export const device = ua => {
  const s = String(ua || ""), os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "Unknown OS";
  const br = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "Browser";
  return `${br} on ${os}`;
};

export async function hashPassword(pw) {
  const salt = randomBytes(16), N = 16384, r = 8, p = 1;
  const key = await scrypt(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw, stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(String(stored || ""));
  if (!m) return false;
  const want = Buffer.from(m[5], "base64");
  const got = await scrypt(String(pw), Buffer.from(m[4], "base64"), want.length, { N: +m[1], r: +m[2], p: +m[3], maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}
export const passwordPolicy = pw => typeof pw === "string" && pw.length >= 12 && pw.length <= 200 && new Set(pw).size >= 5;

async function checkPassword(p, pw) {
  if (p && p.hasOwnPassword) return verifyPassword(pw, p.row.password_hash);
  const envOk = p && p.source === "env" && (E.ADMIN_PASSWORD || "").length >= 12 && same(pw, E.ADMIN_PASSWORD);
  await verifyPassword(pw, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  return !!envOk;
}

async function guard(keys, op) {
  try { return await rpc("login_guard", { p_keys: keys, p_op: op }); }
  catch (e) { console.error("login_guard", String(e.message).slice(0, 120)); fail(503, "unavailable", "Sign-in is temporarily unavailable."); }
}

export async function session(req, touch) {
  const t = cookies(req)[COOKIE];
  if (!t || !/^[a-f0-9]{64}$/.test(t)) return null;
  const id = hex(t);
  const r = (await sb(`/admin_sessions?id=eq.${id}&expires_at=gt.${iso(Date.now())}&revoked_at=is.null&select=*`))[0];
  if (!r || Date.parse(r.created_at) + ABS < Date.now()) return null;
  const p = await principal(r.uid);
  if (!p) {
    await sb(`/admin_sessions?id=eq.${id}`, { method: "PATCH", body: { revoked_at: new Date().toISOString(), revoke_reason: "access_removed" }, prefer: "return=minimal" }).catch(warn("revoke session after access removal"));
    return null;
  }
  if (touch) {
    const next = Math.min(Date.now() + IDLE(), Date.parse(r.created_at) + ABS);
    if (next - Date.parse(r.expires_at) > 15000) {
      await sb(`/admin_sessions?id=eq.${id}`, { method: "PATCH", body: { expires_at: new Date(next).toISOString(), last_seen_at: new Date().toISOString() }, prefer: "return=minimal" }).catch(e => console.error("touch", e));
      await sb(`/admin_users?uid=eq.${q(r.uid)}`, { method: "PATCH", body: { last_seen_at: new Date().toISOString() }, prefer: "return=minimal" }).catch(warn("admin last_seen"));
    }
  }
  return { uid: r.uid, tok: t, id, row: r, p, reauthOk: !!r.reauth_at && Date.now() - Date.parse(r.reauth_at) < REAUTH_MS };
}

export async function login(req, res, b) {
  if (await limited(req, "alogin", 8, 900)) fail(429, "rate_limited");
  need(ready(), 503, "not_configured");
  const u = String(b.uid || "").trim(), ip = clientIp(req);
  const keys = ["ip:" + ip, ...(UID.test(u) ? ["u:" + u] : [])];
  const g = await guard(keys, "check");
  if (g.locked) { await securityEvent("login_locked", { severity: "warning", actor: UID.test(u) ? u : null, req }); return res.status(429).json({ error: "locked", retry_after: g.retry_after }); }
  const p = UID.test(u) ? await principal(u) : null;
  const ok = await checkPassword(p, String(b.password || ""));
  await sleep(250 + Math.random() * 250);
  if (!ok) {
    await guard(keys, "fail");
    await securityEvent("login_failed", { severity: "warning", actor: UID.test(u) ? u : null, req, detail: { step: "password" } });
    if (UID.test(u) && (await hit("alogin-u:" + u, 5, 900))) fail(429, "rate_limited");
    return res.json({ ok: true, step: "otp" });
  }
  const code = String(randomInt(0, 1e6)).padStart(6, "0");
  await sb("/admin_otps?on_conflict=uid", { method: "POST", body: { uid: u, code_hash: hex(code + u), attempts: 0, expires_at: new Date(Date.now() + 3e5).toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
  const r = await say(u, `🔐 <b>CHDS admin login</b>\nYour code: <code>${code}</code>\nValid for 5 minutes · IP ${ip}\nIf this was not you, change your password now.`);
  if (!r.ok) fail(502, "telegram");
  return res.json({ ok: true, step: "otp" });
}

export async function otp(req, res, b) {
  if (await limited(req, "aotp", 10, 900)) fail(429, "rate_limited");
  const u = String(b.uid || "").trim(), code = String(b.code || "").trim(), ip = clientIp(req);
  if (!ready() || !UID.test(u) || !/^\d{6}$/.test(code)) fail(401, "invalid");
  const keys = ["ip:" + ip, "u:" + u];
  const g = await guard(keys, "check");
  if (g.locked) return res.status(429).json({ error: "locked", retry_after: g.retry_after });
  const row = (await sb(`/admin_otps?uid=eq.${u}&select=*`))[0];
  if (!row || Date.parse(row.expires_at) < Date.now() || row.attempts >= 5) { await sb(`/admin_otps?uid=eq.${u}`, { method: "DELETE" }); fail(401, "invalid"); }
  if (!same(hex(code + u), row.code_hash)) {
    await sb(`/admin_otps?uid=eq.${u}`, { method: "PATCH", body: { attempts: row.attempts + 1 } });
    await guard(keys, "fail");
    await securityEvent("login_failed", { severity: "warning", actor: u, req, detail: { step: "otp" } });
    await audit(u, "login_failed", { ip }, { req });
    fail(401, "invalid");
  }
  await sb(`/admin_otps?uid=eq.${u}`, { method: "DELETE" });
  const p = await principal(u);
  if (!p) fail(401, "invalid");
  await guard(keys, "success");
  const tok = randomBytes(32).toString("hex"), ua = userAgent(req);
  await sb("/admin_sessions", { method: "POST", body: { id: hex(tok), uid: u, ip, user_agent: ua, device: device(ua), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + IDLE()).toISOString() }, prefer: "return=minimal" });
  setCookie(res, tok, 28800);
  if (envFounders().has(u)) await sb("/admin_users?on_conflict=uid", { method: "POST", body: { uid: u, display_name: "Founder " + u.slice(-4), role_id: "founder", source: "env" }, prefer: "resolution=ignore-duplicates,return=minimal" }).catch(e => console.error("env founder row", e));
  await sb(`/admin_users?uid=eq.${q(u)}`, { method: "PATCH", body: { last_login_at: new Date().toISOString() }, prefer: "return=minimal" }).catch(warn("admin last_login"));
  await audit("admin:" + u, "login", { device: device(ua) }, { target: u, req });
  await securityEvent("login_success", { actor: u, req, detail: { device: device(ua) } });
  await say(u, `✅ <b>Admin login successful</b>\n${device(ua)} · IP ${ip}. If this was not you, change your password and use Sign out everywhere.`);
  return res.json({ ok: true });
}

export async function reauth(req, res, ses, b) {
  const keys = ["u:" + ses.uid];
  const g = await guard(keys, "check");
  if (g.locked) return res.status(429).json({ error: "locked", retry_after: g.retry_after });
  const ok = await checkPassword(ses.p, String(b.password || ""));
  await sleep(200 + Math.random() * 200);
  if (!ok) {
    await guard(keys, "fail");
    await securityEvent("reauth_failed", { severity: "warning", actor: ses.uid, req });
    fail(401, "invalid", "Password is not correct.");
  }
  await guard(keys, "success");
  const tok = randomBytes(32).toString("hex"), now = new Date().toISOString();
  await sb("/admin_sessions", { method: "POST", body: { id: hex(tok), uid: ses.uid, ip: clientIp(req), user_agent: userAgent(req), device: device(userAgent(req)), created_at: ses.row.created_at,
    expires_at: new Date(Math.min(Date.now() + IDLE(), Date.parse(ses.row.created_at) + ABS)).toISOString(), last_seen_at: now, reauth_at: now, rotated_from: ses.id }, prefer: "return=minimal" });
  await sb(`/admin_sessions?id=eq.${ses.id}`, { method: "PATCH", body: { revoked_at: now, revoke_reason: "rotated" }, prefer: "return=minimal" });
  setCookie(res, tok, Math.max(60, Math.floor((Date.parse(ses.row.created_at) + ABS - Date.now()) / 1000)));
  await audit("admin:" + ses.uid, "reauth", {}, { target: ses.uid, req });
  return res.json({ ok: true, valid_ms: REAUTH_MS });
}

export async function revokeSessions(filter, by, reason) {
  return sb(`/admin_sessions?${filter}&revoked_at=is.null`, { method: "PATCH", body: { revoked_at: new Date().toISOString(), revoked_by: by, revoke_reason: reason }, prefer: "return=representation" });
}
