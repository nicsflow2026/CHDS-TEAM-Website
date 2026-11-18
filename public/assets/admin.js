"use strict";
(()=>{
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let D=null,uid="",tab="overview",filter="all",chatSid="",chatMsgs=[],timer=0,note="",idleMs=600000,last=Date.now(),pingAt=0;
const money=n=>(D?D.cur:"₱")+Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
const when=t=>t?new Date(t).toLocaleString():"";
const show=(id,on)=>$(id).classList.toggle("hide",!on);
const err=t=>{$("#err").textContent=t||""};

async function call(path,body){
  const o={credentials:"same-origin",cache:"no-store",headers:{}};
  if(body!==undefined){o.method="POST";o.headers["Content-Type"]="application/json";o.headers["X-CHDS-Admin"]="1";o.body=JSON.stringify(body)}
  let r;try{r=await fetch("/api/admin/"+path,o)}catch{return{ok:false,status:0,j:{}}}
  let j={};try{j=await r.json()}catch{}
  if(r.status===401&&!/^(login|otp)/.test(path)){const was=!!D;lock();if(was)err("Session expired after inactivity. Please sign in again.")}
  return{ok:r.ok,status:r.status,j};
}
function lock(){clearInterval(timer);D=null;show("#app",false);show("#login",true);show("#s1",true);show("#s2",false);err("")}

async function enter(){
  await refresh();
  if(!D){lock();return}
  show("#login",false);show("#app",true);last=Date.now();
  clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)refresh(true)},30000); // quiet poll: does not extend the session
}
const bump=()=>{last=Date.now();if(D&&Date.now()-pingAt>60000){pingAt=Date.now();call("ping")}};
["pointerdown","keydown","touchstart","scroll"].forEach(ev=>addEventListener(ev,bump,{passive:true}));
setInterval(async()=>{if(D&&Date.now()-last>idleMs){await call("logout",{});lock();err("Signed out after "+Math.round(idleMs/6e4)+" minutes of inactivity.")}},10000);

$("#s1").addEventListener("submit",async e=>{
  e.preventDefault();err("");const b=$("#s1 button");b.disabled=true;
  uid=$("#uid").value.trim();
  const r=await call("login",{uid,password:$("#pw").value});$("#pw").value="";b.disabled=false;
  if(r.ok){show("#s1",false);show("#s2",true);$("#code").focus();return}
  err(r.status===429?"Too many attempts. Try again in 15 minutes.":r.status===503?(r.j.error==="db_not_migrated"?"Database is not set up: run ALL of supabase.sql in Supabase -> SQL Editor, then try again.":"The admin panel is not configured yet. See the README."):r.status===502?"Could not send the code. Open the bot in Telegram, press /start, then try again.":"Something went wrong. Please try again.");
});
$("#s2").addEventListener("submit",async e=>{
  e.preventDefault();err("");const b=$("#s2 button");b.disabled=true;
  const r=await call("otp",{uid,code:$("#code").value.trim()});$("#code").value="";b.disabled=false;
  if(r.ok){await enter();return}
  err(r.status===429?"Too many attempts. Try again in 15 minutes.":"Invalid or expired code. Start over and request a new one.");
  if(r.status!==429){show("#s2",false);show("#s1",true)}
});
$("#back").onclick=()=>{show("#s2",false);show("#s1",true);err("")};
$("#out").onclick=async()=>{await call("logout",{});lock()};
$("#outall").onclick=async()=>{if(confirm("Sign out of all admin sessions on every device?")){await call("logout",{all:true});lock()}};

async function refresh(quiet){
  const r=await call("overview?status="+filter+(quiet?"&quiet=1":""));
  if(!r.ok)return;D=r.j;idleMs=D.idle_ms||idleMs;
  $("#pb").textContent=D.pending?"("+D.pending+")":"";
  const a=document.activeElement;
  if(quiet&&a&&$("#view").contains(a)&&/^(INPUT|SELECT|SUMMARY|TEXTAREA)$/.test(a.tagName))return; // do not wipe what the admin is typing
  render();
}
async function act(body,okMsg){
  const r=await call("act",body);
  note=r.ok?(okMsg||"Done."):(r.j.error==="already_handled"?"Already handled by someone else.":"Action failed ("+(r.j.error||r.status)+").");
  await refresh();return r;
}

