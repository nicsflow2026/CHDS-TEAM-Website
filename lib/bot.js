import { E, ids, esc, num, money, dayOf, SID, RID, UID, sb, rpc, say, tg, edit, closeNotifs } from "./core.js";

export const COMMANDS = [
  { command: "report", description: "Submit a report (recovered, earnings, date)" },
  { command: "myreports", description: "View or delete your recent reports" },
  { command: "delete", description: "Remove a report submitted by mistake" },
  { command: "chats", description: "Customer chats you joined" },
  { command: "cancel", description: "Cancel the current action" },
  { command: "help", description: "How to use this bot" }
];
const admins = () => ids(E.ADMIN_UIDS), members = () => ids(E.ALLOWED_UIDS);
const pend = r => r.status === "pending";
const help = admin => `<b>CHDS Report</b> · Team Console\n\n<b>Submit a report</b>\n/report <code>&lt;recovered&gt; &lt;earnings&gt; &lt;date&gt;</code>\nExample: <code>/report 3 150 2026-11-17</code>\nDate: <code>YYYY-MM-DD</code>, <code>today</code> or <code>yesterday</code>. Send /report alone for guided mode.\n\n<b>Manage reports</b>\n/myreports — your recent reports\n/delete <code>&lt;ID&gt;</code> — remove a report submitted by mistake\n\n<b>Customer chats</b>\nWhen a customer asks for human support you get an alert with an <b>Accept</b> button. Once joined, just type to reply (or reply to a specific customer message).\n/chats — chats you joined · /cancel — cancel current action\n${admin ? "\n<b>Admin</b>\n/pending — reports awaiting approval\n" : ""}\nReports appear on the public website only after admin approval.`;
const status = r => (pend(r) ? "⏳ Pending approval" : "✅ Published");
const card = r => `Reference: <code>${r.id}</code>\nDate: <b>${r.report_date}</b>\nRecovered: <b>${r.recovered}</b>\nEarnings: <b>${money(r.revenue)}</b>\nStatus: ${status(r)}`;
const reviewKb = id => ({ inline_keyboard: [[{ text: "✅ Approve", callback_data: "a:" + id }, { text: "❌ Reject", callback_data: "r:" + id }]] });
const dateKb = { inline_keyboard: [[{ text: "📅 Today", callback_data: "dt:today" }, { text: "Yesterday", callback_data: "dt:yday" }]] };
const exitKb = sid => ({ inline_keyboard: [[{ text: "🚪 Exit chat", callback_data: "hx:" + sid }]] });

