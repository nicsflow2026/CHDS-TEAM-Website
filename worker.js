const SYSTEM = `You are CHDS AI Support, the professional support assistant of CH Digital Services.
Scope: Facebook (and Instagram) account and page problems such as hacked, disabled, locked, restricted, lost admin access, 2FA lockout, impersonation, ad account issues, plus questions about our custom website service. Politely decline anything unrelated.
Behave like a senior intake specialist: acknowledge the problem in one sentence, ask at most two focused questions (what happened, when, whether they still have access to the linked email or phone, any error or notice shown), and ask for a screenshot of the error, notice or email when it would help. If the user's message contains "[Screenshot text extracted by OCR]", use it to understand the case and summarize what you see.
Strict rules: NEVER give step-by-step instructions, tutorials, tricks or methods for recovering, bypassing or accessing an account; explain that the CHDS team handles cases directly. Never ask for passwords, login codes or ID documents, and warn users never to share them. Never promise or guarantee recovery or timelines. Never invent prices or statistics. When the user wants a person, needs a quote or a case review, tell them to tap "Talk to a human". Keep replies under 4 short sentences. Reply in the user's language (English or Filipino).`;

const COMMANDS = [
  { command: "report", description: "Submit a report (recovered, earnings, date)" },
  { command: "myreports", description: "View or delete your recent reports" },
  { command: "delete", description: "Remove a report submitted by mistake" },
  { command: "chats", description: "Customer chats you joined" },
  { command: "cancel", description: "Cancel the current action" },
  { command: "help", description: "How to use this bot" }
];

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...h } });
const ids = v => new Set(String(v || "").split(",").map(s => s.trim()).filter(Boolean));
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const num = s => { const n = Number(String(s).replace(/[,₱$€£]/g, "")); return Number.isFinite(n) && n >= 0 && n <= 1e7 ? Math.round(n * 100) / 100 : null; };
const money = (env, n) => (env.CURRENCY || "$") + Number(n).toLocaleString("en-US");
const pend = r => r.st === "pending";
const SID = /^[a-f0-9]{16}$/;
const tz = env => (Number(env.TZ_OFFSET) || 0) * 36e5;
const dayOf = (env, t) => new Date(t + tz(env)).toISOString().slice(0, 10);
const team = env => [...new Set([...ids(env.ALLOWED_UIDS), ...ids(env.ADMIN_UIDS)])];
const hub = (env, b) => env.HUB.get(env.HUB.idFromName("main")).fetch("https://do/", { method: "POST", body: JSON.stringify(b) }).then(r => r.json());
const room = (env, sid, b) => env.ROOM.get(env.ROOM.idFromName(sid)).fetch("https://do/", { method: "POST", body: JSON.stringify(b) }).then(r => r.json());

/* ============ Durable Objects ============ */
export class Hub {
  constructor(state) { this.s = state.storage; }
  async fetch(req) {
    const q = await req.json(), S = this.s; let o = { ok: true };
    switch (q.op) {
      case "rp_all": o = (await S.get("R")) || []; break;
      case "rp_add": { const R = (await S.get("R")) || []; R.push(q.r); await S.put("R", R.slice(-5000)); break; }
      case "rp_del": { const R = (await S.get("R")) || [], i = R.findIndex(r => r.id === q.id); o = i < 0 ? null : R.splice(i, 1)[0]; if (i >= 0) await S.put("R", R); break; }
      case "rp_appr": {
        const R = (await S.get("R")) || [], i = R.findIndex(r => r.id === q.id);
        if (i < 0) o = null;
        else if (R[i].st !== "pending") o = { r: R[i], changed: false };
        else { R[i].st = "approved"; R[i].at = Date.now(); await S.put("R", R); o = { r: R[i], changed: true }; }
        break;
      }
      case "st_get": { const v = await S.get("st:" + q.uid); o = v && v.e > Date.now() ? v : null; break; }
      case "st_set": await S.put("st:" + q.uid, { ...q.v, e: Date.now() + 6e5 }); break;
      case "st_del": await S.delete("st:" + q.uid); break;
      case "rl": {
        const k = "rl:" + q.k, v = (await S.get(k)) || { n: 0, t: Date.now() };
        if (Date.now() - v.t > q.w) { v.n = 0; v.t = Date.now(); }
        v.n++; await S.put(k, v); o = { limited: v.n > q.max }; break;
      }
      case "mem_get": o = { sids: (await S.get("m:" + q.uid)) || [], act: (await S.get("a:" + q.uid)) || null }; break;
      case "mem_add": { const L = (await S.get("m:" + q.uid)) || []; if (!L.includes(q.sid)) L.push(q.sid); await S.put("m:" + q.uid, L); await S.put("a:" + q.uid, q.sid); break; }
      case "mem_rm": {
        const L = ((await S.get("m:" + q.uid)) || []).filter(x => x !== q.sid); await S.put("m:" + q.uid, L);
        if ((await S.get("a:" + q.uid)) === q.sid) await S.put("a:" + q.uid, L[L.length - 1] || null); break;
      }
      case "act_set": await S.put("a:" + q.uid, q.sid); break;
    }
    return Response.json(o);
  }
}

