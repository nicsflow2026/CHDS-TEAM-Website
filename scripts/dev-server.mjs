// Local development server that mimics Vercel: static files from public/ (cleanUrls + vercel.json headers)
// and /api/* routed to the real serverless handlers.
//   node scripts/dev-server.mjs            → uses your real .env / environment (Supabase, Telegram, Groq)
//   node scripts/dev-server.mjs --fake     → TEST ONLY: in-memory test double with fixture data (tests/support/fixtures.mjs)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
const PORT = Number((process.argv.find(a => a.startsWith("--port=")) || "--port=8787").split("=")[1]);
const FAKE = process.argv.includes("--fake");
if (FAKE) await (await import("../tests/support/fixtures.mjs")).install();
const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".txt": "text/plain", ".svg": "image/svg+xml", ".json": "application/json" };
const H = {
  ai: "../api/ai/[a].js", human: "../api/human/[a].js", admin: "../api/admin/[a].js", public: "../api/public/[a].js",
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
  if (FAKE && path === "/__test/last-otp") { // TEST DOUBLE ONLY: read the code the fake Telegram "sent"
    const m = [...globalThis.__fake.tg.sent].reverse().find(x => x.chat_id === u.searchParams.get("uid") && /Your code: <code>(\d{6})/.test(x.text));
    res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ code: m ? /<code>(\d{6})/.exec(m.text)[1] : null }));
  }
  if (path.startsWith("/api/")) {
    const seg = path.split("/").filter(Boolean), key = seg[1];
    if (!H[key]) { res.statusCode = 404; return res.end("{}"); }
    let raw = ""; for await (const c of req) raw += c;
    const query = Object.fromEntries(u.searchParams); if (seg[2]) query.a = seg[2];
    const r2 = Object.assign(req, { query, body: raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : undefined });
    const shim = Object.assign(res, { status(c) { res.statusCode = c; return shim; }, json(o) { if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return shim; }, send(s) { res.end(typeof s === "string" ? s : JSON.stringify(s)); return shim; } });
    try { await (await handler(key))(r2, shim); } catch (e) { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end("{}"); } }
    return;
  }
  let file = path === "/" ? "/index.html" : path;
  if (!extname(file)) file += ".html";
  try { const p = join("public", file); await stat(p); res.setHeader("content-type", MIME[extname(p)] || "application/octet-stream"); res.end(await readFile(p)); }
  catch { res.statusCode = 404; res.setHeader("content-type", MIME[".html"]); res.end(await readFile("public/404.html")); }
}).listen(PORT, () => console.log(`CHDS dev server on http://localhost:${PORT}${FAKE ? " (TEST DOUBLE — fixture data, not real)" : ""}`));
