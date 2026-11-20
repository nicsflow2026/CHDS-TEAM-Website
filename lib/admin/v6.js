// V6 dashboard operations: public report photos (separate public bucket, explicit per-photo selection) and
// PERMANENT report deletion (delete_reports permission + password re-confirmation, retryable job).
// Every operation declares its permission; the router enforces it before the handler runs.
import { sb, q, RID } from "../core.js";
import { text } from "../validate.js";
import { teamScope } from "../rbac.js";
import { selectPhotos, removePhoto, replacePhoto, updatePhoto, syncPhotos, adminPhotoState, PhotoError, MAX_PUBLIC_IMAGES } from "../publicimages.js";
import { purgeReport, deletionJobs } from "../deletion.js";
import { fail, need, actor, v } from "./util.js";

const VIEW = ["publish_reports", "manage_reports", "approve_reports"];
async function report(ctx, id, { forPhotos = false } = {}) {
  id = String(id || "").toUpperCase(); need(RID.test(id), 400, "bad_request");
  const r = (await sb(`/reports?id=eq.${q(id)}&select=id,uid,team_member_id,status,published_at,archived_at,deleted_at,deletion_pending_at,title`))[0]; need(r, 404, "not_found");
  const s = await teamScope(ctx.p); need(!s || s.ids.includes(r.team_member_id) || s.uids.includes(r.uid), 403, "forbidden", "That report is outside your team.");
  if (forPhotos) {
    need(!r.deletion_pending_at, 423, "deletion_pending", "This report is being permanently deleted.");
    need(!r.deleted_at && !r.archived_at, 409, "not_active", "Restore the report before managing its public photos.");
    need(r.status === "approved", 409, "not_approved", "Approve the report before choosing public photos.");
  }
  return r;
}
const photoOp = fn => async ctx => { try { return await fn(ctx); } catch (e) { if (e instanceof PhotoError) fail(e.status, e.code, e.message); throw e; } };
const send = (ctx, o) => { ctx.res.status(o.status).json(o.body); return undefined; };

export const ops = {
  /* ---------------- Public photos ---------------- */
  report_photos: { perm: VIEW, method: "GET", fn: async ctx => {
    const r = await report(ctx, ctx.qy.id);
    const st = await adminPhotoState(r);
    await ctx.audit("report_evidence_previewed", { images: st.evidence.filter(e => e.image).length }, { target: r.id });
    return { ...st, can_select: r.status === "approved" && !r.archived_at && !r.deleted_at && !r.deletion_pending_at, report_status: r.status };
  } },
  report_photo_select: { perm: "publish_reports", method: "POST", fn: photoOp(async ctx => {
    const r = await report(ctx, ctx.b.id, { forPhotos: true });
    const ids = Array.isArray(ctx.b.evidence_ids) ? ctx.b.evidence_ids.slice(0, MAX_PUBLIC_IMAGES) : [];
    const alt = v(text(ctx.b.alt_text, { max: 200, label: "Alt text" }));
    const added = await selectPhotos(r, ids, actor(ctx), alt);
    await ctx.audit("report_photos_selected", { count: added.length, evidence_ids: added.map(x => x.evidence_id) }, { target: r.id });
    return { ok: true, added: added.length, state: await adminPhotoState(r) };
  }) },
  report_photo_remove: { perm: "publish_reports", method: "POST", fn: photoOp(async ctx => {
    const r = await report(ctx, ctx.b.id);
    need(!r.deletion_pending_at, 423, "deletion_pending", "This report is being permanently deleted.");
    const x = await removePhoto(r.id, ctx.b.image_id);
    await ctx.audit("report_photo_removed", { evidence_id: x.evidence_id, was_public: !!(x.path && r.published_at) }, { target: r.id });
    return { ok: true, state: await adminPhotoState(r) };
  }) },
  report_photo_replace: { perm: "publish_reports", method: "POST", fn: photoOp(async ctx => {
    const r = await report(ctx, ctx.b.id, { forPhotos: true });
    const x = await replacePhoto(r, ctx.b.image_id, ctx.b.evidence_id);
    await ctx.audit("report_photo_replaced", { image_id: x.id, evidence_id: x.evidence_id }, { target: r.id });
    return { ok: true, state: await adminPhotoState(r) };
  }) },
  report_photo_update: { perm: "publish_reports", method: "POST", fn: photoOp(async ctx => {
    const r = await report(ctx, ctx.b.id, { forPhotos: true });
    if (ctx.b.alt_text !== undefined) v(text(ctx.b.alt_text, { max: 200, label: "Alt text" }));
    const x = await updatePhoto(r.id, ctx.b.image_id, { alt_text: ctx.b.alt_text, sort_order: ctx.b.sort_order });
    await ctx.audit("report_photo_updated", { image_id: x.id }, { target: r.id });
    return { ok: true, state: await adminPhotoState(r) };
  }) },
  report_photos_sync: { perm: "publish_reports", method: "POST", fn: photoOp(async ctx => {
    const r = await report(ctx, ctx.b.id);
    need(!r.deletion_pending_at, 423, "deletion_pending", "This report is being permanently deleted.");
    const o = await syncPhotos(r);
    await ctx.audit("report_photos_synced", o, { target: r.id });
    return { ok: true, ...o, state: await adminPhotoState(r) };
  }) },

  /* ---------------- Permanent deletion ---------------- */
  // Works for pending, approved, published, unpublished, edited, archived and owner-withdrawn reports; no
  // unpublish step is needed first. Requires: delete_reports + password re-confirmation (router: reauth) +
  // reason + the report ID typed back by the administrator.
  report_purge: { perm: "delete_reports", method: "POST", reauth: true, raw: true, fn: async ctx => {
    const id = String(ctx.b.id || "").toUpperCase();
    need(RID.test(id), 400, "bad_request");
    need(String(ctx.b.confirm || "").trim().toUpperCase() === id, 400, "confirmation_required", "Type the report ID exactly to confirm permanent deletion.");
    await report(ctx, id); // existence + team scope
    return send(ctx, await purgeReport({ id, reason: ctx.b.reason, actor: actor(ctx), role: ctx.p.role, req: ctx.req }));
  } },
  report_purge_retry: { perm: "delete_reports", method: "POST", reauth: true, raw: true, fn: async ctx => {
    const jid = String(ctx.b.job_id || ""); need(/^DEL-[A-Z0-9]{10}$/.test(jid), 400, "bad_request");
    const j = (await sb(`/report_deletions?id=eq.${q(jid)}&select=id,report_id,status,reason`))[0]; need(j, 404, "not_found");
    if (j.status === "completed") return send(ctx, { status: 200, body: { ok: true, already_completed: true, job_id: j.id } });
    return send(ctx, await purgeReport({ id: j.report_id, reason: j.reason, actor: actor(ctx), role: ctx.p.role, req: ctx.req, via: "retry" }));
  } },
  report_deletions: { perm: "delete_reports", method: "GET", fn: async ctx => ({ open: await deletionJobs({ open: true }), completed: ctx.qy.completed === "1" ? (await deletionJobs({ open: false, limit: 50 })).map(({ report_id, ...x }) => x) : undefined }) }
};