export class Room {
  constructor(state) { this.s = state.storage; }
  async fetch(req) {
    const q = await req.json(), now = Date.now();
    const s = (await this.s.get("s")) || { st: "ended", seq: 0, msgs: [], joined: {}, notif: [], name: "", t: 0 };
    const push = (f, t, a) => { s.msgs.push({ i: ++s.seq, f, t, a, x: now }); if (s.msgs.length > 200) s.msgs.shift(); };
    let o = { ok: true }, dirty = true;
    switch (q.op) {
      case "open":
        if (s.st !== "ended") { o = { ok: true, existing: true }; dirty = false; break; }
        Object.assign(s, { st: "wait", joined: {}, msgs: [], seq: 0, name: q.name, notif: [], t: now });
        push("sys", "Request sent. Please wait for CHDS human support to join. AI replies are paused until then."); break;
      case "notif": s.notif = q.n; break;
      case "join":
        if (s.st === "ended") { o = { ok: false }; dirty = false; break; }
        if (!s.joined[q.uid]) { s.joined[q.uid] = q.name; push("sys", `${q.name} from CHDS Support joined the chat.`); }
        s.st = "live";
        o = { ok: true, name: s.name, tail: s.msgs.filter(m => m.f === "user").slice(-5).map(m => m.t), others: Object.entries(s.joined).filter(([u]) => u !== q.uid).map(([u]) => u) }; break;
      case "exit": {
        if (!s.joined[q.uid]) { o = { ok: false }; dirty = false; break; }
        const nm = s.joined[q.uid]; delete s.joined[q.uid]; const left = Object.keys(s.joined);
        if (!left.length) { s.st = "ended"; push("sys", `${nm} left the chat. CHDS AI Support is back to assist you.`); o = { ok: true, ended: true, left, nm, notif: s.notif }; }
        else { push("sys", `${nm} left the chat.`); o = { ok: true, ended: false, left, nm }; }
        break;
      }
      case "msg":
        if (s.st === "ended") { o = { ok: false }; dirty = false; break; }
        push(q.f, q.t, q.a); o = { ok: true, joined: Object.keys(s.joined), name: s.name, st: s.st }; break;
      case "end": {
        if (s.st === "ended") { o = { ok: true, joined: [], notif: [] }; dirty = false; break; }
        const j = Object.keys(s.joined), n = s.notif; s.st = "ended"; s.joined = {};
        push("sys", "Chat closed. CHDS AI Support is back to assist you."); o = { ok: true, joined: j, notif: n, name: s.name }; break;
      }
      case "poll": {
        dirty = false;
        let expired = null;
        if (s.st === "wait" && now - s.t > 15 * 6e4) {
          const n = s.notif; s.st = "ended"; push("sys", "No agent is available right now. CHDS AI Support will keep assisting you, or message us on Telegram @chproofs."); expired = n; dirty = true;
        }
        o = { st: s.st, n: Object.keys(s.joined).length, msgs: s.msgs.filter(m => m.i > q.after && m.f !== "user").map(({ i, f, t, a }) => ({ i, f, t, a })), expired };
        break;
      }
      case "info": dirty = false; o = { st: s.st, joined: s.joined, name: s.name }; break;
    }
    if (dirty) await this.s.put("s", s);
    return Response.json(o);
  }
}

