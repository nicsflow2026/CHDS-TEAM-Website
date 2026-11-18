// Shared helpers: env, Supabase REST, Telegram
const E = process.env;
export { E };
export const ids = v => new Set(String(v || "").split(",").map(s => s.trim()).filter(Boolean));
export const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export const num = s => { const n = Number(String(s).replace(/[,₱$€£]/g, "")); return Number.isFinite(n) && n >= 0 && n <= 1e7 ? Math.round(n * 100) / 100 : null; };
export const money = n => (E.CURRENCY || "$") + Number(n).toLocaleString("en-US");
export const dayOf = t => new Date(t + (Number(E.TZ_OFFSET) || 0) * 36e5).toISOString().slice(0, 10);
export const team = () => [...new Set([...ids(E.ALLOWED_UIDS), ...ids(E.ADMIN_UIDS)])];
export const SID = /^[a-f0-9]{16}$/, RID = /^R[A-Z0-9]{5}$/, UID = /^\d{1,20}$/;

const base = () => (E.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
export async function sb(path, { method = "GET", body, prefer } = {}) {
  const k = (E.SUPABASE_SERVICE_KEY || "").trim();
  if (!base() || !k) throw new Error("supabase_not_configured");
  const r = await fetch(base() + "/rest/v1" + path, {
    method, signal: AbortSignal.timeout(8000),
    headers: { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} ${path.slice(0, 50)} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
export const rpc = (fn, args) => sb("/rpc/" + fn, { method: "POST", body: args });

export const tg = async (m, b) => {
  try {
    const r = await fetch(`https://api.telegram.org/bot${(E.BOT_TOKEN || "").trim()}/${m}`, { method: "POST", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return await r.json();
  } catch (e) { return { ok: false, description: String(e) }; }
};
export const say = (chat_id, text, extra = {}) => tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
export const edit = (q, text, extra = {}) => tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text, parse_mode: "HTML", ...extra });
export const closeNotifs = (notif, text) => Promise.allSettled((Array.isArray(notif) ? notif : []).map(([c, m]) => tg("editMessageText", { chat_id: c, message_id: m, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } })));

export const toBlob = u => {
  if (typeof u !== "string" || !u.startsWith("data:image/jpeg;base64,") || u.length > 1.3e6) return null;
  try { return new Blob([Buffer.from(u.slice(23), "base64")], { type: "image/jpeg" }); } catch { return null; }
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
    const j = await (await fetch(`https://api.telegram.org/bot${(E.BOT_TOKEN || "").trim()}/${method}`, { method: "POST", body: fd, signal: AbortSignal.timeout(20000) })).json();
    if (!j.ok) return null;
    return items.length === 1 ? [j.result.photo.at(-1).file_id] : j.result.map(x => x.photo.at(-1).file_id);
  } catch { return null; }
}

export const api = (fn, o = {}) => async (req, res) => {
  if (E.ALLOWED_ORIGIN && o.cors !== false) {
    res.setHeader("Access-Control-Allow-Origin", E.ALLOWED_ORIGIN); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  try { await fn(req, res); } catch (e) {
    console.error(e);
    if (res.headersSent) return;
    // Missing table/function in Supabase (supabase.sql not run, or the API schema cache is stale)
    if (/PGRST20[25]|42P01|42883|schema cache|does not exist/i.test(String(e && e.message))) return res.status(503).json({ error: "db_not_migrated" });
    res.status(500).json({ error: "server_error" });
  }
};
export const jsonBody = req => { let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } } return b && typeof b === "object" ? b : {}; };

// Vercel sets x-vercel-forwarded-for itself (cannot be spoofed by the client)
export const clientIp = req => String(req.headers["x-vercel-forwarded-for"] || req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
export const hit = async (key, max, win) => { try { return !!(await rpc("rate_hit", { p_key: key, p_max: max, p_win: win })); } catch { return false; } };
export const limited = (req, tag, max, win) => hit(tag + ":" + clientIp(req), max, win);
export const audit = (actor, action, detail = {}) => sb("/audit_log", { method: "POST", body: { actor: String(actor), action, detail }, prefer: "return=minimal" }).catch(e => console.error("audit", e));
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
export async function aiChat(messages, { max = 600, budget = 26000 } = {}) {
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
        : { model, temperature: 0.3, max_completion_tokens: max + 600, reasoning_effort: "low", include_reasoning: false, messages };
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
export const REQUIRED_TABLES = ["reports", "sessions", "messages", "agents", "bot_state", "tg_updates", "rate_limits", "admin_sessions", "admin_otps", "audit_log"];
export async function dbCheck() {
  const missing = [];
  try { await rpc("stats_json", { p_from: "2000-01-01" }); } catch (e) { console.error("db stats_json", e); missing.push("function:stats_json"); }
  await Promise.all(REQUIRED_TABLES.map(t => sb(`/${t}?select=*&limit=0`).catch(e => { console.error("db table", t, String(e.message).slice(0, 120)); missing.push(t); })));
  return { ok: missing.length === 0, missing };
}
