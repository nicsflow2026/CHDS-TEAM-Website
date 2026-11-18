"use strict";
/* CHDS admin views (part 1): shared list component, Overview, People, Security & System, Profile. */
(()=>{
const A=window.ADM,{$,$$,h,I,money,moneyS,num,when,day,dur,ago,ini,badge,api,errText,toast,loading,empty,errorBox,page,kpis,table,pager,dlg,confirmAct,formDlg,chart,every,crumbs,has}=A;
const V=A.views;
const qs=o=>new URLSearchParams(Object.entries(o).filter(([,v])=>v!==""&&v!==undefined&&v!==null)).toString();
const refreshBtn=`<button class="btn ghost sm" type="button" data-refresh>${I("refresh")} Refresh</button>`;

/* Generic list: filters + table + pagination + row actions. Returns {reload}. */
A.list=function(el,cfg){
  const st={offset:0,f:{...(cfg.defaults||{})}};let rows=[];
  el.innerHTML=page(cfg.title,cfg.icon,cfg.desc,(cfg.actions||"")+refreshBtn)+(cfg.top||"")+
    (cfg.filters&&cfg.filters.length?`<form class="bar" data-filters role="search">${cfg.filters.map(f=>`<div class="f${f.w?" wide":""}"><label for="flt_${f.n}">${h(f.l)}</label>${f.t==="select"?`<select id="flt_${f.n}" name="${f.n}">${f.o.map(([v,l])=>`<option value="${h(v)}"${String(st.f[f.n]??"")===String(v)?" selected":""}>${h(l)}</option>`).join("")}</select>`:`<input id="flt_${f.n}" name="${f.n}" type="${f.t||"search"}" value="${h(st.f[f.n]||"")}" ${f.t==="search"||!f.t?'placeholder="Search…" maxlength="60"':""}>`}</div>`).join("")}</form>`:"")+
    `<div data-list>${loading()}</div>`;
  const box=$("[data-list]",el);
  async function load(){
    box.setAttribute("aria-busy","true");
    const lim=cfg.limit||25,r=await api(cfg.op+"?"+qs({...st.f,offset:st.offset,limit:lim}));
    box.removeAttribute("aria-busy");
    if(!r.ok){box.innerHTML=errorBox(errText(r));$("[data-retry]",box).onclick=load;return}
    rows=cfg.rows?cfg.rows(r.j):r.j.rows||[];
    box.innerHTML=(cfg.above?cfg.above(r.j):"")+table(cfg.cols,rows,{click:!!cfg.click,emptyText:cfg.emptyText})+pager(r.j.total??rows.length,st.offset,lim);
  }
  const f=$("[data-filters]",el);
  if(f){let t;const upd=()=>{clearTimeout(t);t=setTimeout(()=>{new FormData(f).forEach((v,k)=>st.f[k]=v);st.offset=0;load()},250)};f.addEventListener("input",upd);f.addEventListener("change",upd);f.addEventListener("submit",e=>e.preventDefault())}
  el.addEventListener("click",async e=>{
    const pg=e.target.closest("[data-pg]");if(pg){st.offset=+pg.dataset.pg;load();return}
    if(e.target.closest("[data-refresh]")){load();return}
    const act=e.target.closest("[data-act]");
    if(act&&cfg.act){e.stopPropagation();act.disabled=true;try{await cfg.act(act.dataset.act,rows[+act.closest("tr")?.dataset.row]??null,act,load)}finally{act.disabled=false}return}
    const tr=e.target.closest("tr.click");if(tr&&cfg.click)cfg.click(rows[+tr.dataset.row],load);
  });
  el.addEventListener("keydown",e=>{const tr=e.target.closest&&e.target.closest("tr.click");if(tr&&(e.key==="Enter"||e.key===" ")){e.preventDefault();cfg.click(rows[+tr.dataset.row],load)}});
  load();return{reload:load,state:st};
};
// Run an API action, toast the result. Returns the response.
A.run=async(op,body,okMsg)=>{const r=await api(op,body);if(r.ok){if(okMsg)toast(okMsg,"ok")}else if(r.status!==428)toast(errText(r),"err");return r};
A.drawer=(title,html)=>{const d=dlg(`<div class="db"><div class="dh"><h2>${h(title)}</h2><button class="ibtn" type="button" data-close aria-label="Close">${I("x")}</button></div>${html}</div>`,{drawer:true,label:title});$("[data-close]",d).onclick=()=>d.close();return d};
A.transcript=(msgs)=>msgs.length?`<div class="tr">${msgs.map(m=>{const who={user:"Customer",assistant:"CHDS AI",agent:m.author||"Agent",system:"System",summary:"AI-generated summary (not the customer's words)",note:m.author||"Agent note"}[m.role]||m.role;
  return`<div class="tm ${h(m.role)}"><b>${h(who)} · ${when(m.created_at)}</b>${h(m.body)}${m.meta&&m.meta.ocr?`<div class="small">Screenshot text (OCR): ${h(String(m.meta.ocr).slice(0,400))}</div>`:""}</div>`}).join("")}</div>`:empty("No messages.");
A.notes=(notes,op,idKey,id,reload)=>`<div class="card" style="margin-top:14px"><h3>${I("pencil")} Internal notes</h3>${notes.length?notes.map(n=>`<div class="tm"><b>${h(n.author)} · ${when(n.created_at)}</b>${h(n.body)}</div>`).join(""):'<p class="small">No notes yet. Notes are visible to authorized staff only.</p>'}
  <form data-note style="display:grid;gap:8px;margin-top:10px"><label for="nt">Add a note</label><textarea id="nt" maxlength="2000"></textarea><button class="btn sm" type="submit" style="justify-self:start">Add note</button></form></div>`;
A.bindNote=(root,op,body,after)=>{const f=$("[data-note]",root);if(!f)return;f.addEventListener("submit",async e=>{e.preventDefault();const t=$("textarea",f).value.trim();if(!t)return;const r=await A.run(op,{...body,body:t},"Note added.");if(r.ok)after()})};
const opts=(m,all)=>[["",all||"All"],...Object.entries(m)];

/* ---------------- Overview ---------------- */
V.overview=async el=>{
  const r=await api("overview");if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=A.go;return}
  const o=r.j,me=A.me();
  const k=[];
  if(o.revenue){k.push({l:"Actual revenue · today",v:money(o.revenue.fixed.today),i:"wallet"},{l:"Actual revenue · this month",v:money(o.revenue.fixed.month),i:"trending-up",s:"Verified / approved only"},{l:"Pending revenue · this month",v:money(o.revenue.month.pending),i:"clock"},{l:"All-time actual revenue",v:moneyS(o.revenue.fixed.all_time),i:"bar-chart"})}
  if(o.pending_reports!==undefined)k.push({l:"Reports awaiting review",v:num(o.pending_reports),i:"file-text"});
  if(o.handoffs)k.push({l:"Requests waiting for an agent",v:num(o.handoffs.waiting),i:"headset",s:o.handoffs.oldest_waiting?"Oldest since "+ago(o.handoffs.oldest_waiting):"Queue is empty"},{l:"Open human chats",v:num(o.handoffs.open),i:"arrow-left-right"});
  if(o.ai)k.push({l:"AI conversations today",v:num(o.ai_today),i:"bot"},{l:"AI resolution rate · 30 days",v:o.ai.resolution_rate===null?"—":o.ai.resolution_rate+"%",i:"circle-check",s:`${num(o.ai.ai_resolved)} of ${num(o.ai.conversations)} resolved without a human`});
  if(o.failed_notifications!==undefined)k.push({l:"Failed Telegram notifications",v:num(o.failed_notifications),i:"alert-triangle"});
  el.innerHTML=page(`Welcome, ${me.name}`,"layout-dashboard",`Signed in as ${h(me.role_name)}. Figures come from live database records.${o.partial?" Some panels could not load.":""}`,refreshBtn)+
    (k.length?kpis(k):`<div class="card">${empty("Your role has no dashboard widgets. Use the navigation to open the sections you can access.","layout-dashboard")}</div>`)+
    `<div class="grid g2">${o.revenue?`<div class="card"><h3>${I("bar-chart")} Actual revenue this month (by day)</h3>${chart({labels:o.revenue.series.map(s=>s.bucket.slice(5)),series:[{name:"Actual",values:o.revenue.series.map(s=>s.actual||0)},{name:"Pending",values:o.revenue.series.map(s=>s.pending||0),color:"#F59E0B"}],fmt:moneyS,title:"Revenue this month"})}</div>`:""}
    ${o.recent_audit?`<div class="card"><h3>${I("scroll-text")} Recent activity</h3>${table([{l:"When",f:x=>ago(x.at)},{l:"Actor",f:x=>`<code>${h(x.actor)}</code>`},{l:"Action",f:x=>h(x.action.replace(/_/g," "))},{l:"Target",f:x=>h(x.target||"")}],o.recent_audit,{emptyText:"No activity yet."})}<p><a href="#/audit">Open audit logs</a></p></div>`:""}
    ${has("view_system_health")?`<div class="card"><h3>${I("heart-pulse")} Integrations</h3><div class="acts"><button class="btn ghost sm" type="button" data-x="test_ai">${I("bot")} Test AI</button>${has("manage_system")?`<button class="btn ghost sm" type="button" data-x="webhook_connect">${I("send")} Connect Telegram bot</button>`:""}<a class="btn ghost sm" href="#/health">${I("heart-pulse")} System Health</a></div><p class="small" data-xout></p></div>`:""}</div>`;
  $("[data-refresh]",el).onclick=A.go;
  $$("[data-x]",el).forEach(b=>b.onclick=async()=>{b.disabled=true;const x=await api(b.dataset.x,{});b.disabled=false;$("[data-xout]",el).textContent=x.ok?(x.j.ok?"✓ ":"✗ ")+(x.j.detail||(x.j.ok?"Telegram webhook, commands and bot name set.":x.j.error||"Failed")):errText(x)});
};

/* ---------------- User Management (staff) ---------------- */
let PERMS=null;
async function permCatalog(){if(PERMS)return PERMS;const r=await api("roles_list");PERMS=r.ok?r.j:{roles:[],permissions:[]};return PERMS}
async function staffForm(u,reload){
  const cat=has("manage_roles")?await permCatalog():null;
  const roles=(await api("staff_list?limit=1")).j.roles||[];
  const team=(await api("team_options")).j.rows||[];
  const mine=A.me().perms;
  formDlg({title:u?`Edit ${u.display_name}`:"Add staff account",intro:"Staff sign in with their Telegram user ID, their password and a one-time code from the bot. You can only grant permissions you hold yourself.",
    fields:[[{n:"uid",l:"Telegram user ID",v:u?u.uid:"",req:true,ml:20},{n:"display_name",l:"Display name",v:u?u.display_name:"",req:true,ml:60}],
      [{n:"role_id",l:"Role",t:"select",o:roles.filter(r=>r.id!=="founder"||A.me().role==="founder").map(r=>[r.id,r.name]),v:u?u.role_id:"support_agent",req:true},{n:"team_member_id",l:"Linked team member",t:"select",o:[["","— none —"],...team.map(t=>[t.id,t.name])],v:u?u.team_member_id||"":""}],
      {n:"grants",l:"Extra permissions (in addition to the role)",t:"perms",v:u?u.grants:[],o:(cat?cat.permissions:mine.map(k=>({key:k,description:""}))).map(p=>[p.key,p.key.replace(/_/g," "),p.description,!mine.includes(p.key)])},
      {n:"password",l:u?"New password (leave empty to keep)":"Initial password",t:"password",req:!u,h:"At least 12 characters. Share it privately; the user can change it under My profile."}],
    submit:u?"Save changes":"Create account",
    onSubmit:async v=>{const r=await api("staff_save",v);if(r.ok){toast(u?"Account updated.":"Account created.","ok");reload();return true}return r.status===428?"Password confirmation is required.":errText(r)}});
}
async function staffDrawer(row,reload){
  const r=await api("staff_get?uid="+encodeURIComponent(row.uid));if(!r.ok){toast(errText(r),"err");return}
  const {user:u,notes,activity,sessions,support_history}=r.j,env=u.source==="env",self=u.uid===A.me().uid;
  const d=A.drawer(u.display_name,`<dl class="kv"><dt>Telegram ID</dt><dd><code>${h(u.uid)}</code></dd><dt>Role</dt><dd>${h(u.role_name)}${u.grants.length?` + ${h(u.grants.join(", "))}`:""}</dd><dt>Status</dt><dd>${badge(u.status)} ${u.status_reason?h(u.status_reason):""}</dd>
    <dt>Registered</dt><dd>${when(u.created_at)}</dd><dt>Last sign-in</dt><dd>${when(u.last_login_at)}</dd><dt>Last activity</dt><dd>${when(u.last_seen_at)}</dd><dt>Source</dt><dd>${env?"ADMIN_UIDS environment (managed outside the dashboard)":"Dashboard"}</dd></dl>
    ${env||self?`<p class="notice">${I("info")} ${env?"Founders defined in ADMIN_UIDS can only be changed in the Vercel environment.":"Use My profile to change your own account."}</p>`:`<div class="acts" style="margin:14px 0">
      ${has("manage_admins")?`<button class="btn ghost sm" data-d="edit">${I("pencil")} Edit</button>`:""}
      ${u.status==="active"?`<button class="btn ghost sm" data-d="suspended">${I("user-x")} Suspend</button>${has("manage_admins")?`<button class="btn danger sm" data-d="banned">Ban</button>`:""}`:`<button class="btn ok sm" data-d="active">${I("user-check")} Restore</button>`}
      <button class="btn ghost sm" data-d="revoke">${I("log-out")} Revoke sessions</button>${has("manage_admins")?`<button class="btn danger sm" data-d="delete">${I("trash")} Delete</button>`:""}</div>`}
    <div class="card"><h3>${I("monitor-smartphone")} Sessions</h3>${table([{l:"Device",f:s=>h(s.device||"—")},{l:"IP",f:s=>h(s.ip||"")},{l:"Started",f:s=>when(s.created_at)},{l:"Last seen",f:s=>ago(s.last_seen_at)},{l:"State",f:s=>s.active?badge("active"):badge(s.revoke_reason||"ended")}],sessions,{emptyText:"No sessions."})}</div>
    <div class="card" style="margin-top:14px"><h3>${I("headset")} Support history</h3>${table([{l:"Request",f:x=>`<a href="#/handoffs/${h(x.id)}">${h(x.id)}</a>`},{l:"Customer",f:x=>h(x.user?.display_name||"")},{l:"Status",f:x=>badge(x.status)},{l:"Accepted",f:x=>when(x.assigned_at)}],support_history,{emptyText:"No handled requests."})}</div>
    <div class="card" style="margin-top:14px"><h3>${I("activity")} Recent activity</h3>${table([{l:"When",f:x=>when(x.at)},{l:"Action",f:x=>h(x.action.replace(/_/g," "))},{l:"Target",f:x=>h(x.target||"")}],activity,{emptyText:"No recorded activity."})}</div>
    ${A.notes(notes)}`);
  const re=()=>{d.close();staffDrawer(row,reload);reload()};
  A.bindNote(d,"staff_note",{uid:u.uid},re);
  $$("[data-d]",d).forEach(b=>b.onclick=async()=>{const a=b.dataset.d;
    if(a==="edit"){d.close();return staffForm(u,reload)}
    if(a==="revoke"){const c=await confirmAct({title:"Revoke all sessions?",text:`${h(u.display_name)} will be signed out everywhere.`,confirm:"Revoke"});if(c&&(await A.run("staff_revoke_sessions",{uid:u.uid},"Sessions revoked.")).ok)re();return}
    if(a==="delete"){const c=await confirmAct({title:"Delete this account?",text:"The account is deactivated and hidden (soft delete). Its history and audit records are kept.",confirm:"Delete account",danger:true,reason:true});if(c&&(await A.run("staff_delete",{uid:u.uid,reason:c.reason},"Account deleted.")).ok){d.close();reload()}return}
    const lbl={active:"Restore",suspended:"Suspend",banned:"Ban"}[a];
    const c=await confirmAct({title:`${lbl} ${u.display_name}?`,text:a==="active"?"The account can sign in again.":"All of their sessions end immediately.",confirm:lbl,danger:a!=="active",reason:true});
    if(c&&(await A.run("staff_status",{uid:u.uid,status:a,reason:c.reason},`Account ${a==="active"?"restored":a}.`)).ok)re()});
}
V.users=async el=>{
  const roles=(await api("staff_list?limit=1")).j.roles||[];
  const L=A.list(el,{title:"User Management",icon:"users",desc:"Dashboard staff accounts: search, review activity, suspend, restore, ban, revoke sessions and add internal notes. Every action is logged.",
    actions:has("manage_admins")?`<button class="btn sm" type="button" data-new>${I("user-plus")} Add staff</button>`:"",op:"staff_list",
    filters:[{n:"q",l:"Search name or ID",w:1},{n:"status",l:"Status",t:"select",o:[["","All"],["active","Active"],["suspended","Suspended"],["banned","Banned"]]},{n:"role",l:"Role",t:"select",o:[["","All roles"],...roles.map(r=>[r.id,r.name])]},{n:"deleted",l:"Show",t:"select",o:[["","Current"],["1","Deleted"]]}],
    cols:[{l:"Name",f:u=>`<div class="prow"><span class="pav">${h(ini(u.display_name))}</span><span><b>${h(u.display_name)}</b><br><code>${h(u.uid)}</code></span></div>`},{l:"Role",f:u=>h(u.role_name)+(u.source==="env"?' <span class="bd in">env</span>':"")},{l:"Status",f:u=>badge(u.deleted_at?"removed":u.status)},{l:"Registered",f:u=>day(u.created_at)},{l:"Last activity",f:u=>ago(u.last_seen_at||u.last_login_at)}],
    click:(u,reload)=>staffDrawer(u,reload)});
  const n=$("[data-new]",el);if(n)n.onclick=()=>staffForm(null,L.reload);
};

/* ---------------- Team Management ---------------- */
async function memberForm(m,reload){
  const all=(await api("team_options")).j.rows||[];
  formDlg({title:m?`Edit ${m.display_name}`:"Add team member",intro:"Public fields appear on the website only while the member is active and marked public. The Telegram UID is private: it is never shown publicly.",
    fields:[[{n:"display_name",l:"Display name",v:m?.display_name,req:true,ml:60},{n:"role_title",l:"Role / title",v:m?.role_title||"Recovery Specialist",req:true,ml:60}],
      [{n:"member_group",l:"Group",t:"select",o:[["founder","Founder"],["admin","Admin"],["member","Member"]],v:m?.member_group||"member"},{n:"display_order",l:"Display order",t:"number",min:0,max:100000,v:m?.display_order??100}],
      [{n:"telegram_username",l:"Telegram username (public)",v:m?.telegram_username||"",ml:33},{n:"telegram_uid",l:"Telegram UID (private)",v:m?.telegram_uid||"",ml:20,h:"Links bot reports and support alerts to this member."}],
      {n:"facebook_url",l:"Facebook profile URL (optional)",t:"url",v:m?.facebook_url||"",ml:300},
      {n:"bio",l:"Description",t:"textarea",v:m?.bio||"",ml:400},
      {n:"leader_id",l:"Team leader",t:"select",o:[["","— none —"],...all.filter(x=>!m||x.id!==m.id).map(x=>[x.id,x.name])],v:m?.leader_id||""},
      [{n:"is_public",l:"Show on public website",t:"checkbox",v:m?m.is_public:true},{n:"show_telegram",l:"Show Telegram username publicly",t:"checkbox",v:m?m.show_telegram:true}]],
    onSubmit:async v=>{const r=await api("team_save",{...v,id:m?.id,display_order:Number(v.display_order)});if(r.ok){toast("Team member saved.","ok");reload();return true}return errText(r)}});
}
V.team=el=>{
  A.list(el,{title:"Team Management",icon:"user-plus",desc:"Database-backed team directory. Inactive and removed members keep their history and performance records.",
    actions:`<button class="btn sm" type="button" data-new>${I("plus")} Add member</button>`,op:"team_list",limit:500,
    filters:[{n:"q",l:"Search",w:1},{n:"status",l:"Status",t:"select",o:[["","All"],["active","Active"],["inactive","Inactive"]]},{n:"deleted",l:"Show",t:"select",o:[["","Current"],["1","Removed"]]}],
    cols:[{l:"Member",f:m=>`<div class="prow"><span class="pav">${h(ini(m.display_name))}${m.photo_url?`<img src="${h(m.photo_url)}" alt="">`:""}</span><span><b>${h(m.display_name)}</b><br><span class="small">${h(m.role_title)}</span></span></div>`},
      {l:"Group",f:m=>h(m.member_group)},{l:"Telegram",f:m=>(m.telegram_username?"@"+h(m.telegram_username):"—")+(m.telegram_uid?' <span class="bd in" title="Private UID on file">UID</span>':"")},
      {l:"Public",f:m=>m.is_public?badge("published"):badge("draft")},{l:"Status",f:m=>badge(m.deleted_at?"removed":m.status)},{l:"Order",f:m=>num(m.display_order),c:"num"},
      {l:"Actions",f:m=>m.deleted_at?"":`<div class="acts"><button class="btn ghost sm" data-act="edit">${I("pencil")}<span class="sr">Edit</span></button><button class="btn ghost sm" data-act="photo">${I("image")} Photo</button><button class="btn ghost sm" data-act="status">${m.status==="active"?"Deactivate":"Activate"}</button><button class="btn danger sm" data-act="del" aria-label="Remove">${I("trash")}</button></div>`}],
    act:async(a,m,btn,reload)=>{
      if(a==="edit")return memberForm(m,reload);
      if(a==="photo")return formDlg({title:"Profile photo",intro:"JPG, PNG or WebP. The image is resized in your browser and checked again on the server (max 2 MB).",fields:[{n:"file",l:"Image",t:"file",accept:"image/jpeg,image/png,image/webp",req:true,px:800,maxBytes:2*1048576}],submit:"Upload",
        onSubmit:async v=>{const r=await api("team_photo",{id:m.id,file:v.file});if(r.ok){toast("Photo updated.","ok");reload();return true}return errText(r)}});
      if(a==="status"){const to=m.status==="active"?"inactive":"active";const c=await confirmAct({title:`${to==="active"?"Activate":"Deactivate"} ${m.display_name}?`,text:to==="inactive"?"They disappear from the public team page and stop receiving support alerts. History is kept.":"They reappear publicly (if marked public) and receive alerts again.",reason:true,confirm:to==="active"?"Activate":"Deactivate"});
        if(c&&(await A.run("team_status",{id:m.id,status:to,reason:c.reason},"Status updated.")).ok)reload();return}
      if(a==="del"){const c=await confirmAct({title:`Remove ${m.display_name}?`,text:"Soft delete: the member is hidden everywhere, but their reports, revenue and performance history are preserved.",danger:true,reason:true,confirm:"Remove"});if(c&&(await A.run("team_delete",{id:m.id,reason:c.reason},"Member removed.")).ok)reload()}
    }});
  $("[data-new]",el).onclick=()=>memberForm(null,()=>A.go());
};

/* ---------------- Roles & Permissions ---------------- */
V.roles=async el=>{
  const load=async()=>{
    PERMS=null;const c=await permCatalog(),mine=A.me().perms;
    el.innerHTML=page("Roles & Permissions","key-round","Each role is a set of permission keys, enforced by the API on every request. You can only include permissions you hold. The Founder role always has every permission.",`<button class="btn sm" type="button" data-new>${I("plus")} New role</button>`)+
      `<p class="notice">${I("shield")} Founders configured in ADMIN_UIDS: ${num(c.env_founders)}. The platform refuses to suspend, demote or delete the last active Super Admin.</p><div class="grid g2" style="margin-top:14px">${c.roles.map(r=>`<div class="card"><h3>${I("key-round")} ${h(r.name)} ${r.is_system?'<span class="bd in">built-in</span>':""} ${r.scope==="team"?'<span class="bd wa">team scope</span>':""}</h3><p class="small">${h(r.description||"")}</p><p class="small">${num(r.users)} account(s) · <code>${h(r.id)}</code></p><div class="acts" style="margin:8px 0">${r.id==="founder"?'<span class="small">All permissions</span>':(r.permissions||[]).map(p=>`<span class="bd">${h(p)}</span>`).join("")||'<span class="small">No permissions yet</span>'}</div>
      ${r.id!=="founder"?`<div class="acts"><button class="btn ghost sm" data-edit="${h(r.id)}">${I("pencil")} Edit</button>${r.is_system?"":`<button class="btn danger sm" data-del="${h(r.id)}">${I("trash")} Delete</button>`}</div>`:""}</div>`).join("")}</div>`;
    const form=r=>formDlg({title:r?`Edit role: ${r.name}`:"New role",fields:[{n:"name",l:"Role name",v:r?.name,req:true,ml:60},{n:"description",l:"Description",t:"textarea",v:r?.description,ml:300},
      {n:"scope",l:"Data scope",t:"select",o:[["all","All data"],["team","Own team only (team leaders)"]],v:r?.scope||"all"},
      {n:"permissions",l:"Permissions",t:"perms",v:r?.permissions||[],o:c.permissions.map(p=>[p.key,p.key.replace(/_/g," "),p.description,!mine.includes(p.key)])}],
      onSubmit:async v=>{const x=await api("role_save",{...v,id:r?.id});if(x.ok){toast("Role saved.","ok");load();return true}return x.status===428?"Password confirmation is required.":errText(x)}});
    $("[data-new]",el).onclick=()=>form(null);
    $$("[data-edit]",el).forEach(b=>b.onclick=()=>form(c.roles.find(r=>r.id===b.dataset.edit)));
    $$("[data-del]",el).forEach(b=>b.onclick=async()=>{const k=await confirmAct({title:"Delete role?",text:"Only possible when no account uses it.",danger:true,confirm:"Delete role"});if(k&&(await A.run("role_delete",{id:b.dataset.del},"Role deleted.")).ok)load()});
  };
  await load();
};

/* ---------------- Session Manager ---------------- */
V.sessions=el=>A.list(el,{title:"Session Manager",icon:"monitor-smartphone",desc:"Dashboard sessions with device, IP and activity. Revoking ends the session immediately and is recorded in the audit log.",op:"sessions_list",limit:50,defaults:{state:"active"},
  filters:[{n:"state",l:"State",t:"select",o:[["active","Active"],["ended","Ended / revoked"],["","All"]]},{n:"uid",l:"Telegram ID"}],
  cols:[{l:"Account",f:s=>`<b>${h(s.name)}</b><br><code>${h(s.uid)}</code>${s.current?' <span class="bd ok">this session</span>':""}`},{l:"Device",f:s=>h(s.device||"—")},{l:"IP",f:s=>h(s.ip||"")},{l:"Created",f:s=>when(s.created_at)},{l:"Last activity",f:s=>ago(s.last_seen_at)},
    {l:"State",f:s=>s.active?badge("active"):badge(s.revoke_reason?s.revoke_reason.replace(/_/g," "):"expired")},{l:"",f:s=>s.active?`<button class="btn danger sm" data-act="revoke">Revoke</button>`:""}],
  act:async(a,s,b,reload)=>{const c=await confirmAct({title:"Revoke this session?",text:`${h(s.name)} on ${h(s.device||"unknown device")} will be signed out.`,danger:true,confirm:"Revoke"});if(!c)return;const r=await A.run("session_revoke",{key:s.key},"Session revoked.");if(r.ok){if(r.j.self)location.reload();else reload()}}});

/* ---------------- My profile ---------------- */
V.profile=async el=>{
  const me=A.me(),s=await api("my_sessions");
  el.innerHTML=page("My profile","user",`${h(me.role_name)} · Telegram ID <code>${h(me.uid)}</code>`)+`<div class="grid g2"><div class="card"><h3>${I("user")} Display name</h3><form data-n style="display:grid;gap:8px"><label for="pn">Name</label><input id="pn" value="${h(me.name)}" maxlength="60"><button class="btn sm" style="justify-self:start" type="submit">Save name</button></form></div>
    <div class="card"><h3>${I("lock")} Password</h3><p class="small">${me.has_own_password?"You use a personal password.":me.source==="env"?"You currently sign in with ADMIN_PASSWORD. Setting a personal password replaces it for your account only.":""}</p><button class="btn sm" type="button" data-pw>Change password</button></div></div>
    <div class="card" style="margin-top:16px"><h3>${I("monitor-smartphone")} My sessions</h3>${s.ok?table([{l:"Device",f:x=>h(x.device||"—")+(x.current?' <span class="bd ok">this device</span>':"")},{l:"IP",f:x=>h(x.ip||"")},{l:"Started",f:x=>when(x.created_at)},{l:"Last seen",f:x=>ago(x.last_seen_at)},{l:"State",f:x=>x.active?badge("active"):badge(x.revoke_reason||"expired")}],s.j.rows):errorBox(errText(s))}</div>
    <div class="card" style="margin-top:16px"><h3>${I("shield-check")} Your permissions</h3><div class="acts">${me.perms.map(p=>`<span class="bd">${h(p)}</span>`).join("")}</div></div>`;
  $("[data-n]",el).addEventListener("submit",async e=>{e.preventDefault();const r=await A.run("profile_name",{display_name:$("#pn").value},"Name saved.");if(r.ok)location.reload()});
  $("[data-pw]",el).onclick=()=>formDlg({title:"Change password",intro:"You will confirm your current password first. Other sessions are signed out after the change.",fields:[{n:"new_password",l:"New password",t:"password",req:true,h:"At least 12 characters."},{n:"confirm_password",l:"Repeat new password",t:"password",req:true}],
    onSubmit:async v=>{const r=await api("profile_password",v);if(r.ok){toast("Password changed. Other sessions were signed out.","ok");return true}return r.status===428?"Password confirmation is required.":errText(r)}});
};

/* ---------------- Security Center ---------------- */
V.security=async el=>{
  const r=await api("security_overview");if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=A.go;return}
  const {counts:c,events,locks,logins,config}=r.j;
  el.innerHTML=page("Security Center","shield","Sign-in protection, lockouts, rate limits, unauthorized attempts and integration health. Credentials are never stored in these logs.",refreshBtn)+
    kpis([{l:"Failed sign-ins · 24 h",v:num(c.failed_logins_24h),i:"alert-triangle",s:num(c.failed_logins_7d)+" in 7 days"},{l:"Lockouts · 24 h",v:num(c.lockouts_24h),i:"lock"},{l:"Rate-limited · 24 h",v:num(c.rate_limited_24h),i:"clock"},{l:"Unauthorized / forbidden · 24 h",v:num(c.unauthorized_24h),i:"shield"},{l:"Active admin sessions",v:num(c.active_sessions),i:"monitor-smartphone"},{l:"Failed Telegram notifications",v:num(c.telegram_failed_notifications),i:"send"}])+
    `<div class="grid g2"><div class="card"><h3>${I("lock-keyhole")} Active lockouts</h3>${table([{l:"Key",f:x=>`<code>${h(x.key)}</code>`},{l:"Failures",f:x=>num(x.fails),c:"num"},{l:"Locked until",f:x=>when(x.locked_until)},{l:"",f:()=>`<button class="btn ghost sm" data-act="unlock">Unlock</button>`}],locks,{emptyText:"No active lockouts."})}</div>
    <div class="card"><h3>${I("shield-check")} Protections in place</h3><dl class="kv"><dt>Two-factor</dt><dd>${h(config.two_factor)}</dd><dt>Idle sign-out</dt><dd>${num(config.idle_minutes)} min · 8 h maximum</dd><dt>Session secret</dt><dd>${config.session_secret_ok?badge("active"):badge("failed")}</dd><dt>ADMIN_PASSWORD</dt><dd>${config.admin_password_set?"Set":"Not set (only personal passwords work)"}</dd><dt>Env founders</dt><dd>${num(config.env_founders)}</dd><dt>Lockout</dt><dd>5 failures → 1 min, doubling up to 24 h</dd></dl></div></div>
    <div class="card" style="margin-top:16px"><h3>${I("history")} Sign-in history</h3>${table([{l:"When",f:x=>when(x.at)},{l:"Actor",f:x=>`<code>${h(x.actor)}</code>`},{l:"Event",f:x=>h(x.action.replace(/_/g," "))},{l:"IP",f:x=>h(x.ip||"")}],logins,{emptyText:"No sign-ins recorded."})}</div>
    <div class="card" style="margin-top:16px"><h3>${I("activity")} Security events</h3>${table([{l:"When",f:x=>when(x.at)},{l:"Type",f:x=>h(x.type.replace(/_/g," "))},{l:"Severity",f:x=>badge(x.severity==="info"?"active":x.severity==="warning"?"pending":"failed").replace(/>[^<]*</,">"+h(x.severity)+"<")},{l:"Actor",f:x=>h(x.actor||"")},{l:"IP",f:x=>h(x.ip||"")},{l:"Detail",f:x=>`<code>${h(JSON.stringify(x.detail||{}))}</code>`,c:"wide"}],events,{emptyText:"No security events."})}</div>`;
  $("[data-refresh]",el).onclick=A.go;
  $$("[data-act=unlock]",el).forEach((b,i)=>b.onclick=async()=>{if((await A.run("security_unlock",{key:locks[i].key},"Lockout cleared.")).ok)A.go()});
};

