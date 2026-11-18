import { api, E, rpc, team, ids } from "../lib/core.js";
export default api(async (req, res) => {
  let db = false; try { await rpc("stats_json", { p_from: "2000-01-01" }); db = true; } catch (e) { console.error(e); }
  res.setHeader("Cache-Control", "no-store");
  if (!E.WEBHOOK_SECRET || req.headers["x-setup-key"] !== E.WEBHOOK_SECRET) return res.json({ ok: true, database_ok: db });
  res.json({ ok: true, database_ok: db, groq_key: !!E.GROQ_API_KEY, bot_token: !!E.BOT_TOKEN, webhook_secret: !!E.WEBHOOK_SECRET, supabase_env: !!(E.SUPABASE_URL && E.SUPABASE_SERVICE_KEY), team_uids: team().length, admin_uids: ids(E.ADMIN_UIDS).size, admin_panel_ready: !!((E.ADMIN_PASSWORD || "").length >= 12 && (E.SESSION_SECRET || "").length >= 24) });
});
