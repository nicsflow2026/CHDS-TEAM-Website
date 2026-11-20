// Image helpers for PUBLIC report photos (server only, no native dependencies).
//  * imageInfo(buf, mime)     -> { width, height } as displayed (JPEG EXIF orientation 5–8 swaps the axes)
//  * stripMetadata(buf, mime) -> a copy without EXIF / XMP / IPTC / comments / text chunks.
// Evidence photos can carry GPS coordinates, device serials and timestamps. Those must never reach the public
// bucket. The only EXIF field kept is JPEG Orientation (re-written as a minimal EXIF block) so photos are not
// shown rotated. Anything that cannot be parsed is REFUSED (throws) rather than published unprocessed.

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000;
const bad = m => { throw new Error("image: " + m); };

/* ---------------- JPEG ---------------- */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// Keep: APP0 (JFIF), APP2 (ICC colour profile), APP14 (Adobe colour transform) and all non-APP structural segments.
const DROP_JPEG = m => (m >= 0xe1 && m <= 0xef && m !== 0xe2 && m !== 0xee) || m === 0xfe;

function jpegSegments(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) bad("not a JPEG");
  const segs = []; let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) bad("corrupt JPEG marker");
    let j = i + 1;
    while (j < b.length && b[j] === 0xff) j++; // optional fill bytes before a marker
    if (j >= b.length) bad("truncated JPEG");
    const m = b[j]; i = j - 1;                 // segment starts at the 0xFF directly before the marker byte
    if (m === 0xd9) { segs.push({ m, start: i, end: i + 2 }); break; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { segs.push({ m, start: i, end: i + 2 }); i += 2; continue; }
    if (i + 4 > b.length) bad("truncated JPEG");
    const len = u16be(b, i + 2); if (len < 2) bad("bad JPEG segment length");
    const end = i + 2 + len; if (end > b.length) bad("truncated JPEG segment");
    if (m === 0xda) { segs.push({ m, start: i, end: b.length, scan: true }); break; } // entropy-coded data up to EOI: copied verbatim
    segs.push({ m, start: i, end }); i = end;
  }
  return segs;
}
function exifOrientation(b, seg) {
  const d = seg.start + 4; // after marker + length
  if (seg.end - d < 14 || b.toString("latin1", d, d + 6) !== "Exif\0\0") return 1;
  const t = d + 6, le = b[t] === 0x49 && b[t + 1] === 0x49, r16 = i => (le ? u16le(b, i) : u16be(b, i)), r32 = i => (le ? u32le(b, i) : u32be(b, i));
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return 1;
  const ifd = t + r32(t + 4); if (ifd + 2 > seg.end) return 1;
  const n = r16(ifd);
  for (let k = 0; k < n && ifd + 2 + k * 12 + 12 <= seg.end; k++) {
    const e = ifd + 2 + k * 12;
    if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}
function orientationApp1(o) { // minimal big-endian EXIF: IFD0 with the single Orientation tag
  const body = Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
}
function jpegInfo(b) {
  const segs = jpegSegments(b); let w = 0, h = 0, o = 1;
  for (const s of segs) {
    if (SOF.has(s.m)) { h = u16be(b, s.start + 5); w = u16be(b, s.start + 7); }
    if (s.m === 0xe1 && o === 1) o = exifOrientation(b, s);
  }
  if (!w || !h) bad("JPEG has no frame header");
  return { segs, width: o >= 5 ? h : w, height: o >= 5 ? w : h, orientation: o };
}
function jpegStrip(b) {
  const { segs, orientation } = jpegInfo(b);
  const out = [b.subarray(0, 2)]; let inserted = orientation === 1;
  for (const s of segs) {
    if (!inserted && s.m !== 0xe0) { out.push(orientationApp1(orientation)); inserted = true; }
    if (DROP_JPEG(s.m)) continue;
    out.push(b.subarray(s.start, s.end));
  }
  return Buffer.concat(out);
}

/* ---------------- PNG ---------------- */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DROP_PNG = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);
function pngChunks(b) {
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIG)) bad("not a PNG");
  const ch = []; let i = 8;
  while (i + 12 <= b.length) {
    const len = u32be(b, i), type = b.toString("latin1", i + 4, i + 8), end = i + 12 + len;
    if (end > b.length) bad("truncated PNG chunk");
    ch.push({ type, start: i, end }); i = end;
    if (type === "IEND") break;
  }
  if (!ch.length || ch[0].type !== "IHDR") bad("PNG has no IHDR");
  return ch;
}
const pngInfo = b => { pngChunks(b); return { width: u32be(b, 16), height: u32be(b, 20) }; };
const pngStrip = b => Buffer.concat([PNG_SIG, ...pngChunks(b).filter(c => !DROP_PNG.has(c.type)).map(c => b.subarray(c.start, c.end))]);

