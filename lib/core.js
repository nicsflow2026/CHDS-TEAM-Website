// Shared helpers: env, Supabase REST, Telegram, API wrapper, audit. Server-only (never shipped to the browser).
import { createHash, randomBytes } from "node:crypto";
const E = process.env;
export { E };

/* ---------------- env ---------------- */
// Accept both the original variable names and the names used in the upgrade spec.
export const botToken = () => (E.BOT_TOKEN || E.TELEGRAM_BOT_TOKEN || "").trim();
export const serviceKey = () => (E.SUPABASE_SERVICE_KEY || E.SUPABASE_SERVICE_ROLE_KEY || "").trim();
export const UID = /^\d{1,20}$/;
// Comma-separated Telegram UIDs -> { valid:Set, invalid:[] }. Spaces and empty entries are ignored.
export const parseUids = v => {
  const valid = new Set(), invalid = [];
  for (const s of String(v || "").split(",").map(x => x.trim()).filter(Boolean)) (UID.test(s) ? valid.add(s) : invalid.push(s.slice(0, 24)));
  return { valid, invalid };
};
export const ids = v => parseUids(v).valid;
// Telegram team = ALLOWED_UIDS + ADMIN_UIDS + TELEGRAM_TEAM_UIDS (de-duplicated, validated)
export const team = () => [...new Set([...ids(E.ALLOWED_UIDS), ...ids(E.ADMIN_UIDS), ...ids(E.TELEGRAM_TEAM_UIDS)])];
export const teamConfigIssues = () => ["ALLOWED_UIDS", "ADMIN_UIDS", "TELEGRAM_TEAM_UIDS"].flatMap(k => parseUids(E[k]).invalid.map(v => `${k}: "${v}" is not a numeric Telegram user ID`));
export const appUrl = () => String(E.APP_URL || "").trim().replace(/\/+$/, "");

/* ---------------- formatting ---------------- */
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const num = s => { const n = Number(String(s).replace(/[,₱$€£\s]/g, "")); return String(s ?? "").trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1e7 ? Math.round(n * 100) / 100 : null; };
// Philippine peso by default. An old CURRENCY=$ value left in Vercel is treated as unset.
export const cur = () => { const c = (E.CURRENCY || "").trim(); return !c || c === "$" ? "₱" : c; };
export const money = n => cur() + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const tzo = () => (String(E.TZ_OFFSET ?? "").trim() === "" ? 8 : Number(E.TZ_OFFSET) || 0); // default UTC+8 (Philippines)
export const dayOf = t => new Date(t + tzo() * 36e5).toISOString().slice(0, 10);
export const SID = /^[a-f0-9]{16}$/, RID = /^R[A-Z0-9]{5}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, HSID = /^HS-[A-Z0-9]{8}$/;
export const sha256 = s => createHash("sha256").update(s).digest("hex");
export const rid = (prefix, n = 8) => prefix + randomBytes(n).toString("hex").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n);