/* ============ HTTP ============ */
export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.pathname;
    const cors = { "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (p === "/api/stats" && req.method === "GET") return J(await stats(env), 200, { ...cors, "Cache-Control": "public, max-age=5" });
      if (p === "/api/chat" && req.method === "POST") return await chat(req, env, cors);
      if (p.startsWith("/api/human/")) return await human(req, env, u, cors);
      if (p === "/api/telegram" && req.method === "POST") {
        if (!env.WEBHOOK_SECRET || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
        try { await tgUpdate(await req.json(), env); } catch (e) { console.error(e); }
        return new Response("ok");
      }
      if (p === "/api/setup" && req.method === "POST") {
        if (!env.WEBHOOK_SECRET || req.headers.get("X-Setup-Key") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
        const call = async (m, b) => (await (await tg(env, m, b)).json()).ok;
        return J({
          webhook: await call("setWebhook", { url: u.origin + "/api/telegram", secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] }),
          commands: await call("setMyCommands", { commands: COMMANDS }),
          name: await call("setMyName", { name: "CHDS Report" })
        });
      }
    } catch (e) { console.error(e); return J({ error: "server_error" }, 500, cors); }
    return J({ error: "not_found" }, 404, cors);
  }
};

const limited = async (env, req, tag, max, w) => {
  const ip = req.headers.get("CF-Connecting-IP") || "x"; let h = 0;
  for (const c of ip) h = (h * 31 + c.charCodeAt(0)) % 512;
  return (await hub(env, { op: "rl", k: tag + h, max, w })).limited;
};

async function stats(env) {
  const R = (await hub(env, { op: "rp_all" })).filter(r => !pend(r)), S = {};
  for (let i = 29; i >= 0; i--) { const d = dayOf(env, Date.now() - i * 864e5); S[d] = { d, revenue: 0, recovered: 0 }; }
  let rec = 0, rev = 0;
  for (const r of R) { rec += r.recovered; rev += r.revenue; const s = S[r.d || dayOf(env, r.ts)]; if (s) { s.revenue += r.revenue; s.recovered += r.recovered; } }
  return {
    totals: { recovered: rec, revenue: Math.round(rev * 100) / 100, reports: R.length },
    series: Object.values(S),
    recent: R.slice(-6).reverse().map(({ n, recovered, revenue, ts }) => ({ n, recovered, revenue, ts })),
    updated: Date.now()
  };
}

async function chat(req, env, cors) {
  if (!env.GROQ_API_KEY) return J({ error: "not_configured" }, 503, cors);
  if (await limited(env, req, "c", 20, 6e4)) return J({ error: "rate_limited" }, 429, cors);
  const b = await req.json().catch(() => ({}));
  const m = (Array.isArray(b.messages) ? b.messages : []).slice(-8)
    .filter(x => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .map(x => ({ role: x.role, content: x.content.slice(0, 2500) }));
  if (!m.length || m[m.length - 1].role !== "user") return J({ error: "bad_request" }, 400, cors);
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.GROQ_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.GROQ_MODEL || "llama-3.3-70b-versatile", temperature: 0.3, max_tokens: 350, messages: [{ role: "system", content: SYSTEM }, ...m] })
  });
  if (!r.ok) return J({ error: "upstream" }, 502, cors);
  const j = await r.json();
  return J({ reply: (j.choices?.[0]?.message?.content || "").trim() || "Please tap “Talk to a human” and our team will assist you." }, 200, cors);
}

/* ============ Website <-> team live chat ============ */
const toBlob = u => {
  if (typeof u !== "string" || !u.startsWith("data:image/jpeg;base64,") || u.length > 1.6e6) return null;
  try { return new Blob([Uint8Array.from(atob(u.slice(23)), c => c.charCodeAt(0))], { type: "image/jpeg" }); } catch { return null; }
};
async function photos(env, chat, items) {
  const fd = new FormData(); fd.set("chat_id", String(chat));
  let method = "sendPhoto";
  if (items.length === 1) { const it = items[0]; it.b ? fd.set("photo", it.b, "shot.jpg") : fd.set("photo", it.f); }
  else {
    method = "sendMediaGroup";
    fd.set("media", JSON.stringify(items.map((it, i) => { if (it.b) { fd.set("f" + i, it.b, `shot${i}.jpg`); return { type: "photo", media: "attach://f" + i }; } return { type: "photo", media: it.f }; })));
  }
  const j = await (await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", body: fd })).json().catch(() => null);
  if (!j || !j.ok) return null;
  return items.length === 1 ? [j.result.photo.at(-1).file_id] : j.result.map(x => x.photo.at(-1).file_id);
}
const closeNotifs = (env, notif, text) => Promise.allSettled((notif || []).map(([c, m]) => tg(env, "editMessageText", { chat_id: c, message_id: m, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } })));