const badge=s=>`<span class="bd ${s==="approved"||s==="live"?"ok":s==="pending"||s==="wait"?"wa":"no"}">${esc(s)}</span>`;
function overview(){
  const T=D.stats.totals,S=D.stats.series,mx=Math.max(1,...S.map(d=>d.revenue)),y=D.sys,ok=v=>v?'<span class="bd ok">OK</span>':'<span class="bd no">Missing</span>';
  const live=D.chats.filter(c=>c.status!=="ended").length;
  return `<div class="sec" style="margin-top:20px"><div class="cards">
    <div class="card"><b>${money(T.revenue)}</b><small>Approved revenue</small></div>
    <div class="card"><b>${T.recovered.toLocaleString()}</b><small>Accounts recovered</small></div>
    <div class="card"><b>${D.pending}</b><small>Pending reports</small></div>
    <div class="card"><b>${live}</b><small>Open chats</small></div></div></div>
  <div class="sec"><h3>Revenue, last 30 days</h3><div class="bars" role="img" aria-label="Revenue per day">${S.map(d=>`<i title="${esc(d.d)}: ${money(d.revenue)}" style="height:${Math.max(2,d.revenue/mx*100)}%"></i>`).join("")}</div></div>
  <div class="sec"><h3>System status</h3><div class="kv">
    <div><span>Groq API key</span> ${ok(y.groq_key)}</div><div><span>AI model</span> ${esc(y.groq_model)}</div>
    <div><span>Telegram bot token</span> ${ok(y.bot_token)}</div><div><span>Webhook secret</span> ${ok(y.webhook_secret)}</div>
    <div><span>Webhook connected</span> ${ok(y.webhook_url)}</div><div><span>Pending updates</span> ${esc(y.webhook_pending??"-")}</div>
    <div><span>Team UIDs</span> ${y.team_uids}</div><div><span>Admin UIDs</span> ${y.admin_uids}</div></div>
    ${y.webhook_error?`<p class="err">Telegram error: ${esc(y.webhook_error)}</p>`:""}
    <div class="row" style="margin-top:14px"><button class="mb" data-a="webhook" type="button">Connect Telegram bot</button><button class="mb" data-a="testai" type="button">Test AI</button></div></div>`;
}
function reports(){
  const rows=D.reports.map(r=>`<tr><td><code>${esc(r.id)}</code></td><td>${esc(r.name)}</td><td>${esc(r.report_date)}</td><td>${r.recovered}</td><td>${money(r.revenue)}</td><td>${badge(r.status)}</td><td>${when(r.created_at)}</td><td>${
    (r.status==="pending"?`<button class="mb g" data-a="approve" data-id="${esc(r.id)}" type="button">Approve</button><button class="mb r" data-a="reject" data-id="${esc(r.id)}" type="button">Reject</button>`:"")+
    `<button class="mb r" data-a="delete" data-id="${esc(r.id)}" type="button">Delete</button>`}</td></tr>`).join("");
  const today=new Date().toISOString().slice(0,10);
  return `<div class="sec" style="margin-top:20px"><div class="row"><h3 style="margin:0;margin-right:auto">Reports</h3>
    <select id="flt" aria-label="Filter">${["all","pending","approved"].map(v=>`<option value="${v}"${v===filter?" selected":""}>${v[0].toUpperCase()+v.slice(1)}</option>`).join("")}</select></div>
    <details style="margin-top:12px;padding:0;background:none;border:0"><summary class="mb" style="display:inline-block">+ Add report manually</summary>
    <form id="addf" class="addf"><input name="name" placeholder="Member name" maxlength="40" required><input name="recovered" type="number" min="0" max="9999" step="1" placeholder="Recovered" required><input name="revenue" type="number" min="0" max="10000000" step="0.01" placeholder="Earnings" required><input name="date" type="date" max="${today}" value="${today}" required><span></span><button class="btn sm" type="submit">Add (approved)</button></form></details>
    <div class="tw" style="margin-top:12px"><table><thead><tr><th>ID</th><th>Member</th><th>Date</th><th>Recovered</th><th>Earnings</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="8">No reports yet.</td></tr>'}</tbody></table></div></div>`;
}
function chats(){
  const rows=D.chats.map(c=>`<tr><td><code>${esc(c.sid)}</code></td><td>${esc(c.name)}</td><td>${badge(c.status)}</td><td>${esc(c.agents.join(", ")||"-")}</td><td>${when(c.updated_at)}</td><td><button class="mb" data-a="chat" data-sid="${esc(c.sid)}" type="button">View</button>${c.status!=="ended"?`<button class="mb r" data-a="close" data-sid="${esc(c.sid)}" type="button">Close</button>`:""}</td></tr>`).join("");
  const tr=chatSid?`<div class="tr" aria-label="Transcript">${chatMsgs.map(m=>`<div class="${m.sender==="agent"?"a":m.sender==="sys"?"s":""}"><b>${esc(m.sender==="user"?"Customer":m.sender==="agent"?(m.author||"Agent"):"System")}</b> · ${esc(when(m.created_at))}<br>${esc(m.body)}</div>`).join("")||"<div class=s>No messages.</div>"}</div>`:"";
  return `<div class="sec" style="margin-top:20px"><h3>Customer chats</h3><div class="tw"><table><thead><tr><th>Session</th><th>Customer</th><th>Status</th><th>Agents</th><th>Updated</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6">No chats yet.</td></tr>'}</tbody></table></div>${tr}</div>`;
}
function audit(){
  const rows=D.audit.map(a=>`<tr><td>${esc(when(a.at))}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="w">${esc(JSON.stringify(a.detail||{}))}</td></tr>`).join("");
  return `<div class="sec" style="margin-top:20px"><h3>Audit log</h3><div class="tw"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Nothing yet.</td></tr>'}</tbody></table></div></div>`;
}
function render(){
  if(!D)return;
  const v=$("#view"),keep=document.activeElement&&document.activeElement.id==="flt";
  v.innerHTML=(note?`<p class="msgok" role="status" style="margin-top:14px">${esc(note)}</p>`:"")+({overview,reports,chats,audit}[tab])();
  if(keep){const f=$("#flt");if(f)f.focus()}
}