/* ---------------- Audit Logs ---------------- */
V.audit=el=>A.list(el,{title:"Audit Logs",icon:"scroll-text",desc:"Append-only record of sensitive actions. Entries cannot be edited or deleted through the platform.",op:"audit_list",limit:50,
  filters:[{n:"actor",l:"Actor"},{n:"action",l:"Action"},{n:"target",l:"Target"},{n:"from",l:"From",t:"date"},{n:"to",l:"To",t:"date"}],
  cols:[{l:"When",f:x=>when(x.at)},{l:"Actor",f:x=>`<code>${h(x.actor)}</code>`},{l:"Action",f:x=>`<b>${h(x.action.replace(/_/g," "))}</b>`},{l:"Target",f:x=>h(x.target||"")},{l:"Change",f:x=>x.prev||x.next?`<code>${h(JSON.stringify(x.prev||{}))}</code> → <code>${h(JSON.stringify(x.next||{}))}</code>`:"",c:"wide"},{l:"Details",f:x=>Object.keys(x.detail||{}).length?`<code>${h(JSON.stringify(x.detail))}</code>`:"",c:"wide"},{l:"IP",f:x=>h(x.ip||"")}]});

/* ---------------- Emergency Control ---------------- */
V.emergency=async el=>{
  const r=await api("emergency_get");if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=A.go;return}
  const {flags,labels,history}=r.j;
  const help={maintenance_mode:"Public chat and support requests stop; visitors see a maintenance notice. The dashboard keeps working and security is unchanged.",human_requests_disabled:"Visitors can still use AI Support but cannot open new Human Support requests.",reports_disabled:"Blocks new reports from the bot and the dashboard.",revenue_edits_locked:"Blocks creating, editing, verifying or rejecting revenue, and edits to approved report amounts.",telegram_notifications_disabled:"Stops outgoing Telegram alerts (logged as skipped). Use if the bot is misbehaving.",ai_disabled:"AI Support stops answering; visitors are offered Human Support instead."};
  el.innerHTML=page("Emergency Control","siren","Switch platform services off or on. Every change needs a reason and your password, notifies the founders on Telegram and is written to the audit log. Emergency settings never bypass sign-in or permissions.")+
    `<div class="card">${Object.keys(labels).map(k=>`<div class="toggle"><div><b>${h(labels[k])}</b><small>${h(help[k]||"")}</small></div><div class="acts">${flags[k]?badge("active").replace("active","ON"):'<span class="bd">OFF</span>'}<button class="btn ${flags[k]?"ok":"danger"} sm" type="button" data-flag="${h(k)}">${flags[k]?"Restore service":"Turn on"}</button></div></div>`).join("")}</div>
    <div class="card" style="margin-top:16px"><h3>${I("history")} Emergency history</h3>${table([{l:"When",f:x=>when(x.at)},{l:"By",f:x=>`<code>${h(x.actor)}</code>`},{l:"Change",f:x=>`${h(x.detail?.label||x.detail?.flag||"")}: ${h(JSON.stringify(x.prev))} → ${h(JSON.stringify(x.next))}`},{l:"Reason",f:x=>h(x.detail?.reason||""),c:"wide"}],history,{emptyText:"No emergency actions yet."})}</div>`;
  $$("[data-flag]",el).forEach(b=>b.onclick=async()=>{const k=b.dataset.flag,to=!flags[k];
    const c=await confirmAct({title:`${to?"Turn on":"Restore"}: ${labels[k]}?`,text:h(help[k]||""),confirm:to?"Turn on":"Restore service",danger:to,reason:true,typed:to?"CONFIRM":null});if(!c)return;
    if((await A.run("emergency_set",{flag:k,value:to,confirm:true,reason:c.reason},"Emergency setting updated.")).ok)A.go()});
};

