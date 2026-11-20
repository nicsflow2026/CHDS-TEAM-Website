import { envReport } from "../lib/core.js";
const r = envReport(), prod = process.env.VERCEL_ENV === "production";
for (const m of r.errors) console.error((prod ? "ERROR " : "WARN  ") + m);
for (const m of r.warnings) console.warn("WARN  " + m);
console.log(r.ok ? "Environment OK." : `${r.errors.length} required setting(s) missing.`);
process.exit(!r.ok && prod ? 1 : 0);