async function human(req, env, u, cors) {
  const p = u.pathname.slice(11), ok = (o, s = 200) => J(o, s, cors);
  if (p === "poll" && req.method === "GET") {
    const sid = u.searchParams.get("sid") || "";
    if (!SID.test(sid)) return ok({ error: "bad_request" }, 400);
    const o = await room(env, sid, { op: "poll", after: Math.max(0, +u.searchParams.get("after") || 0) });
    if (o.expired) await closeNotifs(env, o.expired, "⏹ <b>Request expired</b> — no one joined in time.");
    return ok({ st: o.st, n: o.n, msgs: o.msgs });
  }
  if (req.method !== "POST") return ok({ error: "not_found" }, 404);
  const b = await req.json().catch(() => ({})), sid = String(b.sid || "");
  if (!SID.test(sid)) return ok({ error: "bad_request" }, 400);
  if (await limited(env, req, "h", 40, 6e4)) return ok({ error: "rate_limited" }, 429);

  if (p === "request") {
    const members = team(env);
    if (!members.length) return ok({ error: "no_team" }, 503);
    const name = "Guest " + (parseInt(sid.slice(0, 4), 16) % 9000 + 1000);
    const op = await room(env, sid, { op: "open", name });
    if (op.existing) return ok({ ok: true, existing: true });
    const tr = (Array.isArray(b.tr) ? b.tr : []).slice(-10).map(x => `${x && x.r === "user" ? "👤" : "🤖"} ${String((x && x.c) || "").slice(0, 200)}`).join("\n") || "(no messages yet)";
    const ocr = String(b.ocr || "").slice(0, 400), blobs = (Array.isArray(b.imgs) ? b.imgs : []).slice(-3).map(toBlob).filter(Boolean);
    const text = `🆘 <b>Live support request</b>\nCustomer: <b>${name}</b> · <code>#${sid}</code>\n\n<b>Conversation</b>\n${esc(tr)}${ocr ? `\n\n📄 <b>Screenshot text (OCR)</b>\n${esc(ocr)}` : ""}\n\n📷 Screenshots: ${blobs.length}\n<i>Tap Accept to join this chat.</i>`;
    const kb = { inline_keyboard: [[{ text: "✅ Accept & join chat", callback_data: "ha:" + sid }]] };
    let fids = null; const notif = [];
    const send = async c => {
      if (blobs.length) { const f = await photos(env, c, fids ? fids.map(x => ({ f: x })) : blobs.map(x => ({ b: x }))); if (!f) return false; fids = fids || f; }
      const j = await (await say(env, c, text, { reply_markup: kb })).json().catch(() => null);
      if (!j || !j.ok) return false; notif.push([c, j.result.message_id]); return true;
    };
    let i = 0; for (; i < members.length; i++) if (await send(members[i])) { i++; break; }
    await Promise.allSettled(members.slice(i).map(send));
    if (!notif.length) { await room(env, sid, { op: "end" }); return ok({ error: "unreachable" }, 503); }
    await room(env, sid, { op: "notif", n: notif });
    return ok({ ok: true });
  }

  if (p === "send") {
    const t = String(b.text || "").trim().slice(0, 1000), blob = b.img ? toBlob(b.img) : null;
    if (!t && !blob) return ok({ error: "bad_request" }, 400);
    const o = await room(env, sid, { op: "msg", f: "user", t: t || "[screenshot]" });
    if (!o.ok) return ok({ st: "ended" });
    await Promise.allSettled(o.joined.map(async uid => {
      const cap = `💬 <b>${o.name}</b> <code>#${sid}</code>${t ? "\n" + esc(t) : ""}`;
      if (blob) { const fd = new FormData(); fd.set("chat_id", uid); fd.set("photo", blob, "shot.jpg"); fd.set("caption", cap); fd.set("parse_mode", "HTML"); await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, { method: "POST", body: fd }); }
      else await say(env, uid, cap);
    }));
    return ok({ ok: true, st: o.st });
  }

  if (p === "end") {
    const o = await room(env, sid, { op: "end" });
    await Promise.allSettled((o.joined || []).map(async uid => { await hub(env, { op: "mem_rm", uid, sid }); await say(env, uid, `⏹ <b>${o.name}</b> closed the chat <code>#${sid}</code>.`); }));
    if (o.notif && o.notif.length) await closeNotifs(env, o.notif, "⏹ <b>Session closed</b> by the customer.");
    return ok({ ok: true });
  }
  return ok({ error: "not_found" }, 404);
}

