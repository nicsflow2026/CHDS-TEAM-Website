// Public report photos. Original evidence stays in the PRIVATE report-evidence bucket. An administrator explicitly
// selects image evidence for public display; the system copies it (metadata stripped) into the PUBLIC
// public-report-images bucket under a new random name and records it in report_public_images.
// A selected photo is "materialized" (has a public object + path) only while it may be shown: unpublishing a
// report removes its public objects (path -> NULL) and publishing copies them again under NEW random names, so a
// URL that was public before an unpublish never works again.
// Ordering rules (partial failures): an object is uploaded before its row points at it and removed (on failure)
// if the row cannot be written; an object is deleted before its row, so the API never lists a removed photo
// as available and no untracked object is left behind.
import { randomBytes } from "node:crypto";
import { sb, q, warn } from "./core.js";
import { download, upload, remove, publicUrl, signedUrl, EVIDENCE_BUCKET, PUBLIC_IMAGES_BUCKET } from "./storage.js";
import { imageInfo, stripMetadata, PUBLIC_IMAGE_TYPES } from "./imagemeta.js";

export const MAX_PUBLIC_IMAGES = 8;
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
// Short cache on purpose: a photo an administrator removes must stop being served quickly.
const PUBLIC_CACHE = "public, max-age=300";
export class PhotoError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const err = (s, c, m) => { throw new PhotoError(s, c, m); };

const rowsOf = reportId => sb(`/report_public_images?report_id=eq.${q(reportId)}&select=*&order=sort_order.asc,id.asc`);
const evidenceOf = reportId => sb(`/report_evidence?report_id=eq.${q(reportId)}&select=id,path,mime,size_bytes,created_at&order=id.asc`);

// Copy one evidence image into the public bucket. Returns the new object's facts (caller writes the row).
async function copyToPublic(reportId, ev) {
  if (!PUBLIC_IMAGE_TYPES.includes(ev.mime)) err(400, "not_an_image", "Only JPG, PNG or WebP evidence can be shown publicly (PDF files stay private).");
  let clean, dim;
  try {
    const src = await download(EVIDENCE_BUCKET, ev.path);
    clean = stripMetadata(src, ev.mime); dim = imageInfo(clean, ev.mime);
  } catch (e) {
    if (e instanceof PhotoError) throw e;
    console.error("public photo prepare", String(e.message).slice(0, 160));
    err(422, "unprocessable", "This image could not be prepared for public display (it was not published).");
  }
  const path = `${reportId}/${randomBytes(16).toString("hex")}.${EXT[ev.mime]}`;
  await upload(PUBLIC_IMAGES_BUCKET, path, clean, ev.mime, { cacheControl: PUBLIC_CACHE });
  return { path, mime: ev.mime, width: dim.width, height: dim.height, size_bytes: clean.length };
}
// Upload first; if the row cannot be written, remove the object again (no orphan).
async function withCopy(reportId, ev, write) {
  const c = await copyToPublic(reportId, ev);
  try { return await write(c); }
  catch (e) { await remove(PUBLIC_IMAGES_BUCKET, [c.path]).catch(warn("public photo rollback")); throw e; }
}

/* ---------------- admin operations ---------------- */
// rep: { id, published_at } — selections are allowed once the report is approved (checked by the caller).
export async function selectPhotos(rep, evidenceIds, actor, altDefault = "") {
  const ev = await evidenceOf(rep.id), cur = await rowsOf(rep.id), added = [];
  const want = [...new Set(evidenceIds.map(Number))].filter(n => Number.isInteger(n) && n > 0);
  if (!want.length) err(400, "bad_request", "Choose at least one photo.");
  if (cur.length + want.filter(id => !cur.some(r => r.evidence_id === id)).length > MAX_PUBLIC_IMAGES) err(409, "too_many", `A report can show at most ${MAX_PUBLIC_IMAGES} public photos.`);
  let order = cur.reduce((m, r) => Math.max(m, r.sort_order), 0);
  for (const id of want) {
    const e = ev.find(x => x.id === id);
    if (!e) err(404, "not_found", "That evidence file does not belong to this report.");
    if (cur.some(r => r.evidence_id === id)) continue; // already selected: idempotent
    const row = await withCopy(rep.id, e, async c => (await sb("/report_public_images", { method: "POST",
      body: { report_id: rep.id, evidence_id: e.id, ...c, alt_text: String(altDefault || "").slice(0, 200), sort_order: (order += 10), created_by: actor }, prefer: "return=representation" }))[0]);
    added.push(row);
  }
  return added;
}
export async function removePhoto(reportId, imageId) {
  const r = (await sb(`/report_public_images?id=eq.${Number(imageId)}&report_id=eq.${q(reportId)}&select=*`))[0];
  if (!r) err(404, "not_found", "That public photo does not exist.");
  if (r.path) await remove(PUBLIC_IMAGES_BUCKET, [r.path]); // object first: failure keeps everything as it was
  await sb(`/report_public_images?id=eq.${r.id}`, { method: "DELETE" });
  return r;
}
export async function replacePhoto(rep, imageId, evidenceId) {
  const r = (await sb(`/report_public_images?id=eq.${Number(imageId)}&report_id=eq.${q(rep.id)}&select=*`))[0];
  if (!r) err(404, "not_found", "That public photo does not exist.");
  const e = (await evidenceOf(rep.id)).find(x => x.id === Number(evidenceId));
  if (!e) err(404, "not_found", "That evidence file does not belong to this report.");
  if (e.id !== r.evidence_id && (await rowsOf(rep.id)).some(x => x.evidence_id === e.id)) err(409, "duplicate", "That photo is already selected.");
  const row = await withCopy(rep.id, e, async c => (await sb(`/report_public_images?id=eq.${r.id}`, { method: "PATCH", body: { evidence_id: e.id, ...c, updated_at: new Date().toISOString() }, prefer: "return=representation" }))[0]);
  if (r.path) await remove(PUBLIC_IMAGES_BUCKET, [r.path]).catch(warn("old public photo remove")); // old URL stops working
  return row;
}
export async function updatePhoto(reportId, imageId, { alt_text, sort_order }) {
  const body = { updated_at: new Date().toISOString() };
  if (alt_text !== undefined) body.alt_text = String(alt_text).replace(/\s+/g, " ").trim().slice(0, 200);
  if (sort_order !== undefined) body.sort_order = Math.max(0, Math.min(100000, Number(sort_order) | 0));
  const r = (await sb(`/report_public_images?id=eq.${Number(imageId)}&report_id=eq.${q(reportId)}`, { method: "PATCH", body, prefer: "return=representation" }))[0];
  if (!r) err(404, "not_found", "That public photo does not exist.");
  return r;
}

