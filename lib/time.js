// Philippine calendar helpers (UTC+8, no daylight saving). All revenue/report dates are PH calendar dates.
import { dayOf, tzo } from "./core.js";
export const today = () => dayOf(Date.now());
const D = s => new Date(s + "T00:00:00Z");
const S = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
export const weekStart = s => { const d = D(s), w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return S(d); }; // Monday
export const monthStart = s => s.slice(0, 8) + "01";
export const monthEnd = s => { const d = D(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return S(d); };
export const yearStart = s => s.slice(0, 4) + "-01-01";
export const yearEnd = s => s.slice(0, 4) + "-12-31";
export const MIN_DATE = "2020-01-01", MAX_DATE = "2100-12-31";
export const PRESETS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_year", "last_year", "custom", "all"];
const days = (a, b) => (D(b) - D(a)) / 864e5;

// Returns { from, to, group, preset } or { error }
export function range(preset, from, to, now = today()) {
  let r;
  switch (preset) {
    case "today": r = [now, now]; break;
    case "yesterday": { const y = addDays(now, -1); r = [y, y]; break; }
    case "this_week": { const w = weekStart(now); r = [w, addDays(w, 6)]; break; }
    case "last_week": { const w = addDays(weekStart(now), -7); r = [w, addDays(w, 6)]; break; }
    case "this_month": r = [monthStart(now), monthEnd(now)]; break;
    case "last_month": { const p = addDays(monthStart(now), -1); r = [monthStart(p), monthEnd(p)]; break; }
    case "this_year": r = [yearStart(now), yearEnd(now)]; break;
    case "last_year": { const p = String(Number(now.slice(0, 4)) - 1); r = [p + "-01-01", p + "-12-31"]; break; }
    case "all": r = [MIN_DATE, MAX_DATE]; break;
    case "custom": {
      const ok = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && S(D(s)) === s;
      if (!ok(from) || !ok(to)) return { error: "Choose a valid start and end date." };
      if (from > to) return { error: "The start date must be before the end date." };
      if (from < MIN_DATE || to > MAX_DATE) return { error: "Dates must be between 2020-01-01 and 2100-12-31." };
      r = [from, to]; break;
    }
    default: return { error: "Unknown date range." };
  }
  const span = preset === "all" ? days(MIN_DATE, now) : days(r[0], r[1]);
  const group = span <= 62 ? "day" : span <= 190 ? "week" : span <= 1100 ? "month" : "year";
  return { from: r[0], to: r[1], group, preset };
}
// PH-midnight boundaries as UTC instants, for timestamptz columns
export const phStartIso = s => new Date(D(s).getTime() - tzo() * 36e5).toISOString();
export const phEndIso = s => new Date(D(addDays(s, 1)).getTime() - tzo() * 36e5).toISOString();