/* ---------------- Backup & Recovery ---------------- */
V.backups=async el=>{
  const r=await api("backups_list");if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=A.go;return}
  el.innerHTML=page("Backup & Recovery","archive","Full exports are written to the private <code>backups</code> storage bucket, downloaded back and checked (SHA-256 and row counts) before they are marked verified. Secrets such as sessions, one-time codes and password hashes are never included.",`<button class="btn sm" type="button" data-new>${I("archive")} Create backup</button>`)+
    `<p class="notice">${I("info")} Supabase's own automated backups (dashboard → Database → Backups, plan-dependent) remain the primary recovery mechanism. Restoring an export is a manual, documented procedure: see docs/BACKUP_AND_RECOVERY.md.</p>
    <div class="card" style="margin-top:14px"><h3>${I("history")} Backup history</h3>${table([{l:"ID",f:x=>`<code>${h(x.id)}</code>`},{l:"Created",f:x=>when(x.created_at)},{l:"By",f:x=>h(x.created_by)},{l:"Status",f:x=>badge(x.status)},{l:"Size",f:x=>x.size_bytes?num(Math.round(x.size_bytes/1024))+" KB":"—",c:"num"},{l:"Rows",f:x=>num(Object.values(x.row_counts||{}).reduce((a,b)=>a+b,0)),c:"num"},{l:"Note",f:x=>h(x.error||""),c:"wide"},{l:"",f:x=>x.status==="verified"||x.status==="completed"?`<button class="btn ghost sm" data-dl="${h(x.id)}">${I("download")} Download</button>`:""}],r.j.rows,{emptyText:"No backups yet."})}</div>
    <div class="card" style="margin-top:16px"><h3>${I("download")} Record exports (CSV)</h3><div class="acts">${r.j.datasets.map(d=>`<button class="btn ghost sm" data-ex="${h(d)}">${I("download")} ${h(d.replace(/_/g," "))}</button>`).join("")}</div></div>`;
  $("[data-new]",el).onclick=async()=>{const c=await confirmAct({title:"Create a full backup now?",text:"This reads every business table and may take up to a minute.",confirm:"Create backup"});if(!c)return;toast("Backup started…");const x=await A.run("backup_create",{},"Backup created and verified.");if(x.ok||x.status===502)A.go()};
  $$("[data-dl]",el).forEach(b=>b.onclick=async()=>{const x=await A.run("backup_download",{id:b.dataset.dl});if(x.ok)location.href=x.j.url});
  $$("[data-ex]",el).forEach(b=>b.onclick=()=>A.download("export_dataset",{dataset:b.dataset.ex}));
};

