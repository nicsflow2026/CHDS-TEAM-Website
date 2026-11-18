import { api, statsData, limited } from "../lib/core.js";
export default api(async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (await limited(req, "stats", 120, 60)) return res.status(429).json({ error: "rate_limited" });
  res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=10");
  res.json(await statsData());
});
