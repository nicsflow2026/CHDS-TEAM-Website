// Static checks: syntax of every JS file, module linking of server code, and a secret scan of public/.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, matchesGlob as nodeGlob } from "node:path";
// Same semantics as Vercel's glob matching: "*" stays inside one folder, "**/" spans folders, "[...]" is a character class.
const toRe = g => new RegExp("^" + g.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*\*\//g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, "(?:.*/)?") + "$");
const matchesGlob = (f, g) => (typeof nodeGlob === "function" ? nodeGlob(f, g) : toRe(g).test(f));
import { execFileSync } from "node:child_process";
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let bad = 0;
for (const f of [...walk("api"), ...walk("lib"), ...walk("public/assets"), ...walk("scripts"), ...walk("tests")].filter(f => /\.m?js$/.test(f))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { bad++; console.log("SYNTAX", f, String(e.stderr).split("\n")[0]); }
}
for (const f of [...walk("api"), ...walk("lib")].filter(f => f.endsWith(".js"))) {
  try { await import("../" + f); } catch (e) { bad++; console.log("LINK", f, e.message); }
}
// vercel.json: catch configuration errors that otherwise only appear in Vercel's deploy logs
{
  const vj = JSON.parse(readFileSync("vercel.json", "utf8")), pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const KEYS = ["$schema", "buildCommand", "installCommand", "devCommand", "outputDirectory", "framework", "cleanUrls", "trailingSlash", "functions", "headers", "rewrites", "redirects", "regions", "crons", "public", "github", "git"];
  for (const k of Object.keys(vj)) if (!KEYS.includes(k)) { bad++; console.log(`VERCEL unknown vercel.json property "${k}"`); }
  const fns = walk("api").map(f => f.split("\\").join("/")).filter(f => /\.(m?js|ts)$/.test(f)), pats = Object.keys(vj.functions || {});
  for (const p of pats) {
    if (!fns.some(f => matchesGlob(f, p))) { bad++; console.log(`VERCEL functions pattern "${p}" matches no file in api/ — Vercel stops the deploy. "[...]" is a glob character class; use a wildcard such as api/admin/*.js`); }
    if (vj.functions[p].maxDuration > 60) console.log(`NOTE  ${p}: maxDuration ${vj.functions[p].maxDuration}s needs a paid plan or Fluid compute`);
  }
  for (const f of fns) { const m = pats.filter(p => matchesGlob(f, p)); if (m.length > 1) { bad++; console.log(`VERCEL ${f} is matched by ${m.length} functions patterns (${m.join(", ")}) — ambiguous settings`); } }
  const lone = walk("api").filter(f => !/\.(m?js|ts)$/.test(f)); if (lone.length) { bad++; console.log("VERCEL non-function files inside api/:", lone); }
  if (!/^\d+\.x$/.test(String(pkg.engines && pkg.engines.node))) { bad++; console.log(`VERCEL package.json engines.node "${pkg.engines && pkg.engines.node}" should be a pinned major such as "22.x" (ranges like ">=20" auto-upgrade and log a warning)`); }
  if (vj.outputDirectory && !statSync(vj.outputDirectory, { throwIfNoEntry: false })) { bad++; console.log(`VERCEL outputDirectory "${vj.outputDirectory}" does not exist`); }
  if (vj.buildCommand) { const m = /node (\S+)/.exec(vj.buildCommand); if (m && !statSync(m[1], { throwIfNoEntry: false })) { bad++; console.log(`VERCEL buildCommand script ${m[1]} not found`); } }
  for (const h of vj.headers || []) if (!h.source.startsWith("/")) { bad++; console.log(`VERCEL header source "${h.source}" must start with /`); }
  console.log(`vercel.json: ${pats.length} function patterns cover ${fns.length} functions, each matched exactly once`);
}
// Secret exposure scan of everything Vercel serves publicly
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, /gsk_[A-Za-z0-9]{20,}/, /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/, /SUPABASE_SERVICE/, /SESSION_SECRET\s*[=:]/, /ADMIN_PASSWORD\s*[=:]/, /WEBHOOK_SECRET\s*[=:]/, /service_role/, /sourceMappingURL/, /BEGIN (RSA |EC )?PRIVATE KEY/];
const pub = walk("public");
for (const f of pub) { if (/\.(png|webp|jpg)$/.test(f)) continue; const t = readFileSync(f, "utf8"); for (const re of SECRET) if (re.test(t)) { bad++; console.log("SECRET?", f, re); } }
if (pub.some(f => /\.(env|json|sql|map|bak|log)$/i.test(f))) { bad++; console.log("Unexpected file type in public/:", pub.filter(f => /\.(env|json|sql|map|bak|log)$/i.test(f))); }
if (/TEAM\s*=\s*\[/.test(readFileSync("public/assets/config.js", "utf8"))) { bad++; console.log("Hardcoded team list still in config.js"); }
console.log(bad ? `${bad} problem(s)` : `OK: syntax, module linking and public/ secret scan (${pub.length} public files)`);
process.exit(bad ? 1 : 0);
