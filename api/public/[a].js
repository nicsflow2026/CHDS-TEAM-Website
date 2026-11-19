// Controlled public endpoints: approved team directory fields, site status, public announcements, public report feed.
// Never returns Telegram UIDs, staff data, internal notes or anything not explicitly approved for the public.
// The report feed reads ONLY the public_report_feed view (explicitly published reports; no private columns exist in it).
import { createHash } from "node:crypto";
import { api, sb, settings, limited, like } from "../../lib/core.js";
import { publicUrl } from "../../lib/storage.js";
import { isDate } from "../../lib/validate.js";
import { REPORT_CATEGORIES, CATEGORY_LABEL } from "../../lib/reports.js";

const feedOut = r => ({ id: r.id, title: r.title, summary: r.summary || "", category: r.category, category_label: CATEGORY_LABEL[r.category] || "Other",
  activity_date: r.activity_date, published_at: r.published_at, recovered: Number(r.recovered) || 0, member: r.member_name || "CHDS Team" });

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
  if (a === "reports") {
    const qy = req.query || {}, limit = Math.max(1, Math.min(24, parseInt(qy.limit) || 12)), offset = Math.max(0, Math.min(5000, parseInt(qy.offset) || 0));
    const term = String(qy.q || "").trim().slice(0, 60);
    const f = [REPORT_CATEGORIES.includes(qy.category) ? `&category=eq.${qy.category}` : "", isDate(qy.from) ? `&activity_date=gte.${qy.from}` : "", isDate(qy.to) ? `&activity_date=lte.${qy.to}` : "",
      term ? `&or=(title.ilike.${like(term)},summary.ilike.${like(term)})` : ""].join("");
    const r = await sb(`/public_report_feed?select=id,title,summary,category,activity_date,published_at,recovered,member_name${f}&order=published_at.desc,id.desc&limit=${limit}&offset=${offset}`, { count: true });
    const rows = r.rows.map(feedOut);
    res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");
    return res.json({ rows, total: r.total, offset, limit, categories: REPORT_CATEGORIES.map(k => [k, CATEGORY_LABEL[k]]),
      version: createHash("sha1").update(r.total + "|" + rows.map(x => x.id + x.published_at).join(",")).digest("hex").slice(0, 12) });
  }
  return res.status(404).json({ error: "not_found" });
}, { name: "api/public" });
