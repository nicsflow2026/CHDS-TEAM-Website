import { api, E, rpc, sb, say, photos, toBlob, closeNotifs, team, esc, SID, limited, jsonBody } from "../../lib/core.js";
export default api(async (req, res) => {
  const a = String(req.query.a || ""), no = s => res.status(s).json({ error: s === 404 ? "not_found" : "bad_request" });
  res.setHeader("Cache-Control", "no-store");
  if (a === "poll" && req.method === "GET") {
    const sid = String(req.query.sid || ""); if (!SID.test(sid)) return no(400);
    const o = await rpc("poll_session", { p_sid: sid, p_after: Math.max(0, parseInt(req.query.after) || 0) });
    if (o.expired && o.expired.length) await closeNotifs(o.expired, "⏹ <b>Request expired</b> — no one joined in time.");
    return res.json({ st: o.st, n: o.n, msgs: o.msgs });
  }
  if (req.method !== "POST") return no(404);
  const b = jsonBody(req), sid = String(b.sid || "");
  if (!SID.test(sid)) return no(400);
  if (await limited(req, "human", 40, 60)) return res.status(429).json({ error: "rate_limited" });

  if (a === "request") {
    if (!E.BOT_TOKEN) return res.status(503).json({ error: "not_configured" });
    if (await limited(req, "hreq", 3, 600)) return res.status(429).json({ error: "rate_limited" }); // stops alert spam to the team
    const members = team(); if (!members.length) return res.status(503).json({ error: "no_team" });
    const name = "Guest " + (parseInt(sid.slice(0, 4), 16) % 9000 + 1000);
    const op = await rpc("open_session", { p_sid: sid, p_name: name });
    if (op.existing) return res.json({ ok: true, existing: true });
    const rows = (Array.isArray(b.tr) ? b.tr : []).slice(-10), ocr = String(b.ocr || "").slice(0, 300), blobs = (Array.isArray(b.imgs) ? b.imgs : []).slice(-3).map(toBlob).filter(Boolean);
    const build = n => `🆘 <b>Live support request</b>\nCustomer: <b>${name}</b> · <code>#${sid}</code>\n\n<b>Conversation</b>\n${esc(rows.map(x => `${x && x.r === "user" ? "👤" : "🤖"} ${String((x && x.c) || "").slice(0, n)}`).join("\n") || "(no messages yet)")}${ocr ? `\n\n📄 <b>Screenshot text (OCR)</b>\n${esc(ocr)}` : ""}\n\n📷 Screenshots: ${blobs.length}\n<i>Tap Accept to join this chat.</i>`;
    let text = build(160); if (text.length > 3800) text = build(50); // never cut inside an HTML entity
    const kb = { inline_keyboard: [[{ text: "✅ Accept & join chat", callback_data: "ha:" + sid }]] };
    let fids = null; const notif = [];
    const send = async c => {
      if (blobs.length) { const f = await photos(c, fids ? fids.map(x => ({ f: x })) : blobs.map(x => ({ b: x }))); if (!f) return false; fids = fids || f; }
      const j = await say(c, text, { reply_markup: kb });
      if (!j.ok) return false; notif.push([c, j.result.message_id]); return true;
    };
    let i = 0; for (; i < members.length; i++) if (await send(members[i])) { i++; break; }
    await Promise.allSettled(members.slice(i).map(send));
    if (!notif.length) { await rpc("end_session", { p_sid: sid }); return res.status(503).json({ error: "unreachable" }); }
    await sb(`/sessions?sid=eq.${sid}`, { method: "PATCH", body: { notif }, prefer: "return=minimal" });
    return res.json({ ok: true });
  }

  if (a === "send") {
    const t = String(b.text || "").trim().slice(0, 1000), blob = b.img ? toBlob(b.img) : null;
    if (!t && !blob) return no(400);
    const o = await rpc("post_message", { p_sid: sid, p_sender: "user", p_author: null, p_body: t || "[screenshot]" });
    if (!o.ok) return res.json({ st: "ended" });
    await Promise.allSettled(o.joined.map(async uid => {
      const cap = `💬 <b>${esc(o.name)}</b> <code>#${sid}</code>${t ? "\n" + esc(t) : ""}`;
      if (blob) await photos(uid, [{ b: blob }], cap); else await say(uid, cap);
    }));
    return res.json({ ok: true, st: o.st });
  }

  if (a === "end") {
    const o = await rpc("end_session", { p_sid: sid });
    await Promise.allSettled((o.joined || []).map(uid => say(uid, `⏹ <b>${esc(o.name)}</b> closed the chat <code>#${sid}</code>.`)));
    if (o.notif && o.notif.length) await closeNotifs(o.notif, "⏹ <b>Session closed</b> by the customer.");
    return res.json({ ok: true });
  }
  return no(404);
});