/* ---------------- System Health ---------------- */
V.health=async el=>{
  const r=await api("health");if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=A.go;return}
  const x=r.j,ok=v=>v?badge("active").replace(">active<",">OK<"):badge("failed").replace(">failed<",">Problem<");
  el.innerHTML=page("System Health","heart-pulse",`Checked ${when(x.checked_at)} in ${num(x.took_ms)} ms. Only real checks are shown — no estimated uptime.`,refreshBtn+(A.has("manage_system")?`<button class="btn ghost sm" data-x="webhook_connect">${I("send")} Connect Telegram bot</button>`:"")+`<button class="btn ghost sm" data-x="test_ai">${I("bot")} Test AI</button>`)+
    `<p class="small" data-xout></p><div class="grid g3">
    <div class="card"><h3>${I("server")} API</h3><dl class="kv"><dt>Status</dt><dd>${ok(x.api.ok)}</dd><dt>Node.js</dt><dd>${h(x.api.node)}</dd><dt>Environment</dt><dd>${h(x.api.env||"not on Vercel")}</dd><dt>Region</dt><dd>${h(x.api.region||"—")}</dd><dt>Commit</dt><dd>${h(x.api.commit||"—")}</dd></dl></div>
    <div class="card"><h3>${I("layers")} Supabase</h3><dl class="kv"><dt>Configured</dt><dd>${ok(x.supabase.configured)}</dd><dt>Schema</dt><dd>${ok(x.supabase.ok)}</dd><dt>Check time</dt><dd>${x.supabase.latency_ms??"—"} ms</dd>${x.supabase.missing.length?`<dt>Missing</dt><dd><code>${h(x.supabase.missing.join(", "))}</code></dd>`:""}</dl></div>
    <div class="card"><h3>${I("send")} Telegram</h3><dl class="kv"><dt>Bot</dt><dd>${ok(x.telegram.ok)} ${h(x.telegram.bot||x.telegram.error||"")}</dd><dt>Webhook</dt><dd>${ok(x.telegram.webhook_url_set)}</dd><dt>Pending updates</dt><dd>${x.telegram.webhook_pending??"—"}</dd><dt>Team UIDs</dt><dd>${num(x.telegram.team_uids)}</dd><dt>Failed alerts</dt><dd>${x.telegram.failed_notifications??"—"}</dd>${x.telegram.webhook_last_error?`<dt>Last error</dt><dd>${h(x.telegram.webhook_last_error)}</dd>`:""}${x.telegram.uid_errors.length?`<dt>UID config</dt><dd>${h(x.telegram.uid_errors.join("; "))}</dd>`:""}</dl></div>
    <div class="card"><h3>${I("bot")} AI (Groq)</h3><dl class="kv"><dt>API key</dt><dd>${ok(x.ai.configured)}</dd><dt>Models</dt><dd>${h(x.ai.models.join(", "))}</dd></dl></div>
    <div class="card"><h3>${I("archive")} Storage</h3><dl class="kv"><dt>Reachable</dt><dd>${ok(x.storage.ok)}</dd><dt>Missing buckets</dt><dd>${x.storage.missing_buckets.length?h(x.storage.missing_buckets.join(", ")):"none"}</dd>${x.storage.error?`<dt>Error</dt><dd>${h(x.storage.error)}</dd>`:""}</dl></div>
    <div class="card"><h3>${I("clock")} Background work</h3><dl class="kv"><dt>Waiting handoffs</dt><dd>${x.background.waiting_handoffs??"—"}</dd><dt>Oldest waiting</dt><dd>${x.background.oldest_waiting?ago(x.background.oldest_waiting):"—"}</dd><dt>Errors · 24 h</dt><dd>${x.errors.last_24h??"—"}</dd></dl></div></div>
    <div class="card" style="margin-top:16px"><h3>${I("alert-triangle")} Recent application errors</h3>${table([{l:"When",f:e=>when(e.at)},{l:"Route",f:e=>`<code>${h(e.route)}</code>`},{l:"Message",f:e=>h(e.message),c:"wide"}],x.errors.recent,{emptyText:"No application errors recorded."})}</div>
    <div class="card" style="margin-top:16px"><h3>${I("sliders")} Configuration checks</h3><dl class="kv"><dt>SESSION_SECRET</dt><dd>${ok(x.config.session_secret)}</dd><dt>WEBHOOK_SECRET</dt><dd>${ok(x.config.webhook_secret)}</dd><dt>ADMIN_PASSWORD</dt><dd>${x.config.admin_password?"set":"not set"}</dd><dt>APP_URL</dt><dd>${x.config.app_url?"set":"not set (dashboard links in Telegram are omitted)"}</dd></dl></div>`;
  $("[data-refresh]",el).onclick=A.go;
  $$("[data-x]",el).forEach(b=>b.onclick=async()=>{b.disabled=true;const y=await api(b.dataset.x,{});b.disabled=false;$("[data-xout]",el).textContent=y.ok?(y.j.ok?"✓ ":"✗ ")+(y.j.detail||(y.j.ok?"Telegram webhook, commands and name set.":y.j.error||"Failed")):errText(y)});
};

