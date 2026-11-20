import { esc, money, RID, SID, UID, sb, rpc, say, tg, edit, closeNotifs, audit, q, team, warn, appUrl, isCaseClosed } from "./core.js";
import { isActiveMember, announceAccepted, detailsText, queueText, recipients } from "./handoff.js";
import { principal } from "./rbac.js";
import { isApprover } from "./reporters.js";
import { closeCase, CLOSE_EFFECTS } from "./cases.js";
import { redactSecrets, asksForSecret } from "./secrets.js";
import { notifyStaff } from "./staffnotify.js";

import { COMMANDS } from "./tgcommands.js";
export { COMMANDS };
const portalUrl = () => (appUrl() ? appUrl() + "/report-portal" : null);
const portalText = () => portalUrl()
  ? `🔐 <b>CHDS report portal</b>\n${esc(portalUrl())}\nSign in with your Telegram user ID; the bot sends you a one-time code. Never share that code with anyone — CHDS staff will never ask for it.\nThis link is private to the CHDS team: please do not share it.`
  : "🔐 <b>CHDS report portal</b>\nOpen <code>/report-portal</code> on the CHDS website and sign in with your Telegram user ID. (Ask an admin to set APP_URL so the bot can send the full link.)";
const pend = r => r.status === "pending" || r.status === "reviewed";
const HELP = `<b>CHDS Team Console</b>

/help — show this message
/portal — private report portal link (submit reports, My Reports)
/chats — your active customer conversations
/quene — support requests waiting for an agent
/online — set your availability to online
/offline — set your availability to offline (your current chats stay yours)
/cancel — cancel your pending bot action

<b>Customer support</b>
New requests arrive with <b>Accept</b> and <b>View Details</b>. Only one agent can accept a request. Once accepted, type here to reply (or reply to one of the customer's messages). Finish with <b>Return to AI</b>, <b>Resolve</b> or <b>Close case</b>. Never ask customers for passwords or codes.

<b>Reports</b>
Reports are submitted in the portal. Approvers receive review cards with <b>Approve</b> and <b>Reject</b>. Reports appear on the public website only after approval and publication.`;
const reviewKb = id => ({ inline_keyboard: [[{ text: "✅ Approve", callback_data: "a:" + id }, { text: "❌ Reject", callback_data: "r:" + id }]] });
const agentKb = sid => ({ inline_keyboard: [[{ text: "↩ Return to AI", callback_data: "hx:" + sid }, { text: "✅ Resolve", callback_data: "hz:" + sid }], [{ text: "🔒 Close case", callback_data: "hc:" + sid }]] });
const OPEN_CASE = ["waiting", "assigned", "in_progress", "waiting_customer"];
const CASE_LABEL = { waiting: "Waiting for agent", assigned: "Assigned", in_progress: "Customer replied", waiting_customer: "Waiting for customer" };