/* ============ CHDS Report bot ============ */
const tg = (env, m, b) => fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const say = (env, chat_id, text, extra = {}) => tg(env, "sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
const edit = (env, q, text, extra = {}) => tg(env, "editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text, parse_mode: "HTML", ...extra });
const help = admin => `<b>CHDS Report</b> · Team Console\n\n<b>Submit a report</b>\n/report <code>&lt;recovered&gt; &lt;earnings&gt; &lt;date&gt;</code>\nExample: <code>/report 3 150 2026-11-17</code>\nDate: <code>YYYY-MM-DD</code>, <code>today</code> or <code>yesterday</code>. Send /report alone for guided mode.\n\n<b>Manage reports</b>\n/myreports — your recent reports\n/delete <code>&lt;ID&gt;</code> — remove a report submitted by mistake\n\n<b>Customer chats</b>\nWhen a customer asks for human support you get an alert with an <b>Accept</b> button. Once joined, just type to reply (or reply to a specific customer message).\n/chats — chats you joined · /cancel — cancel current action\n${admin ? "\n<b>Admin</b>\n/pending — reports awaiting approval\n" : ""}\nReports appear on the public website only after admin approval.`;
const status = r => (pend(r) ? "⏳ Pending approval" : "✅ Published");
const card = (env, r) => `Reference: <code>${r.id}</code>\nDate: <b>${r.d || dayOf(env, r.ts)}</b>\nRecovered: <b>${r.recovered}</b>\nEarnings: <b>${money(env, r.revenue)}</b>\nStatus: ${status(r)}`;
const reviewKb = id => ({ inline_keyboard: [[{ text: "✅ Approve", callback_data: "a:" + id }, { text: "❌ Reject", callback_data: "r:" + id }]] });
const dateKb = env => ({ inline_keyboard: [[{ text: "📅 Today", callback_data: "dt:today" }, { text: "Yesterday", callback_data: "dt:yday" }]] });
const exitKb = sid => ({ inline_keyboard: [[{ text: "🚪 Exit chat", callback_data: "hx:" + sid }]] });

function parseDate(env, s) {
  const t = dayOf(env, Date.now()), v = String(s || "").toLowerCase();
  if (v === "today") return { d: t };
  if (v === "yesterday" || v === "yday") return { d: dayOf(env, Date.now() - 864e5) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { err: "Use the format <code>YYYY-MM-DD</code>, or <code>today</code> / <code>yesterday</code>." };
  const x = new Date(v + "T00:00:00Z");
  if (isNaN(x) || x.toISOString().slice(0, 10) !== v) return { err: "That date does not exist." };
  if (v > t) return { err: "The date cannot be in the future." };
  if (v < dayOf(env, Date.now() - 90 * 864e5)) return { err: "Reports older than 90 days cannot be submitted." };
  return { d: v };
}

async function tgUpdate(u, env) {
  const admins = ids(env.ADMIN_UIDS), members = ids(env.ALLOWED_UIDS);
  if (u.callback_query) return cbq(u.callback_query, env, admins, members);
  const m = u.message;
  if (!m || m.chat.type !== "private") return;
  const uid = String(m.from.id), cid = m.chat.id, isAdmin = admins.has(uid);
  if (!isAdmin && !members.has(uid)) return say(env, cid, "⛔ <b>Access restricted</b>\nThis bot is available to authorized CHDS team members only.");
  if (!m.text) return say(env, cid, "ℹ️ Only text messages can be sent to customers for now.");
  const text = m.text.trim(), [cmd, ...a] = text.split(/\s+/), c = cmd.split("@")[0].toLowerCase();

  if (c === "/start" || c === "/help") return say(env, cid, help(isAdmin));
  if (c === "/cancel") { await hub(env, { op: "st_del", uid }); return say(env, cid, "↩ Cancelled. Nothing was submitted."); }
  if (c === "/report") {
    if (a.length >= 3) return submit(env, m.from, cid, a[0], a[1], a[2], admins);
    if (a.length === 2) return askDate(env, cid, uid, a[0], a[1]);
    await hub(env, { op: "st_set", uid, v: { s: "rec" } });
    return say(env, cid, "📝 <b>New report</b>\nStep 1 of 3 — How many accounts did you recover?\n<i>Send a number, or /cancel to stop.</i>");
  }
  if (c === "/myreports") {
    const mine = (await hub(env, { op: "rp_all" })).filter(r => r.uid === uid), last = mine.slice(-5).reverse();
    if (!last.length) return say(env, cid, "📂 You have no reports yet. Use /report to submit one.");
    const ok = mine.filter(r => !pend(r));
    const body = last.map(r => `<code>${r.id}</code> · ${r.d || dayOf(env, r.ts)}\n${r.recovered} recovered · ${money(env, r.revenue)} · ${status(r)}`).join("\n\n");
    return say(env, cid, `📂 <b>Your recent reports</b>\n\n${body}\n\n<b>Published total:</b> ${ok.reduce((s, r) => s + r.recovered, 0)} recovered · ${money(env, ok.reduce((s, r) => s + r.revenue, 0))}\n\n<i>Tap a button to remove a report.</i>`,
      { reply_markup: { inline_keyboard: last.map(r => [{ text: "🗑 Delete " + r.id, callback_data: "dq:" + r.id }]) } });
  }
  if (c === "/pending" && isAdmin) {
    const P = (await hub(env, { op: "rp_all" })).filter(pend).slice(-10);
    if (!P.length) return say(env, cid, "✅ No reports awaiting approval.");
    for (const r of P) await say(env, cid, `📝 <b>Pending report</b>\nFrom: ${esc(r.n)}\n${card(env, r)}`, { reply_markup: reviewKb(r.id) });
    return;
  }
  if (c === "/delete") {
    const id = (a[0] || "").toUpperCase();
    if (!id) return say(env, cid, "Usage: <code>/delete ID</code>\nFind your report IDs with /myreports.");
    const r = (await hub(env, { op: "rp_all" })).find(x => x.id === id);
    if (!r) return say(env, cid, "⚠️ No report found with that ID. Check /myreports.");
    if (r.uid !== uid && !isAdmin) return say(env, cid, "⛔ You can only delete reports you submitted.");
    return confirmDelete(env, cid, r);
  }
  if (c === "/chats") {
    const { sids, act } = await hub(env, { op: "mem_get", uid });
    if (!sids.length) return say(env, cid, "💬 You are not in any customer chat.");
    const info = await Promise.all(sids.map(s => room(env, s, { op: "info" }).then(i => ({ s, i }))));
    return say(env, cid, `💬 <b>Your customer chats</b>\nActive for typing: <b>${esc((info.find(x => x.s === act) || {}).i?.name || "—")}</b>`,
      { reply_markup: { inline_keyboard: info.map(({ s, i }) => [{ text: `${s === act ? "● " : ""}${i.name}`, callback_data: "hs:" + s }, { text: "🚪 Exit", callback_data: "hx:" + s }]) } });
  }

  const st = await hub(env, { op: "st_get", uid });
  if (st && !text.startsWith("/")) {
    if (st.s === "rec") {
      if (!/^\d{1,4}$/.test(text)) return say(env, cid, "⚠️ Please send a whole number, for example <code>3</code>.");
      await hub(env, { op: "st_set", uid, v: { s: "rev", rec: text } });
      return say(env, cid, "Step 2 of 3 — What is the total earnings for these accounts?\n<i>Send a number, for example 150.</i>");
    }
    if (st.s === "rev") {
      if (num(text) === null) return say(env, cid, "⚠️ Please send a valid amount, for example <code>150</code>.");
      return askDate(env, cid, uid, st.rec, text);
    }
    const d = parseDate(env, text);
    if (d.err) return say(env, cid, "⚠️ " + d.err);
    return submit(env, m.from, cid, st.rec, st.rev, d.d, admins);
  }

  // customer chat routing: reply-to a customer message, otherwise the active chat
  const rt = m.reply_to_message, tag = ((rt && (rt.text || rt.caption)) || "").match(/#([a-f0-9]{16})/);
  const mem = await hub(env, { op: "mem_get", uid }), sid = tag && mem.sids.includes(tag[1]) ? tag[1] : mem.act;
  if (sid && !text.startsWith("/")) {
    const nm = m.from.first_name || "Agent", r = await room(env, sid, { op: "msg", f: "agent", t: text.slice(0, 1000), a: nm + " · CHDS Support" });
    if (!r.ok) { await hub(env, { op: "mem_rm", uid, sid }); return say(env, cid, "⏹ That chat has already ended."); }
    if (mem.sids.length > 1) return say(env, cid, `✓ Sent to <b>${esc(r.name)}</b>`);
    return;
  }
  return say(env, cid, "I didn't recognize that. Here is what I can do:\n\n" + help(isAdmin));
}

const askDate = async (env, cid, uid, rec, rev) => {
  if (!/^\d{1,4}$/.test(rec) || num(rev) === null) return say(env, cid, "⚠️ <b>Invalid report</b>\nUse: <code>/report 3 150 2026-11-17</code>\n(recovered, earnings, date)");
  await hub(env, { op: "st_set", uid, v: { s: "date", rec, rev } });
  return say(env, cid, `📅 <b>Step 3 of 3 — Report date</b>\nWhich day do these ${esc(rec)} recovery(ies) and ${money(env, num(rev) ?? 0)} belong to?\nTap a button or type <code>YYYY-MM-DD</code>.`, { reply_markup: dateKb(env) });
};
const confirmDelete = (env, cid, r) => say(env, cid, `🗑 <b>Delete this report?</b>\n\n${card(env, r)}\n\n<i>This cannot be undone.${pend(r) ? "" : " It will be removed from the public website."}</i>`,
  { reply_markup: { inline_keyboard: [[{ text: "🗑 Yes, delete", callback_data: "d:" + r.id }, { text: "↩ Keep it", callback_data: "x" }]] } });

async function submit(env, from, cid, rc, rv, dt, admins) {
  const uid = String(from.id), recovered = /^\d{1,4}$/.test(rc) ? +rc : null, revenue = num(rv), d = parseDate(env, dt);
  await hub(env, { op: "st_del", uid });
  if (recovered === null || revenue === null || d.err) return say(env, cid, `⚠️ <b>Invalid report</b>\n${d.err || "Check the numbers."}\nUse: <code>/report 3 150 2026-11-17</code>\n(recovered, earnings, date)`);
  const mine = (await hub(env, { op: "rp_all" })).filter(r => r.uid === uid), prev = mine[mine.length - 1];
  if (prev && prev.recovered === recovered && prev.revenue === revenue && prev.d === d.d && Date.now() - prev.ts < 120000)
    return say(env, cid, "⚠️ This looks like a duplicate of your last report. If it was a mistake, use /myreports to delete it.");
  const r = { id: "R" + crypto.randomUUID().slice(0, 5).toUpperCase(), uid, n: String(from.first_name || from.username || "Member").slice(0, 40), recovered, revenue, d: d.d, ts: Date.now(), st: admins.size ? "pending" : "approved" };
  await hub(env, { op: "rp_add", r });
  if (admins.size) await Promise.allSettled([...admins].map(a => say(env, a, `📝 <b>New report for review</b>\nFrom: ${esc(r.n)} (<code>${uid}</code>)\n${card(env, r)}`, { reply_markup: reviewKb(r.id) })));
  return say(env, cid, `✅ <b>Report received</b>\n\n${card(env, r)}\n\n${admins.size ? "An admin will review it shortly. " : ""}Made a mistake? Use <code>/delete ${r.id}</code>.`);
}

async function cbq(q, env, admins, members) {
  const uid = String(q.from.id), isAdmin = admins.has(uid), [act, id] = String(q.data || "").split(":"), cid = q.message.chat.id;
  const ans = (t, alert) => tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: t, show_alert: !!alert });
  if (!isAdmin && !members.has(uid)) return ans("Members only", true);
  if (act === "x") { await ans("Cancelled"); return edit(env, q, "↩ Cancelled. Nothing was changed."); }
  const nm = q.from.first_name || "Agent";

  /* ----- customer chat rooms ----- */
  if (act === "ha") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const o = await room(env, id, { op: "join", uid, name: nm });
    if (!o.ok) { await ans("This request has already ended.", true); return edit(env, q, "⏹ <b>Session closed</b> — this request has ended."); }
    await hub(env, { op: "mem_add", uid, sid: id }); await ans("You joined the chat");
    await edit(env, q, `✅ <b>You joined ${o.name}</b> · <code>#${id}</code>\nType here to reply to the customer (or reply to one of their messages). The customer no longer receives AI replies while an agent is in the chat.${o.others.length ? `\n👥 Other agents in this chat: ${o.others.length}` : ""}`, { reply_markup: exitKb(id) });
    if (o.tail.length) await say(env, cid, `🕘 <b>Latest customer messages</b>\n${o.tail.map(t => "• " + esc(t.slice(0, 300))).join("\n")}`);
    await Promise.allSettled(o.others.map(x => say(env, x, `👥 <b>${esc(nm)}</b> joined <b>${o.name}</b> <code>#${id}</code>.`)));
    return;
  }
  if (act === "hs") { await hub(env, { op: "act_set", uid, sid: id }); await ans("Active chat switched"); return edit(env, q, "✅ Active chat switched. Your next messages go to this customer."); }
  if (act === "hx") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const o = await room(env, id, { op: "exit", uid });
    await hub(env, { op: "mem_rm", uid, sid: id });
    if (!o.ok) { await ans("You are not in this chat.", true); return edit(env, q, "🚪 You are no longer in this chat."); }
    await ans("You left the chat");
    await edit(env, q, `🚪 <b>You left the chat</b> <code>#${id}</code>.${o.ended ? "\nYou were the last agent, so CHDS AI Support has resumed for this customer." : ""}`);
    if (o.ended) await closeNotifs(env, o.notif.filter(([c, m]) => !(String(c) === String(cid) && m === q.message.message_id)), "⏹ <b>Session closed</b> — the customer is back with CHDS AI Support.");
    else await Promise.allSettled(o.left.map(x => say(env, x, `🚪 <b>${esc(o.nm)}</b> left the chat <code>#${id}</code>.`)));
    return;
  }

  /* ----- report date step (guided) ----- */
  if (act === "dt") {
    const st = await hub(env, { op: "st_get", uid });
    if (!st || st.s !== "date") return ans("This report session expired. Send /report again.", true);
    const d = parseDate(env, id === "today" ? "today" : "yesterday");
    await ans(); await edit(env, q, `📅 Date selected: <b>${d.d}</b>`);
    return submit(env, q.from, cid, st.rec, st.rev, d.d, admins);
  }

  /* ----- report review / delete ----- */
  const all = await hub(env, { op: "rp_all" }), r = all.find(x => x.id === id), mine = r && r.uid === uid;
  if (!r) return ans("This report no longer exists.", true);
  if (act === "dq") { if (!mine && !isAdmin) return ans("You can only delete your own reports.", true); await ans(); return confirmDelete(env, cid, r); }
  if (act === "d") {
    if (!mine && !isAdmin) return ans("You can only delete your own reports.", true);
    const gone = await hub(env, { op: "rp_del", id });
    if (!gone) return ans("Already deleted.", true);
    await ans("Deleted");
    await edit(env, q, `🗑 <b>Report deleted</b>\nReference: <code>${r.id}</code>${pend(r) ? "" : "\nIt has been removed from the public website."}`);
    if (!pend(r)) await Promise.allSettled([...admins].filter(x => x !== uid).map(x => say(env, x, `🗑 <b>Published report removed</b>\nReference: <code>${r.id}</code>\nOwner: ${esc(r.n)}\nRemoved by: ${esc(nm)}\nWas: ${r.recovered} recovered · ${money(env, r.revenue)} · ${r.d || ""}`)));
    if (!mine) await say(env, r.uid, `🗑 An admin removed your report <code>${r.id}</code>.`);
    return;
  }
  if (act === "a" || act === "r") {
    if (!isAdmin) return ans("Admins only", true);
    if (!pend(r)) return ans("Already handled", true);
    if (act === "a") { const x = await hub(env, { op: "rp_appr", id }); if (!x || !x.changed) return ans("Already handled", true); }
    else await hub(env, { op: "rp_del", id });
    await ans(act === "a" ? "Approved" : "Rejected");
    await edit(env, q, `${act === "a" ? "✅ <b>Approved</b>" : "❌ <b>Rejected</b>"} · ${esc(r.n)}\n${r.recovered} recovered · ${money(env, r.revenue)} · ${r.d} · <code>${r.id}</code>`);
    return say(env, r.uid, act === "a" ? `✅ <b>Report approved</b>\n<code>${r.id}</code> is now live on the website. Thank you!` : `❌ <b>Report not approved</b>\n<code>${r.id}</code> was rejected by an admin. Please check the details and submit again if needed.`);
  }
}
