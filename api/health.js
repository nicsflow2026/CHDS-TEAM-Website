import { api, E, dbCheck, aiModels, aiChat, team, ids, teamConfigIssues, botToken, serviceKey, limited, sb } from "../lib/core.js";
import { timingSafeEqual, createHash } from "node:crypto";
const same = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());
export default api(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (await limited(req, "health", 20, 60)) return res.status(429).json({ error: "rate_limited" });
  const key = req.headers["x-setup-key"];
  if (!E.WEBHOOK_SECRET || !key || !same(key, E.WEBHOOK_SECRET)) {
    let ok = false; try { await sb("/system_settings?select=key&limit=1"); ok = true; } catch (e) { console.error("health db", String(e.message).slice(0, 120)); }
    return res.json({ ok: true, database_ok: ok });
  }
  const db = await dbCheck();
  const out = { ok: true, database_ok: db.ok, missing: db.missing, db_ms: db.ms, groq_key: !!E.GROQ_API_KEY, ai_models: aiModels(), bot_token: !!botToken(), webhook_secret: !!E.WEBHOOK_SECRET,
    supabase_env: !!(E.SUPABASE_URL && serviceKey()), team_uids: team().length, admin_uids: ids(E.ADMIN_UIDS).size, team_uid_errors: teamConfigIssues(),
    admin_panel_ready: !!((E.ADMIN_PASSWORD || "").length >= 12 && (E.SESSION_SECRET || "").length >= 24), app_url: !!E.APP_URL };
  if (req.query.ai) { const o = await aiChat([{ role: "user", content: "Reply with the single word OK." }], { max: 40, budget: 20000 }); out.ai_test = o.ok ? { ok: true, model: o.model } : { ok: false, error: o.error, detail: o.detail }; }
  res.json(out);
}, { name: "api/health" });
