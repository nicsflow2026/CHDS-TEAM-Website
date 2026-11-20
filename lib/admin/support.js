import { sb, rpc, q, like, UUID, SID, HSID, say, esc, settings, closeNotifs, warn, isCaseClosed } from "../core.js";
import { can, canAny } from "../rbac.js";
import { isCaseAdmin } from "../cases.js";
import { redactSecrets, asksForSecret } from "../secrets.js";
import { text, oneOf } from "../validate.js";
import { phStartIso, phEndIso, range } from "../time.js";
import { retryRequest, announceAccepted, agentProfile, recipients, STATUS_LABEL } from "../handoff.js";
import { closeHumanRoom } from "../rooms.js";
import { fail, need, actor, page, v, reasonOf } from "./util.js";

const OPEN = "(waiting,assigned,in_progress,waiting_customer)";
const isoRange = qy => { const r = range(qy.preset || "this_month", qy.from, qy.to); if (r.error) fail(400, "invalid", r.error); return { ...r, a: phStartIso(r.from), b: phEndIso(r.to) }; };

export const ops = {
  ai_users_list: { perm: "view_ai_conversations", method: "GET", fn: async ctx => {
    const pg = page(ctx.qy);
    const term = String(ctx.qy.q || "").trim().slice(0, 60);
    const r = await rpc("ai_users_search", { p_q: term, p_status: oneOf(ctx.qy.status, ["active", "blocked"], ""), p_limit: pg.limit, p_offset: pg.offset });
    return { total: r.total, rows: r.rows };
  } },

  ai_user_get: { perm: "view_ai_conversations", method: "GET", fn: async ctx => {
    const id = String(ctx.qy.id || ""); need(UUID.test(id), 400, "bad_request");
    const [u, convs, notes, handoffs, msgCount] = await Promise.all([
      sb(`/ai_support_users?id=eq.${id}&select=*`).then(r => r[0]),
      sb(`/ai_support_conversations?user_id=eq.${id}&order=created_at.desc&limit=100&select=id,status,owner,category,title,message_count,created_at,updated_at,resolved_at,human_sid`),
      sb(`/internal_notes?subject_type=eq.visitor&subject_id=eq.${id}&order=id.desc&limit=50&select=*`),
      sb(`/ai_handoff_requests?user_id=eq.${id}&order=created_at.desc&limit=50&select=id,status,reason,category,created_at,assigned_name`),
      sb(`/ai_support_messages?user_id=eq.${id}&role=eq.user&select=id&limit=1`, { count: true }).then(r => r.total)]);
    need(u, 404, "not_found");
    await ctx.audit("ai_user_viewed", {}, { target: id });
    return { user: u, conversations: convs, notes, handoffs, counts: { conversations: convs.length, messages: msgCount, handoffs: handoffs.length },
      first_interaction: convs.length ? convs[convs.length - 1].created_at : u.first_seen_at, last_activity: u.last_seen_at };
  } },

  ai_user_note: { perm: "manage_ai_support", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(UUID.test(id), 400, "bad_request");
    const body = v(text(ctx.b.body, { min: 1, max: 2000, multiline: true, label: "Note" }));
    const n = (await sb("/internal_notes", { method: "POST", body: { subject_type: "visitor", subject_id: id, author: actor(ctx), body }, prefer: "return=representation" }))[0];
    await ctx.audit("ai_user_note_added", {}, { target: id });
    return { ok: true, note: n };
  } },

  ai_user_flags: { perm: "manage_ai_support", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(UUID.test(id), 400, "bad_request");
    const u = (await sb(`/ai_support_users?id=eq.${id}&select=*`))[0]; need(u, 404, "not_found");
    const flags = [...new Set((Array.isArray(ctx.b.flags) ? ctx.b.flags : []).map(f => String(f).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24)).filter(Boolean))].slice(0, 10);
    const status = oneOf(ctx.b.status, ["active", "blocked"], u.status);
    const reason = status !== u.status ? reasonOf(ctx.b) : u.status_reason;
    const r = (await sb(`/ai_support_users?id=eq.${id}`, { method: "PATCH", body: { flags, status, status_reason: reason, updated_at: new Date().toISOString() }, prefer: "return=representation" }))[0];
    if (status === "blocked" && u.status !== "blocked") await sb(`/ai_support_sessions?user_id=eq.${id}&revoked_at=is.null`, { method: "PATCH", body: { revoked_at: new Date().toISOString() }, prefer: "return=minimal" });
    await ctx.audit(status !== u.status ? (status === "blocked" ? "ai_user_blocked" : "ai_user_unblocked") : "ai_user_flags_updated", { reason }, { target: id, prev: { flags: u.flags, status: u.status }, next: { flags, status } });
    return { ok: true, user: r };
  } },

  ai_convos_list: { perm: "view_ai_conversations", method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy);
    const f = [oneOf(qy.status, ["active", "awaiting_confirmation", "resolved", "handoff", "closed"]) ? `&status=eq.${qy.status}` : "",
      oneOf(qy.owner, ["ai", "human"]) ? `&owner=eq.${qy.owner}` : "", qy.category ? `&category=eq.${q(qy.category)}` : "",
      UUID.test(qy.user || "") ? `&user_id=eq.${qy.user}` : "",
      /^\d{4}-\d{2}-\d{2}$/.test(qy.from || "") ? `&created_at=gte.${encodeURIComponent(phStartIso(qy.from))}` : "",
      /^\d{4}-\d{2}-\d{2}$/.test(qy.to || "") ? `&created_at=lt.${encodeURIComponent(phEndIso(qy.to))}` : "",
      qy.q ? `&title=ilike.${like(qy.q)}` : ""].join("");
    const r = await sb(`/ai_support_conversations?select=id,status,owner,category,title,message_count,failure_count,created_at,updated_at,resolved_at,human_sid,user:ai_support_users(id,display_name)${f}&order=updated_at.desc${pg.range}`, { count: true });
    return r;
  } },

  ai_convo_get: { perm: "view_ai_conversations", method: "GET", fn: async ctx => {
    const id = String(ctx.qy.id || ""); need(UUID.test(id), 400, "bad_request");
    const c = (await sb(`/ai_support_conversations?id=eq.${id}&select=*,user:ai_support_users(id,display_name,status)`))[0]; need(c, 404, "not_found");
    const [messages, handoffs, notes] = await Promise.all([
      sb(`/ai_support_messages?conversation_id=eq.${id}&order=id.asc&limit=1000&select=id,role,author,body,meta,created_at`),
      sb(`/ai_handoff_requests?conversation_id=eq.${id}&order=created_at.asc&select=*`),
      sb(`/internal_notes?subject_type=eq.conversation&subject_id=eq.${id}&order=id.desc&select=*`)]);
    await ctx.audit("ai_conversation_viewed", {}, { target: id });
    return { conversation: c, messages, handoffs, notes };
  } },

  ai_convo_note: { perm: "manage_ai_support", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(UUID.test(id), 400, "bad_request");
    const body = v(text(ctx.b.body, { min: 1, max: 2000, multiline: true, label: "Note" }));
    const n = (await sb("/internal_notes", { method: "POST", body: { subject_type: "conversation", subject_id: id, author: actor(ctx), body }, prefer: "return=representation" }))[0];
    await ctx.audit("ai_conversation_note_added", {}, { target: id });
    return { ok: true, note: n };
  } },

  ai_analytics: { perm: "view_ai_conversations", method: "GET", fn: async ctx => {
    const r = isoRange(ctx.qy);
    const a = await rpc("ai_support_analytics", { p_from: r.a, p_to: r.b });
    const n = Number(a.conversations) || 0;
    return { range: { from: r.from, to: r.to, preset: r.preset }, ...a,
      ai_resolution_rate: n ? Math.round(a.ai_resolved / n * 1000) / 10 : null,
      human_intervention_rate: n ? Math.round(a.escalations / n * 1000) / 10 : null };
  } },

  handoffs_list: { perm: ["manage_support", "view_ai_conversations"], method: "GET", fn: async ctx => {
    const { qy } = ctx, pg = page(qy, 50);
    const st = qy.status === "open" ? `&status=in.${OPEN}` : oneOf(qy.status, Object.keys(STATUS_LABEL)) ? `&status=eq.${qy.status}` : "";
    const f = [st, qy.reason ? `&reason=eq.${q(qy.reason)}` : "", qy.q ? `&id=ilike.${like(qy.q)}` : "", oneOf(qy.priority, ["low", "normal", "high", "urgent"]) ? `&priority=eq.${qy.priority}` : "",
      qy.mine === "1" ? `&assigned_uid=eq.${q(ctx.p.uid)}` : "",
      /^\d{4}-\d{2}-\d{2}$/.test(qy.from || "") ? `&created_at=gte.${encodeURIComponent(phStartIso(qy.from))}` : "",
      /^\d{4}-\d{2}-\d{2}$/.test(qy.to || "") ? `&created_at=lt.${encodeURIComponent(phEndIso(qy.to))}` : ""].join("");
    const r = await sb(`/ai_handoff_requests?select=id,sid,status,priority,reason,category,created_at,assigned_at,assigned_uid,assigned_name,first_response_at,resolved_at,closed_at,cancelled_at,closed_by_name,notified_count,notify_failed,conversation_id,last_customer_msg_at,agent_read_at,csat_rating,escalated_at,user:ai_support_users(id,display_name)${f}&order=created_at.${qy.status === "open" ? "asc" : "desc"}${pg.range}`, { count: true });
    return r;
  } },

  handoff_get: { perm: ["manage_support", "view_ai_conversations", "view_closed_cases"], method: "GET", fn: async ctx => {
    const id = String(ctx.qy.id || ""); need(HSID.test(id), 400, "bad_request");
    const h = (await sb(`/ai_handoff_requests?id=eq.${q(id)}&select=*,user:ai_support_users(id,display_name,status,first_seen_at,last_seen_at,flags)`))[0]; need(h, 404, "not_found");
    if (!canAny(ctx.p, ["manage_support", "view_ai_conversations"])) need(h.status === "closed", 403, "forbidden", "Your role can only open closed cases.");
    const [history, messages, notifs, notes, conv, prior] = await Promise.all([
      sb(`/ai_handoff_history?request_id=eq.${q(id)}&order=id.asc&select=*`),
      sb(`/ai_support_messages?conversation_id=eq.${h.conversation_id}&order=id.asc&limit=1000&select=id,role,author,body,meta,created_at`),
      sb(`/notification_log?kind=eq.handoff_new&ref=eq.${q(id)}&select=chat_id,status,attempts,last_error,updated_at`),
      sb(`/internal_notes?subject_type=eq.handoff&subject_id=eq.${q(id)}&order=id.desc&select=*`),
      sb(`/ai_support_conversations?id=eq.${h.conversation_id}&select=id,status,owner,closed_at,closed_by,close_reason,human_sid,title,category,created_at`).then(r => r[0] || null),
      sb(`/ai_handoff_requests?user_id=eq.${q(h.user_id)}&id=neq.${q(id)}&select=id,status,created_at&order=created_at.desc&limit=10`)]);
    const mine = !!h.assigned_uid && h.assigned_uid === ctx.p.uid, s = (await settings()).support;
    if (mine && h.last_customer_msg_at && (!h.agent_read_at || h.agent_read_at < h.last_customer_msg_at))
      await sb(`/ai_handoff_requests?id=eq.${q(id)}`, { method: "PATCH", body: { agent_read_at: new Date().toISOString() }, prefer: "return=minimal" }).catch(warn("mark case read"));
    const due = (t, min) => t ? new Date(Date.parse(t) + min * 6e4).toISOString() : null;
    const firstDue = due(h.created_at, s.first_response_minutes), resDue = due(h.created_at, s.resolution_hours * 60);
    const latest = !!conv && conv.human_sid === h.sid;
    return { request: h, history, messages, notifications: notifs, notes, mine, conversation: conv, previous_requests: prior,
      sla: { first_response_due: firstDue, first_response_breached: !!firstDue && (h.first_response_at ? h.first_response_at > firstDue : Date.now() > Date.parse(firstDue) && !["closed", "cancelled", "ended", "resolved"].includes(h.status)),
        resolution_due: resDue, resolution_breached: !!resDue && ((h.resolved_at || (h.status === "closed" && h.closed_at)) ? (h.resolved_at || h.closed_at) > resDue : Date.now() > Date.parse(resDue) && !["closed", "cancelled", "ended", "resolved"].includes(h.status)) },
      can: { close: h.status !== "closed" && latest && can(ctx.p, "close_support_cases") && (mine || isCaseAdmin(ctx.p)),
        reopen: h.status === "closed" && can(ctx.p, "reopen_support_cases"), reply: mine && can(ctx.p, "manage_support") && ["assigned", "in_progress", "waiting_customer"].includes(h.status) && !(conv && conv.closed_at),
        manage: can(ctx.p, "manage_support") } };
  } },

  support_overview: { perm: "manage_support", method: "GET", fn: async () => {
    const [queue, rooms, agents, failed, legacy, s, team] = await Promise.all([
      sb(`/ai_handoff_requests?status=in.${OPEN}&order=created_at.asc&limit=100&select=id,sid,status,priority,reason,category,created_at,assigned_at,assigned_name,assigned_uid,first_response_at,last_customer_msg_at,agent_read_at,notified_count,notify_failed,escalated_at,user:ai_support_users(display_name)`),
      sb("/sessions?status=neq.ended&order=updated_at.desc&limit=100&select=sid,name,status,owner_name,owner_uid,request_id,created_at,updated_at"),
      sb("/agents?select=uid,active_sid,available,available_at"),
      sb("/notification_log?status=eq.failed&order=updated_at.desc&limit=50&select=*"),
      sb("/sessions?request_id=is.null&order=updated_at.desc&limit=30&select=sid,name,status,joined,created_at,updated_at"),
      settings(), recipients()]);
    const names = Object.fromEntries((await sb(`/team_members?telegram_uid=not.is.null&deleted_at=is.null&select=telegram_uid,display_name,status`)).map(m => [m.telegram_uid, m]));
    return { queue, rooms, failed_notifications: failed, legacy_rooms: legacy.map(c => ({ ...c, agents: Object.values(c.joined || {}), joined: undefined })),
      agents: team.map(uid => { const a = agents.find(x => x.uid === uid); return { uid, name: names[uid]?.display_name || null, available: a ? a.available : true, available_at: a?.available_at || null, active_sid: a?.active_sid || null }; }),
      limits: s.support, flags: { human_requests_disabled: s.emergency.human_requests_disabled, telegram_notifications_disabled: s.emergency.telegram_notifications_disabled } };
  } },

  support_accept: { perm: "manage_support", method: "POST", fn: async ctx => {
    const sid = String(ctx.b.sid || ""); need(SID.test(sid), 400, "bad_request");
    const nm = String(ctx.p.name || "Agent").slice(0, 40);
    const o = await rpc("join_session", { p_sid: sid, p_uid: ctx.p.uid, p_name: nm });
    if (!o.ok) fail(409, o.reason === "taken" ? "taken" : "ended", o.reason === "taken" ? `Already accepted by ${o.owner_name}.` : "This request has ended.");
    if (o.first) { await announceAccepted(o.notif, sid, ctx.p.uid, nm, o.request_id); await ctx.audit("handoff_accepted", { via: "dashboard" }, { target: o.request_id || sid }); }
    return { ok: true, request_id: o.request_id };
  } },

  support_reply: { perm: "manage_support", method: "POST", fn: async ctx => {
    const sid = String(ctx.b.sid || ""); need(SID.test(sid), 400, "bad_request");
    const s = (await sb(`/sessions?sid=eq.${sid}&select=owner_uid,status,conversation_id`))[0]; need(s, 404, "not_found");
    const locked = s.conversation_id ? !!(await sb(`/ai_support_conversations?id=eq.${q(s.conversation_id)}&select=closed_at`))[0]?.closed_at : false;
    need(!locked, 409, "case_closed", "This case is closed. Replies can no longer be sent to it.");
    need(s.status !== "ended", 409, "ended", "This chat has ended.");
    need(s.owner_uid === ctx.p.uid, 403, "not_owner", "Only the agent who accepted this request can reply.");
    const raw = v(text(ctx.b.text, { min: 1, max: 1000, multiline: true, label: "Message" }));
    need(!asksForSecret(raw), 400, "policy", "Not sent: CHDS Support never asks customers for passwords, one-time codes, login or recovery codes, cookies or tokens.");
    const red = redactSecrets(raw);
    const prof = await agentProfile(ctx.p.uid, ctx.p.name);
    let o;
    try { o = await rpc("post_message", { p_sid: sid, p_sender: "agent", p_author: prof.name + " · CHDS Support", p_body: red.text }); }
    catch (e) { if (isCaseClosed(e)) fail(409, "case_closed", "This case is closed. Replies can no longer be sent to it."); throw e; }
    need(o.ok, 409, "ended", "This chat has ended.");
    return { ok: true, redacted: red.found };
  } },

  support_return: { perm: "manage_support", method: "POST", fn: async ctx => {
    const sid = String(ctx.b.sid || ""); need(SID.test(sid), 400, "bad_request");
    const resolve = ctx.b.resolve === true;
    const s = (await sb(`/sessions?sid=eq.${sid}&select=owner_uid,status,request_id`))[0]; need(s, 404, "not_found");
    const force = s.owner_uid !== ctx.p.uid;
    if (force) need(ctx.p.role === "founder" || ctx.p.role === "administrator", 403, "not_owner", "Only the agent who accepted this request, a Founder or an Administrator can hand it back.");
    const summary = v(text(ctx.b.summary, { max: 2000, multiline: true, label: "Summary", required: force }));
    const unresolved = v(text(ctx.b.unresolved, { max: 2000, multiline: true, label: "Unresolved tasks" }));
    const o = await rpc("return_to_ai", { p_sid: sid, p_actor: actor(ctx), p_actor_uid: ctx.p.uid, p_force: force, p_summary: summary || null, p_unresolved: unresolved || null, p_resolve: resolve });
    if (!o.ok) fail(409, o.reason, o.reason === "not_owner" ? "Only the agent who accepted this request can hand it back." : o.reason === "case_closed" ? "This case is closed." : "This chat has already ended.");
    await closeNotifs(o.notif || [], `⏹ <b>${esc(o.request_id || "Session")}</b> ${resolve ? "was resolved" : "was returned to AI"} from the dashboard.`);
    if (s.owner_uid && s.owner_uid !== ctx.p.uid) await say(s.owner_uid, `ℹ️ ${esc(ctx.p.name)} ${resolve ? "resolved" : "returned to AI"} <code>${esc(o.request_id || sid)}</code> from the dashboard.`).catch(warn("notify owner of dashboard handback"));
    await ctx.audit(resolve ? "handoff_resolved" : "handoff_returned_to_ai", { forced: force, summary: (summary || "").slice(0, 300) }, { target: o.request_id || sid });
    return { ok: true };
  } },

  support_end: { perm: "manage_support", method: "POST", fn: async ctx => {
    const sid = String(ctx.b.sid || ""); need(SID.test(sid), 400, "bad_request");
    const reason = reasonOf(ctx.b);
    const s = (await sb(`/sessions?sid=eq.${sid}&select=sid,owner_uid,conversation_id,status`))[0]; need(s, 404, "not_found");
    need(!s.owner_uid || s.owner_uid === ctx.p.uid || isCaseAdmin(ctx.p), 403, "not_owner", "Only the assigned agent, a Founder or an Administrator can end this chat.");
    await closeHumanRoom(sid, actor(ctx), reason);
    await ctx.audit("support_chat_ended", { reason }, { target: sid });
    return { ok: true };
  } },

  support_retry: { perm: "manage_support", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(HSID.test(id), 400, "bad_request");
    const r = await retryRequest(id);
    if (r.error) fail(409, r.error, r.error === "not_waiting" ? "Only waiting requests are re-sent." : "Not found.");
    await ctx.audit("handoff_notifications_retried", r, { target: id });
    return { ok: true, ...r };
  } },

  support_note: { perm: "manage_support", method: "POST", fn: async ctx => {
    const id = String(ctx.b.id || ""); need(HSID.test(id), 400, "bad_request");
    const body = v(text(ctx.b.body, { min: 1, max: 2000, multiline: true, label: "Note" }));
    const n = (await sb("/internal_notes", { method: "POST", body: { subject_type: "handoff", subject_id: id, author: actor(ctx), body }, prefer: "return=representation" }))[0];
    await ctx.audit("handoff_note_added", {}, { target: id });
    return { ok: true, note: n };
  } },

  support_quota_reset: { perm: "manage_support", method: "POST", fn: async ctx => {
    const id = String(ctx.b.user_id || ""); need(UUID.test(id), 400, "bad_request");
    const reason = reasonOf(ctx.b);
    await sb(`/support_rate_limits?key=eq.v:${id}`, { method: "DELETE" });
    await ctx.audit("support_quota_reset", { reason }, { target: id });
    return { ok: true };
  } },

  my_availability: { perm: "manage_support", method: "POST", fn: async ctx => {
    const available = ctx.b.available === true;
    await sb("/agents?on_conflict=uid", { method: "POST", body: { uid: ctx.p.uid, available, available_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
    await ctx.audit("agent_availability", { available }, { target: ctx.p.uid });
    return { ok: true, available };
  } }
};

ops.chat = { perm: "manage_support", method: "GET", fn: async ctx => {
  const sid = String(ctx.qy.sid || ""); need(SID.test(sid), 400, "bad_request");
  return { messages: await sb(`/messages?sid=eq.${sid}&order=id.asc&limit=500&select=id,sender,author,body,created_at`) };
} };
