// Controlled public endpoints: approved team directory fields, site status, public announcements.
// Never returns Telegram UIDs, staff data, internal notes or anything not explicitly approved for the public.
import { api, sb, settings, limited } from "../../lib/core.js";
import { publicUrl } from "../../lib/storage.js";

export default api(async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  const a = String(req.query.a || "");
  if (await limited(req, "pub", 120, 60)) return res.status(429).json({ error: "rate_limited" });
  if (a === "team") {
    const rows = await sb("/team_members?status=eq.active&is_public=is.true&deleted_at=is.null&order=display_order.asc,display_name.asc&select=id,display_name,role_title,member_group,telegram_username,show_telegram,facebook_url,photo_path,bio");
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.json({ members: rows.map(r => ({ id: r.id, name: r.display_name, role: r.role_title, group: r.member_group,
      telegram: r.show_telegram ? r.telegram_username : null, facebook: r.facebook_url, photo: publicUrl("team-photos", r.photo_path), bio: r.bio })) });
  }
  if (a === "status") {
    const s = await settings();
    const now = new Date().toISOString();
    const ann = s.site.announcement_banner ? await sb(`/announcements?status=eq.published&audience=eq.all&publish_at=lte.${encodeURIComponent(now)}&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})&order=priority.desc,publish_at.desc&limit=3&select=id,title,message,priority,publish_at`) : [];
    res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
    return res.json({ maintenance: s.emergency.maintenance_mode, ai_enabled: !s.emergency.ai_disabled, human_enabled: !s.emergency.human_requests_disabled, announcements: ann });
  }
  return res.status(404).json({ error: "not_found" });
}, { name: "api/public" });
