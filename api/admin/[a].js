// Admin dashboard API. Every operation declares its permission; this router enforces authentication,
// CSRF protection (custom header + same-origin), permissions, re-authentication for sensitive actions,
// rate limits and audit context. The browser never decides what a user may do.
import { api, sb, jsonBody, sameOrigin, audit, securityEvent, hit, clientIp } from "../../lib/core.js";
import { can, canAny } from "../../lib/rbac.js";
import { session, login, otp, reauth, revokeSessions, setCookie, IDLE } from "../../lib/admin/auth.js";
import { HttpError } from "../../lib/admin/util.js";
import { ops as people } from "../../lib/admin/people.js";
import { ops as support } from "../../lib/admin/support.js";
import { ops as business } from "../../lib/admin/business.js";
import { ops as system } from "../../lib/admin/system.js";

export const OPS = { ...people, ...support, ...business, ...system };

const handler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex");
  const a = String(req.query.a || ""), post = req.method === "POST", fail = (s, e, m) => res.status(s).json({ error: e, ...(m ? { message: m } : {}) });
  if (post && !sameOrigin(req, "x-chds-admin")) { await securityEvent("csrf_blocked", { severity: "warning", req, detail: { op: a.slice(0, 40) } }); return fail(403, "forbidden"); }
  const b = post ? jsonBody(req) : {};
  try {
    if (a === "login" && post) return await login(req, res, b);
    if (a === "otp" && post) return await otp(req, res, b);

    const ses = await session(req, req.query.quiet !== "1");
    if (!ses) {
      if (req.headers.cookie && /__Host-chds_admin=/.test(req.headers.cookie) && !(await hit("sec-unauth:" + clientIp(req), 10, 3600)))
        await securityEvent("unauthorized", { severity: "info", req, detail: { op: a.slice(0, 40), note: "expired or revoked session" } });
      return fail(401, "unauthorized");
    }
    if (a === "ping") return res.json({ ok: true, idle_ms: IDLE() });
    if (a === "reauth" && post) return await reauth(req, res, ses, b);
    if (a === "logout" && post) {
      const all = b.all === true;
      await revokeSessions(all ? `uid=eq.${ses.uid}` : `id=eq.${ses.id}`, "admin:" + ses.uid, all ? "logout_all" : "logout");
      setCookie(res, "", 0);
      await audit("admin:" + ses.uid, all ? "logout_all" : "logout", {}, { target: ses.uid, req });
      return res.json({ ok: true });
    }

    const op = Object.prototype.hasOwnProperty.call(OPS, a) ? OPS[a] : null;
    if (!op) return fail(404, "not_found");
    if (op.method !== req.method) return fail(405, "method");
    const allowed = op.perm === null || (Array.isArray(op.perm) ? canAny(ses.p, op.perm) : can(ses.p, op.perm));
    if (!allowed) {
      if (!(await hit("sec-forbid:" + ses.uid, 20, 3600))) await securityEvent("forbidden", { severity: "warning", actor: ses.uid, req, detail: { op: a, needs: op.perm } });
      return fail(403, "forbidden", "Your role does not include this permission.");
    }
    if (await hit("adm:" + ses.uid, 600, 60)) return fail(429, "rate_limited"); // every authenticated request
    if (post && (await hit("adm-w:" + ses.uid, 120, 60))) return fail(429, "rate_limited");
    if (op.reauth && !ses.reauthOk) return fail(428, "reauth_required", "Confirm your password to continue.");
    const ctx = { req, res, b, qy: req.query || {}, ses, p: ses.p, idle: IDLE(),
      audit: (action, detail = {}, extra = {}) => audit("admin:" + ses.uid, action, detail, { ...extra, req }) };
    const out = await op.fn(ctx);
    if (op.raw || res.headersSent) return;
    return res.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message !== e.code ? e.message : undefined);
    throw e; // api() logs to app_errors and answers 500 / 503
  }
};
export default api(handler, { cors: false, name: "api/admin" });
