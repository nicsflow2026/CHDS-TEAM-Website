import { E, ids, esc, money, RID, SID, UID, sb, rpc, say, tg, edit, closeNotifs, statsData, settings, audit, q, team, warn, appUrl, isCaseClosed } from "./core.js";
import { isActiveMember, announceAccepted, detailsText, queueText, recipients } from "./handoff.js";
import { principal, can } from "./rbac.js";
import { isApprover } from "./reporters.js";
import { closeCase, CLOSE_EFFECTS } from "./cases.js";
import { redactSecrets, asksForSecret } from "./secrets.js";
import { notifyStaff } from "./staffnotify.js";

// V5: the old /report command and its guided submission flow were removed. Reports are submitted on the
// CHDS website (private report portal). /portal sends the link privately to authorized members.
export const COMMANDS = [
  { command: "portal", description: "Open the private report portal (submit reports, My Reports)" },
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
const portalUrl = () => (appUrl() ? appUrl() + "/report-portal" : null);
const portalText = () => portalUrl()
  ? `🔐 <b>CHDS report portal</b>\n${esc(portalUrl())}\nSign in with your Telegram user ID; the bot sends you a one-time code. Never share that code with anyone — CHDS staff will never ask for it.\nThis link is private to the CHDS team: please do not share it.`
  : "🔐 <b>CHDS report portal</b>\nOpen <code>/report-portal</code> on the CHDS website and sign in with your Telegram user ID. (Ask an admin to set APP_URL so the bot can send the full link.)";
const pend = r => r.status === "pending" || r.status === "reviewed";
const help = admin => `<b>CHDS Team Console</b>\n\n<b>Reports</b>\nReports are submitted on the CHDS website: /portal sends you the private link (submit reports, edit them, see feedback in My Reports).\n/myreports — your recent reports\n/total — total earnings (team and yours)\n/delete <code>&lt;ID&gt;</code> — remove a report submitted by mistake\n\n<b>Customer support</b>\nWhen a customer asks for a human you get an alert with <b>Accept Request</b> and <b>View Details</b>. Only one agent can accept a request. Once accepted, just type to reply (or reply to a specific customer message). Use <b>Return to AI</b>, <b>Resolve</b> or <b>Close case</b> when you are done. Never ask customers for passwords or codes.\n/chats — chats you accepted · /queue — waiting requests\n/online · /offline — your availability · /cancel — cancel current action\n${admin ? "\n<b>Approver</b>\n/pending — reports awaiting approval\n" : ""}\nReports appear on the public website only after approval and publication.`;
const STATUS = { pending: "⏳ Pending approval", reviewed: "🔎 Reviewed, awaiting approval", approved: "✅ Approved", rejected: "❌ Rejected", changes_requested: "✏️ Corrections requested" };
const card = r => `Reference: <code>${r.id}</code>\nActivity date: <b>${r.report_date}</b>${r.title ? `\nTitle: ${esc(r.title)}` : ""}\nRecovered: <b>${r.recovered}</b>\nEarnings: <b>${money(r.revenue)}</b>\nStatus: ${STATUS[r.status] || r.status}${r.published_at ? " · 🌐 published" : ""}${r.status === "rejected" && r.rejection_reason ? `\nReason: ${esc(r.rejection_reason)}` : ""}`;
const reviewKb = id => ({ inline_keyboard: [[{ text: "✅ Approve", callback_data: "a:" + id }, { text: "❌ Reject", callback_data: "r:" + id }]] });
const agentKb = sid => ({ inline_keyboard: [[{ text: "↩ Return to AI", callback_data: "hx:" + sid }, { text: "✅ Resolve", callback_data: "hz:" + sid }], [{ text: "🔒 Close case", callback_data: "hc:" + sid }]] });

/* ---- data access ---- */
// Same deletion rules as the website: owners may delete only reports that are not approved/published
// (Pending, Reviewed, Corrections requested, Rejected); staff need manage_reports (env founders always).
const OWNER_DELETABLE = ["pending", "reviewed", "changes_requested", "rejected"];
const canStaffDelete = async uid => envAdmins().has(uid) || can(await principal(uid), "manage_reports");
const deleteRule = async (uid, r) => (await canStaffDelete(uid)) ? "staff" : r.uid === uid ? (OWNER_DELETABLE.includes(r.status) && !r.published_at ? "owner" : "locked") : "denied";
const DELETE_MSG = { locked: "Approved or published reports can only be removed by an administrator.", denied: "You can only delete reports you submitted." };
const getReport = async id => (RID.test(id) ? (await sb(`/reports?id=eq.${id}&deleted_at=is.null&select=*`))[0] : null) || null;
const stGet = async uid => (await sb(`/bot_state?uid=eq.${uid}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=state`))[0]?.state || null;
const stSet = (uid, s) => sb("/bot_state?on_conflict=uid", { method: "POST", body: { uid, state: s, expires_at: new Date(Date.now() + 6e5).toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
const stDel = uid => sb(`/bot_state?uid=eq.${uid}`, { method: "DELETE" });
async function agentName(uid, from) {
  const m = (await sb(`/team_members?telegram_uid=eq.${q(uid)}&deleted_at=is.null&select=display_name`).catch(warn("agent name lookup", [])))[0];
  return String((m && m.display_name) || from.first_name || from.username || "Agent").slice(0, 40);
}

const confirmDelete = (cid, r) => say(cid, `🗑 <b>Delete this report?</b>\n\n${card(r)}\n\n<i>It is kept in the history for auditing.${r.status === "approved" ? " It will be removed from the public website." : ""}</i>`,
  { reply_markup: { inline_keyboard: [[{ text: "🗑 Yes, delete", callback_data: "d:" + r.id }, { text: "↩ Keep it", callback_data: "x" }]] } });

async function handback(uid, cid, st, summaryText) {
  const lines = String(summaryText || "").split("\n").map(s => s.trim()).filter(Boolean);
  const open = lines.filter(l => /^open\s*:/i.test(l)).map(l => l.replace(/^open\s*:\s*/i, "")).join("; ");
  const summary = lines.filter(l => !/^open\s*:/i.test(l)).join(" ").slice(0, 2000);
  const o = await rpc("return_to_ai", { p_sid: st.sid, p_actor: "tg:" + uid, p_actor_uid: uid, p_force: false, p_summary: summary || null, p_unresolved: open || null, p_resolve: st.mode === "resolve" });
  await stDel(uid);
  if (!o.ok) return say(cid, o.reason === "not_owner" ? "⛔ Only the agent who accepted this request can hand it back." : o.reason === "case_closed" ? "🔒 This case is closed. Nothing was changed." : "⏹ That chat has already ended.");
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
  if (c === "/report") return say(cid, "📝 <b>Report submission moved to the CHDS website.</b>\nThe Telegram /report command was retired. Use the private report portal instead:\n\n" + portalText());
  if (c === "/portal") return say(cid, portalText());
  if (c === "/total") {
    const [st, mine, pen] = await Promise.all([statsData(), rpc("user_totals", { p_uid: uid }), sb(`/reports?uid=eq.${uid}&status=in.(pending,reviewed)&deleted_at=is.null&select=recovered,revenue`)]);
    const w = st.series.slice(-7), sum = (arr, k) => arr.reduce((x, r) => x + r[k], 0), today = st.series.at(-1);
    const pv = pen.reduce((x, r) => x + Number(r.revenue), 0);
    return say(cid, `💰 <b>Total earnings</b> <i>(published reports)</i>\n\n<b>Team:</b> ${money(st.totals.revenue)} · ${st.totals.recovered} recovered · ${st.totals.reports} reports\nToday: ${money(today.revenue)} · Last 7 days: ${money(sum(w, "revenue"))}\n\n<b>You:</b> ${money(mine.revenue)} · ${mine.recovered} recovered${pen.length ? `\n⏳ Waiting for approval: ${money(pv)} (${pen.length} report${pen.length > 1 ? "s" : ""})` : ""}`);
  }
  if (c === "/myreports") {
    const last = await sb(`/reports?uid=eq.${uid}&deleted_at=is.null&order=created_at.desc&limit=5&select=*`);
    if (!last.length) return say(cid, "📂 You have no reports yet. Submit reports in the private report portal: /portal");
    const t = await rpc("user_totals", { p_uid: uid });
    const body = last.map(r => `<code>${r.id}</code> · activity ${r.report_date}\n${r.recovered} recovered · ${money(r.revenue)} · ${STATUS[r.status] || r.status}${r.published_at ? " · 🌐 published" : ""}`).join("\n\n");
    const del = last.filter(r => OWNER_DELETABLE.includes(r.status) && !r.published_at);
    return say(cid, `📂 <b>Your recent reports</b>\n\n${body}\n\n<b>Approved total:</b> ${t.recovered} recovered · ${money(t.revenue)}\n\n<i>${del.length ? "Tap a button to remove a report that is not approved yet. " : ""}Edit reports and read feedback in My Reports (/portal).</i>`,
      del.length ? { reply_markup: { inline_keyboard: del.map(r => [{ text: "🗑 Delete " + r.id, callback_data: "dq:" + r.id }]) } } : {});
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
    const rule = await deleteRule(uid, r);
    if (rule === "locked" || rule === "denied") return say(cid, "⛔ " + DELETE_MSG[rule]);
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
    await notifyStaff({ uids: [o.report.uid], staffOnly: true, kind: "report_reject", title: `Your report ${st.id} was rejected`, body: text.slice(0, 300), link: "#/reports", ref: st.id, key: st.id + ":reject" });
    return say(o.report.uid, `❌ <b>Report not approved</b>\n<code>${st.id}</code> was rejected.\nReason: ${esc(text.slice(0, 300))}\nPlease check the details and submit again if needed.`);
  }
  // customer chat routing: reply-to a customer message (that chat only), otherwise the active chat
  const ac = await rpc("agent_chats", { p_uid: uid }), L = ac.chats || [];
  const rt = m.reply_to_message, tag = ((rt && (rt.text || rt.caption)) || "").match(/#([a-f0-9]{16})/);
  if (tag && !text.startsWith("/") && !L.some(x => x.sid === tag[1])) // never re-route a reply meant for an ended/closed chat to another customer
    return say(cid, "⏹ That conversation has ended or its case is closed. Your message was <b>not</b> sent.");
  if (L.length && !text.startsWith("/")) {
    const sid = tag ? tag[1] : L.some(x => x.sid === ac.act) ? ac.act : L[L.length - 1].sid;
    if (asksForSecret(text)) return say(cid, "⛔ <b>Not sent.</b> CHDS policy: never ask customers for passwords, one-time codes, login or recovery codes, cookies or tokens. Rephrase your message.");
    const red = redactSecrets(text.slice(0, 1000));
    let r;
    try { r = await rpc("post_message", { p_sid: sid, p_sender: "agent", p_author: (await agentName(uid, m.from)) + " · CHDS Support", p_body: red.text }); }
    catch (e) { if (isCaseClosed(e)) return say(cid, "🔒 This case is closed. Messages can no longer be sent to it."); throw e; }
    if (!r.ok) return say(cid, "⏹ That chat has already ended. Your message was not sent.");
    if (red.found.length) await say(cid, "ℹ️ A password/code-like value was removed from your message before it was sent.");
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

  if (act === "hc" || act === "hcy") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const h = (await sb(`/ai_handoff_requests?sid=eq.${q(id)}&select=id,status,assigned_uid`))[0];
    if (!h) return ans("Not found", true);
    const p = await principal(uid);
    if (act === "hc") {
      await ans();
      return say(cid, `🔒 <b>Close case ${esc(h.id)}?</b>\n${CLOSE_EFFECTS.map(x => "• " + esc(x)).join("\n")}`, { reply_markup: { inline_keyboard: [[{ text: "🔒 Confirm Close", callback_data: "hcy:" + id }, { text: "Cancel", callback_data: "x" }]] } });
    }
    if (!p) { await ans("Closing needs a CHDS dashboard role with close_support_cases.", true); return edit(q2, "⛔ Not closed: your account has no close_support_cases permission. Ask a Founder, or close it from the dashboard."); }
    const o = await closeCase({ p, requestId: h.id, reason: "Closed via Telegram", actor: "tg:" + uid, via: "telegram" });
    if (o.status !== 200) { await ans(o.body.message || "Not closed", true); return edit(q2, `⛔ Not closed: ${esc(o.body.message || o.body.error)}`); }
    await ans(o.body.already_closed ? "Already closed" : "Case closed");
    return edit(q2, o.body.already_closed ? `🔒 ${esc(h.id)} was already closed. No action needed.` : `🔒 <b>Case ${esc(h.id)} closed.</b> The conversation is now read-only.`);
  }

  /* report review / delete */
  if (!RID.test(String(id || ""))) return ans("Unknown action", true);
  const r = await getReport(id), mine = r && r.uid === uid;
  if (!r) return ans("This report no longer exists.", true);
  if (act === "dq" || act === "d") {
    const rule = await deleteRule(uid, r);
    if (rule === "locked" || rule === "denied") return ans(DELETE_MSG[rule], true);
    if (act === "dq") { await ans(); return confirmDelete(cid, r); }
    const o = rule === "owner"
      ? await rpc("report_owner_update", { p_id: id, p_uid: uid, p_patch: { delete: true } })
      : await rpc("report_update", { p_id: id, p_actor: "tg:" + uid, p_reason: mine ? "Removed by the submitter via Telegram" : "Removed by an administrator via Telegram", p_patch: { delete: true } });
    if (!o.ok) return ans(o.error === "not_eligible" ? DELETE_MSG.locked : "Already deleted.", true);
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
    await notifyStaff({ uids: [r.uid], staffOnly: true, kind: "report_approve", title: `Your report ${r.id} was approved`, link: "#/reports", ref: r.id, key: r.id + ":approve" });
    return say(r.uid, `✅ <b>Report approved</b>\n<code>${r.id}</code> was approved. It appears on the public report feed only if an administrator publishes it. Thank you!`);
  }
}
export { team, recipients };
