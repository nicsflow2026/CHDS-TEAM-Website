// PERMANENT (hard) report deletion. Irreversible through the application.
// Sequence (each step is safe to repeat, so a failed run is resumed by running it again):
//   1-4  caller authenticated the administrator, checked delete_reports and the report ID
//   5    report_purge_begin (one transaction): lock the report against every change, unpublish it, stop its
//        revenue counting, journal the job with the EXACT storage paths saved in the database
//   6-7  the report is already invisible to the public API / feed / search / homepage
//   8    delete those objects from report-evidence AND public-report-images, plus any object left in the
//        report's own folder (orphan sweep), then VERIFY each object is gone
//   9    report_purge_finish (one transaction): delete every report-specific row, redact the report's audit
//        entries, verify inside the transaction, close the job
//   10-11 verify again from outside: no report row, no evidence rows, no objects
//   12-13 public endpoints are not CDN-cached (see api/public), so totals, search and feed update immediately
//   14   success only when everything above succeeded; otherwise 502 with the job ID for an authorized retry
// The job keeps the report ID and paths ONLY while it is open; afterwards just a keyed, non-reversible
// deletion reference, the reason, the administrator and the timestamps remain (no report content).
import { createHmac, randomBytes } from "node:crypto";
import { sb, rpc, tg, q, isUnique, audit, warn, RID } from "./core.js";
import { remove, exists, listFolder, EVIDENCE_BUCKET, PUBLIC_IMAGES_BUCKET } from "./storage.js";

const BUCKETS = [EVIDENCE_BUCKET, PUBLIC_IMAGES_BUCKET];
export const deletionRef = id => createHmac("sha256", String(process.env.SESSION_SECRET || "")).update("report-deletion:" + id).digest("hex").slice(0, 32);
const newJobId = () => "DEL-" + randomBytes(10).toString("base64").replace(/[^A-Za-z0-9]/g, "").toUpperCase().padEnd(10, "X").slice(0, 10);
const res = (status, body) => ({ status, body });

async function begin(id, ref, actor, reason) {
  const args = { p_id: id, p_job: newJobId(), p_ref: ref, p_actor: actor, p_reason: reason };
  try { return await rpc("report_purge_begin", args); }
  catch (e) { if (isUnique(e)) return rpc("report_purge_begin", args); throw e; } // a concurrent request created the job first: resume it
}
async function jobFail(job, message) {
  await sb(`/report_deletions?id=eq.${q(job.id)}&status=neq.completed`, { method: "PATCH", body: { attempts: (job.attempts || 0) + 1, last_error: String(message).slice(0, 300), updated_at: new Date().toISOString() }, prefer: "return=minimal" })
    .catch(warn("deletion job error note"));
}
// Approvers' Telegram review cards still show the report: replace them before their log rows are deleted.
async function scrubTelegramCards(id) {
  const rows = await sb(`/notification_log?or=(ref.eq.${q(id)},ref.like.${q(id + ":*")})&message_id=not.is.null&select=chat_id,message_id`).catch(warn("deletion: telegram cards lookup", []));
  await Promise.allSettled(rows.map(r => tg("editMessageText", { chat_id: r.chat_id, message_id: r.message_id, parse_mode: "HTML", text: "🗑 <b>This report was permanently deleted by an administrator.</b>\nNo action is needed.", reply_markup: { inline_keyboard: [] } })));
}
// Every object to remove: the DB-recorded paths plus anything inside the report's own folder in either bucket.
// Paths outside "<report id>/" are never touched (they could belong to another report).
async function objectsOf(id, job) {
  const folder = id + "/", set = new Map(BUCKETS.map(b => [b, new Set()])), foreign = [];
  for (const o of job.storage_paths || []) {
    if (!set.has(o.bucket)) continue;
    if (String(o.path).startsWith(folder)) set.get(o.bucket).add(o.path); else foreign.push(o.bucket + "/" + o.path);
  }
  for (const b of BUCKETS) { // orphan sweep (an upload interrupted before its row was written)
    try { for (const p of await listFolder(b, folder)) set.get(b).add(p); }
    catch (e) { console.error("[deletion] folder listing failed", b, String(e.message).slice(0, 120)); }
  }
  if (foreign.length) console.error("[deletion] skipped paths outside the report folder", id, foreign.length);
  return set;
}

