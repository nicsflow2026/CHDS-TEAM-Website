// Static checks: syntax of every JS file, module linking of server code, and a secret scan of public/.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let bad = 0;
for (const f of [...walk("api"), ...walk("lib"), ...walk("public/assets"), ...walk("scripts"), ...walk("tests")].filter(f => /\.m?js$/.test(f))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { bad++; console.log("SYNTAX", f, String(e.stderr).split("\n")[0]); }
}
for (const f of [...walk("api"), ...walk("lib")].filter(f => f.endsWith(".js"))) {
  try { await import("../" + f); } catch (e) { bad++; console.log("LINK", f, e.message); }
}
// Secret exposure scan of everything Vercel serves publicly
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, /gsk_[A-Za-z0-9]{20,}/, /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/, /SUPABASE_SERVICE/, /SESSION_SECRET\s*[=:]/, /ADMIN_PASSWORD\s*[=:]/, /WEBHOOK_SECRET\s*[=:]/, /service_role/, /sourceMappingURL/, /BEGIN (RSA |EC )?PRIVATE KEY/];
const pub = walk("public");
for (const f of pub) { if (/\.(png|webp|jpg)$/.test(f)) continue; const t = readFileSync(f, "utf8"); for (const re of SECRET) if (re.test(t)) { bad++; console.log("SECRET?", f, re); } }
if (pub.some(f => /\.(env|json|sql|map|bak|log)$/i.test(f))) { bad++; console.log("Unexpected file type in public/:", pub.filter(f => /\.(env|json|sql|map|bak|log)$/i.test(f))); }
if (/TEAM\s*=\s*\[/.test(readFileSync("public/assets/config.js", "utf8"))) { bad++; console.log("Hardcoded team list still in config.js"); }
console.log(bad ? `${bad} problem(s)` : `OK: syntax, module linking and public/ secret scan (${pub.length} public files)`);
process.exit(bad ? 1 : 0);
