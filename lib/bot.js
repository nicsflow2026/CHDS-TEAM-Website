import { E, ids, esc, num, money, dayOf, SID, RID, UID, sb, rpc, say, tg, edit, closeNotifs, statsData, settings, audit, q, team, warn } from "./core.js";
import { notifyText } from "./notify.js";
import { isActiveMember, announceAccepted, detailsText, queueText, recipients } from "./handoff.js";
import { principal, can } from "./rbac.js";

export const COMMANDS = [
  { command: "report", description: "Submit a report (recovered, earnings, date)" },
  { command: "myreports", description: "View or delete your recent reports" },
  { command: "total", description: "Total earnings (team and yours)" },
  { command: "delete", description: "Remove a report submitted by mistake" },
  { command: "chats", description: "Customer chats you accepted" },
  { command: "queue", description: "Support requests waiting for an agent" },
  { command: "online", description: "Mark yourself available for support requests" },
  { command: "offline", description: "Mark yourself unavailable" },
  { command: "cancel", description: "Cancel the current action" },
  { command: "help", description: "How to use this bot" }
];
const envAdmins = () => ids(E.ADMIN_UIDS);
// Report approvers: ADMIN_UIDS plus dashboard staff whose role grants approve_reports
async function isApprover(uid) {
  if (envAdmins().has(uid)) return true;
  try { return can(await principal(uid), "approve_reports"); } catch (e) { console.error("approver lookup", String(e.message).slice(0, 100)); return false; }
}
async function approverUids() {
  const set = new Set(envAdmins());
  try {
    const rows = await sb("/admin_users?status=eq.active&deleted_at=is.null&source=eq.db&select=uid,grants,role:roles(id,permissions)");
    for (const r of rows) if (r.role && (r.role.id === "founder" || (r.role.permissions || []).includes("approve_reports") || (r.grants || []).includes("approve_reports"))) set.add(r.uid);
  } catch (e) { console.error("approver list", String(e.message).slice(0, 100)); }
  return [...set];
}
const pend = r => r.status === "pending" || r.status === "reviewed";
const help = admin => `<b>CHDS Report</b> · Team Console\n\n<b>Submit a report</b>\n/report <code>&lt;recovered&gt; &lt;earnings&gt; &lt;date&gt;</code>\nExample: <code>/report 3 150 2026-11-17</code>\nDate: <code>YYYY-MM-DD</code>, <code>today</code> or <code>yesterday</code>. Send /report alone for guided mode.\n\n<b>Manage reports</b>\n/myreports — your recent reports\n/total — total earnings (team and yours)\n/delete <code>&lt;ID&gt;</code> — remove a report submitted by mistake\n\n<b>Customer support</b>\nWhen a customer asks for a human you get an alert with <b>Accept Request</b> and <b>View Details</b>. Only one agent can accept a request. Once accepted, just type to reply (or reply to a specific customer message). Use <b>Return to AI</b> or <b>Resolve</b> when you are done.\n/chats — chats you accepted · /queue — waiting requests\n/online · /offline — your availability · /cancel — cancel current action\n${admin ? "\n<b>Approver</b>\n/pending — reports awaiting approval\n" : ""}\nReports appear on the public website only after approval.`;
const STATUS = { pending: "⏳ Pending approval", reviewed: "🔎 Reviewed, awaiting approval", approved: "✅ Published", rejected: "❌ Rejected" };
const card = r => `Reference: <code>${r.id}</code>\nDate: <b>${r.report_date}</b>\nRecovered: <b>${r.recovered}</b>\nEarnings: <b>${money(r.revenue)}</b>\nStatus: ${STATUS[r.status] || r.status}${r.status === "rejected" && r.rejection_reason ? `\nReason: ${esc(r.rejection_reason)}` : ""}`;
const reviewKb = id => ({ inline_keyboard: [[{ text: "✅ Approve", callback_data: "a:" + id }, { text: "❌ Reject", callback_data: "r:" + id }]] });
const dateKb = { inline_keyboard: [[{ text: "📅 Today", callback_data: "dt:today" }, { text: "Yesterday", callback_data: "dt:yday" }]] };
const agentKb = sid => ({ inline_keyboard: [[{ text: "↩ Return to AI", callback_data: "hx:" + sid }, { text: "✅ Resolve", callback_data: "hz:" + sid }]] });

