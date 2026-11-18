import { api, statsData } from "../lib/core.js";
export default api(async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=10");
  res.json(await statsData());
});