const getReport = async id => (RID.test(id) ? (await sb(`/reports?id=eq.${id}&deleted_at=is.null&deletion_pending_at=is.null&select=*`))[0] : null) || null;
const stGet = async uid => (await sb(`/bot_state?uid=eq.${uid}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=state`))[0]?.state || null;
const stSet = (uid, s) => sb("/bot_state?on_conflict=uid", { method: "POST", body: { uid, state: s, expires_at: new Date(Date.now() + 6e5).toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
const stDel = uid => sb(`/bot_state?uid=eq.${uid}`, { method: "DELETE" });
const stExpire = uid => sb(`/bot_state?uid=eq.${uid}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: "PATCH", body: { expires_at: new Date().toISOString() }, prefer: "return=minimal" });
async function agentName(uid, from) {
  const m = (await sb(`/team_members?telegram_uid=eq.${q(uid)}&deleted_at=is.null&select=display_name`).catch(warn("agent name lookup", [])))[0];
  return String((m && m.display_name) || from.first_name || from.username || "Agent").slice(0, 40);
}
const ago = t => { if (!t) return "—"; const s = Math.max(0, (Date.now() - Date.parse(t)) / 1e3); return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : Math.floor(s / 86400) + " d ago"; };
async function myChats(uid) {
  const ac = await rpc("agent_chats", { p_uid: uid }), sids = (ac.chats || []).map(x => x.sid).filter(x => SID.test(x));
  if (!sids.length) return { act: ac.act, rows: [] };
  const ss = await sb(`/sessions?sid=in.(${sids.join(",")})&status=neq.ended&select=sid,name,status,request_id,updated_at`);
  const hs = ss.some(x => x.request_id) ? await sb(`/ai_handoff_requests?id=in.(${ss.filter(x => x.request_id).map(x => q(x.request_id)).join(",")})&select=id,status,last_customer_msg_at,last_agent_msg_at`) : [];
  const rows = ss.map(x => { const h = hs.find(y => y.id === x.request_id); return { ...x, h }; })
    .filter(x => !x.h || OPEN_CASE.includes(x.h.status))
    .map(x => ({ sid: x.sid, ref: x.request_id || "#" + x.sid, name: x.name || "Customer", status: x.h ? CASE_LABEL[x.h.status] : x.status === "live" ? "Live" : "Waiting",
      last: [x.updated_at, x.h && x.h.last_customer_msg_at, x.h && x.h.last_agent_msg_at].filter(Boolean).sort().at(-1) }));
  return { act: ac.act, rows };
}
async function queueMsg(cid) {
  const { rows, text: qt } = await queueText();
  return say(cid, qt, rows.length ? { reply_markup: { inline_keyboard: rows.map(r => [{ text: `✅ Accept ${r.id}`, callback_data: "ha:" + r.sid }, { text: "🔎 View Details", callback_data: "hd:" + r.sid }]) } } : {});
}

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
  return say(cid, `${st.mode === "resolve" ? "✅ <b>Marked resolved</b>" : "↩ <b>Returned to CHDS AI Support</b>"} · <code>${esc(o.request_id || "#" + st.sid)}</code>\nThe customer was notified${summary ? " and your summary was saved for the AI and the dashboard" : ""}.${rows.length ? `\n\n⏳ ${rows.length} request(s) waiting — /quene` : ""}`);
}

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

  if (c === "/start" || c === "/help") return say(cid, HELP);
  if (c === "/portal") return say(cid, portalText());
  if (c === "/cancel") {
    const st0 = await stGet(uid);
    if (!st0) return say(cid, "ℹ️ Nothing to cancel. You have no pending bot action.");
    await stExpire(uid);
    return say(cid, st0.s === "rej" ? `↩ Cancelled. Report <code>${esc(st0.id)}</code> was not rejected.` : st0.s === "hb" ? "↩ Cancelled. You are still in the customer chat." : "↩ Cancelled.");
  }
  if (c === "/chats") {
    const { act, rows } = await myChats(uid);
    if (!rows.length) return say(cid, "💬 You have no active customer conversations. /quene shows waiting requests.");
    const cur = rows.some(x => x.sid === act) ? act : rows.at(-1).sid;
    return say(cid, `💬 <b>Your active conversations</b> (${rows.length})\n\n` + rows.map(x => `${x.sid === cur ? "● " : ""}<code>${esc(x.ref)}</code> · <b>${esc(x.name)}</b>\n${esc(x.status)} · last activity ${ago(x.last)}`).join("\n\n") + `\n\nYour messages go to the conversation marked ●.`,
      { reply_markup: { inline_keyboard: rows.map(x => [{ text: `${x.sid === cur ? "● " : ""}Type to ${x.name}`.slice(0, 40), callback_data: "hs:" + x.sid }, { text: "🔎 View", callback_data: "hd:" + x.sid }]) } });
  }
  if (c === "/quene") return queueMsg(cid);
  if (c === "/online" || c === "/offline") {
    const on = c === "/online";
    await sb("/agents?on_conflict=uid", { method: "POST", body: { uid, available: on, available_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
    await audit("tg:" + uid, on ? "agent_online" : "agent_offline", {}, { target: uid });
    if (!on) return say(cid, "⚪ You are <b>offline</b>. Your current conversations stay assigned to you; /online to switch back.");
    const { rows } = await queueText();
    return say(cid, `🟢 You are <b>online</b>.${rows.length ? `\n⏳ ${rows.length} request(s) waiting — /quene` : ""}`);
  }

  const st = await stGet(uid);
  if (st && st.s === "hb" && !text.startsWith("/")) return handback(uid, cid, st, text);
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
  const ac = await rpc("agent_chats", { p_uid: uid }), L = ac.chats || [];
  const rt = m.reply_to_message, tag = ((rt && (rt.text || rt.caption)) || "").match(/#([a-f0-9]{16})/);
  if (tag && !text.startsWith("/") && !L.some(x => x.sid === tag[1]))
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
  return say(cid, "I didn't recognize that. Here is what I can do:\n\n" + HELP);
}

async function cbq(q2) {
  const uid = String(q2.from.id), [act, id] = String(q2.data || "").split(":"), cid = q2.message.chat.id;
  const ans = (t, alert) => tg("answerCallbackQuery", { callback_query_id: q2.id, text: t, show_alert: !!alert });
  if (!UID.test(uid)) return ans("Members only", true);
  const approver = await isApprover(uid);
  if (!approver && !(await isActiveMember(uid))) return ans("Members only", true);
  if (act === "x") { await ans("Cancelled"); return edit(q2, "↩ Cancelled. Nothing was changed."); }

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
    if (det) await say(cid, det);
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
    return say(cid, `${act === "hz" ? "✅ <b>Resolve this request</b>" : "↩ <b>Return to CHDS AI Support</b>"}\nSend a short summary of what you did (saved for the AI and the dashboard).\nAdd a line starting with <code>Open:</code> for anything still unresolved.\n/cancel to keep the chat.`,
      { reply_markup: { inline_keyboard: [[{ text: "⏭ Continue without a summary", callback_data: "hk:" + id }]] } });
  }
  if (act === "hk") {
    if (!SID.test(id)) return ans("Invalid request", true);
    const st = await stGet(uid);
    if (!st || st.s !== "hb" || st.sid !== id) { await ans("Nothing pending", true); return edit(q2, "ℹ️ That step already finished or was cancelled."); }
    await ans(); await edit(q2, "⏭ Continuing without a summary.");
    return handback(uid, cid, st, "");
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

  if (act === "d" || act === "dq") { await ans("This button was retired. Manage reports in the portal (/portal).", true); return edit(q2, "ℹ️ This action was retired. Manage your reports in the private portal: /portal"); }
  if (!RID.test(String(id || ""))) return ans("Unknown action", true);
  const r = await getReport(id);
  if (!r) { await ans("This report no longer exists.", true); return edit(q2, "ℹ️ This report no longer exists. No action needed."); }
  if (act === "a" || act === "r") {
    if (!approver) return ans("Approvers only", true);
    if (!pend(r)) return ans("Already handled", true);
    if (act === "r") {
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