/* ---- data access ---- */
const getReport = async id => (RID.test(id) ? (await sb(`/reports?id=eq.${id}&select=*`))[0] : null) || null;
const stGet = async uid => (await sb(`/bot_state?uid=eq.${uid}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=state`))[0]?.state || null;
const stSet = (uid, s) => sb("/bot_state?on_conflict=uid", { method: "POST", body: { uid, state: s, expires_at: new Date(Date.now() + 6e5).toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
const stDel = uid => sb(`/bot_state?uid=eq.${uid}`, { method: "DELETE" });
const delReport = async id => (RID.test(id) ? (await sb(`/reports?id=eq.${id}`, { method: "DELETE", prefer: "return=representation" }))[0] : null) || null;

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
const confirmDelete = (cid, r) => say(cid, `🗑 <b>Delete this report?</b>\n\n${card(r)}\n\n<i>This cannot be undone.${pend(r) ? "" : " It will be removed from the public website."}</i>`,
  { reply_markup: { inline_keyboard: [[{ text: "🗑 Yes, delete", callback_data: "d:" + r.id }, { text: "↩ Keep it", callback_data: "x" }]] } });

async function submit(from, cid, rc, rv, dt) {
  const uid = String(from.id), recovered = /^\d{1,4}$/.test(rc) ? +rc : null, revenue = num(rv), d = parseDate(dt);
  await stDel(uid);
  if (recovered === null || revenue === null || d.err) return say(cid, `⚠️ <b>Invalid report</b>\n${d.err || "Check the numbers."}\nUse: <code>/report 3 150 2026-11-17</code>\n(recovered, earnings, date)`);
  const prev = (await sb(`/reports?uid=eq.${uid}&order=created_at.desc&limit=1&select=*`))[0];
  if (prev && prev.recovered === recovered && Number(prev.revenue) === revenue && prev.report_date === d.d && Date.now() - Date.parse(prev.created_at) < 120000)
    return say(cid, "⚠️ This looks like a duplicate of your last report. If it was a mistake, use /myreports to delete it.");
  const auto = admins().has(uid) || /^(1|true|yes|on)$/i.test(String(E.AUTO_APPROVE || "").trim()); // admins / AUTO_APPROVE publish instantly
  const needs = admins().size > 0 && !auto;
  const r = { uid, name: String(from.first_name || from.username || "Member").slice(0, 40), recovered, revenue, report_date: d.d, status: needs ? "pending" : "approved", created_at: new Date().toISOString() };
  for (let i = 0; ; i++) {
    r.id = "R" + crypto.randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
    try { await sb("/reports", { method: "POST", body: r, prefer: "return=minimal" }); break; } catch (e) { if (i >= 2) throw e; }
  }
  if (needs) await Promise.allSettled([...admins()].map(a => say(a, `📝 <b>New report for review</b>\nFrom: ${esc(r.name)} (<code>${uid}</code>)\n${card(r)}`, { reply_markup: reviewKb(r.id) })));
  return say(cid, `✅ <b>Report received</b>\n\n${card(r)}\n\n${needs ? "An admin will review it first. It appears on the website after approval. " : "It is now live on the website. "}Made a mistake? Use <code>/delete ${r.id}</code>.`);
}

/* ---- messages ---- */
export async function tgUpdate(u) {
  if (u.callback_query) return cbq(u.callback_query);
  const m = u.message;
  if (!m || !m.from || m.chat.type !== "private") return;
  const uid = String(m.from.id), cid = m.chat.id, isAdmin = admins().has(uid);
  if (!UID.test(uid)) return;
  if (!isAdmin && !members().has(uid)) return say(cid, "⛔ <b>Access restricted</b>\nThis bot is available to authorized CHDS team members only.");
  if (!m.text) return say(cid, "ℹ️ Only text messages can be sent to customers for now.");
  const text = m.text.trim(), [cmd, ...a] = text.split(/\s+/), c = cmd.split("@")[0].toLowerCase();

  if (c === "/start" || c === "/help") return say(cid, help(isAdmin));
  if (c === "/cancel") { await stDel(uid); return say(cid, "↩ Cancelled. Nothing was submitted."); }
  if (c === "/report") {
    if (a.length >= 3) return submit(m.from, cid, a[0], a[1], a[2]);
    if (a.length === 2) return askDate(cid, uid, a[0], a[1]);
    await stSet(uid, { s: "rec" });
    return say(cid, "📝 <b>New report</b>\nStep 1 of 3 — How many accounts did you recover?\n<i>Send a number, or /cancel to stop.</i>");
  }
  if (c === "/myreports") {
    const last = await sb(`/reports?uid=eq.${uid}&order=created_at.desc&limit=5&select=*`);
    if (!last.length) return say(cid, "📂 You have no reports yet. Use /report to submit one.");
    const t = await rpc("user_totals", { p_uid: uid });
    const body = last.map(r => `<code>${r.id}</code> · ${r.report_date}\n${r.recovered} recovered · ${money(r.revenue)} · ${status(r)}`).join("\n\n");
    return say(cid, `📂 <b>Your recent reports</b>\n\n${body}\n\n<b>Published total:</b> ${t.recovered} recovered · ${money(t.revenue)}\n\n<i>Tap a button to remove a report.</i>`,
      { reply_markup: { inline_keyboard: last.map(r => [{ text: "🗑 Delete " + r.id, callback_data: "dq:" + r.id }]) } });
  }
  if (c === "/pending" && isAdmin) {
    const P = await sb("/reports?status=eq.pending&order=created_at.asc&limit=10&select=*");
    if (!P.length) return say(cid, "✅ No reports awaiting approval.");
    for (const r of P) await say(cid, `📝 <b>Pending report</b>\nFrom: ${esc(r.name)}\n${card(r)}`, { reply_markup: reviewKb(r.id) });
    return;
  }
  if (c === "/delete") {
    const id = (a[0] || "").toUpperCase();
    if (!id) return say(cid, "Usage: <code>/delete ID</code>\nFind your report IDs with /myreports.");
    const r = await getReport(id);
    if (!r) return say(cid, "⚠️ No report found with that ID. Check /myreports.");
    if (r.uid !== uid && !isAdmin) return say(cid, "⛔ You can only delete reports you submitted.");
    return confirmDelete(cid, r);
  }
  if (c === "/chats") {
    const ac = await rpc("agent_chats", { p_uid: uid }), L = ac.chats || [];
    if (!L.length) return say(cid, "💬 You are not in any customer chat.");
    const act = L.some(x => x.sid === ac.act) ? ac.act : L[L.length - 1].sid;
    return say(cid, `💬 <b>Your customer chats</b>\nActive for typing: <b>${esc(L.find(x => x.sid === act).name)}</b>`,
      { reply_markup: { inline_keyboard: L.map(x => [{ text: `${x.sid === act ? "● " : ""}${x.name}`, callback_data: "hs:" + x.sid }, { text: "🚪 Exit", callback_data: "hx:" + x.sid }]) } });
  }

  const st = await stGet(uid);
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
    const d = parseDate(text);
    if (d.err) return say(cid, "⚠️ " + d.err);
    return submit(m.from, cid, st.rec, st.rev, d.d);
  }

  // customer chat routing: reply-to a customer message, otherwise the active chat
  const ac = await rpc("agent_chats", { p_uid: uid }), L = ac.chats || [];
  if (L.length && !text.startsWith("/")) {
    const rt = m.reply_to_message, tag = ((rt && (rt.text || rt.caption)) || "").match(/#([a-f0-9]{16})/);
    const sid = tag && L.some(x => x.sid === tag[1]) ? tag[1] : L.some(x => x.sid === ac.act) ? ac.act : L[L.length - 1].sid;
    const r = await rpc("post_message", { p_sid: sid, p_sender: "agent", p_author: m.from.first_name || "Agent" + " · CHDS Support", p_body: text.slice(0, 1000) });
    if (!r.ok) return say(cid, "⏹ That chat has already ended.");
    if (L.length > 1) return say(cid, `✓ Sent to <b>${esc(r.name)}</b>`);
    return;
  }
  return say(cid, "I didn't recognize that. Here is what I can do:\n\n" + help(isAdmin));
}

async function cbq(q) {
  const uid = String(q.from.id), isAdmin = admins().has(uid), [act, id] = String(q.data || "").split(":"), cid = q.message.chat.id;
  const ans = (t, alert) => tg("answerCallbackQuery", { callback_query_id: q.id, text: t, show_alert: !!alert });
  if (!UID.test(uid) || (!isAdmin && !members().has(uid))) return ans("Members only", true);
  if (act === "x") { await ans("Cancelled"); return edit(q, "↩ Cancelled. Nothing was changed."); }
  const nm = q.from.first_name || "Agent";

  /* customer chat rooms */
  if (act === "ha") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const o = await rpc("join_session", { p_sid: id, p_uid: uid, p_name: nm });
    if (!o.ok) { await ans("This request has already ended.", true); return edit(q, "⏹ <b>Session closed</b> — this request has ended."); }
    await ans("You joined the chat");
    await edit(q, `✅ <b>You joined ${esc(o.name)}</b> · <code>#${id}</code>\nType here to reply to the customer (or reply to one of their messages). The customer no longer receives AI replies while an agent is in the chat.${o.others.length ? `\n👥 Other agents in this chat: ${o.others.length}` : ""}`, { reply_markup: exitKb(id) });
    if (o.tail.length) await say(cid, `🕘 <b>Latest customer messages</b>\n${o.tail.map(t => "• " + esc(t.slice(0, 300))).join("\n")}`);
    await Promise.allSettled(o.others.map(x => say(x, `👥 <b>${esc(nm)}</b> joined <b>${esc(o.name)}</b> <code>#${id}</code>.`)));
    return;
  }
  if (act === "hs") {
    if (!SID.test(id)) return ans("Invalid request", true);
    await sb("/agents?on_conflict=uid", { method: "POST", body: { uid, active_sid: id }, prefer: "resolution=merge-duplicates,return=minimal" });
    await ans("Active chat switched"); return edit(q, "✅ Active chat switched. Your next messages go to this customer.");
  }
  if (act === "hx") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const o = await rpc("exit_session", { p_sid: id, p_uid: uid });
    if (!o.ok) { await ans("You are not in this chat.", true); return edit(q, "🚪 You are no longer in this chat."); }
    await ans("You left the chat");
    await edit(q, `🚪 <b>You left the chat</b> <code>#${id}</code>.${o.ended ? "\nYou were the last agent, so CHDS AI Support has resumed for this customer." : ""}`);
    if (o.ended) await closeNotifs((o.notif || []).filter(([c, m]) => !(String(c) === String(cid) && m === q.message.message_id)), "⏹ <b>Session closed</b> — the customer is back with CHDS AI Support.");
    else await Promise.allSettled(o.left.map(x => say(x, `🚪 <b>${esc(o.nm)}</b> left the chat <code>#${id}</code>.`)));
    return;
  }

  /* report date step (guided) */
  if (act === "dt") {
    const st = await stGet(uid);
    if (!st || st.s !== "date") return ans("This report session expired. Send /report again.", true);
    const d = parseDate(id === "today" ? "today" : "yesterday");
    await ans(); await edit(q, `📅 Date selected: <b>${d.d}</b>`);
    return submit(q.from, cid, st.rec, st.rev, d.d);
  }

  /* report review / delete */
  const r = await getReport(id), mine = r && r.uid === uid;
  if (!r) return ans("This report no longer exists.", true);
  if (act === "dq") { if (!mine && !isAdmin) return ans("You can only delete your own reports.", true); await ans(); return confirmDelete(cid, r); }
  if (act === "d") {
    if (!mine && !isAdmin) return ans("You can only delete your own reports.", true);
    if (!(await delReport(id))) return ans("Already deleted.", true);
    await ans("Deleted");
    await edit(q, `🗑 <b>Report deleted</b>\nReference: <code>${r.id}</code>${pend(r) ? "" : "\nIt has been removed from the public website."}`);
    if (!pend(r)) await Promise.allSettled([...admins()].filter(x => x !== uid).map(x => say(x, `🗑 <b>Published report removed</b>\nReference: <code>${r.id}</code>\nOwner: ${esc(r.name)}\nRemoved by: ${esc(nm)}\nWas: ${r.recovered} recovered · ${money(r.revenue)} · ${r.report_date}`)));
    if (!mine) await say(r.uid, `🗑 An admin removed your report <code>${r.id}</code>.`);
    return;
  }
  if (act === "a" || act === "r") {
    if (!isAdmin) return ans("Admins only", true);
    if (act === "a") { const x = await sb(`/reports?id=eq.${id}&status=eq.pending`, { method: "PATCH", body: { status: "approved", approved_at: new Date().toISOString() }, prefer: "return=representation" }); if (!x.length) return ans("Already handled", true); }
    else { if (!pend(r)) return ans("Already handled", true); if (!(await sb(`/reports?id=eq.${id}&status=eq.pending`, { method: "DELETE", prefer: "return=representation" })).length) return ans("Already handled", true); }
    await ans(act === "a" ? "Approved" : "Rejected");
    await edit(q, `${act === "a" ? "✅ <b>Approved</b>" : "❌ <b>Rejected</b>"} · ${esc(r.name)}\n${r.recovered} recovered · ${money(r.revenue)} · ${r.report_date} · <code>${r.id}</code>`);
    return say(r.uid, act === "a" ? `✅ <b>Report approved</b>\n<code>${r.id}</code> is now live on the website. Thank you!` : `❌ <b>Report not approved</b>\n<code>${r.id}</code> was rejected by an admin. Please check the details and submit again if needed.`);
  }
}