/* ---------------- WebP ---------------- */
function webpChunks(b) {
  if (b.length < 20 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") bad("not a WebP");
  const ch = []; let i = 12;
  while (i + 8 <= b.length) {
    const type = b.toString("latin1", i, i + 4), len = u32le(b, i + 4), end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) bad("truncated WebP chunk");
    ch.push({ type, start: i, data: i + 8, len, end: Math.min(end, b.length) }); i = end;
  }
  if (!ch.length) bad("empty WebP");
  return ch;
}
function webpInfo(b) {
  for (const c of webpChunks(b)) {
    const d = c.data;
    if (c.type === "VP8X" && c.len >= 10) return { width: 1 + (b[d + 4] | (b[d + 5] << 8) | (b[d + 6] << 16)), height: 1 + (b[d + 7] | (b[d + 8] << 8) | (b[d + 9] << 16)) };
    if (c.type === "VP8 " && c.len >= 10 && b[d + 3] === 0x9d && b[d + 4] === 0x01 && b[d + 5] === 0x2a) return { width: u16le(b, d + 6) & 0x3fff, height: u16le(b, d + 8) & 0x3fff };
    if (c.type === "VP8L" && c.len >= 5 && b[d] === 0x2f) { const v = u32le(b, d + 1); return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }; }
  }
  bad("WebP has no image header");
}
function webpStrip(b) {
  const keep = webpChunks(b).filter(c => c.type !== "EXIF" && c.type !== "XMP ").map(c => Buffer.from(b.subarray(c.start, c.end)));
  for (const c of keep) if (c.toString("latin1", 0, 4) === "VP8X") c[8] &= ~0x0c; // clear the EXIF (0x08) and XMP (0x04) flags
  const body = Buffer.concat(keep), head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1"); head.writeUInt32LE(body.length + 4, 4); head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}

/* ---------------- public API ---------------- */
export const PUBLIC_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export function imageInfo(buf, mime) {
  const i = mime === "image/jpeg" ? jpegInfo(buf) : mime === "image/png" ? pngInfo(buf) : mime === "image/webp" ? webpInfo(buf) : bad("unsupported type " + mime);
  if (!(i.width > 0 && i.height > 0 && i.width <= 20000 && i.height <= 20000)) bad("implausible dimensions");
  return { width: i.width, height: i.height };
}
export function stripMetadata(buf, mime) {
  if (mime === "image/jpeg") return jpegStrip(buf);
  if (mime === "image/png") return pngStrip(buf);
  if (mime === "image/webp") return webpStrip(buf);
  return bad("unsupported type " + mime);
}
// Testing aid: does a buffer still contain metadata markers we strip?
export function hasMetadata(buf, mime) {
  if (mime === "image/jpeg") return jpegSegments(buf).some(s => (s.m === 0xe1 && buf.toString("latin1", s.start + 4, s.start + 8) !== "Exif") || s.m === 0xed || s.m === 0xfe || (s.m === 0xe1 && s.end - s.start > 40));
  if (mime === "image/png") return pngChunks(buf).some(c => DROP_PNG.has(c.type));
  if (mime === "image/webp") return webpChunks(buf).some(c => c.type === "EXIF" || c.type === "XMP ");
  return false;
}