/* ---- data access ---- */
const getReport = async id => (RID.test(id) ? (await sb(`/reports?id=eq.${id}&deleted_at=is.null&select=*`))[0] : null) || null;
const stGet = async uid => (await sb(`/bot_state?uid=eq.${uid}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=state`))[0]?.state || null;
const stSet = (uid, s) => sb("/bot_state?on_conflict=uid", { method: "POST", body: { uid, state: s, expires_at: new Date(Date.now() + 6e5).toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
const stDel = uid => sb(`/bot_state?uid=eq.${uid}`, { method: "DELETE" });
async function agentName(uid, from) {
  const m = (await sb(`/team_members?telegram_uid=eq.${q(uid)}&deleted_at=is.null&select=display_name`).catch(warn("agent name lookup", [])))[0];
  return String((m && m.display_name) || from.first_name || from.username || "Agent").slice(0, 40);
}

export function parseDate(s) {
  const t = dayOf(Date.now()), v = String(s || "").toLowerCase();
  if (v === "today") return { d: t };
  if (v === "yesterday" || v === "yday") return { d: dayOf(Date.now() - 864e5) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { err: "Use the format <code>YYYY-MM-DD</code>, or <code>today</code> / <code>yesterday</code>." };
  const x = new Date(v + "T00:00:00Z");
  if (isNaN(x) || x.toISOString().slice(0, 10) !== v) return { err: "That date does not exist." };
  if (v > t) return { err: "The date cannot be in the future." };
  if (v < dayOf(Date.now() - 90 * 864e5)) return { err: "Reports older than 90 days cannot be submitted." };
  return { d: v };
}

const askDate = async (cid, uid, rec, rev) => {
  if (!/^\d{1,4}$/.test(rec) || num(rev) === null) return say(cid, "⚠️ <b>Invalid report</b>\nUse: <code>/report 3 150 2026-11-17</code>\n(recovered, earnings, date)");
  await stSet(uid, { s: "date", rec, rev });
  return say(cid, `📅 <b>Step 3 of 3 — Report date</b>\nWhich day do these ${esc(rec)} recovery(ies) and ${money(num(rev))} belong to?\nTap a button or type <code>YYYY-MM-DD</code>.`, { reply_markup: dateKb });
};
const confirmDelete = (cid, r) => say(cid, `🗑 <b>Delete this report?</b>\n\n${card(r)}\n\n<i>It is kept in the history for auditing.${r.status === "approved" ? " It will be removed from the public website." : ""}</i>`,
  { reply_markup: { inline_keyboard: [[{ text: "🗑 Yes, delete", callback_data: "d:" + r.id }, { text: "↩ Keep it", callback_data: "x" }]] } });

async function submit(from, cid, rc, rv, dt) {
  const uid = String(from.id), recovered = /^\d{1,4}$/.test(rc) ? +rc : null, revenue = num(rv), d = parseDate(dt);
  await stDel(uid);
  if ((await settings()).emergency.reports_disabled) return say(cid, "⏸ Report submissions are temporarily disabled by an admin. Please try again later.");
  if (recovered === null || revenue === null || d.err) return say(cid, `⚠️ <b>Invalid report</b>\n${d.err || "Check the numbers."}\nUse: <code>/report 3 150 2026-11-17</code>\n(recovered, earnings, date)`);
  const prev = (await sb(`/reports?uid=eq.${uid}&deleted_at=is.null&order=created_at.desc&limit=1&select=*`))[0];
  if (prev && prev.recovered === recovered && Number(prev.revenue) === revenue && prev.report_date === d.d && Date.now() - Date.parse(prev.created_at) < 120000)
    return say(cid, "⚠️ This looks like a duplicate of your last report. If it was a mistake, use /myreports to delete it.");
  const auto = envAdmins().has(uid) || /^(1|true|yes|on)$/i.test(String(E.AUTO_APPROVE || "").trim()); // admins / AUTO_APPROVE publish instantly
  const approvers = await approverUids();
  const needs = approvers.length > 0 && !auto;
  const r = { uid, name: String(from.first_name || from.username || "Member").slice(0, 40), recovered, revenue, report_date: d.d, status: needs ? "pending" : "approved",
    created_at: new Date().toISOString(), source: "telegram", submitted_by: "tg:" + uid, ...(needs ? {} : { approved_at: new Date().toISOString(), reviewed_by: "auto-approved" }) };
  for (let i = 0; ; i++) {
    r.id = "R" + crypto.randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
    try { await sb("/reports", { method: "POST", body: r, prefer: "return=minimal" }); break; } catch (e) { if (i >= 2) throw e; }
  }
  if (needs) await Promise.allSettled(approvers.map(a => notifyText("report_review", r.id, a, `📝 <b>New report for review</b>\nFrom: ${esc(r.name)} (<code>${uid}</code>)\n${card(r)}`, { reply_markup: reviewKb(r.id) })));
  return say(cid, `✅ <b>Report received</b>\n\n${card(r)}\n\n${needs ? "An approver will review it first. It appears on the website after approval. " : "It is now live on the website. "}Made a mistake? Use <code>/delete ${r.id}</code>.`);
}

async function handback(uid, cid, st, summaryText) {
  const lines = String(summaryText || "").split("\n").map(s => s.trim()).filter(Boolean);
  const open = lines.filter(l => /^open\s*:/i.test(l)).map(l => l.replace(/^open\s*:\s*/i, "")).join("; ");
  const summary = lines.filter(l => !/^open\s*:/i.test(l)).join(" ").slice(0, 2000);
  const o = await rpc("return_to_ai", { p_sid: st.sid, p_actor: "tg:" + uid, p_actor_uid: uid, p_force: false, p_summary: summary || null, p_unresolved: open || null, p_resolve: st.mode === "resolve" });
  await stDel(uid);
  if (!o.ok) return say(cid, o.reason === "not_owner" ? "⛔ Only the agent who accepted this request can hand it back." : "⏹ That chat has already ended.");
  await audit("tg:" + uid, st.mode === "resolve" ? "handoff_resolved" : "handoff_returned_to_ai", { summary: summary.slice(0, 300), unresolved: open.slice(0, 300) }, { target: o.request_id || st.sid });
  await closeNotifs(o.notif || [], `⏹ <b>${esc(o.request_id || "Session")}</b> ${st.mode === "resolve" ? "was resolved" : "was returned to AI"} by ${esc(o.nm)}.`);
  const { rows } = await queueText();
  return say(cid, `${st.mode === "resolve" ? "✅ <b>Marked resolved</b>" : "↩ <b>Returned to CHDS AI Support</b>"} · <code>${esc(o.request_id || "#" + st.sid)}</code>\nThe customer was notified${summary ? " and your summary was saved for the AI and the dashboard" : ""}.${rows.length ? `\n\n⏳ ${rows.length} request(s) waiting — /queue` : ""}`);
}

/* ---- messages ---- */
export async function tgUpdate(u) {
  if (u.callback_query) return cbq(u.callback_query);
  const m = u.message;
  if (!m || !m.from || m.chat.type !== "private") return;
  const uid = String(m.from.id), cid = m.chat.id;
  if (!UID.test(uid)) return;
  const approver = await isApprover(uid);
  if (!approver && !(await isActiveMember(uid))) return say(cid, "⛔ <b>Access restricted</b>\nThis bot is available to authorized CHDS team members only.");
  if (!m.text) return say(cid, "ℹ️ Only text messages can be sent to customers for now.");
  const text = m.text.trim(), [cmd, ...a] = text.split(/\s+/), c = cmd.split("@")[0].toLowerCase();

  if (c === "/start" || c === "/help") return say(cid, help(approver));
  if (c === "/cancel") { await stDel(uid); return say(cid, "↩ Cancelled. Nothing was submitted."); }
  if (c === "/report") {
    if (a.length >= 3) return submit(m.from, cid, a[0], a[1], a[2]);
    if (a.length === 2) return askDate(cid, uid, a[0], a[1]);
    await stSet(uid, { s: "rec" });
    return say(cid, "📝 <b>New report</b>\nStep 1 of 3 — How many accounts did you recover?\n<i>Send a number, or /cancel to stop.</i>");
  }
  if (c === "/total") {
    const [st, mine, pen] = await Promise.all([statsData(), rpc("user_totals", { p_uid: uid }), sb(`/reports?uid=eq.${uid}&status=in.(pending,reviewed)&deleted_at=is.null&select=recovered,revenue`)]);
    const w = st.series.slice(-7), sum = (arr, k) => arr.reduce((x, r) => x + r[k], 0), today = st.series.at(-1);
    const pv = pen.reduce((x, r) => x + Number(r.revenue), 0);
    return say(cid, `💰 <b>Total earnings</b> <i>(published reports)</i>\n\n<b>Team:</b> ${money(st.totals.revenue)} · ${st.totals.recovered} recovered · ${st.totals.reports} reports\nToday: ${money(today.revenue)} · Last 7 days: ${money(sum(w, "revenue"))}\n\n<b>You:</b> ${money(mine.revenue)} · ${mine.recovered} recovered${pen.length ? `\n⏳ Waiting for approval: ${money(pv)} (${pen.length} report${pen.length > 1 ? "s" : ""})` : ""}`);
  }
  if (c === "/myreports") {
    const last = await sb(`/reports?uid=eq.${uid}&deleted_at=is.null&order=created_at.desc&limit=5&select=*`);
    if (!last.length) return say(cid, "📂 You have no reports yet. Use /report to submit one.");
    const t = await rpc("user_totals", { p_uid: uid });
    const body = last.map(r => `<code>${r.id}</code> · ${r.report_date}\n${r.recovered} recovered · ${money(r.revenue)} · ${STATUS[r.status] || r.status}`).join("\n\n");
    return say(cid, `📂 <b>Your recent reports</b>\n\n${body}\n\n<b>Published total:</b> ${t.recovered} recovered · ${money(t.revenue)}\n\n<i>Tap a button to remove a report.</i>`,
      { reply_markup: { inline_keyboard: last.map(r => [{ text: "🗑 Delete " + r.id, callback_data: "dq:" + r.id }]) } });
  }
  if (c === "/pending" && approver) {
    const P = await sb("/reports?status=in.(pending,reviewed)&deleted_at=is.null&order=created_at.asc&limit=10&select=*");
    if (!P.length) return say(cid, "✅ No reports awaiting approval.");
    for (const r of P) await say(cid, `📝 <b>Pending report</b>\nFrom: ${esc(r.name)}\n${card(r)}`, { reply_markup: reviewKb(r.id) });
    return;
  }
  if (c === "/delete") {
    const id = (a[0] || "").toUpperCase();
    if (!id) return say(cid, "Usage: <code>/delete ID</code>\nFind your report IDs with /myreports.");
    const r = await getReport(id);
    if (!r) return say(cid, "⚠️ No report found with that ID. Check /myreports.");
    if (r.uid !== uid && !approver) return say(cid, "⛔ You can only delete reports you submitted.");
    return confirmDelete(cid, r);
  }
  if (c === "/chats") {
    const ac = await rpc("agent_chats", { p_uid: uid }), L = ac.chats || [];
    if (!L.length) return say(cid, "💬 You are not in any customer chat. /queue shows waiting requests.");
    const act = L.some(x => x.sid === ac.act) ? ac.act : L[L.length - 1].sid;
    return say(cid, `💬 <b>Your customer chats</b>\nActive for typing: <b>${esc(L.find(x => x.sid === act).name)}</b>`,
      { reply_markup: { inline_keyboard: L.map(x => [{ text: `${x.sid === act ? "● " : ""}${x.name}`, callback_data: "hs:" + x.sid }, { text: "↩ Return to AI", callback_data: "hx:" + x.sid }]) } });
  }
  if (c === "/queue" || c === "/online") {
    if (c === "/online") await sb("/agents?on_conflict=uid", { method: "POST", body: { uid, available: true, available_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
    const { rows, text: qt } = await queueText();
    return say(cid, (c === "/online" ? "🟢 You are marked <b>available</b>.\n\n" : "") + qt,
      rows.length ? { reply_markup: { inline_keyboard: rows.map(r => [{ text: `✅ Accept ${r.id}`, callback_data: "ha:" + r.sid }, { text: "🔎 Details", callback_data: "hd:" + r.sid }]) } } : {});
  }
  if (c === "/offline") {
    await sb("/agents?on_conflict=uid", { method: "POST", body: { uid, available: false, available_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
    return say(cid, "⚪ You are marked <b>unavailable</b>. You still receive new-request alerts as a configured team member; /online to switch back.");
  }

  const st = await stGet(uid);
  if (st && st.s === "hb" && (c === "/skip" || !text.startsWith("/"))) return handback(uid, cid, st, c === "/skip" ? "" : text);
  if (st && st.s === "rej" && !text.startsWith("/")) {
    if (text.length < 3) return say(cid, "⚠️ Please write a short reason (at least 3 characters), or /cancel.");
    await stDel(uid);
    const o = await rpc("report_review", { p_id: st.id, p_actor: "tg:" + uid, p_action: "reject", p_reason: text.slice(0, 500), p_note: null });
    if (!o.ok) return say(cid, o.error === "already_handled" ? "ℹ️ This report was already handled." : "⚠️ Could not reject the report.");
    await audit("tg:" + uid, "report_rejected", { reason: text.slice(0, 300) }, { target: st.id });
    await say(cid, `❌ <b>Rejected</b> <code>${st.id}</code>\nReason: ${esc(text.slice(0, 300))}`);
    return say(o.report.uid, `❌ <b>Report not approved</b>\n<code>${st.id}</code> was rejected.\nReason: ${esc(text.slice(0, 300))}\nPlease check the details and submit again if needed.`);
  }
  if (st && !text.startsWith("/")) {
    if (st.s === "rec") {
      if (!/^\d{1,4}$/.test(text)) return say(cid, "⚠️ Please send a whole number, for example <code>3</code>.");
      await stSet(uid, { s: "rev", rec: text });
      return say(cid, "Step 2 of 3 — What is the total earnings for these accounts?\n<i>Send a number, for example 150.</i>");
    }
    if (st.s === "rev") {
      if (num(text) === null) return say(cid, "⚠️ Please send a valid amount, for example <code>150</code>.");
      return askDate(cid, uid, st.rec, text);
    }
    if (st.s === "date") {
      const d = parseDate(text);
      if (d.err) return say(cid, "⚠️ " + d.err);
      return submit(m.from, cid, st.rec, st.rev, d.d);
    }
  }

  // customer chat routing: reply-to a customer message, otherwise the active chat
  const ac = await rpc("agent_chats", { p_uid: uid }), L = ac.chats || [];
  if (L.length && !text.startsWith("/")) {
    const rt = m.reply_to_message, tag = ((rt && (rt.text || rt.caption)) || "").match(/#([a-f0-9]{16})/);
    const sid = tag && L.some(x => x.sid === tag[1]) ? tag[1] : L.some(x => x.sid === ac.act) ? ac.act : L[L.length - 1].sid;
    const r = await rpc("post_message", { p_sid: sid, p_sender: "agent", p_author: (await agentName(uid, m.from)) + " · CHDS Support", p_body: text.slice(0, 1000) });
    if (!r.ok) return say(cid, "⏹ That chat has already ended.");
    if (L.length > 1) return say(cid, `✓ Sent to <b>${esc(r.name)}</b>`);
    return;
  }
  return say(cid, "I didn't recognize that. Here is what I can do:\n\n" + help(approver));
}

async function cbq(q2) {
  const uid = String(q2.from.id), [act, id] = String(q2.data || "").split(":"), cid = q2.message.chat.id;
  const ans = (t, alert) => tg("answerCallbackQuery", { callback_query_id: q2.id, text: t, show_alert: !!alert });
  if (!UID.test(uid)) return ans("Members only", true);
  const approver = await isApprover(uid);
  if (!approver && !(await isActiveMember(uid))) return ans("Members only", true);
  if (act === "x") { await ans("Cancelled"); return edit(q2, "↩ Cancelled. Nothing was changed."); }

  /* customer support requests */
  if (act === "ha") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const nm = await agentName(uid, q2.from);
    const o = await rpc("join_session", { p_sid: id, p_uid: uid, p_name: nm });
    if (!o.ok) {
      if (o.reason === "taken") { await ans(`Already accepted by ${o.owner_name}`, true); return edit(q2, `✅ Already accepted by <b>${esc(o.owner_name)}</b>. No action needed.`); }
      await ans("This request has already ended.", true); return edit(q2, "⏹ <b>Session closed</b> — this request has ended.");
    }
    await ans(o.first ? "Request accepted" : "You are in this chat");
    await edit(q2, `✅ <b>You accepted ${esc(o.request_id || "")} — ${esc(o.name)}</b> · <code>#${id}</code>\nType here to reply to the customer (or reply to one of their messages). AI replies are paused while you own this chat.`, { reply_markup: agentKb(id) });
    if (o.first) {
      await announceAccepted(o.notif, id, uid, nm, o.request_id);
      await audit("tg:" + uid, "handoff_accepted", { agent: nm }, { target: o.request_id || id });
    }
    const det = await detailsText(id);
    if (det) await say(cid, det);
    if (o.tail.length) await say(cid, `🕘 <b>Customer messages while waiting</b>\n${o.tail.map(t => "• " + esc(t.slice(0, 300))).join("\n")}`);
    return;
  }
  if (act === "hd") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const det = await detailsText(id);
    await ans(det ? "Details sent" : "Not found", !det);
    if (det) await say(cid, det); // only to this authorized team member
    return;
  }
  if (act === "hs") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const mine = (await rpc("agent_chats", { p_uid: uid })).chats || [];
    if (!mine.some(x => x.sid === id)) return ans("You are not in this chat.", true);
    await sb("/agents?on_conflict=uid", { method: "POST", body: { uid, active_sid: id }, prefer: "resolution=merge-duplicates,return=minimal" });
    await ans("Active chat switched"); return edit(q2, "✅ Active chat switched. Your next messages go to this customer.");
  }
  if (act === "hx" || act === "hz") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const mine = (await rpc("agent_chats", { p_uid: uid })).chats || [];
    if (!mine.some(x => x.sid === id)) { await ans("You are not in this chat.", true); return edit(q2, "🚪 You are no longer in this chat."); }
    await stSet(uid, { s: "hb", sid: id, mode: act === "hz" ? "resolve" : "return" });
    await ans();
    return say(cid, `${act === "hz" ? "✅ <b>Resolve this request</b>" : "↩ <b>Return to CHDS AI Support</b>"}\nSend a short summary of what you did (saved for the AI and the dashboard).\nAdd a line starting with <code>Open:</code> for anything still unresolved.\n/skip to continue without a summary · /cancel to keep the chat.`);
  }

  /* report date step (guided) */
  if (act === "dt") {
    const st = await stGet(uid);
    if (!st || st.s !== "date") return ans("This report session expired. Send /report again.", true);
    const d = parseDate(id === "today" ? "today" : "yesterday");
    await ans(); await edit(q2, `📅 Date selected: <b>${d.d}</b>`);
    return submit(q2.from, cid, st.rec, st.rev, d.d);
  }

  /* report review / delete */
  const r = await getReport(id), mine = r && r.uid === uid;
  if (!r) return ans("This report no longer exists.", true);
  if (act === "dq") { if (!mine && !approver) return ans("You can only delete your own reports.", true); await ans(); return confirmDelete(cid, r); }
  if (act === "d") {
    if (!mine && !approver) return ans("You can only delete your own reports.", true);
    const o = await rpc("report_update", { p_id: id, p_actor: "tg:" + uid, p_reason: mine ? "Removed by the submitter via Telegram" : "Removed by an approver via Telegram", p_patch: { delete: true } });
    if (!o.ok) return ans("Already deleted.", true);
    await ans("Deleted");
    await audit("tg:" + uid, "report_deleted", { via: "telegram" }, { target: id, prev: { status: r.status, recovered: r.recovered, revenue: Number(r.revenue), date: r.report_date } });
    await edit(q2, `🗑 <b>Report deleted</b>\nReference: <code>${r.id}</code>${r.status === "approved" ? "\nIt has been removed from the public website." : ""}`);
    if (r.status === "approved") await Promise.allSettled([...envAdmins()].filter(x => x !== uid).map(x => say(x, `🗑 <b>Published report removed</b>\nReference: <code>${r.id}</code>\nOwner: ${esc(r.name)}\nWas: ${r.recovered} recovered · ${money(r.revenue)} · ${r.report_date}`)));
    if (!mine) await say(r.uid, `🗑 An approver removed your report <code>${r.id}</code>.`);
    return;
  }
  if (act === "a" || act === "r") {
    if (!approver) return ans("Approvers only", true);
    if (!pend(r)) return ans("Already handled", true);
    if (act === "r") { // a reason is required: ask for it
      await stSet(uid, { s: "rej", id });
      await ans();
      return say(cid, `❌ <b>Reject ${r.id}?</b>\nSend the reason in one message (it is shown to the member), or /cancel.`);
    }
    const o = await rpc("report_review", { p_id: id, p_actor: "tg:" + uid, p_action: "approve", p_reason: null, p_note: null });
    if (!o.ok) return ans("Already handled", true);
    await audit("tg:" + uid, "report_approved", { recovered: r.recovered, revenue: Number(r.revenue) }, { target: id });
    await ans("Approved");
    await edit(q2, `✅ <b>Approved</b> · ${esc(r.name)}\n${r.recovered} recovered · ${money(r.revenue)} · ${r.report_date} · <code>${r.id}</code>`);
    return say(r.uid, `✅ <b>Report approved</b>\n<code>${r.id}</code> is now live on the website. Thank you!`);
  }
}
export { team, recipients };
