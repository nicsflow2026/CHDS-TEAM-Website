// Report rules shared by the private report portal (owners) and the dashboard (staff).
// Activity date = when the reported activity happened (Philippine calendar date, report_date column).
// Submission timestamp = when the report entered CHDS (created_at). They are never substituted for each other.
import { text, oneOf, isDate, int, amount } from "./validate.js";
import { today, addDays, MIN_DATE } from "./time.js";
import { redactSecrets } from "./secrets.js";

export const REPORT_CATEGORIES = ["account_recovery", "page_recovery", "ad_account", "impersonation", "website", "consultation", "scheduled_activity", "other"];
export const CATEGORY_LABEL = { account_recovery: "Account recovery", page_recovery: "Page recovery", ad_account: "Ad account", impersonation: "Impersonation",
  website: "Website project", consultation: "Consultation", scheduled_activity: "Scheduled / planned activity", other: "Other" };
// Only report types that describe planned work may carry a future activity date (days ahead allowed).
export const FUTURE_DAYS = { consultation: 180, website: 365, scheduled_activity: 365 };
export const STATUS_LABEL = { pending: "Pending review", reviewed: "Reviewed", approved: "Approved", rejected: "Rejected", changes_requested: "Corrections requested" };

export function activityDateError(category, d, now = today()) {
  if (!isDate(d)) return "Enter a valid activity date (YYYY-MM-DD).";
  if (d < MIN_DATE) return "Activity dates start at 2020-01-01.";
  const ahead = FUTURE_DAYS[category] || 0;
  if (d > now && !ahead) return "This report type cannot have a future activity date (Philippine time). Use “Scheduled / planned activity”, “Consultation” or “Website project” for planned work.";
  if (d > addDays(now, ahead)) return `Planned activity can be at most ${ahead} days ahead for this report type.`;
  return null;
}

// Validates report fields. partial=true validates only the fields present (edits).
// Free-text fields are passed through the secret redactor; the types found are returned (never the values).
export function reportFields(b, { partial = false, requireDescription = false } = {}) {
  const out = {}, errors = [], found = new Set();
  const has = k => b[k] !== undefined;
  const txt = (k, opts) => {
    if (partial && !has(k)) return;
    const r = text(b[k], opts); if (r.error) { errors.push(r.error); return; }
    let s = r.value || "";
    if (s) { const x = redactSecrets(s); s = x.text; x.found.forEach(t => found.add(t)); }
    out[k] = s || null;
  };
  txt("title", { min: 3, max: 120, required: true, label: "Title" });
  txt("description", { min: requireDescription ? 10 : 0, max: 4000, multiline: true, required: requireDescription, label: "Description" });
  txt("account_info", { max: 2000, multiline: true, label: "Account or case information" });
  txt("additional_info", { max: 2000, multiline: true, label: "Additional information" });
  if (!partial || has("category")) { const c = oneOf(b.category, REPORT_CATEGORIES); if (!c) errors.push("Choose a report category."); else out.category = c; }
  if (!partial || has("recovered")) { const n = b.recovered === "" || b.recovered === undefined || b.recovered === null ? 0 : int(b.recovered, 0, 9999); if (n === null) errors.push("Recovered accounts must be a whole number between 0 and 9999."); else out.recovered = n; }
  if (!partial || has("revenue")) { const n = b.revenue === "" || b.revenue === undefined || b.revenue === null ? 0 : amount(b.revenue); if (n === null) errors.push("Revenue must be an amount between 0 and 10,000,000 with up to 2 decimals."); else out.revenue = n; }
  if (!partial || has("report_date")) out.report_date = b.report_date;
  return { values: out, errors, redacted: [...found] };
}
// Date check needs the final category (an edit may change either field).
export const dateCheck = (values, current = {}) => activityDateError(values.category ?? current.category, values.report_date ?? current.report_date);

// What the owner sees in My Reports (never reviewer IDs, internal notes, dedupe keys, deletion actors).
export const ownerView = (r, uid) => ({
  id: r.id, title: r.title, description: r.description, account_info: r.account_info, additional_info: r.additional_info, category: r.category,
  activity_date: r.report_date, submitted_at: r.created_at, updated_at: r.updated_at, recovered: r.recovered, revenue: Number(r.revenue),
  status: r.status, reviewed_at: r.reviewed_at, feedback: r.review_note || null, rejection_reason: r.rejection_reason || null, correction_request: r.correction_request || null,
  published: !!r.published_at, published_at: r.published_at || null, public_title: r.public_title || null, public_summary: r.public_summary || null,
  archived: !!r.archived_at, archived_at: r.archived_at || null, archived_by_you: !!r.archived_at && r.archived_by === "portal:" + uid, source: r.source,
  can_edit: !r.archived_at, can_delete: ["pending", "reviewed", "changes_requested", "rejected"].includes(r.status) && !r.published_at,
  can_archive: !r.archived_at && ["approved", "rejected"].includes(r.status) && !r.published_at, can_restore: !!r.archived_at && r.archived_by === "portal:" + uid
});