/* ---------------- System Settings ---------------- */
V.settings=async el=>{
  const r=await api("settings_get");if(!r.ok){el.innerHTML=errorBox(errText(r));$("[data-retry]",el).onclick=A.go;return}
  const {support:s,site,env}=r.j;
  el.innerHTML=page("System Settings","sliders","Database-backed settings take effect within seconds. Environment values are shown read-only; change them in Vercel.")+
    `<div class="grid g2"><form class="card" data-s style="display:grid;gap:10px"><h3>${I("headset")} Human Support limits</h3>
      <label for="s1">Requests allowed before cooldown</label><input id="s1" type="number" min="1" max="20" value="${h(s.request_limit)}">
      <label for="s2">Cooldown (minutes)</label><input id="s2" type="number" min="5" max="1440" value="${h(s.cooldown_minutes)}">
      <label for="s3">Unsuccessful AI attempts before offering a human</label><input id="s3" type="number" min="1" max="5" value="${h(s.handoff_after_failures)}">
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="s4"${site.announcement_banner?" checked":""}> Show public announcements on the website</label>
      <div class="ferr" role="alert"></div><button class="btn sm" type="submit" style="justify-self:start">Save settings</button></form>
    <div class="card"><h3>${I("server")} Environment (read-only)</h3><dl class="kv"><dt>Currency</dt><dd>${h(env.currency)}</dd><dt>Timezone offset</dt><dd>UTC+${h(env.tz_offset)}</dd><dt>Admin idle timeout</dt><dd>${h(env.admin_idle_min)} min</dd><dt>AUTO_APPROVE</dt><dd>${env.auto_approve?"on":"off"}</dd><dt>APP_URL</dt><dd>${h(env.app_url||"not set")}</dd><dt>AI models</dt><dd>${h(env.ai_models.join(", "))}</dd></dl></div></div>`;
  $("[data-s]",el).addEventListener("submit",async e=>{e.preventDefault();const x=await api("settings_save",{request_limit:$("#s1").value,cooldown_minutes:$("#s2").value,handoff_after_failures:$("#s3").value,announcement_banner:$("#s4").checked});
    if(x.ok)toast("Settings saved.","ok");else $(".ferr",el).textContent=errText(x)});
};
A.qs=qs;A.opts=opts;
})();
