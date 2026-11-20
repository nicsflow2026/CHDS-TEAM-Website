// Supabase Storage via REST with the service key (server only).
import { sbBase, serviceKey } from "./core.js";
export const EVIDENCE_BUCKET = "report-evidence";       // PRIVATE: original evidence, signed URLs only
export const PUBLIC_IMAGES_BUCKET = "public-report-images"; // PUBLIC: copies an administrator explicitly approved for display
const H = () => ({ apikey: serviceKey(), Authorization: "Bearer " + serviceKey() });
const enc = p => p.split("/").map(encodeURIComponent).join("/");
async function call(path, init, timeout = 15000) {
  if (!sbBase() || !serviceKey()) throw new Error("supabase_not_configured");
  const r = await fetch(sbBase() + "/storage/v1" + path, { ...init, signal: AbortSignal.timeout(timeout), headers: { ...H(), ...(init.headers || {}) } });
  if (!r.ok) throw Object.assign(new Error(`storage ${r.status} ${(await r.text()).slice(0, 200)}`), { status: r.status });
  return r;
}
export async function upload(bucket, path, buf, mime, { upsert = false, cacheControl = "max-age=3600" } = {}) {
  await call(`/object/${bucket}/${enc(path)}`, { method: "POST", headers: { "Content-Type": mime, "x-upsert": upsert ? "true" : "false", "Cache-Control": cacheControl }, body: buf }, 25000);
  return path;
}
export const publicUrl = (bucket, path) => (path ? `${sbBase()}/storage/v1/object/public/${bucket}/${enc(path)}` : null);
export async function signedUrl(bucket, path, expiresIn = 300) {
  const j = await (await call(`/object/sign/${bucket}/${enc(path)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn }) })).json();
  const u = j.signedURL || j.signedUrl;
  if (!u) throw new Error("storage sign: no URL returned");
  return /^https?:/.test(u) ? u : `${sbBase()}/storage/v1${u.startsWith("/") ? "" : "/"}${u}`;
}
export async function download(bucket, path) { return Buffer.from(await (await call(`/object/${bucket}/${enc(path)}`, { method: "GET" }, 25000)).arrayBuffer()); }
// Removes exact object keys (not folders). Removing a key that does not exist is not an error (idempotent).
export async function remove(bucket, paths) {
  if (!paths.length) return [];
  const r = await call(`/object/${bucket}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
  try { return await r.json(); } catch { return []; }
}
// true / false; throws when Storage cannot answer (so a verification never reports "gone" by mistake)
export async function exists(bucket, path) {
  try { await call(`/object/${bucket}/${enc(path)}`, { method: "HEAD" }, 8000); return true; } // same check as supabase-js exists()
  catch (e) { if (e.status === 404 || e.status === 400) return false; throw e; }
}
// Objects directly inside one folder ("R1A2B3/"). Used to sweep orphans of a report being deleted.
export async function listFolder(bucket, folder) {
  const out = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const rows = await (await call(`/object/list/${bucket}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefix: folder, limit: 100, offset, sortBy: { column: "name", order: "asc" } }) })).json();
    for (const r of rows || []) if (r && r.name && r.id) out.push(folder.replace(/\/?$/, "/") + r.name); // id null = sub-folder placeholder
    if (!rows || rows.length < 100) break;
  }
  return out;
}
export async function buckets() { return (await call("/bucket", { method: "GET" }, 6000)).json(); }
