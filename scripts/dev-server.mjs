import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
const PORT = Number((process.argv.find(a => a.startsWith("--port=")) || "--port=8787").split("=")[1]);
const FAKE = process.argv.includes("--fake");
if (FAKE) await (await import("../tests/support/fixtures.mjs")).install();
const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".txt": "text/plain", ".svg": "image/svg+xml", ".json": "application/json" };
const H = {
  ai: "../api/ai/[a].js", admin: "../api/admin/[a].js", public: "../api/public/[a].js", portal: "../api/portal/[a].js",
  chat: "../api/chat.js", stats: "../api/stats.js", health: "../api/health.js", setup: "../api/setup.js", telegram: "../api/telegram.js"
};
const cache = {};
const handler = async k => (cache[k] ||= (await import(H[k])).default);
function headersFor(path) {
  const out = {};
  for (const h of vercel.headers) { const re = new RegExp("^" + h.source.replace(/\(\.\*\)/g, "(.*)") + "$"); if (re.test(path)) for (const x of h.headers) out[x.key] = x.value; }
  delete out["Strict-Transport-Security"]; return out;
}
createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost"), path = decodeURIComponent(u.pathname);
  for (const [k, v] of Object.entries(headersFor(path))) res.setHeader(k, v);
  if (FAKE && path === "/__test/last-otp") {
    const m = [...globalThis.__fake.tg.sent].reverse().find(x => x.chat_id === u.searchParams.get("uid") && /(Your code|sign-in code): <code>(\d{6})/.test(x.text));
    res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ code: m ? /<code>(\d{6})/.exec(m.text)[1] : null }));
  }
  if (FAKE && path === "/__test/seed-case") {
    const f = globalThis.__fake, conv = f.t("ai_support_conversations").find(c => c.id === u.searchParams.get("conv"));
    res.setHeader("content-type", "application/json");
    if (!conv) { res.statusCode = 404; return res.end('{"error":"not_found"}'); }
    const id = "HS-" + Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, "X"), sid = Math.random().toString(16).slice(2, 18).padEnd(16, "0");
    const o = f.RPC.create_handoff({ p: { id, sid, conversation_id: conv.id, user_id: conv.user_id, reason: "user_requested", category: "general", summary: { generated_by: "fixture", summary: "Seeded for a UI test." }, idempotency_key: "seed-" + id + "-xxxxxxxx", quota_keys: ["seed:" + id], limit: 100000, cooldown_min: 0 } });
    return res.end(JSON.stringify(o.error ? o : { rid: id, sid }));
  }
  if (FAKE && path === "/__test/reset-limits") {
    globalThis.__fake.T.rate_limits = []; globalThis.__fake.T.support_rate_limits = []; res.setHeader("content-type", "application/json"); return res.end('{"ok":true}');
  }
  if (FAKE && path === "/__test/reset-quota") {
    globalThis.__fake.T.support_rate_limits = []; res.setHeader("content-type", "application/json"); return res.end('{"ok":true}');
  }
  if (FAKE && path.startsWith("/__fake-storage/")) {
    const m = /^\/__fake-storage\/object\/(?:public|sign)\/(.+)$/.exec(u.pathname), key = m ? "/object/" + m[1] : null, b = key && globalThis.__fake.storage.get(key);
    if (!b) { res.statusCode = 404; return res.end(); }
    res.setHeader("content-type", /\.png$/.test(key) ? "image/png" : /\.webp$/.test(key) ? "image/webp" : /\.pdf$/.test(key) ? "application/pdf" : "image/jpeg"); res.setHeader("cache-control", "max-age=300"); return res.end(b);
  }
  if (path.startsWith("/api/")) {
    const seg = path.split("/").filter(Boolean), key = seg[1];
    if (!H[key]) { res.statusCode = 404; return res.end("{}"); }
    let raw = ""; for await (const c of req) raw += c;
    const query = Object.fromEntries(u.searchParams); if (seg[2]) query.a = seg[2];
    const r2 = Object.assign(req, { query, body: raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : undefined });
    const out = o => { const t = JSON.stringify(o); return FAKE ? t.replaceAll("https://fake.supabase.co/storage/v1", `http://localhost:${PORT}/__fake-storage`) : t; };
    const shim = Object.assign(res, { status(c) { res.statusCode = c; return shim; }, json(o) { if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json"); res.end(out(o)); return shim; }, send(s) { res.end(typeof s === "string" ? s : JSON.stringify(s)); return shim; } });
    try { await (await handler(key))(r2, shim); } catch (e) { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end("{}"); } }
    return;
  }
  let file = path === "/" ? "/index.html" : path;
  if (!extname(file)) file += ".html";
  try { const p = join("public", file); await stat(p); res.setHeader("content-type", MIME[extname(p)] || "application/octet-stream"); res.end(await readFile(p)); }
  catch { res.statusCode = 404; res.setHeader("content-type", MIME[".html"]); res.end(await readFile("public/404.html")); }
}).listen(PORT, () => console.log(`CHDS dev server on http://localhost:${PORT}${FAKE ? " (TEST DOUBLE — fixture data, not real)" : ""}`));