/* ---------------- publication hooks ---------------- */
// Before publishing: every selected photo must have a public object. Throws if one cannot be prepared.
export async function materializeAll(reportId) {
  const rows = (await rowsOf(reportId)).filter(r => !r.path && r.evidence_id), ev = rows.length ? await evidenceOf(reportId) : [];
  for (const r of rows) {
    const e = ev.find(x => x.id === r.evidence_id); if (!e) continue;
    await withCopy(reportId, e, c => sb(`/report_public_images?id=eq.${r.id}`, { method: "PATCH", body: { ...c, updated_at: new Date().toISOString() }, prefer: "return=minimal" }));
  }
  return rows.length;
}
// After unpublishing / archiving / an owner edit: public objects go away, the selection is kept.
export async function dematerializeAll(reportId) {
  const rows = (await rowsOf(reportId)).filter(r => r.path);
  if (!rows.length) return 0;
  await remove(PUBLIC_IMAGES_BUCKET, rows.map(r => r.path));
  await sb(`/report_public_images?report_id=eq.${q(reportId)}&path=not.is.null`, { method: "PATCH", body: { path: null, updated_at: new Date().toISOString() }, prefer: "return=minimal" });
  return rows.length;
}
// Bring the public objects in line with the report's publication state (used after unpublish-type changes
// and by the admin "Sync" action when an earlier cleanup failed).
export async function syncPhotos(rep) { return rep.published_at && !rep.deletion_pending_at ? { materialized: await materializeAll(rep.id) } : { removed: await dematerializeAll(rep.id) }; }
export const syncAfterUnpublish = reportId => dematerializeAll(reportId).catch(e => { console.error("[photos] public copies not removed for", reportId, String(e.message).slice(0, 120)); return -1; });

/* ---------------- views ---------------- */
// Admin: every evidence file with its public status. Image previews are short-lived signed URLs of the
// PRIVATE originals (shown only to staff); public URLs are shown for materialized copies.
export async function adminPhotoState(rep) {
  const [ev, rows] = await Promise.all([evidenceOf(rep.id), rowsOf(rep.id)]);
  const images = ev.filter(e => PUBLIC_IMAGE_TYPES.includes(e.mime));
  const previews = await Promise.all(images.map(e => signedUrl(EVIDENCE_BUCKET, e.path, 300).catch(warn("evidence preview url", null))));
  const pub = !!rep.published_at;
  return {
    max: MAX_PUBLIC_IMAGES, published: pub,
    evidence: ev.map(e => { const i = images.indexOf(e), sel = rows.find(r => r.evidence_id === e.id);
      return { id: e.id, mime: e.mime, size_bytes: e.size_bytes, created_at: e.created_at, image: i >= 0, preview_url: i >= 0 ? previews[i] : null, selected_image_id: sel ? sel.id : null }; }),
    selected: rows.map(r => ({ id: r.id, evidence_id: r.evidence_id, alt_text: r.alt_text, sort_order: r.sort_order, width: r.width, height: r.height,
      status: r.path ? (pub ? "live" : "ready") : (pub ? "missing" : "staged"), public_url: r.path && pub ? publicUrl(PUBLIC_IMAGES_BUCKET, r.path) : null })),
    needs_sync: pub && rows.some(r => !r.path && r.evidence_id),     // published but a selected photo has no public copy
    unpublished_copies: !pub && rows.filter(r => r.path).length       // copies prepared (or left by a failed cleanup) while not public
  };
}
// Public: only materialized photos of the given (already published) report IDs. Never paths of private files.
export async function publicPhotosFor(ids) {
  if (!ids.length) return {};
  const rows = await sb(`/report_public_images?report_id=in.(${ids.map(q).join(",")})&path=not.is.null&select=report_id,path,alt_text,width,height,sort_order,id&order=sort_order.asc,id.asc`);
  const out = {};
  for (const r of rows) (out[r.report_id] ||= []).push({ url: publicUrl(PUBLIC_IMAGES_BUCKET, r.path), alt: r.alt_text || "", w: r.width || null, h: r.height || null });
  return out;
}
