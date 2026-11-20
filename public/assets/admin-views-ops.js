"use strict";
(()=>{
const A=window.ADM,{$,$$,h,I,money,moneyS,num,when,day,dur,ago,ini,badge,api,errText,toast,loading,empty,errorBox,page,kpis,table,dlg,confirmAct,formDlg,chart,every,crumbs,has,phToday}=A;
const V=A.views,qs=A.qs;
const REASON={user_requested:"Customer asked for a human",knowledge_limit:"Outside what the AI can answer",manual_investigation:"Needs manual investigation",account_action:"Needs account-level action",authorized_member:"Needs an authorized team member",unresolved_after_steps:"Unresolved after AI guidance",repeated_failure:"Repeated unsuccessful attempts",rejected_resolution:"Customer rejected the AI resolution",other:"Other"};
const CAT={hacked:"Hacked",disabled:"Disabled",locked:"Locked out",page_access:"Page access",impersonation:"Impersonation",ad_account:"Ad account",website:"Website",general:"General",other:"Other"};
const RCAT={account_recovery:"Account recovery",page_recovery:"Page recovery",ad_account:"Ad account",impersonation:"Impersonation",website:"Website project",consultation:"Consultation",scheduled_activity:"Scheduled / planned activity",other:"Other"};
const RSTATUS={pending:"Pending",reviewed:"Reviewed",approved:"Approved",rejected:"Rejected",changes_requested:"Corrections requested"};
const PRIO={urgent:"Urgent",high:"High",normal:"Normal",low:"Low"};
const CLOSE_EFFECTS=["The case becomes permanently read-only under normal operation.","The customer can no longer send messages to this conversation.","The assigned agent can no longer reply in this conversation.","AI Support will no longer respond in this conversation.","Pending and queued responses are blocked.","The customer must start a new conversation to request support again."];
const addD=(s,n)=>{const d=new Date(s+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const PRESETS=[["today","Today"],["yesterday","Yesterday"],["this_week","This week"],["last_week","Last week"],["this_month","This month"],["last_month","Last month"],["this_year","This year"],["last_year","Last year"],["all","All time"],["custom","Custom range"]];
const rangeBar=(st)=>`<form class="bar" data-range><div class="f"><label for="rp">Period</label><select id="rp" name="preset">${PRESETS.map(([v,l])=>`<option value="${v}"${st.preset===v?" selected":""}>${l}</option>`).join("")}</select></div><div class="f" data-cus${st.preset==="custom"?"":" hidden"}><label for="rf">From</label><input id="rf" name="from" type="date" min="2020-01-01" value="${h(st.from||"")}"></div><div class="f" data-cus${st.preset==="custom"?"":" hidden"}><label for="rt">To</label><input id="rt" name="to" type="date" min="2020-01-01" value="${h(st.to||"")}"></div></form>`;
function bindRange(el,st,load){const f=$("[data-range]",el);f.addEventListener("change",()=>{new FormData(f).forEach((v,k)=>st[k]=v);$$("[data-cus]",f).forEach(x=>x.hidden=st.preset!=="custom");if(st.preset!=="custom"||(st.from&&st.to))load()})}

async function aiUserDrawer(u0,reload){
  const r=await api("ai_user_get?id="+u0.id);if(!r.ok){toast(errText(r),"err");return}
  const {user:u,conversations,notes,handoffs,counts}=r.j;
  const d=A.drawer(u.display_name,`<p class="small">The name is self-reported by the visitor and is not a verified identity.</p><dl class="kv"><dt>User ID</dt><dd><code>${h(u.id)}</code></dd><dt>Status</dt><dd>${badge(u.status)} ${h(u.status_reason||"")}</dd><dt>Flags</dt><dd>${(u.flags||[]).map(f=>`<span class="bd wa">${h(f)}</span>`).join(" ")||"—"}</dd>
    <dt>First interaction</dt><dd>${when(r.j.first_interaction)}</dd><dt>Last activity</dt><dd>${when(r.j.last_activity)}</dd><dt>Conversations</dt><dd>${num(counts.conversations)}</dd><dt>Messages sent</dt><dd>${num(counts.messages)}</dd><dt>Human requests</dt><dd>${num(counts.handoffs)}</dd></dl>
    ${has("manage_ai_support")?`<div class="acts" style="margin:14px 0"><button class="btn ghost sm" data-u="flags">${I("pencil")} Edit flags</button><button class="btn ${u.status==="active"?"danger":"ok"} sm" data-u="status">${u.status==="active"?"Block from chat":"Unblock"}</button>${has("manage_support")?`<button class="btn ghost sm" data-u="quota">Reset request limit</button>`:""}</div>`:""}
    <div class="card"><h3>${I("message-square")} Conversations</h3>${table([{l:"Started",f:c=>when(c.created_at)},{l:"Title",f:c=>h(c.title||"—")},{l:"Status",f:c=>badge(c.status)},{l:"Msgs",f:c=>num(c.message_count),c:"num"},{l:"",f:c=>`<a href="#/ai-conversations/${h(c.id)}">Open</a>`}],conversations,{emptyText:"No conversations."})}</div>
    <div class="card" style="margin-top:14px"><h3>${I("headset")} Human Support requests</h3>${table([{l:"Request",f:x=>`<a href="#/handoffs/${h(x.id)}">${h(x.id)}</a>`},{l:"Reason",f:x=>h(REASON[x.reason]||x.reason)},{l:"Status",f:x=>badge(x.status)},{l:"Agent",f:x=>h(x.assigned_name||"—")},{l:"Created",f:x=>when(x.created_at)}],handoffs,{emptyText:"No requests."})}</div>
    ${A.notes(notes)}`);
  const re=()=>{d.close();aiUserDrawer(u0,reload);reload&&reload()};
  A.bindNote(d,"ai_user_note",{id:u.id},re);
  $$("[data-u]",d).forEach(b=>b.onclick=async()=>{const a=b.dataset.u;
    if(a==="flags")return formDlg({title:"Visitor flags",intro:"Short labels for internal review (e.g. vip, abusive, duplicate). Letters, digits, - and _.",fields:[{n:"flags",l:"Flags (comma separated)",v:(u.flags||[]).join(", ")}],
      onSubmit:async v=>{const x=await api("ai_user_flags",{id:u.id,flags:v.flags.split(",").map(s=>s.trim()).filter(Boolean),status:u.status});if(x.ok){toast("Flags saved.","ok");re();return true}return errText(x)}});
    if(a==="quota"){const c=await confirmAct({title:"Reset this visitor's Human Support limit?",text:"Their request count and cooldown are cleared (IP-based limits still apply).",reason:true,confirm:"Reset"});if(c&&(await A.run("support_quota_reset",{user_id:u.id,reason:c.reason},"Limit reset.")).ok)re();return}
    const to=u.status==="active"?"blocked":"active";const c=await confirmAct({title:to==="blocked"?"Block this visitor from AI Support?":"Unblock this visitor?",text:to==="blocked"?"Their chat sessions end and new messages are refused. Their records are kept.":"They can use the chat again.",danger:to==="blocked",reason:true,confirm:to==="blocked"?"Block":"Unblock"});
    if(c&&(await A.run("ai_user_flags",{id:u.id,flags:u.flags||[],status:to,reason:c.reason},to==="blocked"?"Visitor blocked.":"Visitor unblocked.")).ok)re()});
}
V["ai-users"]=el=>A.list(el,{title:"AI Support Users",icon:"user",desc:"Visitors who registered a name in CHDS AI Support. Names are self-reported. Session tokens are never shown.",op:"ai_users_list",
  filters:[{n:"q",l:"Search name or user ID",w:1},{n:"status",l:"Status",t:"select",o:[["","All"],["active","Active"],["blocked","Blocked"]]}],
  cols:[{l:"Visitor",f:u=>`<div class="prow"><span class="pav">${h(ini(u.display_name))}</span><span><b>${h(u.display_name)}</b><br><code>${h(String(u.id).slice(0,8))}</code></span></div>`},{l:"Status",f:u=>badge(u.status)+(u.flags||[]).map(f=>` <span class="bd wa">${h(f)}</span>`).join("")},
    {l:"Conversations",f:u=>num(u.conversations),c:"num"},{l:"Messages",f:u=>num(u.messages),c:"num"},{l:"Handoffs",f:u=>num(u.handoffs),c:"num"},{l:"First seen",f:u=>day(u.first_seen_at)},{l:"Last activity",f:u=>ago(u.last_seen_at)}],
  click:(u,reload)=>aiUserDrawer(u,reload)});

async function convoDetail(el,id){
  const r=await api("ai_convo_get?id="+encodeURIComponent(id));if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=A.go;return}
  const {conversation:c,messages,handoffs,notes}=r.j;crumbs(c.title||"Conversation");
  el.innerHTML=page(c.title||"Conversation","message-square",`${badge(c.status)} owner: <b>${h(c.owner==="human"?"Human agent":"AI")}</b> · visitor <a href="#/ai-users">${h(c.user?.display_name||"")}</a> <code>${h(String(c.user_id).slice(0,8))}</code>`,`<a class="btn ghost sm" href="#/ai-conversations">${I("chevron-left")} All conversations</a>`)+
    `<div class="grid g2" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div class="card"><h3>${I("message-square")} Full transcript</h3><p class="small">AI-generated summaries and agent notes are highlighted and never mixed with the customer's own words.</p>${A.transcript(messages)}</div>
    <div><div class="card"><h3>${I("info")} Details</h3><dl class="kv"><dt>Category</dt><dd>${h(CAT[c.category]||c.category||"—")}</dd><dt>Started</dt><dd>${when(c.created_at)}</dd><dt>Last message</dt><dd>${when(c.last_message_at)}</dd><dt>Resolved</dt><dd>${c.resolved_at?when(c.resolved_at)+" by "+h(c.resolved_by):"—"}</dd><dt>Unsuccessful attempts</dt><dd>${num(c.failure_count)}</dd></dl></div>
    <div class="card" style="margin-top:14px"><h3>${I("arrow-left-right")} Escalations</h3>${handoffs.length?handoffs.map(x=>`<p><a href="#/handoffs/${h(x.id)}">${h(x.id)}</a> ${badge(x.status)}<br><span class="small">${h(REASON[x.reason]||x.reason)} · ${when(x.created_at)}${x.assigned_name?" · "+h(x.assigned_name):""}</span></p>`).join(""):'<p class="small">Never escalated.</p>'}</div>
    ${has("manage_ai_support")?A.notes(notes):""}</div></div>`;
  A.bindNote(el,"ai_convo_note",{id:c.id},()=>convoDetail(el,id));
}
V["ai-conversations"]=(el,[id])=>id?convoDetail(el,id):A.list(el,{title:"AI Support Conversations",icon:"message-square",desc:"Every AI Support conversation with its owner (AI or human), status and escalation state. Viewing a transcript is recorded in the audit log.",op:"ai_convos_list",
  filters:[{n:"q",l:"Search title",w:1},{n:"status",l:"Status",t:"select",o:[["","All"],["active","Active"],["awaiting_confirmation","Awaiting confirmation"],["resolved","Resolved"],["handoff","With human"],["closed","Closed"]]},{n:"owner",l:"Owner",t:"select",o:[["","All"],["ai","AI"],["human","Human"]]},{n:"category",l:"Category",t:"select",o:A.opts(CAT)},{n:"from",l:"From",t:"date"},{n:"to",l:"To",t:"date"}],
  cols:[{l:"Conversation",f:c=>`<b>${h(c.title||"(no messages yet)")}</b><br><span class="small">${h(c.user?.display_name||"")}</span>`},{l:"Status",f:c=>badge(c.status)},{l:"Owner",f:c=>c.owner==="human"?'<span class="bd ok">Human</span>':'<span class="bd in">AI</span>'},{l:"Category",f:c=>h(CAT[c.category]||"—")},{l:"Msgs",f:c=>num(c.message_count),c:"num"},{l:"Updated",f:c=>ago(c.updated_at)}],
  click:c=>location.hash="#/ai-conversations/"+c.id});

V["ai-analytics"]=async el=>{
  const st={preset:"this_month"};
  el.innerHTML=page("AI Resolution Analytics","pie-chart","Calculated from stored conversations and handoff requests. Nothing is estimated.")+rangeBar(st)+`<div data-out>${loading()}</div>`;
  const out=$("[data-out]",el);
  const load=async()=>{out.innerHTML=loading();const r=await api("ai_analytics?"+qs(st));if(!r.ok){out.innerHTML=errorBox(errText(r));$("[data-retry]",out).onclick=load;return}
    const a=r.j,pct=v=>v===null||v===undefined?"—":v+"%";
    out.innerHTML=kpis([{l:"AI conversations",v:num(a.conversations),i:"message-square"},{l:"Resolved by AI",v:num(a.ai_resolved),i:"circle-check"},{l:"AI resolution rate",v:pct(a.ai_resolution_rate),i:"pie-chart"},{l:"Human escalations",v:num(a.escalations),i:"arrow-left-right"},{l:"Human intervention rate",v:pct(a.human_intervention_rate),i:"headset"},
      {l:"Accepted handoffs",v:num(a.handoffs_accepted),i:"user-check"},{l:"Pending handoffs",v:num(a.handoffs_pending),i:"clock"},{l:"Cancelled handoffs",v:num(a.handoffs_cancelled),i:"circle-x"},{l:"Avg. AI resolution time",v:dur(a.avg_ai_resolution_sec),i:"zap"},{l:"Avg. wait for a human",v:dur(a.avg_wait_sec),i:"clock"},{l:"Avg. human resolution time",v:dur(a.avg_human_resolution_sec),i:"history"}])+
      `<div class="grid g2"><div class="card"><h3>${I("bar-chart")} Conversations and escalations per day</h3>${chart({labels:a.daily.map(x=>String(x.d).slice(5)),series:[{name:"Conversations",values:a.daily.map(x=>x.conversations)},{name:"Escalations",values:a.daily.map(x=>x.escalations),color:"#F59E0B"}],title:"Conversations per day"})}</div>
      <div class="card"><h3>${I("arrow-left-right")} Escalation reasons</h3>${table([{l:"Reason",f:x=>h(REASON[x[0]]||x[0])},{l:"Requests",f:x=>num(x[1]),c:"num"}],Object.entries(a.reasons).sort((x,y)=>y[1]-x[1]),{emptyText:"No escalations in this period."})}
      <h3 style="margin-top:16px">${I("layers")} Categories</h3>${table([{l:"Category",f:x=>h(CAT[x[0]]||x[0])},{l:"Conversations",f:x=>num(x[1]),c:"num"}],Object.entries(a.categories).sort((x,y)=>y[1]-x[1]),{emptyText:"No conversations in this period."})}</div></div>`};
  bindRange(el,st,load);load();
};

async function handoffDetail(el,id){
  const r=await api("handoff_get?id="+encodeURIComponent(id));if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=A.go;return}
  const {request:x,history,messages,notifications,notes,mine,conversation:cv,previous_requests:prev,sla,can:C}=r.j,s=x.summary||{},open=["waiting","assigned","in_progress","waiting_customer"].includes(x.status),closed=x.status==="closed";crumbs(x.id);
  const qr=C.reply?((await api("quick_replies_list")).j.rows||[]):[];
  const admin=["founder","administrator"].includes(A.me().role),u=x.user||{};
  el.innerHTML=page(`Request ${x.id}`,closed?"lock":"arrow-left-right",`${badge(x.status)} ${badge(x.priority||"normal").replace(/>([^<]*)</,">"+h(PRIO[x.priority||"normal"])+" priority<")} · ${h(u.display_name||"")} (self-reported name) · created ${when(x.created_at)}`,`<a class="btn ghost sm" href="#/${closed&&!has("manage_support")?"closed-cases":"handoffs"}">${I("chevron-left")} ${closed?"Back":"Queue"}</a>`+
    (C.manage&&x.status==="waiting"?`<button class="btn ok sm" data-h="accept">${I("user-check")} Accept</button><button class="btn ghost sm" data-h="retry">${I("send")} Re-send alerts</button>`:"")+
    (C.manage&&open&&x.status!=="waiting"&&(mine||admin)?`<button class="btn ghost sm" data-h="return">${I("bot")} Return to AI</button><button class="btn ok sm" data-h="resolve">${I("circle-check")} Resolve</button>`:"")+
    (C.manage&&open?`<button class="btn ghost sm" data-h="escalate">${I("flag")} Escalate</button><button class="btn ghost sm" data-h="end" title="Ends the live chat and returns the customer to AI. Does not lock the case.">End chat</button>`:"")+
    (C.close?`<button class="btn danger sm" data-h="close">${I("lock")} Close This Case</button>`:"")+
    (C.reopen?`<button class="btn ghost sm" data-h="reopen">${I("refresh")} Reopen case</button>`:""))+
    (closed?`<p class="notice warn" role="status">${I("lock")} <span><b>This case is closed and locked.</b> Closed ${when(x.closed_at)} by ${h(x.closed_by_name||x.closed_by||"—")}${x.close_reason?` — “${h(x.close_reason)}”`:""}. The customer, agents and CHDS AI can no longer add messages; the full history below stays readable.${C.reopen?" Reopening is a separate, audited administrator action.":""}</span></p>`:"")+
    (x.reopened_at?`<p class="notice" role="note">${I("history")} <span>Reopened ${when(x.reopened_at)} by <code>${h(x.reopened_by)}</code>: ${h(x.reopen_reason||"")}. The original closure (${when(x.closed_at)}, ${h(x.closed_by_name||x.closed_by||"")}) is kept in the history.</span></p>`:"")+
    (x.escalated_at?`<p class="notice warn">${I("flag")} <span>Escalated ${when(x.escalated_at)}: ${h(x.escalation_note||"")}</span></p>`:"")+
    `<div class="g21"><div><div class="card"><h3>${I("sparkles")} AI-generated summary <span class="bd in">${h(s.generated_by||"")}</span></h3><p style="white-space:pre-wrap">${h(s.summary||"—")}</p>
      <dl class="kv"><dt>Category</dt><dd>${h(CAT[x.category]||x.category||"—")}</dd><dt>Escalation reason</dt><dd>${h(REASON[x.reason]||x.reason)}</dd><dt>Already covered</dt><dd>${(s.attempted||[]).map(h).join("; ")||"—"}</dd><dt>Results</dt><dd>${h(s.results||"—")}</dd><dt>Unresolved</dt><dd>${h(s.unresolved||"—")}</dd>${x.agent_summary?`<dt>Agent summary</dt><dd>${h(x.agent_summary)}</dd>`:""}${x.unresolved_tasks?`<dt>Open tasks</dt><dd>${h(x.unresolved_tasks)}</dd>`:""}</dl></div>
      <div class="card" style="margin-top:14px"><h3>${I("message-square")} Conversation (customer, AI, agent, system)</h3>${A.transcript(messages)}
      ${C.reply?`<form data-reply style="display:grid;gap:8px;margin-top:12px">${qr.length?`<label for="qrs">Quick reply</label><select id="qrs"><option value="">— insert a quick reply —</option>${qr.map(q=>`<option value="${h(q.id)}">${h(q.title)}</option>`).join("")}</select>`:""}<label for="rp">Reply to the customer as ${h(A.me().name)}</label><textarea id="rp" maxlength="1000"></textarea><p class="small">Never ask for passwords, one-time codes, login or recovery codes, cookies or tokens — such messages are blocked.</p><button class="btn sm" style="justify-self:start" type="submit">${I("send")} Send</button></form>`
        :closed?`<p class="small" style="margin-top:10px">${I("lock")} Replies are disabled: this case is closed.</p>`:""}</div></div>
    <div><div class="card"><h3>${I("user")} Customer</h3><dl class="kv"><dt>Name</dt><dd>${h(u.display_name||"—")} <span class="small">(self-reported)</span></dd><dt>Visitor ID</dt><dd><code>${h(String(u.id||"").slice(0,8))}</code></dd><dt>First seen</dt><dd>${when(u.first_seen_at)}</dd><dt>Last seen</dt><dd>${ago(u.last_seen_at)}</dd>${(u.flags||[]).length?`<dt>Flags</dt><dd>${u.flags.map(f=>`<span class="bd">${h(f)}</span>`).join(" ")}</dd>`:""}<dt>Conversation</dt><dd>${cv?badge(cv.status)+` <a href="#/ai-conversations/${h(cv.id)}">Open</a>`:"—"}</dd><dt>Earlier requests</dt><dd>${prev&&prev.length?prev.map(p=>`<a href="#/handoffs/${h(p.id)}">${h(p.id)}</a> ${badge(p.status)}`).join("<br>"):"None"}</dd></dl></div>
      <div class="card" style="margin-top:14px"><h3>${I("clock")} Assignment &amp; SLA</h3><dl class="kv"><dt>Agent</dt><dd>${h(x.assigned_name||"Not accepted yet")}</dd><dt>Priority</dt><dd>${C.manage&&!closed?`<select data-prio aria-label="Priority">${Object.entries(PRIO).map(([k,l])=>`<option value="${k}"${(x.priority||"normal")===k?" selected":""}>${l}</option>`).join("")}</select>`:h(PRIO[x.priority||"normal"])}</dd>
        <dt>Accepted</dt><dd>${when(x.assigned_at)}</dd><dt>First reply</dt><dd>${when(x.first_response_at)}${x.first_response_at?` <span class="small">(${dur((Date.parse(x.first_response_at)-Date.parse(x.created_at))/1e3)})</span>`:""}</dd>
        <dt>First-reply SLA</dt><dd>${sla.first_response_breached?badge("failed").replace(">failed<",">breached<"):badge("active").replace(">active<",">on track<")} <span class="small">due ${when(sla.first_response_due)}</span></dd>
        <dt>Resolution SLA</dt><dd>${sla.resolution_breached?badge("failed").replace(">failed<",">breached<"):badge("active").replace(">active<",">on track<")} <span class="small">due ${when(sla.resolution_due)}</span></dd>
        <dt>Resolved</dt><dd>${when(x.resolved_at)}</dd><dt>Ended / closed</dt><dd>${when(x.closed_at||x.cancelled_at)}</dd><dt>Satisfaction</dt><dd>${x.csat_rating?`${"★".repeat(x.csat_rating)}${"☆".repeat(5-x.csat_rating)} (${x.csat_rating}/5)${x.csat_comment?`<br><span class="small">${h(x.csat_comment)}</span>`:""}`:"—"}</dd></dl></div>
      <div class="card" style="margin-top:14px"><h3>${I("send")} Telegram alerts</h3>${table([{l:"Recipient",f:n=>`<code>…${h(String(n.chat_id).slice(-4))}</code>`},{l:"Status",f:n=>badge(n.status)},{l:"Tries",f:n=>num(n.attempts),c:"num"},{l:"Error",f:n=>h(n.last_error||"")}],notifications,{emptyText:"No alerts recorded."})}</div>
      <div class="card" style="margin-top:14px"><h3>${I("history")} History &amp; audit trail</h3>${table([{l:"When",f:y=>when(y.at)},{l:"Actor",f:y=>`<code>${h(y.actor)}</code>`},{l:"Action",f:y=>h(y.action.replace(/_/g," "))+(y.to_status?" → "+badge(y.to_status):"")+(y.detail&&y.detail.reason?`<br><span class="small">${h(y.detail.reason)}</span>`:"")}],history)}</div>
      ${has("manage_support")?A.notes(notes):""}</div></div>`;
  const re=()=>handoffDetail(el,id);
  A.bindNote(el,"support_note",{id:x.id},re);
  const qs2=$("#qrs",el);if(qs2)qs2.onchange=()=>{const q=qr.find(z=>z.id===qs2.value);if(q){const t=$("#rp",el);t.value=(t.value?t.value+"\n":"")+q.body;t.focus()}qs2.value=""};
  const rf=$("[data-reply]",el);if(rf)rf.addEventListener("submit",async e=>{e.preventDefault();const t=$("#rp",el).value.trim();if(!t)return;const b=$("[type=submit]",rf);b.disabled=true;const y=await A.run("support_reply",{sid:x.sid,text:t},"Sent.");b.disabled=false;if(y.ok){if(y.j.redacted&&y.j.redacted.length)toast("A password/code-like value was removed before sending.","info");re()}else if(y.j.error==="case_closed")re()});
  const pr=$("[data-prio]",el);if(pr)pr.onchange=async()=>{if((await A.run("handoff_priority",{id:x.id,priority:pr.value},"Priority updated.")).ok)re()};
  $$("[data-h]",el).forEach(b=>b.onclick=async()=>{const a=b.dataset.h;b.disabled=true;
    try{
    if(a==="accept"){if((await A.run("support_accept",{sid:x.sid},"You accepted this request. Reply here or in Telegram.")).ok)re();return}
    if(a==="retry"){const y=await A.run("support_retry",{id:x.id});if(y.ok)toast(`Alerts: ${y.j.sent} sent, ${y.j.failed} failed.`,y.j.failed?"err":"ok");re();return}
    if(a==="end"){const c=await confirmAct({title:"End this chat?",text:"The live chat ends and the customer goes back to CHDS AI Support. The case is <b>not</b> locked: the customer can keep chatting with AI or ask for a human again. Use Close This Case to lock it.",reason:true,confirm:"End chat"});if(c&&(await A.run("support_end",{sid:x.sid,reason:c.reason},"Chat ended.")).ok)re();return}
    if(a==="escalate"){const c=await confirmAct({title:"Escalate this case?",text:"Priority becomes Urgent and Founders/Administrators are notified.",reason:true,reasonLabel:"Escalation note",confirm:"Escalate"});if(c&&(await A.run("handoff_escalate",{id:x.id,note:c.reason},"Case escalated.")).ok)re();return}
    if(a==="close")return closeCaseDlg(x,re);
    if(a==="reopen"){const c=await confirmAct({title:`Reopen ${x.id}?`,text:"The conversation unlocks and returns to CHDS AI Support. The original closure stays in the history. Prefer asking the customer to start a new conversation for new requests.",reason:true,reasonLabel:"Reopening reason",confirm:"Reopen case"});if(c&&(await A.run("case_reopen",{id:x.id,reason:c.reason},"Case reopened.")).ok)re();return}
    formDlg({title:a==="resolve"?"Resolve this request":"Return to AI Support",intro:"Your summary is saved for the dashboard and given to the AI as context. The customer is notified.",fields:[{n:"summary",l:"What you did",t:"textarea",req:!mine,ml:2000},{n:"unresolved",l:"Anything still unresolved",t:"textarea",ml:2000}],submit:a==="resolve"?"Resolve":"Return to AI",
      onSubmit:async v=>{const y=await api("support_return",{sid:x.sid,resolve:a==="resolve",...v});if(y.ok){toast("Done.","ok");re();return true}return errText(y)}});
    }finally{b.disabled=false}
  });
}
A.handoffDetail=(el,id)=>handoffDetail(el,id);
function closeCaseDlg(x,after){
  const d=dlg(`<form novalidate data-closeform><h2>${I("lock")} Close This Case?</h2><p class="small" style="font-size:13.5px">Case <b>${h(x.id)}</b> · ${h(x.user?.display_name||"")}. After closing:</p>
    <ul class="clist">${CLOSE_EFFECTS.map(t=>`<li>${h(t)}</li>`).join("")}</ul>
    <div class="fld"><label for="ccr">Closure reason (optional)</label><textarea id="ccr" maxlength="500"></textarea></div>
    <div class="ferr" role="alert"></div><div class="dacts"><button class="btn ghost" type="button" data-c>Cancel</button><button class="btn danger" type="submit">${I("lock")} Confirm Close</button></div></form>`,{label:"Close this case"});
  $("[data-c]",d).onclick=()=>d.close();
  $("form",d).addEventListener("submit",async e=>{e.preventDefault();const b=$("[type=submit]",d);b.disabled=true;b.textContent="Closing…";
    const y=await api("case_close",{id:x.id,reason:$("#ccr",d).value.trim()});b.disabled=false;b.innerHTML=`${I("lock")} Confirm Close`;
    if(y.ok){d.close();toast(y.j.already_closed?"This case was already closed.":"Case closed. The conversation is now read-only.","ok");after();return}
    $(".ferr",d).textContent=errText(y)});
  setTimeout(()=>$("#ccr",d).focus(),30);
}
const hcols=[{l:"Request",f:x=>`<b>${h(x.id)}</b>${x.last_customer_msg_at&&x.assigned_uid===A.me().uid&&(!x.agent_read_at||x.agent_read_at<x.last_customer_msg_at)?` <span class="bd in" title="New customer message">unread</span>`:""}<br><span class="small">${h(x.user?.display_name||"")}</span>`},{l:"Status",f:x=>badge(x.status)},{l:"Priority",f:x=>badge(x.priority||"normal").replace(/>([^<]*)</,">"+h(PRIO[x.priority||"normal"])+"<")},{l:"Reason",f:x=>h(REASON[x.reason]||x.reason)},{l:"Agent",f:x=>h(x.assigned_name||"—")},{l:"Created",f:x=>when(x.created_at)},{l:"Alerts",f:x=>`${num(x.notified_count)} sent${x.notify_failed?` · <span class="bd no">${num(x.notify_failed)} failed</span>`:""}`}];
V.handoffs=(el,[id])=>{if(id)return handoffDetail(el,id);
  const L=A.list(el,{title:"Human Handoff Queue",icon:"arrow-left-right",desc:"Open AI → Human Support requests, oldest first. Only one agent can accept a request; acceptance is atomic in the database. Refreshes every 10 seconds.",op:"handoffs_list",limit:50,defaults:{status:"open"},
    filters:[{n:"status",l:"Status",t:"select",o:[["open","All open"],["waiting","Waiting for Agent"],["assigned","Assigned"],["in_progress","In Progress"],["waiting_customer","Waiting for Customer"]]},{n:"priority",l:"Priority",t:"select",o:[["","All priorities"],...Object.entries(PRIO)]},{n:"mine",l:"Assigned",t:"select",o:[["","Everyone"],["1","My cases"]]},{n:"q",l:"Request ID"}],
    cols:[...hcols,{l:"Waiting",f:x=>x.status==="waiting"?ago(x.created_at).replace(" ago",""):"—"}],click:x=>location.hash="#/handoffs/"+x.id});
  every(()=>L.reload(),10000);
};
V.escalations=el=>A.list(el,{title:"Escalation History",icon:"history",desc:"Every handoff request: resolved, ended (back to AI), closed (locked), cancelled and failed-alert ones.",op:"handoffs_list",limit:50,
  filters:[{n:"q",l:"Request ID"},{n:"status",l:"Status",t:"select",o:[["","All"],["waiting","Waiting"],["assigned","Assigned"],["in_progress","In Progress"],["waiting_customer","Waiting for Customer"],["resolved","Resolved"],["ended","Ended (back to AI)"],["closed","Closed (locked)"],["cancelled","Cancelled"]]},{n:"priority",l:"Priority",t:"select",o:[["","All"],...Object.entries(PRIO)]},{n:"reason",l:"Reason",t:"select",o:A.opts(REASON)},{n:"from",l:"From",t:"date"},{n:"to",l:"To",t:"date"}],
  cols:[...hcols,{l:"Outcome",f:x=>x.status==="closed"?"Closed "+day(x.closed_at):x.resolved_at?"Resolved "+day(x.resolved_at):x.cancelled_at?"Cancelled":x.closed_at?"Ended "+day(x.closed_at):"Open"}],click:x=>location.hash="#/handoffs/"+x.id});

V.support=async el=>{
  const load=async()=>{
    const r=await api("support_overview");if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=load;return}
    const o=r.j,me=o.agents.find(a=>a.uid===A.me().uid);
    el.innerHTML=page("Human Support","headset",`Limits: ${num(o.limits.request_limit)} requests, then ${num(o.limits.cooldown_minutes)} minutes cooldown per visitor and IP (enforced in the database).`,(me?`<button class="btn ghost sm" data-av>${me.available?"Mark me unavailable":"Mark me available"}</button>`:"")+`<button class="btn ghost sm" data-refresh>${I("refresh")} Refresh</button>`)+
      (o.flags.human_requests_disabled?`<p class="notice warn">${I("siren")} New Human Support requests are disabled in Emergency Control.</p>`:"")+(o.flags.telegram_notifications_disabled?`<p class="notice warn">${I("siren")} Telegram notifications are disabled in Emergency Control.</p>`:"")+
      kpis([{l:"Waiting for an agent",v:num(o.queue.filter(x=>x.status==="waiting").length),i:"clock"},{l:"Being handled",v:num(o.queue.filter(x=>x.status!=="waiting").length),i:"headset"},{l:"Configured team members",v:num(o.agents.length),i:"users"},{l:"Available now",v:num(o.agents.filter(a=>a.available).length),i:"user-check"},{l:"Failed alerts",v:num(o.failed_notifications.length),i:"alert-triangle"}])+
      `<div class="card"><h3>${I("inbox")} Open requests</h3>${table([...hcols,{l:"",f:x=>`<a class="btn ghost sm" href="#/handoffs/${h(x.id)}">Open</a>`}],o.queue,{emptyText:"No open requests."})}</div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${I("users")} Team availability</h3>${table([{l:"Member",f:a=>h(a.name||"Unlinked UID")+` <code>…${h(a.uid.slice(-4))}</code>`},{l:"Availability",f:a=>a.available?badge("active").replace(">active<",">available<"):'<span class="bd">unavailable</span>'},{l:"Since",f:a=>ago(a.available_at)},{l:"In a chat",f:a=>a.active_sid?"yes":"—"}],o.agents,{emptyText:"No team UIDs configured (TELEGRAM_TEAM_UIDS / ALLOWED_UIDS / ADMIN_UIDS)."})}<p class="small">Agents switch availability with /online and /offline in the bot.</p></div>
      <div class="card"><h3>${I("alert-triangle")} Failed Telegram alerts</h3>${table([{l:"Kind",f:n=>h(n.kind)},{l:"Ref",f:n=>/^HS-/.test(n.ref)?`<a href="#/handoffs/${h(n.ref)}">${h(n.ref)}</a>`:h(n.ref)},{l:"Recipient",f:n=>`<code>…${h(String(n.chat_id).slice(-4))}</code>`},{l:"Tries",f:n=>num(n.attempts),c:"num"},{l:"Error",f:n=>h(n.last_error||""),c:"wide"}],o.failed_notifications,{emptyText:"No failed alerts."})}<p class="small">Open a waiting request and use “Re-send alerts” to retry safely (each recipient gets at most one copy).</p></div></div>
      <div class="card" style="margin-top:16px"><h3>${I("history")} Legacy chats (before the AI handoff upgrade)</h3>${table([{l:"Session",f:c=>`<code>${h(c.sid)}</code>`},{l:"Customer",f:c=>h(c.name)},{l:"Status",f:c=>badge(c.status)},{l:"Agents",f:c=>h(c.agents.join(", ")||"—")},{l:"Updated",f:c=>when(c.updated_at)},{l:"",f:c=>`<button class="btn ghost sm" data-legacy="${h(c.sid)}">View</button>`}],o.legacy_rooms,{emptyText:"No legacy chats."})}</div>`;
    $("[data-refresh]",el).onclick=load;
    const av=$("[data-av]",el);if(av)av.onclick=async()=>{if((await A.run("my_availability",{available:!me.available},"Availability updated.")).ok)load()};
    $$("[data-legacy]",el).forEach(b=>b.onclick=async()=>{const x=await api("chat?sid="+b.dataset.legacy);if(!x.ok){toast(errText(x),"err");return}A.drawer("Legacy chat "+b.dataset.legacy,A.transcript(x.j.messages.map(m=>({role:m.sender==="sys"?"system":m.sender,author:m.author,body:m.body,created_at:m.created_at}))))});
  };
  await load();every(load,15000);
};

async function reportForm(reload){
  const t=await api("team_options");const opts=(t.j.rows||[]).filter(m=>m.status==="active");
  if(!opts.length){toast("Add an active team member first (Team Management).","err");return}
  const mine=!has("manage_reports");
  formDlg({title:"Submit a report",intro:"Reports start as Pending. Only approved reports count towards revenue and performance, and only published reports appear on the public feed. Evidence and account details stay private. Future activity dates are allowed only for planned report types.",
    fields:[{n:"team_member_id",l:"Team member",t:"select",o:(mine?opts.filter(m=>m.id===t.j.self):opts).map(m=>[m.id,m.name]),v:t.j.self||"",req:true},{n:"title",l:"Report title",req:true,ml:120},
      [{n:"category",l:"Category",t:"select",o:Object.entries(RCAT),req:true},{n:"report_date",l:"Activity date",t:"date",v:phToday(),min:"2020-01-01",max:addD(phToday(),365),req:true,h:"When the activity happened (PH time)."}],
      [{n:"recovered",l:"Recovered accounts (if relevant)",t:"number",min:0,max:9999,step:1,v:0},{n:"revenue",l:"Revenue in PHP (if relevant)",t:"number",min:0,max:10000000,step:"0.01",v:0}],
      {n:"description",l:"Description",t:"textarea",ml:4000},{n:"account_info",l:"Account or case information (private)",t:"textarea",ml:2000},{n:"additional_info",l:"Additional information",t:"textarea",ml:2000},
      {n:"evidence",l:"Evidence (optional: JPG, PNG, WebP or PDF, max 3 MB)",t:"file",accept:"image/jpeg,image/png,image/webp,application/pdf"},
      ...(has("approve_reports")?[{n:"approve_now",l:"Approve immediately (not allowed for your own reports)",t:"checkbox"}]:[])],submit:"Submit report",
    onSubmit:async v=>{const r=await api("report_submit",v);if(r.ok){toast(`Report ${r.j.report.id} submitted.`,"ok");if(r.j.warning)toast(r.j.warning,"err");reload();return true}return errText(r)}});
}
async function reportDrawer(row,reload){
  const r=await api("report_get?id="+row.id);if(!r.ok){toast(errText(r),"err");return}
  const {report:x,evidence,history,notes,deletion_job:job}=r.j,open=x.status==="pending"||x.status==="reviewed",pub=!!x.published_at,arc=!!x.archived_at,wd=!!x.deleted_at,del=!!x.deletion_pending_at,live=!wd&&!del;
  const delBanner=del?`<div class="dbanner" role="alert">${I("alert-triangle")}<div><b>Permanent deletion in progress</b><p class="small">This report is hidden from the public and locked against changes.${job?` Job <code>${h(job.id)}</code> · ${h(job.status.replace("_"," "))} · ${num(job.attempts)} attempt(s)${job.last_error?`<br>Last error: ${h(job.last_error)}`:""}`:""}</p>
    ${has("delete_reports")&&job?`<button class="btn danger sm" type="button" data-r="purge_retry" data-busy="Retrying…">${I("refresh")} Retry permanent deletion</button>`:""}</div></div>`:"";
  const d=A.drawer(`Report ${x.id}`,`${delBanner}${wd?`<div class="dbanner warn">${I("info")}<div><b>Withdrawn by its owner</b><p class="small">Hidden from the owner, the totals and the public feed. ${has("delete_reports")?"You can delete it permanently.":""}</p></div></div>`:""}
    <dl class="kv"><dt>Status</dt><dd>${badge(x.status)} ${pub?badge("published"):""} ${arc?badge("archived"):""}${x.rejection_reason?" — "+h(x.rejection_reason):""}</dd>${x.status==="changes_requested"&&x.correction_request?`<dt>Corrections requested</dt><dd>${h(x.correction_request)}</dd>`:""}<dt>Member</dt><dd>${h(x.name)}</dd><dt>Title</dt><dd>${h(x.title||"(Telegram report)")}</dd><dt>Category</dt><dd>${h(RCAT[x.category]||x.category||"—")}</dd>
    <dt>Activity date</dt><dd>${day(x.report_date)}</dd><dt>Submitted</dt><dd>${when(x.created_at)} by <code>${h(x.submitted_by||"tg:"+x.uid)}</code> · ${h(x.source)}</dd><dt>Last change</dt><dd>${when(x.updated_at)}</dd>
    <dt>Recovered</dt><dd>${num(x.recovered)}</dd><dt>Revenue</dt><dd>${money(x.revenue)}</dd><dt>Reviewed</dt><dd>${x.reviewed_at?when(x.reviewed_at)+" by "+h(x.reviewed_by):"—"}</dd>
    ${x.description?`<dt>Description</dt><dd style="white-space:pre-wrap">${h(x.description)}</dd>`:""}${x.account_info?`<dt>Account / case info <span class="bd">private</span></dt><dd style="white-space:pre-wrap">${h(x.account_info)}</dd>`:""}${x.additional_info?`<dt>Additional</dt><dd style="white-space:pre-wrap">${h(x.additional_info)}</dd>`:""}${x.review_note?`<dt>Remarks</dt><dd>${h(x.review_note)}</dd>`:""}
    ${pub?`<dt>Public title</dt><dd>${h(x.public_title)}</dd><dt>Public summary</dt><dd>${h(x.public_summary||"—")}</dd><dt>Published</dt><dd>${when(x.published_at)} by <code>${h(x.published_by)}</code></dd>`:""}</dl>
    <div class="acts" style="margin:14px 0">${live&&has("approve_reports")&&open&&!arc?`<button class="btn ok sm" data-r="approve">${I("check")} Approve</button>${x.status==="pending"?`<button class="btn ghost sm" data-r="review">Mark reviewed</button>`:""}<button class="btn ghost sm" data-r="request_changes">${I("pencil")} Request corrections</button><button class="btn danger sm" data-r="reject">Reject</button>`:""}
    ${live&&has("approve_reports")&&x.status==="changes_requested"&&!arc?`<button class="btn danger sm" data-r="reject">Reject</button>`:""}
    ${live&&has("publish_reports")&&x.status==="approved"&&!pub&&!arc?`<button class="btn ok sm" data-r="publish">${I("globe")} Publish</button>`:""}${live&&has("publish_reports")&&pub?`<button class="btn ghost sm" data-r="unpublish">Unpublish</button>`:""}
    ${live&&has("publish_reports")?(arc?`<button class="btn ghost sm" data-r="unarchive">Restore from archive</button>`:`<button class="btn ghost sm" data-r="archive">${I("archive")} Archive</button>`):""}
    ${live&&has("manage_reports")&&!arc?`<button class="btn ghost sm" data-r="edit">${I("pencil")} Edit</button>`:""}${live&&!arc?`<button class="btn ghost sm" data-r="evidence">${I("upload")} Add evidence</button>`:""}
    ${!del&&has("delete_reports")?`<button class="btn danger sm" data-r="purge">${I("trash")} Delete permanently</button>`:""}</div>
    <div class="card"><h3>${I("paperclip")} Evidence <span class="bd">private</span></h3>${evidence.length?evidence.map(e=>`<button class="btn ghost sm" data-ev="${e.id}" data-busy="Opening…">${I(e.mime==="application/pdf"?"file-text":"image")} ${h(e.mime.split("/")[1].toUpperCase())} · ${num(Math.round(e.size_bytes/1024))} KB</button>`).join(" "):'<p class="small">No evidence attached.</p>'}<p class="small">Private bucket. Links are signed and expire after 5 minutes; each view is audited.</p></div>
    ${live?`<div class="card" style="margin-top:14px" data-photos aria-live="polite"><h3>${I("image")} Public photos</h3>${UX.skeleton("cards",3,{img:true})}</div>`:""}
    <div class="card" style="margin-top:14px"><h3>${I("history")} Report history</h3>${table([{l:"When",f:y=>when(y.at)},{l:"Actor",f:y=>`<code>${h(y.actor)}</code>`},{l:"Action",f:y=>h(y.action)+(y.to_status&&y.action==="status"?" → "+badge(y.to_status):"")},{l:"Reason / change",f:y=>h(y.reason||"")+(Object.keys(y.changes||{}).length&&(y.action==="edited"||y.action==="published")?` <code>${h(JSON.stringify(y.changes))}</code>`:""),c:"wide"}],history)}</div>
    ${A.notes(notes)}`);
  const re=()=>{d.close();reportDrawer(row,reload);reload()};
  A.bindNote(d,"report_note",{id:x.id},re);
  if(live)photos(d,x,re);
  $$("[data-ev]",d).forEach(b=>b.onclick=async()=>{const y=await A.run("report_evidence_url?id="+b.dataset.ev,undefined,null,b);if(y.ok)window.open(y.j.url,"_blank","noopener")});
  $$("[data-r]",d).forEach(b=>b.onclick=async()=>{const a=b.dataset.r;
    if(a==="purge")return purgeDlg(x,evidence.length,history.length,notes.length,()=>{d.close();reload()});
    if(a==="purge_retry"){const y=await A.run("report_purge_retry",{job_id:job.id},null,b);if(y.ok){toast(`Report ${x.id} was permanently deleted.`,"ok");d.close();reload()}else if(y.status===502){toast(y.j.message,"err");re()}return}
    if(a==="approve"||a==="review"){const c=await confirmAct({title:a==="approve"?`Approve ${x.id}?`:`Mark ${x.id} as reviewed?`,text:a==="approve"?`Its revenue (${money(x.revenue)}) counts as ${x.report_date>phToday()?"projected (future activity date)":"actual"} revenue. Approval does not make it public: publishing is a separate step.`:"It stays out of totals until approved.",confirm:a==="approve"?"Approve":"Mark reviewed"});if(c&&(await A.run("report_review",{id:x.id,action:a},a==="approve"?"Report approved.":"Marked reviewed.",b)).ok)re();return}
    if(a==="reject"){const c=await confirmAct({title:`Reject ${x.id}?`,text:"The member is told the reason. The report and its history are kept.",danger:true,reason:true,reasonLabel:"Rejection reason",confirm:"Reject"});if(c&&(await A.run("report_review",{id:x.id,action:"reject",reason:c.reason},"Report rejected.",b)).ok)re();return}
    if(a==="request_changes"){const c=await confirmAct({title:`Request corrections for ${x.id}?`,text:"The owner sees your request in My Reports (and on Telegram) and can edit the report, which sends it back for review.",reason:true,reasonLabel:"What needs to be corrected",confirm:"Request corrections"});if(c&&(await A.run("report_review",{id:x.id,action:"request_changes",reason:c.reason},"Corrections requested.",b)).ok)re();return}
    if(a==="publish")return formDlg({title:`Publish ${x.id}`,intro:"Only the public title and summary below (plus category, activity date, recovered count, the member's public name and the photos you selected under <b>Public photos</b>) appear on the public report feed. Never include customer names, account details or private information.",fields:[{n:"public_title",l:"Public title",v:x.title||"",req:true,ml:120},{n:"public_summary",l:"Public summary",t:"textarea",ml:600}],submit:"Publish",
      onSubmit:async v=>{const y=await api("report_publish",{id:x.id,action:"publish",...v});if(y.ok){toast("Report published.","ok");re();return true}return errText(y)}});
    if(a==="unpublish"||a==="archive"||a==="unarchive"){const lbl={unpublish:"Unpublish",archive:"Archive",unarchive:"Restore"}[a];const c=await confirmAct({title:`${lbl} ${x.id}?`,text:{unpublish:"It is removed from the public feed and its public photo copies are deleted (old photo links stop working). It stays approved and its photo selection is kept.",archive:"It is hidden from active lists"+(pub?" and removed from the public feed (its public photo copies are deleted)":"")+". History and revenue are kept.",unarchive:"It returns to the active lists. It is not republished automatically."}[a],reason:true,confirm:lbl});
      if(c){const y=await A.run("report_publish",{id:x.id,action:a,reason:c.reason},{unpublish:"Unpublished.",archive:"Archived.",unarchive:"Restored."}[a],b);if(y.ok){if(y.j.photos_warning)toast(y.j.photos_warning,"err");re()}}return}
    if(a==="evidence")return formDlg({title:"Add evidence",fields:[{n:"file",l:"File (JPG, PNG, WebP or PDF, max 3 MB)",t:"file",accept:"image/jpeg,image/png,image/webp,application/pdf",req:true}],submit:"Upload",onSubmit:async v=>{const y=await api("report_evidence_add",{id:x.id,file:v.file});if(y.ok){toast("Evidence added.","ok");re();return true}return errText(y)}});
    if(a==="edit")return formDlg({title:`Edit ${x.id}`,intro:"A reason is required and every change is recorded with its old and new value."+(x.status==="approved"?` <b>Re-review rules:</b> changing facts of this approved report ${has("approve_reports")?"":"sends it back to <b>Pending</b> (you cannot approve it)"}${pub?"; changing its category, activity date or recovered count <b>unpublishes</b> it until a publisher checks it again":""}.`:""),fields:[{n:"title",l:"Title",v:x.title||"",ml:120},[{n:"recovered",l:"Recovered",t:"number",min:0,max:9999,v:x.recovered},{n:"revenue",l:"Revenue (PHP)",t:"number",step:"0.01",min:0,v:x.revenue}],[{n:"report_date",l:"Activity date",t:"date",v:x.report_date,min:"2020-01-01",max:addD(phToday(),365)},{n:"category",l:"Category",t:"select",o:Object.entries(RCAT),v:x.category||"other"}],{n:"description",l:"Description",t:"textarea",v:x.description||""},{n:"account_info",l:"Account or case information (private)",t:"textarea",v:x.account_info||"",ml:2000},{n:"reason",l:"Reason for the change",t:"textarea",req:true,ml:500}],
      onSubmit:async v=>{const p={id:x.id,reason:v.reason};for(const k of["title","recovered","revenue","report_date","category","description","account_info"])if(String(v[k]??"")!==String(x[k]??""))p[k]=v[k];const y=await api("report_edit",p);if(y.ok){toast(y.j.effect==="returned_to_review"?"Saved. The report went back to Pending for a new approval.":y.j.effect==="unpublished"?"Saved. The report was unpublished: publish it again after checking the public text.":"Report updated.","ok");re();return true}return errText(y)}});
  });
}
async function photos(d,x,re){
  const box=$("[data-photos]",d);if(!box)return;
  const head=`<h3>${I("image")} Public photos</h3>`;
  const r=await api("report_photos?id="+x.id);
  if(!r.ok){box.innerHTML=head+errorBox(errText(r));$("[data-retry]",box).onclick=()=>photos(d,x,re);return}
  const s=r.j,canEdit=has("publish_reports")&&s.can_select,imgs=s.evidence.filter(e=>e.image),byEv=Object.fromEntries(s.selected.map(p=>[p.evidence_id,p]));
  const ST={live:["Public","ok"],ready:["Ready · goes live when published","in"],staged:["Selected · copied again on publish","wa"],missing:["Missing public copy","no"]};
  box.innerHTML=head+`<p class="small">Evidence stays private. Only photos you select are copied, without location or camera data, to the public image bucket.${s.published?" This report is <b>published</b>: selected photos are visible on the public feed.":" Selected photos appear on the public feed after the report is published."} Max ${s.max} photos.</p>
    ${s.needs_sync&&canEdit?`<div class="dbanner warn">${I("alert-triangle")}<div><b>A selected photo has no public copy.</b><button class="btn sm" type="button" data-p="sync" data-busy="Syncing…">${I("refresh")} Sync public photos</button></div></div>`:""}
    ${s.unpublished_copies&&has("publish_reports")?`<p class="small">${num(s.unpublished_copies)} prepared public cop${s.unpublished_copies===1?"y":"ies"} exist while the report is not published (unlisted, random URLs). <button class="linkbtn" type="button" data-p="sync" data-busy="Removing…">Remove public copies</button></p>`:""}
    ${!s.can_select?`<p class="small">${s.report_status!=="approved"?"Approve the report to choose public photos.":"Restore the report to manage its public photos."}</p>`:""}
    ${imgs.length?`<div class="pgrid">${imgs.map(e=>{const p=byEv[e.id],st=p?ST[p.status]:null;return`<figure class="pcell${p?" sel":""}">
      <div class="pimg ld">${e.preview_url?`<img src="${h(e.preview_url)}" alt="Evidence ${e.id}" loading="lazy">`:`<span class="small">Preview unavailable</span>`}</div>
      <figcaption>${p?`<span class="bd ${st[1]}">${h(st[0])}</span>${p.alt_text?`<span class="small palt">“${h(p.alt_text)}”</span>`:`<span class="small palt">No alt text</span>`}`:`<span class="bd">Private</span>`}
      ${canEdit?(p?`<span class="pacts"><button class="btn ghost sm" type="button" data-p="alt" data-id="${p.id}">Alt text</button><button class="btn ghost sm" type="button" data-p="replace" data-id="${p.id}">Replace</button><button class="btn danger sm" type="button" data-p="remove" data-id="${p.id}" data-busy="Removing…">Remove</button></span>`
        :`<label class="pchk"><input type="checkbox" value="${e.id}"> Select</label>`):""}</figcaption></figure>`}).join("")}</div>
      ${canEdit&&imgs.some(e=>!byEv[e.id])?`<div class="acts" style="margin-top:10px"><button class="btn sm" type="button" data-p="select" data-busy="Copying…" disabled>${I("globe")} Make selected photos public</button></div>`:""}`
      :`<div class="ux-state">${I("image")}<span>No image evidence. PDF files cannot be shown publicly.</span></div>`}`;
  $$(".pimg img",box).forEach(im=>{const ok=()=>im.parentElement.classList.remove("ld");im.complete?ok():(im.onload=ok,im.onerror=()=>{im.parentElement.classList.remove("ld");im.replaceWith(Object.assign(document.createElement("span"),{className:"small",textContent:"Preview unavailable"}))})});
  const sel=$("[data-p=select]",box),chk=()=>{if(sel)sel.disabled=!$$(".pchk input:checked",box).length};$$(".pchk input",box).forEach(c=>c.onchange=chk);
  const after=y=>{if(y&&y.ok)photos(d,x,re)};
  $$("[data-p]",box).forEach(b=>b.onclick=async()=>{const a=b.dataset.p,id=+b.dataset.id;
    if(a==="select"){const ids=$$(".pchk input:checked",box).map(c=>+c.value);const c=await confirmAct({title:`Make ${ids.length} photo${ids.length>1?"s":""} public?`,text:`They are copied without location or camera data to the public image bucket${x.published_at?" and appear on the public feed immediately":" and appear when the report is published"}. The originals stay private.`,confirm:"Make public"});if(c)after(await A.run("report_photo_select",{id:x.id,evidence_ids:ids},"Photos selected.",b));return}
    if(a==="remove"){const c=await confirmAct({title:"Remove this public photo?",text:"Its public copy is deleted and the link stops working. The private original is kept.",danger:true,confirm:"Remove"});if(c)after(await A.run("report_photo_remove",{id:x.id,image_id:id},"Photo removed from public display.",b));return}
    if(a==="sync"){after(await A.run("report_photos_sync",{id:x.id},"Public photos updated.",b));return}
    if(a==="alt"){const p=s.selected.find(z=>z.id===id);return formDlg({title:"Alt text",intro:"Describe the photo for people who cannot see it. Never include customer names or account details.",fields:[{n:"alt_text",l:"Alt text",v:p.alt_text||"",ml:200}],onSubmit:async v=>{const y=await api("report_photo_update",{id:x.id,image_id:id,alt_text:v.alt_text});if(y.ok){toast("Alt text saved.","ok");photos(d,x,re);return true}return errText(y)}})}
    if(a==="replace"){const opts=imgs.filter(e=>!byEv[e.id]);if(!opts.length){toast("Every image is already selected. Add evidence first.","err");return}
      return formDlg({title:"Replace public photo",intro:"The current public copy is deleted (its link stops working) and the chosen photo takes its place.",fields:[{n:"evidence_id",l:"Replace with",t:"select",o:opts.map(e=>[e.id,`Evidence #${e.id} · ${e.mime.split("/")[1].toUpperCase()} · ${Math.round(e.size_bytes/1024)} KB`])}],submit:"Replace",onSubmit:async v=>{const y=await api("report_photo_replace",{id:x.id,image_id:id,evidence_id:+v.evidence_id});if(y.ok){toast("Photo replaced.","ok");photos(d,x,re);return true}return errText(y)}})}
  });
}
function purgeDlg(x,nEv,nHist,nNotes,done){
  const dg=dlg(`<form novalidate><h2>${I("trash")} Delete report ${h(x.id)} permanently?</h2>
    <p class="small" style="font-size:13.5px"><b>${h(x.title||"Report "+x.id)}</b> · ${h(x.name)} · activity ${day(x.report_date)}${x.published_at?" · <b>published</b>":""}</p>
    <div class="dbanner"><div><b>This cannot be undone.</b><p class="small">The report and everything that belongs to it are removed from the database and from both storage buckets. It cannot be recovered through CHDS.</p></div></div>
    <ul class="dlist"><li>The report${nHist?` and its ${num(nHist)} history entr${nHist===1?"y":"ies"}`:""}${nNotes?` and ${num(nNotes)} internal note${nNotes>1?"s":""}`:""}</li><li>${num(nEv)} private evidence file${nEv===1?"":"s"} and every public photo copy</li><li>Its revenue record, notifications and Telegram review cards</li><li>Report details in older audit entries are redacted; a minimal deletion record (who, when, why) is kept</li></ul>
    <div class="fld"><label for="pg_r">Reason for deletion (required)</label><textarea id="pg_r" maxlength="500" required></textarea></div>
    <div class="fld"><label for="pg_c">Type <b>${h(x.id)}</b> to confirm</label><input id="pg_c" autocomplete="off" spellcheck="false" inputmode="text"></div>
    <label class="fld" style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="pg_ok"> I understand this report and its files will be permanently deleted.</label>
    <div class="pgstate" hidden></div><div class="ferr" role="alert"></div>
    <div class="dacts"><button class="btn ghost" type="button" data-c>Cancel</button><button class="btn danger" type="submit" disabled>${I("trash")} Delete permanently</button></div></form>`,{label:"Delete report permanently"});
  const f=$("form",dg),go=$("[type=submit]",dg),er=$(".ferr",dg),stBox=$(".pgstate",dg),rs=$("#pg_r",dg),cf=$("#pg_c",dg),ok=$("#pg_ok",dg);
  const valid=()=>rs.value.trim().length>=3&&cf.value.trim().toUpperCase()===x.id&&ok.checked;
  [rs,cf,ok].forEach(el=>el.addEventListener("input",()=>{go.disabled=!valid()}));ok.addEventListener("change",()=>{go.disabled=!valid()});
  $("[data-c]",dg).onclick=()=>dg.close();
  let jobId=null;
  const steps=(state,failAt)=>{const L=[["lock","Lock the report and hide it from the public"],["storage","Delete files from both storage buckets and verify"],["database","Delete database records and redact audit entries"],["verify","Verify that nothing remains"]];
    let failed=false;stBox.hidden=false;stBox.innerHTML=`<ul class="ux-steps">${L.map(([k,l])=>{let c=state==="run"?"run":state==="done"?"done":"";if(state==="fail"){if(k===failAt){c="fail";failed=true}else c=failed?"":"done"}return`<li class="${c}">${h(l)}</li>`}).join("")}</ul>`};
  f.addEventListener("submit",async e=>{e.preventDefault();if(!valid()||go.dataset.uxState==="loading")return;er.textContent="";
    [rs,cf,ok].forEach(el=>el.disabled=true);$("[data-c]",dg).disabled=true;UX.busy(go,true,"Deleting…");steps("run");
    const y=jobId?await api("report_purge_retry",{job_id:jobId},{timeout:90000}):await api("report_purge",{id:x.id,reason:rs.value.trim(),confirm:cf.value.trim()},{timeout:90000});
    UX.busy(go,false);$("[data-c]",dg).disabled=false;
    if(y.ok){steps("done");toast(`Report ${x.id} was permanently deleted.`,"ok");UX.announce(`Report ${x.id} permanently deleted`);
      go.hidden=true;$("[data-c]",dg).textContent="Close";stBox.insertAdjacentHTML("beforeend",`<p class="small" style="margin-top:10px">Deletion reference: <code>${h(y.j.deletion_ref)}</code></p>`);$("[data-c]",dg).onclick=()=>{dg.close();done()};return}
    if(y.status===502&&y.j.job_id){jobId=y.j.job_id;steps("fail",y.j.step==="storage"?"storage":y.j.step==="database"?"database":"verify");er.textContent=y.j.message+" Nothing was reported as deleted until every step succeeded.";go.innerHTML=`${I("refresh")} Retry deletion`;return}
    [rs,cf,ok].forEach(el=>el.disabled=false);stBox.hidden=true;er.textContent=errText(y);
  });
  setTimeout(()=>rs.focus(),30);
}
V.reports=async el=>{
  const team=(await api("team_options")).j.rows||[];
  const L=A.list(el,{title:"Reports",icon:"file-text",desc:"Pending → Reviewed → Approved, Rejected or Corrections requested. Approved reports count towards revenue and performance; only <b>published</b> reports appear on the public feed, with the photos you select. Activity date (when it happened) and submission time (when it entered CHDS) are kept separate.",
    actions:`<button class="btn ghost sm" type="button" data-exp>${I("download")} Export CSV</button><button class="btn sm" type="button" data-new>${I("plus")} Submit report</button>`,op:"reports_list",defaults:{status:"open"},top:has("delete_reports")?'<div data-deljobs></div>':"",
    filters:[{n:"q",l:"Search ID, title or member",w:1},{n:"status",l:"Status",t:"select",o:[["open","Needs review"],["","All"],...Object.entries(RSTATUS)]},{n:"published",l:"Public feed",t:"select",o:[["","Any"],["1","Published"],["0","Not published"]]},{n:"archived",l:"Show",t:"select",o:[["","Active"],["1","Archived"],["all","Active + archived"],["withdrawn","Withdrawn by owner"]]},
      {n:"member",l:"Member",t:"select",o:[["","All members"],...team.map(m=>[m.id,m.name])]},{n:"category",l:"Category",t:"select",o:A.opts(RCAT)},{n:"basis",l:"Date filter",t:"select",o:[["","Activity date"],["submission","Submission date"]]},{n:"from",l:"From",t:"date"},{n:"to",l:"To",t:"date"}],
    cols:[{l:"Report",f:x=>`<b>${h(x.id)}</b><br><span class="small">${h(x.title||"Telegram report")}</span>`},{l:"Member",f:x=>h(x.name)},{l:"Activity date",f:x=>day(x.report_date)},{l:"Submitted",f:x=>when(x.created_at)},{l:"Recovered",f:x=>num(x.recovered),c:"num"},{l:"Revenue",f:x=>money(x.revenue),c:"num"},{l:"Status",f:x=>x.deletion_pending_at?badge("deleting"):badge(x.status)+(x.published_at?" "+badge("published"):"")+(x.archived_at?" "+badge("archived"):"")+(x.deleted_at?" "+badge("withdrawn"):"")},{l:"Source",f:x=>h(x.source)}],
    click:(x,reload)=>reportDrawer(x,reload)});
  $("[data-new]",el).onclick=()=>reportForm(L.reload);
  $("[data-exp]",el).onclick=e=>UX.run(e.currentTarget,()=>A.download("reports_export",Object.fromEntries(Object.entries(L.state.f).filter(([k,v])=>v&&k!=="q"&&!(k==="status"&&v==="open")))),{label:"Exporting…"});
  const jb=$("[data-deljobs]",el);
  if(jb){const y=await api("report_deletions");const open=y.ok?y.j.open:[];
    if(open.length){jb.innerHTML=`<div class="dbanner" role="alert">${I("alert-triangle")}<div><b>${num(open.length)} permanent deletion${open.length>1?"s":""} did not finish.</b><p class="small">Those reports stay hidden and locked until the deletion completes.</p>${open.map(j=>`<div class="acts" style="margin-top:6px"><code>${h(j.report_id)}</code><span class="small">${h(j.last_error||j.status)}</span><button class="btn danger sm" type="button" data-job="${h(j.id)}" data-busy="Retrying…">${I("refresh")} Retry</button></div>`).join("")}</div></div>`;
      $$("[data-job]",jb).forEach(b=>b.onclick=async()=>{const r=await A.run("report_purge_retry",{job_id:b.dataset.job},"Deletion completed.",b);if(r.ok)V.reports(el)})}}
};

async function revenueForm(rec,reload){
  const team=(await api("team_options")).j.rows||[];
  formDlg({title:rec?`Adjust ${rec.id}`:"New revenue record",intro:rec?"Manual adjustments need a reason; old and new values are kept in the history. Changing the amount or date of verified revenue sends it back to Pending for re-verification.":"New records start as Pending (or Projected for future dates) and only count as actual revenue after verification.",
    fields:[[{n:"amount",l:"Amount (PHP)",t:"number",min:0,max:10000000,step:"0.01",v:rec?.amount??"",req:true},{n:"revenue_date",l:"Date",t:"date",min:"2020-01-01",v:rec?.revenue_date||phToday(),req:true}],
      {n:"team_member_id",l:"Team member",t:"select",o:[["","— not linked —"],...team.map(m=>[m.id,m.name])],v:rec?.team_member_id||""},
      {n:"description",l:"Description",t:"textarea",v:rec?.description||"",req:true,ml:500},
      ...(rec?[{n:"reason",l:"Reason for adjustment",t:"textarea",req:true,ml:500}]:[{n:"status",l:"Type",t:"select",o:[["pending","Pending (awaiting verification)"],["projected","Projected / scheduled"]]}])],
    onSubmit:async v=>{const r=await api("revenue_save",{...v,id:rec?.id});if(r.ok){toast(rec?"Revenue adjusted.":"Revenue record created.","ok");reload();return true}return errText(r)}});
}
async function revenueDrawer(row,reload){
  const r=await api("revenue_get?id="+row.id);if(!r.ok){toast(errText(r),"err");return}
  const {record:x,history}=r.j,manual=x.source==="manual",can=has("manage_revenue")&&manual&&!x.deleted_at;
  const d=A.drawer(`Revenue ${x.id}`,`<dl class="kv"><dt>Amount</dt><dd><b>${money(x.amount)}</b></dd><dt>Status</dt><dd>${badge(x.status)}${x.rejection_reason?" — "+h(x.rejection_reason):""}</dd><dt>Date</dt><dd>${day(x.revenue_date)}</dd><dt>Member</dt><dd>${h(x.member?.display_name||x.member_name||"—")}</dd><dt>Source</dt><dd>${manual?"Manual record":`Report <code>${h(x.report_id)}</code> (managed through the report)`}</dd><dt>Description</dt><dd>${h(x.description)}</dd><dt>Verified</dt><dd>${x.verified_at?when(x.verified_at)+" by "+h(x.verified_by):"—"}</dd></dl>
    ${can?`<div class="acts" style="margin:14px 0">${["pending","projected"].includes(x.status)?`<button class="btn ok sm" data-v="verify">${I("check")} Verify as actual</button>`:""}<button class="btn ghost sm" data-v="edit">${I("pencil")} Adjust</button>${x.status!=="rejected"?`<button class="btn danger sm" data-v="reject">Reject</button>`:""}<button class="btn danger sm" data-v="delete">${I("trash")} Delete</button></div>`:""}
    <div class="card"><h3>${I("history")} History (old → new values)</h3>${table([{l:"When",f:y=>when(y.at)},{l:"Actor",f:y=>`<code>${h(y.actor)}</code>`},{l:"Action",f:y=>h(y.action)},{l:"Reason",f:y=>h(y.reason||"")},{l:"Change",f:y=>y.old?["amount","revenue_date","status","description"].filter(k=>String(y.old[k])!==String(y.new[k])).map(k=>`${k}: ${h(y.old[k])} → ${h(y.new[k])}`).join("<br>"):"created",c:"wide"}],history)}</div>`);
  $$("[data-v]",d).forEach(b=>b.onclick=async()=>{const a=b.dataset.v;
    if(a==="edit"){d.close();return revenueForm(x,reload)}
    const c=await confirmAct({title:{verify:"Verify this revenue as actual?",reject:"Reject this revenue?",delete:"Delete this revenue record?"}[a],text:a==="verify"?`${money(x.amount)} will count as actual revenue.`:"It will no longer count in any total. History is kept.",danger:a!=="verify",reason:a!=="verify",confirm:a==="verify"?"Verify":a==="reject"?"Reject":"Delete"});if(!c)return;
    if((await A.run("revenue_action",{op:a,id:x.id,reason:c.reason},"Revenue updated.")).ok){d.close();reload()}});
}
V.revenue=async el=>{
  const team=(await api("team_options")).j.rows||[];
  const L=A.list(el,{title:"Revenue",icon:"wallet",desc:"Actual = verified/approved only. Pending, Projected (future-dated) and Rejected are tracked separately. Records from reports follow their report; manual records are adjusted here with a reason.",
    actions:(has("manage_revenue")?`<button class="btn sm" type="button" data-new>${I("plus")} New record</button>`:"")+`<button class="btn ghost sm" type="button" data-csv>${I("download")} Export CSV</button>`,op:"revenue_list",limit:50,
    filters:[{n:"q",l:"Search",w:1},{n:"status",l:"Status",t:"select",o:[["","All"],["actual","Actual"],["pending","Pending"],["projected","Projected"],["rejected","Rejected"]]},{n:"source",l:"Source",t:"select",o:[["","All"],["report","From reports"],["manual","Manual"]]},{n:"member",l:"Member",t:"select",o:[["","All members"],...team.map(m=>[m.id,m.name])]},{n:"from",l:"From",t:"date"},{n:"to",l:"To",t:"date"}],
    above:j=>j.locked?`<p class="notice warn">${I("lock")} Revenue edits are locked by Emergency Control.</p>`:"",
    cols:[{l:"Record",f:x=>`<b>${h(x.id)}</b><br><span class="small">${h(x.description)}</span>`},{l:"Date",f:x=>day(x.revenue_date)},{l:"Member",f:x=>h(x.member?.display_name||x.member_name||"—")},{l:"Amount",f:x=>money(x.amount),c:"num"},{l:"Status",f:x=>badge(x.status)},{l:"Source",f:x=>x.source==="report"?`report <code>${h(x.report_id)}</code>`:"manual"}],
    click:(x,reload)=>revenueDrawer(x,reload)});
  const n=$("[data-new]",el);if(n)n.onclick=()=>revenueForm(null,L.reload);
  $("[data-csv]",el).onclick=()=>A.download("revenue_export",{kind:"records",...L.state.f});
};

V.analytics=async el=>{
  const st={preset:"this_month",group:""};
  el.innerHTML=page("Revenue Analytics","bar-chart","Philippine calendar (UTC+8). Actual revenue counts verified/approved records only; projected and pending are shown separately. History from 2020-01-01.",`<button class="btn ghost sm" type="button" data-csv>${I("download")} Records CSV</button><button class="btn ghost sm" type="button" data-csvm>${I("download")} Members CSV</button>`)+rangeBar(st)+
    `<div class="bar"><div class="f"><label for="grp">Group by</label><select id="grp"><option value="">Automatic</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></div></div><div data-out>${loading(6)}</div>`;
  const out=$("[data-out]",el);
  const load=async()=>{out.innerHTML=loading(6);const r=await api("revenue_analytics?"+qs(st));if(!r.ok){out.innerHTML=errorBox(errText(r));$("[data-retry]",out).onclick=load;return}
    const a=r.j,t=a.totals,f=a.fixed,s=a.series,g=a.growth;
    const lbl=b=>a.range.group==="year"?b.slice(0,4):a.range.group==="month"?b.slice(0,7):b.slice(5);
    out.innerHTML=(a.scope==="team"?`<p class="notice">${I("users")} Showing your team only.</p>`:"")+
      kpis([{l:"Actual revenue (period)",v:money(t.actual),i:"wallet",s:g&&g.change_pct!==null?`${g.change_pct>=0?"+":""}${g.change_pct}% vs previous period`:"No comparable previous period"},{l:"Today",v:money(f.today),i:"clock"},{l:"This week",v:money(f.week),i:"bar-chart"},{l:"This month",v:money(f.month),i:"bar-chart"},{l:"This year",v:money(f.year),i:"trending-up"},{l:"All time",v:money(f.all_time),i:"layers"},
        {l:"Pending",v:money(t.pending),i:"clock"},{l:"Projected",v:money(t.projected),i:"history"},{l:"Rejected",v:money(t.rejected),i:"circle-x"},{l:"Recovered accounts",v:num(t.recovered),i:"user-check",s:"Approved reports"},{l:"Reports",v:num(t.reports.total),i:"file-text",s:`${num(t.reports.approved)} approved · ${num(t.reports.pending+t.reports.reviewed)} open · ${num(t.reports.rejected)} rejected`},
        {l:"Active members",v:num(t.active_members),i:"users"},{l:"Avg. per active member",v:t.avg_per_active_member===null?"—":money(t.avg_per_active_member),i:"pie-chart"},{l:"Top performer",v:a.top?h(a.top.name):"—",i:"trending-up",s:a.top?money(a.top.actual):""},{l:"Lowest performer",v:a.lowest?h(a.lowest.name):"—",i:"activity",s:a.lowest?money(a.lowest.actual):"Needs at least two members"}])+
      `<div class="grid g2"><div class="card"><h3>${I("bar-chart")} Actual vs projected (${h(a.range.group)})</h3>${chart({labels:s.map(x=>lbl(x.bucket)),series:[{name:"Actual",values:s.map(x=>x.actual||0)},{name:"Projected",values:s.map(x=>x.projected||0),color:"#38BDF8"},{name:"Pending",values:s.map(x=>x.pending||0),color:"#F59E0B"}],fmt:moneyS,title:"Revenue by period"})}</div>
      <div class="card"><h3>${I("trending-up")} Growth trend (actual)</h3>${chart({labels:s.map(x=>lbl(x.bucket)),series:[{name:"Actual",values:s.map(x=>x.actual||0)}],type:"line",fmt:moneyS,title:"Actual revenue trend"})}</div></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${I("users")} Team comparison</h3>${chart({labels:a.members.slice(0,12).map(m=>m.name.split(" ")[0]),series:[{name:"Actual",values:a.members.slice(0,12).map(m=>m.actual)}],fmt:moneyS,title:"Revenue per member"})}</div>
      <div class="card"><h3>${I("user")} Individual performance</h3>${table([{l:"Member",f:m=>h(m.name)+(m.status&&m.status!=="active"?` ${badge(m.status)}`:"")},{l:"Actual",f:m=>money(m.actual),c:"num"},{l:"Pending",f:m=>money(m.pending),c:"num"},{l:"Recovered",f:m=>num(m.recovered),c:"num"},{l:"Reports (approved/open/rejected)",f:m=>`${num(m.approved_reports)} / ${num(m.open_reports||0)} / ${num(m.rejected_reports||0)}`,c:"num"},{l:"Share",f:m=>`${m.contribution}%`,c:"num"}],a.members,{emptyText:"No revenue or reports in this period."})}</div></div>`};
  bindRange(el,st,load);$("#grp").onchange=e=>{st.group=e.target.value;load()};
  $("[data-csv]",el).onclick=()=>A.download("revenue_export",{kind:"records",preset:st.preset,from:st.preset==="custom"?st.from:"",to:st.preset==="custom"?st.to:""});
  $("[data-csvm]",el).onclick=()=>A.download("revenue_export",{kind:"members",...st});
  load();
};

V.performance=async el=>{
  const st={preset:"this_month"};let ver="";
  el.innerHTML=page("Live Team Performance","activity",`Updates automatically every 10 seconds from approved reports and verified revenue (controlled polling; it re-renders only when data changes). <span data-live class="small"></span>`)+rangeBar(st)+`<div data-out>${loading(6)}</div>`;
  const out=$("[data-out]",el),live=$("[data-live]",el);
  const load=async(force)=>{const r=await api("performance?"+qs({...st,quiet:1}));if(!r.ok){if(force||!ver){out.innerHTML=errorBox(errText(r));$("[data-retry]",out).onclick=()=>load(true)}live.textContent="Last update failed — retrying.";return}
    live.textContent="Last checked "+new Date().toLocaleTimeString();if(!force&&r.j.version===ver)return;ver=r.j.version;
    const p=r.j,t=p.totals;
    out.innerHTML=kpis([{l:"Approved revenue",v:money(t.actual),i:"wallet"},{l:"Recovered accounts",v:num(t.recovered),i:"user-check"},{l:"Approved reports",v:num(t.reports.approved),i:"file-text"},{l:"Open reports",v:num(t.reports.pending+t.reports.reviewed),i:"clock"}])+
      `<div class="card"><h3>${I("trending-up")} Ranking</h3>${table([{l:"#",f:m=>num(m.rank),c:"num"},{l:"Member",f:m=>`<div class="prow"><span class="pav">${h(ini(m.name))}${m.photo_url?`<img src="${h(m.photo_url)}" alt="">`:""}</span><span><b>${h(m.name)}</b><br><span class="small">${h(m.role||"")}${m.telegram?" · @"+h(m.telegram):""}</span></span></div>`},{l:"Status",f:m=>badge(m.member_status)},
        {l:"Approved revenue",f:m=>money(m.actual),c:"num"},{l:"Recovered",f:m=>num(m.recovered),c:"num"},{l:"Reports",f:m=>`${num(m.reports)} total<br><span class="bd ok">${num(m.approved_reports)} approved</span> <span class="bd wa">${num(m.open_reports||0)} open</span> <span class="bd no">${num(m.rejected_reports||0)} rejected</span>`},{l:"Contribution",f:m=>`<div class="prow"><div class="meter" style="flex:1"><i style="width:${Math.min(100,Number(m.contribution))}%"></i></div><span>${m.contribution}%</span></div>`}],p.rows,{emptyText:"No members or activity in this period."})}</div>
      <div class="card" style="margin-top:16px"><h3>${I("history")} Recent activity</h3>${table([{l:"When",f:x=>ago(x.at)},{l:"Type",f:x=>h(x.kind)},{l:"Ref",f:x=>`<code>${h(x.ref)}</code>`},{l:"Event",f:x=>h(x.action)},{l:"By",f:x=>`<code>${h(x.actor)}</code>`}],p.recent,{emptyText:"No recent activity."})}</div>`};
  bindRange(el,st,()=>{ver="";load(true)});load(true);every(()=>load(false),10000);
};

async function annForm(a,reload){
  const [team,roles]=await Promise.all([api("team_options"),api("staff_list?limit=1")]);
  const iso=t=>t?new Date(Date.parse(t)+8*36e5).toISOString().slice(0,16):"";
  formDlg({title:a?"Edit announcement":"New announcement",intro:"Drafts are not visible. “All users” appears on the public website; other audiences are visible only to signed-in recipients (and optionally sent on Telegram). Times are Philippine time.",
    fields:[{n:"title",l:"Title",v:a?.title,req:true,ml:120},{n:"message",l:"Message",t:"textarea",v:a?.message,req:true,ml:4000},
      [{n:"priority",l:"Priority",t:"select",o:[["low","Low"],["normal","Normal"],["high","High"],["critical","Critical"]],v:a?.priority||"normal"},{n:"audience",l:"Audience",t:"select",o:[["all","All users (public website)"],["team","Team members"],["selected_members","Selected team members"],["admins","Administrators"],["groups","Selected roles"]],v:a?.audience||"team"}],
      {n:"members",l:"Selected team members (for “Selected team members”)",t:"multiselect",o:(team.j.rows||[]).map(m=>[m.id,m.name]),v:a?.audience==="selected_members"?a.target_ids:[]},
      {n:"groups",l:"Selected roles (for “Selected roles”)",t:"multiselect",o:(roles.j.roles||[]).map(r=>[r.id,r.name]),v:a?.audience==="groups"?a.target_ids:[]},
      [{n:"publish_at",l:"Publish from",t:"datetime-local",v:iso(a?.publish_at)},{n:"expires_at",l:"Expires (optional)",t:"datetime-local",v:iso(a?.expires_at)}],
      {n:"send_telegram",l:"Also send to recipients on Telegram when published (not for “All users”)",t:"checkbox",v:a?.send_telegram}],
    onSubmit:async v=>{const ph=s=>s?new Date(s+":00+08:00").toISOString():"";const body={id:a?.id,title:v.title,message:v.message,priority:v.priority,audience:v.audience,target_ids:v.audience==="selected_members"?v.members:v.audience==="groups"?v.groups:[],publish_at:ph(v.publish_at),expires_at:ph(v.expires_at),send_telegram:v.send_telegram};
      const r=await api("ann_save",body);if(r.ok){toast("Saved as "+r.j.announcement.status+".","ok");reload();return true}return errText(r)}});
}
V.announcements=el=>{
  const L=A.list(el,{title:"Announcement Center",icon:"megaphone",desc:"Publish to the public site, the team, selected members, administrators or selected roles. History is preserved; archived announcements cannot be edited.",
    actions:`<button class="btn sm" type="button" data-new>${I("plus")} New announcement</button>`,op:"ann_list",limit:50,
    filters:[{n:"status",l:"Status",t:"select",o:[["","All"],["draft","Draft"],["published","Published"],["archived","Archived"]]},{n:"audience",l:"Audience",t:"select",o:[["","All"],["all","All users"],["team","Team"],["selected_members","Selected members"],["admins","Administrators"],["groups","Roles"]]}],
    cols:[{l:"Title",f:a=>`<b>${h(a.title)}</b><br><span class="small">${h(a.message.slice(0,90))}</span>`},{l:"Audience",f:a=>h(a.audience.replace(/_/g," "))+(a.target_ids.length?` (${a.target_ids.length})`:"")},{l:"Priority",f:a=>badge(a.priority==="critical"||a.priority==="high"?"pending":"draft").replace(/>[^<]*</,">"+h(a.priority)+"<")},{l:"Status",f:a=>badge(a.status)},{l:"Publish",f:a=>when(a.publish_at)},{l:"Expires",f:a=>when(a.expires_at)},
      {l:"",f:a=>a.status==="archived"?"":`<div class="acts"><button class="btn ghost sm" data-act="edit">${I("pencil")}<span class="sr">Edit</span></button>${a.status==="draft"?`<button class="btn ok sm" data-act="published">Publish</button>`:`<button class="btn ghost sm" data-act="draft">Unpublish</button>`}<button class="btn ghost sm" data-act="archived">Archive</button></div>`}],
    act:async(k,a,b,reload)=>{if(k==="edit")return annForm(a,reload);
      const c=await confirmAct({title:{published:"Publish now?",draft:"Move back to draft?",archived:"Archive this announcement?"}[k],text:k==="published"&&a.send_telegram?"It will also be sent once to each recipient on Telegram.":k==="archived"?"Archived announcements stay in the history and cannot be edited.":"",confirm:{published:"Publish",draft:"Unpublish",archived:"Archive"}[k]});if(!c)return;
      const r=await A.run("ann_status",{id:a.id,status:k},"Announcement updated.");if(r.ok){if(r.j.delivery)toast(`Telegram: ${r.j.delivery.sent} sent, ${r.j.delivery.failed} failed.`,r.j.delivery.failed?"err":"ok");reload()}}});
  $("[data-new]",el).onclick=()=>annForm(null,L.reload);
};
})();
