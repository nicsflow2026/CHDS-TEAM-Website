// Admin panel API. Security: password + Telegram one-time code (2FA), server-side sessions (hashed token in DB),
// HttpOnly + Secure + SameSite=Strict cookie, CSRF header + Origin check, rate limits, audit log.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { api, E, sb, rpc, tg, say, closeNotifs, ids, num, UID, SID, RID, clientIp, limited, hit, jsonBody, statsData, audit, aiChat, aiModels, cur } from "../../lib/core.js";
import { COMMANDS, parseDate } from "../../lib/bot.js";

const COOKIE = "__Host-chds_admin";
const dig = s => createHash("sha256").update(s).digest();
const same = (a, b) => timingSafeEqual(dig(String(a)), dig(String(b)));
const hex = s => createHash("sha256").update(s + (E.SESSION_SECRET || "")).digest("hex");
const ready = () => (E.ADMIN_PASSWORD || "").length >= 12 && (E.SESSION_SECRET || "").length >= 24 && ids(E.ADMIN_UIDS).size > 0 && !!E.BOT_TOKEN;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = t => encodeURIComponent(new Date(t).toISOString());
const cookies = req => Object.fromEntries(String(req.headers.cookie || "").split(";").map(c => { const i = c.indexOf("="); return [c.slice(0, i).trim(), c.slice(i + 1).trim()]; }));
const setCookie = (res, v, age) => res.setHeader("Set-Cookie", `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);

// Sliding idle timeout (default 10 min, ADMIN_IDLE_MIN to change) + absolute limit of 8 h.
const IDLE = () => Math.max(1, Math.min(120, Number(E.ADMIN_IDLE_MIN) || 10)) * 6e4, ABS = 8 * 36e5;
async function session(req, touch) {
  const t = cookies(req)[COOKIE];
  if (!t || !/^[a-f0-9]{64}$/.test(t)) return null;
  const r = (await sb(`/admin_sessions?id=eq.${hex(t)}&expires_at=gt.${iso(Date.now())}&select=uid,created_at,expires_at`))[0];
  if (!r || !ids(E.ADMIN_UIDS).has(r.uid) || Date.parse(r.created_at) + ABS < Date.now()) return null;
  if (touch) { // activity extends the session; background polling does not
    const next = Math.min(Date.now() + IDLE(), Date.parse(r.created_at) + ABS);
    if (next - Date.parse(r.expires_at) > 15000) await sb(`/admin_sessions?id=eq.${hex(t)}`, { method: "PATCH", body: { expires_at: new Date(next).toISOString() }, prefer: "return=minimal" }).catch(e => console.error("touch", e));
  }
  return { uid: r.uid, tok: t };
}

export default api(async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex");
  const a = String(req.query.a || ""), post = req.method === "POST", fail = (s, e) => res.status(s).json({ error: e });
  if (post) { // CSRF: custom header (cannot be sent cross-site without CORS) + same-origin check
    const host = req.headers["x-forwarded-host"] || req.headers.host, o = req.headers.origin;
    if (req.headers["x-chds-admin"] !== "1" || (o && o !== `https://${host}` && o !== `http://${host}`)) return fail(403, "forbidden");
  }
  const b = jsonBody(req);

  if (a === "login" && post) {
    if (await limited(req, "alogin", 8, 900)) return fail(429, "rate_limited");
    if (!ready()) return fail(503, "not_configured");
    const u = String(b.uid || "").trim();
    if (UID.test(u) && (await hit("alogin-u:" + u, 5, 900))) return fail(429, "rate_limited");
    const okU = ids(E.ADMIN_UIDS).has(u), okP = same(b.password || "", E.ADMIN_PASSWORD);
    await sleep(300 + Math.random() * 300);
    if (okU && okP) {
      const code = String(randomInt(0, 1e6)).padStart(6, "0");
      await sb("/admin_otps?on_conflict=uid", { method: "POST", body: { uid: u, code_hash: hex(code + u), attempts: 0, expires_at: new Date(Date.now() + 3e5).toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
      const r = await say(u, `🔐 <b>CHDS admin login</b>\nYour code: <code>${code}</code>\nValid for 5 minutes · IP ${clientIp(req)}\nIf this was not you, change ADMIN_PASSWORD now.`);
      if (!r.ok) return fail(502, "telegram");
    }
    return res.json({ ok: true, step: "otp" }); // identical answer for wrong credentials
  }

  if (a === "otp" && post) {
    if (await limited(req, "aotp", 10, 900)) return fail(429, "rate_limited");
    const u = String(b.uid || "").trim(), code = String(b.code || "").trim();
    if (!ready() || !UID.test(u) || !/^\d{6}$/.test(code)) return fail(401, "invalid");
    const row = (await sb(`/admin_otps?uid=eq.${u}&select=*`))[0];
    if (!row || Date.parse(row.expires_at) < Date.now() || row.attempts >= 5) { await sb(`/admin_otps?uid=eq.${u}`, { method: "DELETE" }); return fail(401, "invalid"); }
    if (!same(hex(code + u), row.code_hash)) { await sb(`/admin_otps?uid=eq.${u}`, { method: "PATCH", body: { attempts: row.attempts + 1 } }); await audit(u, "login_failed", { ip: clientIp(req) }); return fail(401, "invalid"); }
    await sb(`/admin_otps?uid=eq.${u}`, { method: "DELETE" });
    const tok = randomBytes(32).toString("hex");
    await sb("/admin_sessions", { method: "POST", body: { id: hex(tok), uid: u, ip: clientIp(req), expires_at: new Date(Date.now() + IDLE()).toISOString() }, prefer: "return=minimal" });
    setCookie(res, tok, 28800);
    await audit(u, "login", { ip: clientIp(req) });
    await say(u, `✅ <b>Admin login successful</b>\nIP ${clientIp(req)}. If this was not you, change ADMIN_PASSWORD and run Sign out everywhere.`);
    return res.json({ ok: true });
  }

  const ses = await session(req, !(a === "overview" && req.query.quiet === "1"));
  if (!ses) return fail(401, "unauthorized");

  if (a === "ping") return res.json({ ok: true, idle_ms: IDLE() });

  if (a === "logout" && post) {
    const all = b.all === true;
    await sb(all ? `/admin_sessions?uid=eq.${ses.uid}` : `/admin_sessions?id=eq.${hex(ses.tok)}`, { method: "DELETE" }); setCookie(res, "", 0); await audit(ses.uid, all ? "logout_all" : "logout");
    return res.json({ ok: true });
  }

  if (a === "overview") {
    const st = String(req.query.status || "all"), f = st === "pending" || st === "approved" ? `&status=eq.${st}` : "";
    const [stats, reports, pending, chats, log, wh] = await Promise.all([
      statsData(), sb(`/reports?order=created_at.desc&limit=200&select=*${f}`), sb("/reports?status=eq.pending&select=id"),
      sb("/sessions?order=updated_at.desc&limit=30&select=sid,name,status,joined,created_at,updated_at"),
      sb("/audit_log?order=id.desc&limit=60&select=*"), tg("getWebhookInfo", {})
    ]);
    return res.json({
      me: ses.uid, idle_ms: IDLE(), cur: cur(), stats, reports, pending: pending.length, audit: log,
      chats: chats.map(c => ({ sid: c.sid, name: c.name, status: c.status, updated_at: c.updated_at, agents: Object.values(c.joined || {}) })),
      sys: { groq_key: !!E.GROQ_API_KEY, groq_model: aiModels().join(", "), bot_token: !!E.BOT_TOKEN, webhook_secret: !!E.WEBHOOK_SECRET, team_uids: ids(E.ALLOWED_UIDS).size, admin_uids: ids(E.ADMIN_UIDS).size, webhook_url: wh.result?.url || "", webhook_pending: wh.result?.pending_update_count ?? null, webhook_error: wh.result?.last_error_message || "" }
    });
  }

  if (a === "chat") {
    const sid = String(req.query.sid || ""); if (!SID.test(sid)) return fail(400, "bad_request");
    return res.json({ messages: await sb(`/messages?sid=eq.${sid}&order=id.asc&limit=300&select=id,sender,author,body,created_at`) });
  }

  if (a === "act" && post) {
    const t = String(b.type || "");
    if (t === "approve" || t === "reject" || t === "delete") {
      const id = String(b.id || ""); if (!RID.test(id)) return fail(400, "bad_request");
      const r = (await sb(`/reports?id=eq.${id}&select=*`))[0]; if (!r) return fail(404, "not_found");
      if (t === "approve") {
        const x = await sb(`/reports?id=eq.${id}&status=eq.pending`, { method: "PATCH", body: { status: "approved", approved_at: new Date().toISOString() }, prefer: "return=representation" });
        if (!x.length) return fail(409, "already_handled");
        await say(r.uid, `✅ <b>Report approved</b>\n<code>${id}</code> is now live on the website.`);
      } else if (t === "reject") {
        const x = await sb(`/reports?id=eq.${id}&status=eq.pending`, { method: "DELETE", prefer: "return=representation" });
        if (!x.length) return fail(409, "already_handled");
        await say(r.uid, `❌ <b>Report not approved</b>\n<code>${id}</code> was rejected by an admin.`);
      } else {
        await sb(`/reports?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
        await say(r.uid, `🗑 An admin removed your report <code>${id}</code>.`);
      }
      await audit(ses.uid, t + "_report", { id, name: r.name, recovered: r.recovered, revenue: Number(r.revenue), date: r.report_date });
      return res.json({ ok: true });
    }
    if (t === "add") {
      const name = String(b.name || "").replace(/[<>]/g, "").trim().slice(0, 40) || "Team", rc = String(b.recovered ?? ""), rv = num(b.revenue), d = parseDate(String(b.date || ""));
      if (!/^\d{1,4}$/.test(rc) || rv === null || d.err) return fail(400, "invalid");
      const r = { id: "R" + randomBytes(4).toString("hex").slice(0, 5).toUpperCase(), uid: ses.uid, name, recovered: +rc, revenue: rv, report_date: d.d, status: "approved", approved_at: new Date().toISOString() };
      await sb("/reports", { method: "POST", body: r, prefer: "return=minimal" });
      await audit(ses.uid, "add_report", { id: r.id, name, recovered: r.recovered, revenue: rv, date: d.d });
      return res.json({ ok: true });
    }
    if (t === "close_chat") {
      const sid = String(b.sid || ""); if (!SID.test(sid)) return fail(400, "bad_request");
      const o = await rpc("end_session", { p_sid: sid });
      await Promise.allSettled((o.joined || []).map(u => say(u, `⏹ Chat <code>#${sid}</code> was closed by an admin.`)));
      await closeNotifs(o.notif, "⏹ <b>Session closed</b> by an admin.");
      await audit(ses.uid, "close_chat", { sid });
      return res.json({ ok: true });
    }
    if (t === "webhook") {
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const w = await tg("setWebhook", { url: `https://${host}/api/telegram`, secret_token: E.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], max_connections: 20 });
      const c = await tg("setMyCommands", { commands: COMMANDS }); await tg("setMyName", { name: "CHDS Report" });
      await audit(ses.uid, "connect_webhook", { ok: !!w.ok });
      return res.json({ ok: !!(w.ok && c.ok), error: w.ok ? undefined : w.description });
    }
    if (t === "test_ai") {
      const o = await aiChat([{ role: "user", content: "Reply with the single word OK." }], { max: 40, budget: 25000 });
      return res.json(o.ok ? { ok: true, detail: `AI answered using ${o.model}.` } : { ok: false, detail: o.detail || o.error });
    }
    return fail(400, "bad_request");
  }
  return fail(404, "not_found");
}, { cors: false });
