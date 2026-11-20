import { getVisitor } from "./visitor.js";
import { UUID } from "./core.js";

export async function requireVisitor(req, res) {
  const v = await getVisitor(req, res);
  if (!v) { res.status(401).json({ error: "identity_required" }); return null; }
  if (v.user.status !== "active") { res.status(403).json({ error: "blocked" }); return null; }
  return v;
}

export const validConvId = v => typeof v === "string" && UUID.test(v);