$("#tabs").addEventListener("click",e=>{const b=e.target.closest("[data-t]");if(!b)return;tab=b.dataset.t;note="";document.querySelectorAll("#tabs button").forEach(x=>x.classList.toggle("on",x===b));render()});
$("#view").addEventListener("change",e=>{if(e.target.id==="flt"){filter=e.target.value;refresh()}});
$("#view").addEventListener("submit",async e=>{
  if(e.target.id!=="addf")return;e.preventDefault();
  const f=new FormData(e.target);
  await act({type:"add",name:f.get("name"),recovered:f.get("recovered"),revenue:f.get("revenue"),date:f.get("date")},"Report added and published.");
});
$("#view").addEventListener("click",async e=>{
  const b=e.target.closest("[data-a]");if(!b)return;const a=b.dataset.a,id=b.dataset.id,sid=b.dataset.sid;b.disabled=true;
  if(a==="approve")await act({type:"approve",id},"Report approved.");
  else if(a==="reject"){if(confirm("Reject and remove this report?"))await act({type:"reject",id},"Report rejected.");else b.disabled=false}
  else if(a==="delete"){if(confirm("Delete this report permanently? It will disappear from the website."))await act({type:"delete",id},"Report deleted.");else b.disabled=false}
  else if(a==="close"){if(confirm("Close this chat? The customer goes back to the AI assistant."))await act({type:"close_chat",sid},"Chat closed.");else b.disabled=false}
  else if(a==="chat"){const r=await call("chat?sid="+encodeURIComponent(sid));if(r.ok){chatSid=sid;chatMsgs=r.j.messages||[];note="";render()}else b.disabled=false}
  else if(a==="webhook"){const r=await act({type:"webhook"});note=r.j.ok?"Telegram bot connected (webhook, commands and name set).":"Could not connect: "+(r.j.error||"check BOT_TOKEN and WEBHOOK_SECRET");render()}
  else if(a==="testai"){const r=await call("act",{type:"test_ai"});note=(r.j.ok?"✅ ":"❌ ")+(r.j.detail||"No response.");render()}
});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&D){if(Date.now()-last>idleMs){call("logout",{});lock();err("Signed out after "+Math.round(idleMs/6e4)+" minutes of inactivity.")}else refresh(true)}});
show("#login",false);enter();
})();
