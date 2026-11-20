
const NAME_OK = /^[\p{L}\p{M}\p{N} '’\-.,()]+$/u;
export function cleanName(v, { min = 2, max = 60 } = {}) {
  if (typeof v !== "string") return { error: "Please enter your name." };
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u.test(v.replace(/[\t\n\r]/g, " "))) return { error: "Your name contains characters that are not allowed." };
  const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s) return { error: "Please enter your name." };
  const len = [...s].length;
  if (len < min) return { error: `Please enter at least ${min} characters.` };
  if (len > max) return { error: `Please keep it under ${max + 1} characters.` };
  if (!NAME_OK.test(s)) return { error: "Please use letters, spaces, hyphens or apostrophes only." };
  if (!/\p{L}/u.test(s)) return { error: "Your name must contain at least one letter." };
  return { value: s };
}

export function text(v, { min = 0, max = 500, multiline = false, required = false, label = "This field" } = {}) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string" && typeof v !== "number") return { error: `${label} is invalid.` };
  let s = String(v).normalize("NFC");
  s = multiline ? s.replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n\t]/gu, "").replace(/\n{4,}/g, "\n\n\n") : s.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ");
  s = s.replace(/[\p{Cf}]/gu, "").trim();
  if (!s && (required || min > 0)) return { error: `${label} is required.` };
  if ([...s].length < min) return { error: `${label} must be at least ${min} characters.` };
  if ([...s].length > max) return { error: `${label} must be at most ${max} characters.` };
  return { value: s };
}

export const oneOf = (v, list, fallback = null) => (list.includes(v) ? v : fallback);
export const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export const int = (v, lo, hi) => { const n = typeof v === "number" ? v : /^-?\d+$/.test(String(v ?? "").trim()) ? Number(v) : NaN; return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
export const amount = v => { const s = String(v ?? "").replace(/[,₱\s]/g, ""); if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return null; const n = Number(s); return n <= 1e7 ? n : null; };
export const httpsUrl = (v, hosts) => {
  if (!v) return { value: null };
  try {
    const u = new URL(String(v).trim());
    if (u.protocol !== "https:" || u.username || u.password) return { error: "Use a full https:// link." };
    if (hosts && !hosts.some(h => u.hostname === h || u.hostname.endsWith("." + h))) return { error: `Link must be on ${hosts.join(" or ")}.` };
    return { value: u.toString() };
  } catch { return { error: "That link is not valid." }; }
};
export const tgUsername = v => { if (!v) return { value: null }; const s = String(v).trim().replace(/^@/, ""); return /^[A-Za-z0-9_]{4,32}$/.test(s) ? { value: s } : { error: "Telegram username: 4–32 letters, digits or underscores." }; };

const SIGS = [
  ["image/jpeg", b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, "jpg"],
  ["image/png", b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a, "png"],
  ["image/webp", b => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP", "webp"],
  ["application/pdf", b => b.slice(0, 5).toString("latin1") === "%PDF-", "pdf"]
];
export function decodeFile(dataUrl, { allow, maxBytes }) {
  if (typeof dataUrl !== "string") return { error: "No file received." };
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.slice(0, maxBytes * 1.4 + 200));
  if (!m) return { error: "File could not be read." };
  let buf; try { buf = Buffer.from(m[2], "base64"); } catch { return { error: "File could not be read." }; }
  if (!buf.length) return { error: "File is empty." };
  if (buf.length > maxBytes) return { error: `File is larger than ${Math.round(maxBytes / 1048576 * 10) / 10} MB.` };
  const sig = SIGS.find(([mime, test]) => allow.includes(mime) && buf.length > 12 && test(buf));
  if (!sig) return { error: `Allowed file types: ${allow.map(x => x.split("/")[1].toUpperCase()).join(", ")}.` };
  return { buf, mime: sig[0], ext: sig[2] };
}

export const csvCell = v => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (cols, rows) => "\ufeff" + [cols.map(c => csvCell(c[1])).join(","), ...rows.map(r => cols.map(c => csvCell(typeof c[0] === "function" ? c[0](r) : r[c[0]])).join(","))].join("\r\n") + "\r\n";
