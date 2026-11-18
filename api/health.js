import { api, E, dbCheck, aiModels, team, ids } from "../lib/core.js";
export default api(async (req, res) => {
  const db = await dbCheck();
  res.setHeader("Cache-Control", "no-store");
  if (!E.WEBHOOK_SECRET || req.headers["x-setup-key"] !== E.WEBHOOK_SECRET) return res.json({ ok: true, database_ok: db.ok });
  res.json({ ok: true, database_ok: db.ok, missing: db.missing, groq_key: !!E.GROQ_API_KEY, ai_models: aiModels(), bot_token: !!E.BOT_TOKEN, webhook_secret: !!E.WEBHOOK_SECRET, supabase_env: !!(E.SUPABASE_URL && E.SUPABASE_SERVICE_KEY), team_uids: team().length, admin_uids: ids(E.ADMIN_UIDS).size, admin_panel_ready: !!((E.ADMIN_PASSWORD || "").length >= 12 && (E.SESSION_SECRET || "").length >= 24) });
});
