// Small helpers for admin operations.
export class HttpError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
export const fail = (status, code, message) => { throw new HttpError(status, code, message); };
export const need = (cond, status, code, message) => { if (!cond) fail(status, code, message); };
export const actor = ctx => "admin:" + ctx.p.uid;
export const page = (qy, def = 25, max = 100) => {
  const limit = Math.max(1, Math.min(max, parseInt(qy.limit) || def)), offset = Math.max(0, Math.min(100000, parseInt(qy.offset) || 0));
  return { limit, offset, range: `&limit=${limit}&offset=${offset}` };
};
export const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
export const diff = (a, b, keys) => { const prev = {}, next = {}; for (const k of keys) if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) { prev[k] = a?.[k] ?? null; next[k] = b?.[k] ?? null; } return { prev, next, changed: Object.keys(next).length > 0 }; };
export const v = r => { if (r.error) fail(400, "invalid", r.error); return r.value; };
export const reasonOf = (b, label = "A reason") => { const s = String(b.reason || "").replace(/\s+/g, " ").trim(); need(s.length >= 3, 400, "reason_required", `${label} is required (at least 3 characters).`); return s.slice(0, 500); };