export async function purgeReport({ id, reason, actor, role = null, req = null, via = "dashboard" }) {
  id = String(id || "").toUpperCase();
  if (!RID.test(id)) return res(400, { error: "bad_request", message: "Invalid report ID." });
  const why = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (why.length < 3) return res(400, { error: "reason_required", message: "A deletion reason is required (at least 3 characters)." });
  const ref = deletionRef(id);

  const b = await begin(id, ref, actor, why);
  if (!b.ok) return b.error === "not_found" ? res(404, { error: "not_found", message: "This report does not exist. It may already have been deleted." }) : res(400, { error: b.error, message: b.error });
  const job = b.job;
  if (!b.resumed) await audit(actor, "report_permanent_delete_started", { job: job.id, reason: why, via }, { target: ref, req, role });

  // 8: storage (both buckets) + verification
  if (job.status === "pending" || job.status === "storage_deleted") {
    let objs;
    try {
      objs = await objectsOf(id, job);
      for (const [bucket, paths] of objs) if (paths.size) await remove(bucket, [...paths]);
      const left = [];
      for (const [bucket, paths] of objs) for (const p of paths) if (await exists(bucket, p)) left.push(bucket);
      if (left.length) throw new Error(`${left.length} storage object(s) still present after deletion`);
    } catch (e) {
      await jobFail(job, "storage: " + e.message);
      await audit(actor, "report_permanent_delete_incomplete", { job: job.id, step: "storage" }, { target: ref, req, role });
      return res(502, { error: "deletion_incomplete", step: "storage", job_id: job.id, retry: true,
        message: "Files could not all be deleted from storage. The report stays hidden and locked. Retry the deletion." });
    }
    if (job.status === "pending") await sb(`/report_deletions?id=eq.${q(job.id)}&status=eq.pending`, { method: "PATCH", body: { status: "storage_deleted", updated_at: new Date().toISOString() }, prefer: "return=minimal" });
    job.files = [...objs.values()].reduce((n, s) => n + s.size, 0);
  }
  await scrubTelegramCards(id);

  // 9: database (one transaction inside the RPC)
  let fin;
  try { fin = await rpc("report_purge_finish", { p_job: job.id }); }
  catch (e) { fin = { ok: false, error: String(e.message).slice(0, 200) }; }
  if (!fin.ok) {
    await jobFail(job, "database: " + fin.error);
    await audit(actor, "report_permanent_delete_incomplete", { job: job.id, step: "database" }, { target: ref, req, role });
    return res(502, { error: "deletion_incomplete", step: "database", job_id: job.id, retry: true,
      message: "The files were deleted but the database records could not be removed. The report stays hidden and locked. Retry the deletion." });
  }

  // 10-11: independent verification
  const [rep, ev, pub] = await Promise.all([sb(`/reports?id=eq.${q(id)}&select=id`), sb(`/report_evidence?report_id=eq.${q(id)}&select=id`), sb(`/report_public_images?report_id=eq.${q(id)}&select=id`)]);
  if (rep.length || ev.length || pub.length) return res(502, { error: "verification_failed", job_id: job.id, retry: true, message: "Deletion could not be verified. Retry the deletion." });

  if (!fin.already_completed) await audit(actor, "report_permanently_deleted", { job: job.id, reason: why, via, files: job.files ?? null, rows: fin.deleted || null }, { target: ref, req, role });
  return res(200, { ok: true, deletion_ref: ref, job_id: job.id, already_completed: !!fin.already_completed, files_deleted: job.files ?? null, rows_deleted: fin.deleted || null });
}

// Open (incomplete) jobs for the dashboard, and the minimal record of completed ones.
export async function deletionJobs({ open = true, limit = 25 } = {}) {
  return sb(`/report_deletions?${open ? "status=neq.completed" : "status=eq.completed"}&select=id,deletion_ref,report_id,status,reason,requested_by,requested_at,completed_at,attempts,last_error&order=requested_at.desc&limit=${limit}`);
}