/* ---------------- Supabase REST ---------------- */
export const sbBase = () => (E.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
export class DbError extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }
// opts: { method, body, prefer, count:true -> returns {rows,total}, timeout }
export async function sb(path, { method = "GET", body, prefer, count, timeout = 8000 } = {}) {
  const k = serviceKey();
  if (!sbBase() || !k) throw new Error("supabase_not_configured");
  const pf = [prefer, count ? "count=exact" : ""].filter(Boolean).join(",");
  const r = await fetch(sbBase() + "/rest/v1" + path, {
    method, signal: AbortSignal.timeout(timeout),
    headers: { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json", ...(pf ? { Prefer: pf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) {
    let code = ""; try { code = JSON.parse(t).code || ""; } catch { /* non-JSON error body */ }
    throw new DbError(r.status, code, `supabase ${r.status} ${code} ${path.slice(0, 60)} ${t.slice(0, 200)}`);
  }
  const data = t ? JSON.parse(t) : null;
  if (!count) return data;
  const m = /\/(\d+|\*)$/.exec(r.headers.get("content-range") || "");
  return { rows: data || [], total: m && m[1] !== "*" ? Number(m[1]) : (data || []).length };
}
export const rpc = (fn, args) => sb("/rpc/" + fn, { method: "POST", body: args });
export const isUnique = e => e instanceof DbError && (e.code === "23505" || (e.status === 409 && e.code !== "PT409"));
// The database refused a write because the Human Support case is closed (triggers raise SQLSTATE PT409 → HTTP 409).
export const isCaseClosed = e => e instanceof DbError && (e.code === "PT409" || /case_closed/.test(e.message));
export const q = encodeURIComponent;
// Escape a value for PostgREST ilike filters (*, %, commas and parentheses break the filter grammar)
export const like = s => q("*" + String(s).replace(/[*%,()\\:"]/g, " ").trim() + "*");

/* ---------------- Telegram ---------------- */
export const tg = async (m, b) => {
  const tok = botToken();
  if (!tok) return { ok: false, description: "BOT_TOKEN not configured" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${tok}/${m}`, { method: "POST", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return await r.json();
  } catch (e) { return { ok: false, description: String(e).slice(0, 200) }; }
};
export const say = (chat_id, text, extra = {}) => tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
export const edit = (q2, text, extra = {}) => tg("editMessageText", { chat_id: q2.message.chat.id, message_id: q2.message.message_id, text, parse_mode: "HTML", ...extra });
export const closeNotifs = (notif, text) => Promise.allSettled((Array.isArray(notif) ? notif : []).map(([c, m]) => tg("editMessageText", { chat_id: c, message_id: m, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } })));

export const toBlob = u => {
  if (typeof u !== "string" || !u.startsWith("data:image/jpeg;base64,") || u.length > 1.3e6) return null;
  try { const b = Buffer.from(u.slice(23), "base64"); return b[0] === 0xff && b[1] === 0xd8 ? new Blob([b], { type: "image/jpeg" }) : null; } catch { return null; }
};
// items: [{b:Blob}|{f:fileId}] -> array of file_ids (or null on failure)
export async function photos(chat, items, caption) {
  const fd = new FormData(); fd.set("chat_id", String(chat));
  let method = "sendPhoto";
  if (items.length === 1) {
    const it = items[0]; it.b ? fd.set("photo", it.b, "shot.jpg") : fd.set("photo", it.f);
    if (caption) { fd.set("caption", caption); fd.set("parse_mode", "HTML"); }
  } else {
    method = "sendMediaGroup";
    fd.set("media", JSON.stringify(items.map((it, i) => { if (it.b) { fd.set("f" + i, it.b, `shot${i}.jpg`); return { type: "photo", media: "attach://f" + i }; } return { type: "photo", media: it.f }; })));
  }
  try {
    const j = await (await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, { method: "POST", body: fd, signal: AbortSignal.timeout(20000) })).json();
    if (!j.ok) { console.error("telegram photos", j.description); return null; }
    return items.length === 1 ? [j.result.photo.at(-1).file_id] : j.result.map(x => x.photo.at(-1).file_id);
  } catch (e) { console.error("telegram photos", String(e).slice(0, 120)); return null; }
}

/* ---------------- request helpers ---------------- */
export const jsonBody = req => { let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } } return b && typeof b === "object" && !Array.isArray(b) ? b : {}; };
// Vercel sets x-vercel-forwarded-for itself (cannot be spoofed by the client)
export const clientIp = req => String(req.headers["x-vercel-forwarded-for"] || req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "x").split(",")[0].trim().slice(0, 64);
export const userAgent = req => String(req.headers["user-agent"] || "").slice(0, 200);
export const reqMeta = req => ({ ip: clientIp(req), user_agent: userAgent(req), request_id: String(req.headers["x-vercel-id"] || "").slice(0, 80) || null });
export const cookies = req => Object.fromEntries(String(req.headers.cookie || "").split(";").filter(c => c.includes("=")).map(c => { const i = c.indexOf("="); return [c.slice(0, i).trim(), c.slice(i + 1).trim()]; }));
// Same-origin + custom header check for state-changing browser requests (CSRF defence)
export const sameOrigin = (req, header) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host, o = req.headers.origin;
  return req.headers[header] === "1" && (!o || o === `https://${host}` || o === `http://${host}`);
};

// rate limit (fixed window). Fails OPEN on database errors so a DB hiccup does not take the site down;
// login uses login_guard (fails closed) instead.
export const hit = async (key, max, win) => { try { return !!(await rpc("rate_hit", { p_key: key, p_max: max, p_win: win })); } catch (e) { console.error("rate_hit", String(e.message).slice(0, 120)); return false; } };
// Logs a failure that is deliberately non-fatal and returns a fallback value (never a silent catch).
export const warn = (tag, fallback = null) => e => { console.error("[non-fatal]", tag, String((e && e.message) || e).slice(0, 200)); return fallback; };
// Rate limit by client IP. A blocked request is recorded as a security event (at most once per 10 min per route+IP).
export const limited = async (req, tag, max, win) => {
  const ip = clientIp(req), over = await hit(tag + ":" + ip, max, win);
  if (over && !(await hit("sec-rl:" + tag + ":" + ip, 1, 600))) await securityEvent("rate_limited", { severity: "warning", req, detail: { route: tag, limit: max, window_s: win } });
  return over;
};

export async function securityEvent(type, { severity = "info", actor = null, req = null, detail = {} } = {}) {
  try {
    await sb("/security_events", { method: "POST", body: { type, severity, actor, ip: req ? clientIp(req) : null, user_agent: req ? userAgent(req) : null, detail }, prefer: "return=minimal" });
  } catch (e) { console.error("security_event", type, String(e.message).slice(0, 120)); }
}

export async function logError(route, e, detail = {}) {
  console.error(route, e);
  try { await sb("/app_errors", { method: "POST", body: { route: String(route).slice(0, 80), message: String((e && e.message) || e).slice(0, 500), detail }, prefer: "return=minimal", timeout: 3000 }); }
  catch (e2) { console.error("app_errors insert failed", String(e2.message).slice(0, 120)); }
}

export const api = (fn, o = {}) => async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (E.ALLOWED_ORIGIN && o.cors !== false) {
    res.setHeader("Access-Control-Allow-Origin", E.ALLOWED_ORIGIN); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-CHDS-Client"); res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  try { await fn(req, res); } catch (e) {
    if (res.headersSent) { console.error(e); return; }
    // Missing table/function in Supabase (migration not run, or the API schema cache is stale)
    if (/PGRST20[25]|42P01|42883|schema cache|does not exist/i.test(String(e && e.message))) { console.error(e); return res.status(503).json({ error: "db_not_migrated" }); }
    if (String(e && e.message) === "supabase_not_configured") return res.status(503).json({ error: "not_configured" });
    await logError(o.name || String(req.url || "").split("?")[0], e);
    res.status(500).json({ error: "server_error" });
  }
};

/* ---------------- audit ---------------- */
// actor: "tg:<uid>" | "admin:<uid>" | "portal:<uid>" | "visitor:<uuid>" | "system". Audit rows are append-only (DB trigger).
export async function audit(actor, action, detail = {}, extra = {}) {
  const { target = null, prev = null, next = null, req = null, role = null } = extra;
  try {
    await sb("/audit_log", { method: "POST", body: { actor: String(actor), action, detail, target: target === null ? null : String(target), prev, next, ...(role ? { actor_role: String(role) } : {}), ...(req ? reqMeta(req) : {}) }, prefer: "return=minimal" });
    return true;
  } catch (e) { console.error("audit", action, e); return false; }
}

/* ---------------- settings / emergency flags ---------------- */
export const EMERGENCY_DEFAULTS = { maintenance_mode: false, human_requests_disabled: false, reports_disabled: false, revenue_edits_locked: false, telegram_notifications_disabled: false, ai_disabled: false };
export const SETTINGS_DEFAULTS = { support: { request_limit: 3, cooldown_minutes: 60, handoff_after_failures: 2, first_response_minutes: 15, resolution_hours: 24 }, site: { announcement_banner: true }, ai: { instructions: "" } };
let settingsCache = null;
export async function settings({ fresh = false } = {}) {
  if (!fresh && settingsCache && Date.now() - settingsCache.t < 5000) return settingsCache.v;
  const rows = await sb("/system_settings?select=key,value");
  const by = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const v = { emergency: { ...EMERGENCY_DEFAULTS, ...(by.emergency || {}) }, support: { ...SETTINGS_DEFAULTS.support, ...(by.support || {}) }, site: { ...SETTINGS_DEFAULTS.site, ...(by.site || {}) }, ai: { ...SETTINGS_DEFAULTS.ai, ...(by.ai || {}) } };
  settingsCache = { t: Date.now(), v };
  return v;
}
export const clearSettingsCache = () => { settingsCache = null; };

/* ---------------- environment validation (startup + deployment) ---------------- */
export function envReport(env = process.env) {
  const errors = [], warnings = [], has = k => String(env[k] || "").trim() !== "";
  if (!has("SUPABASE_URL")) errors.push("SUPABASE_URL is missing.");
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?(rest\/v1\/?)?$/i.test(String(env.SUPABASE_URL).trim())) warnings.push("SUPABASE_URL does not look like https://<project>.supabase.co");
  if (!has("SUPABASE_SERVICE_KEY") && !has("SUPABASE_SERVICE_ROLE_KEY")) errors.push("SUPABASE_SERVICE_KEY (service_role key) is missing.");
  if (!has("BOT_TOKEN") && !has("TELEGRAM_BOT_TOKEN")) errors.push("BOT_TOKEN is missing.");
  else if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN).trim())) warnings.push("BOT_TOKEN does not look like a Telegram bot token.");
  if (!has("WEBHOOK_SECRET")) errors.push("WEBHOOK_SECRET is missing.");
  else if (!/^[A-Za-z0-9_-]{16,256}$/.test(String(env.WEBHOOK_SECRET))) warnings.push("WEBHOOK_SECRET should be 16+ characters of A-Z a-z 0-9 _ - (Telegram's rule).");
  if (!has("GROQ_API_KEY")) errors.push("GROQ_API_KEY is missing.");
  if (String(env.SESSION_SECRET || "").length < 24) errors.push("SESSION_SECRET must be at least 24 characters (40+ recommended).");
  if (!parseUids(env.ADMIN_UIDS).valid.size) errors.push("ADMIN_UIDS must contain at least one numeric Telegram user ID (the founder).");
  if (String(env.ADMIN_PASSWORD || "").length < 12) warnings.push("ADMIN_PASSWORD is shorter than 12 characters: ADMIN_UIDS founders can sign in only after setting a personal password.");
  for (const k of ["ALLOWED_UIDS", "ADMIN_UIDS", "TELEGRAM_TEAM_UIDS"]) for (const v of parseUids(env[k]).invalid) warnings.push(`${k}: "${v}" is not a numeric Telegram user ID and is ignored.`);
  if (!parseUids(env.TELEGRAM_TEAM_UIDS).valid.size && !parseUids(env.ALLOWED_UIDS).valid.size) warnings.push("No TELEGRAM_TEAM_UIDS / ALLOWED_UIDS: only ADMIN_UIDS will receive Human Support alerts.");
  if (!has("APP_URL")) warnings.push("APP_URL is not set: Telegram alerts will not include a dashboard link.");
  else if (!/^https:\/\//.test(String(env.APP_URL))) warnings.push("APP_URL should start with https://");
  if (has("TZ_OFFSET") && !/^-?\d{1,2}$/.test(String(env.TZ_OFFSET).trim())) warnings.push("TZ_OFFSET must be a whole number of hours (8 for the Philippines).");
  return { ok: errors.length === 0, errors, warnings };
}
// Startup check: logged once per cold start (never prints values).
if (process.env.VERCEL) { const r = envReport(); for (const m of r.errors) console.error("[env] " + m); for (const m of r.warnings) console.warn("[env] " + m); }

export async function statsData() {
  const s = await rpc("stats_json", { p_from: dayOf(Date.now() - 29 * 864e5) }), by = {}, series = [];
  for (const r of s.rows) by[r.d] = r;
  for (let i = 29; i >= 0; i--) { const d = dayOf(Date.now() - i * 864e5), r = by[d]; series.push({ d, revenue: r ? Number(r.revenue) : 0, recovered: r ? Number(r.recovered) : 0 }); }
  return { totals: { recovered: Number(s.totals.recovered), revenue: Number(s.totals.revenue), reports: Number(s.totals.reports) }, series, recent: s.recent, updated: Date.now() };
}

// ---------- AI (Groq, OpenAI gpt-oss models) ----------
// Models are tried in order. Override with GROQ_MODELS="model1,model2" (the old GROQ_MODEL variable is ignored on purpose).
export const aiModels = () => {
  const l = String(E.GROQ_MODELS || "").split(",").map(x => x.trim()).filter(Boolean);
  return l.length ? l : ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
};
const stripThink = t => String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
// messages: [{role, content}] (system first). Returns { ok, reply, model } or { ok:false, error, detail }.
export async function aiChat(messages, { max = 600, budget = 26000, json = false } = {}) {
  const key = (E.GROQ_API_KEY || "").trim();
  if (!key) return { ok: false, error: "not_configured", detail: "GROQ_API_KEY is not set." };
  const t0 = Date.now(); let last = "no response";
  for (const model of aiModels()) {
    for (const lean of [false, true]) { // second pass = plain request without reasoning options, in case Groq rejects them
      const left = budget - (Date.now() - t0);
      if (left < 2500) return { ok: false, error: "timeout", detail: last };
      // gpt-oss are reasoning models: reasoning tokens count against the limit, so keep effort low and the limit generous
      const body = lean
        ? { model, temperature: 0.3, max_tokens: max + 600, messages }
        : { model, temperature: 0.3, max_completion_tokens: max + 600, reasoning_effort: "low", include_reasoning: false, messages, ...(json ? { response_format: { type: "json_object" } } : {}) };
      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", signal: AbortSignal.timeout(Math.min(left, 14000)),
          headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        if (r.ok) {
          const j = await r.json(), c = j.choices?.[0], t = stripThink(c?.message?.content);
          if (t) return { ok: true, reply: t, model };
          last = `${model}: empty reply (${c?.finish_reason || "?"})`; console.error("groq", last); break;
        }
        const d = (await r.text()).slice(0, 300); last = `${model}: ${r.status} ${d}`; console.error("groq", last);
        if (r.status === 401 || r.status === 403) return { ok: false, error: "bad_key", detail: `Groq rejected the API key (${r.status}). Create a new key at console.groq.com.` };
        if ((r.status === 400 || r.status === 422) && !lean) continue; // retry this model without reasoning options
        break; // 404 / 429 / 5xx -> next model
      } catch (e) { last = `${model}: ${String(e).slice(0, 120)}`; console.error("groq", last); break; }
    }
  }
  return { ok: false, error: "upstream", detail: last };
}

// ---------- database health ----------
export const REQUIRED_TABLES = ["reports", "sessions", "messages", "agents", "bot_state", "tg_updates", "rate_limits", "admin_sessions", "admin_otps", "audit_log",
  "system_settings", "roles", "admin_users", "team_members", "revenue_records", "ai_support_users", "ai_support_conversations", "ai_support_messages",
  "ai_handoff_requests", "notification_log", "support_rate_limits", "security_events", "announcements", "backups", "report_history",
  "portal_sessions", "portal_otps", "ai_knowledge", "support_quick_replies", "staff_notifications", "public_report_feed"];
export async function dbCheck() {
  const missing = [], t0 = Date.now();
  try { await rpc("stats_json", { p_from: "2000-01-01" }); } catch (e) { console.error("db stats_json", String(e.message).slice(0, 120)); missing.push("function:stats_json"); }
  try { await rpc("support_quota", { p_keys: [], p_limit: 3, p_cooldown_min: 60, p_consume: false }); } catch (e) { console.error("db support_quota", String(e.message).slice(0, 120)); missing.push("migration:002"); }
  try { await rpc("revenue_promote_due", { p_today: "2000-01-01" }); } catch (e) { console.error("db 003", String(e.message).slice(0, 120)); missing.push("migration:003"); }
  await Promise.all(REQUIRED_TABLES.map(t => sb(`/${t}?select=*&limit=0`).catch(e => { console.error("db table", t, String(e.message).slice(0, 120)); missing.push(t); })));
  return { ok: missing.length === 0, missing, ms: Date.now() - t0 };
}
