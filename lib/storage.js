// Supabase Storage via REST with the service key (server only).
import { sbBase, serviceKey } from "./core.js";
const H = () => ({ apikey: serviceKey(), Authorization: "Bearer " + serviceKey() });
const enc = p => p.split("/").map(encodeURIComponent).join("/");
async function call(path, init, timeout = 15000) {
  if (!sbBase() || !serviceKey()) throw new Error("supabase_not_configured");
  const r = await fetch(sbBase() + "/storage/v1" + path, { ...init, signal: AbortSignal.timeout(timeout), headers: { ...H(), ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`storage ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}
export async function upload(bucket, path, buf, mime, { upsert = false } = {}) {
  await call(`/object/${bucket}/${enc(path)}`, { method: "POST", headers: { "Content-Type": mime, "x-upsert": upsert ? "true" : "false", "Cache-Control": "max-age=3600" }, body: buf }, 25000);
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
export async function remove(bucket, paths) { await call(`/object/${bucket}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) }); }
export async function buckets() { return (await call("/bucket", { method: "GET" }, 6000)).json(); }
