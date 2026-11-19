"use strict";
/* CHDS admin dashboard — core (API client, UI kit, router, auth). Views live in admin-views.js.
   Every permission is enforced by the API; this file only hides what the API would refuse anyway. */
window.ADM=(()=>{
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const h=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const I=(n,c)=>window.CHDSIcon(n,c);
const money=n=>n===null||n===undefined||n===""?"—":"₱"+Number(n).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
const moneyS=n=>n===null||n===undefined?"—":"₱"+Number(n).toLocaleString("en-PH",{maximumFractionDigits:0});
const num=n=>n===null||n===undefined?"—":Number(n).toLocaleString("en-PH");
const when=t=>t?new Date(t).toLocaleString("en-PH",{timeZone:"Asia/Manila",year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"—";
const day=t=>t?new Date(String(t).length===10?t+"T00:00:00+08:00":t).toLocaleDateString("en-PH",{timeZone:"Asia/Manila",year:"numeric",month:"short",day:"numeric"}):"—";
const dur=s=>s===null||s===undefined||!Number.isFinite(+s)?"—":s<0?"—":s<60?Math.round(s)+"s":s<3600?Math.round(s/60)+" min":s<86400?(s/3600).toFixed(1)+" h":(s/86400).toFixed(1)+" d";
const ago=t=>{if(!t)return"—";const s=(Date.now()-Date.parse(t))/1e3;return s<60?"just now":s<3600?Math.floor(s/60)+"m ago":s<86400?Math.floor(s/3600)+"h ago":Math.floor(s/86400)+"d ago"};
const ini=s=>String(s||"?").split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
const phToday=()=>new Date(Date.now()+8*36e5).toISOString().slice(0,10);
const BD={active:"ok",approved:"ok",actual:"ok",resolved:"ok",verified:"ok",published:"ok",sent:"ok",live:"ok",completed:"ok",
  pending:"wa",reviewed:"in",projected:"in",waiting:"wa",awaiting_confirmation:"wa",assigned:"in",in_progress:"in",waiting_customer:"wa",handoff:"wa",draft:"",wait:"wa",running:"in",
  rejected:"no",suspended:"wa",banned:"no",blocked:"no",cancelled:"no",failed:"no",closed:"no",ended:"",archived:"",inactive:"wa",removed:"no",
  changes_requested:"wa",unpublished:"",urgent:"no",high:"wa",normal:"",low:"",unread:"in"};
const LABEL={waiting:"Waiting for Agent",assigned:"Assigned",in_progress:"In Progress",waiting_customer:"Waiting for Customer",awaiting_confirmation:"Awaiting confirmation",handoff:"With human",
  ended:"Ended (back to AI)",closed:"Closed · locked",changes_requested:"Corrections requested"};
const badge=s=>`<span class="bd ${BD[s]??""}">${h(LABEL[s]||String(s||"—").replace(/_/g," "))}</span>`;

let ME=null,route="",timers=[],globalTimers=[],idleMs=600000,last=Date.now(),pingAt=0,badgeN=0,lastWaiting=null;

/* ---------------- API ---------------- */
async function api(op,body,o={}){
  const opt={credentials:"same-origin",cache:"no-store",headers:{}};
  if(body!==undefined){opt.method="POST";opt.headers["Content-Type"]="application/json";opt.headers["X-CHDS-Admin"]="1";opt.body=JSON.stringify(body)}
  let r;try{r=await fetch("/api/admin/"+op,opt)}catch{return{ok:false,status:0,j:{error:"network",message:"Network error. Check your connection."}}}
  let j={};try{j=await r.json()}catch(e){console.warn("Non-JSON response from",op,r.status)}
  if(r.status===401&&!/^(login|otp|reauth)/.test(op)){const was=!!ME;lock();if(was)lerr("Your session ended (inactivity, sign-out elsewhere or access change). Please sign in again.");return{ok:false,status:401,j}}
  if(r.status===428&&!o.noReauth){const ok=await reauth();if(ok)return api(op,body,{...o,noReauth:true});return{ok:false,status:428,j:{error:"reauth_cancelled",message:"Password confirmation was cancelled. Nothing was changed."}}}
  return{ok:r.ok,status:r.status,j};
}
const errText=r=>r.j&&r.j.message?r.j.message:{0:"Network error.",403:"Your role does not include this permission.",404:"Not found.",409:"This was already changed by someone else.",423:"Locked by Emergency Control.",429:"Too many requests. Please wait a moment.",503:"A required service is not configured or the database is not migrated."}[r.status]||`Request failed (${r.j&&r.j.error||r.status}).`;
async function download(op,params){
  const r=await fetch("/api/admin/"+op+"?"+new URLSearchParams(params),{credentials:"same-origin",cache:"no-store"});
  if(!r.ok){let j={};try{j=await r.json()}catch(e){console.warn("Non-JSON error from",op,r.status)}toast(errText({status:r.status,j}),"err");return}
  const b=await r.blob(),cd=r.headers.get("content-disposition")||"",m=/filename="([^"]+)"/.exec(cd),a=document.createElement("a");
  a.href=URL.createObjectURL(b);a.download=m?m[1]:"export.csv";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);toast("Export downloaded.","ok");
}

/* ---------------- UI kit ---------------- */
function toast(msg,kind="info"){const d=document.createElement("div");d.className="toast "+kind;d.setAttribute("role",kind==="err"?"alert":"status");d.innerHTML=I(kind==="ok"?"circle-check":kind==="err"?"alert-triangle":"info")+`<span>${h(msg)}</span>`;$("#toasts").appendChild(d);setTimeout(()=>d.remove(),kind==="err"?7000:4000)}
const loading=(n=4)=>`<div class="card" aria-busy="true" aria-label="Loading">${'<div class="skel"></div>'.repeat(n)}</div>`;
const empty=(t,icon="inbox")=>`<div class="state">${I(icon)}<span>${h(t)}</span></div>`;
const errorBox=(t)=>`<div class="state err" role="alert">${I("alert-triangle")}<span>${h(t)}</span><button class="btn ghost sm" type="button" data-retry>${I("refresh")} Try again</button></div>`;
function page(title,icon,desc,actions=""){return`<div class="phd"><div><h1>${I(icon)} ${h(title)}</h1>${desc?`<p>${desc}</p>`:""}</div><div class="acts">${actions}</div></div>`}
function kpis(list){return`<div class="kpis">${list.filter(Boolean).map(k=>`<div class="kpi"><span>${I(k.i||"activity")} ${h(k.l)}</span><b>${k.v}</b>${k.s?`<small>${k.s}</small>`:""}</div>`).join("")}</div>`}
// cols: [{l:label, f:row=>html, c:"num"|"wide"}]
function table(cols,rows,{click,emptyText="No records match these filters."}={}){
  if(!rows||!rows.length)return`<div class="tw">${empty(emptyText)}</div>`;
  // data-row is ALWAYS set: row-action buttons (Edit/Delete/Revoke/Publish…) resolve their record through it, also in lists without row click.
  return`<div class="tw"><table class="rt"><thead><tr>${cols.map(c=>`<th class="${c.c||""}" scope="col">${h(c.l)}</th>`).join("")}</tr></thead><tbody>${rows.map((r,i)=>`<tr data-row="${i}"${click?` class="click" tabindex="0"`:""}>${cols.map(c=>`<td class="${c.c||""}" data-label="${h(c.l)}">${c.f(r)??""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function pager(total,offset,limit){if(total<=limit&&!offset)return"";const a=offset+1,b=Math.min(total,offset+limit);
  return`<div class="pager"><span>${num(a)}–${num(b)} of ${num(total)}</span><button class="btn ghost sm" type="button" data-pg="${Math.max(0,offset-limit)}" ${offset?"":"disabled"} aria-label="Previous page">${I("chevron-left")}</button><button class="btn ghost sm" type="button" data-pg="${offset+limit}" ${b<total?"":"disabled"} aria-label="Next page">${I("chevron-right")}</button></div>`}
function dlg(html,{drawer=false,label="Dialog"}={}){
  const d=document.createElement("dialog");if(drawer)d.className="drawer";d.setAttribute("aria-label",label);d.innerHTML=html;document.body.appendChild(d);
  d.addEventListener("close",()=>d.remove());d.addEventListener("click",e=>{if(e.target===d)d.close()});d.showModal();return d;
}
// Confirmation with optional required reason. Resolves {reason} or null.
function confirmAct({title,text,confirm="Confirm",danger=false,reason=false,reasonLabel="Reason",typed=null}){
  return new Promise(res=>{
    const d=dlg(`<form method="dialog" novalidate><h2>${h(title)}</h2><p class="small" style="font-size:13.5px">${text||""}</p>
      ${reason?`<div class="fld"><label for="cr">${h(reasonLabel)} (required)</label><textarea id="cr" maxlength="500" required></textarea></div>`:""}
      ${typed?`<div class="fld"><label for="ct">Type <b>${h(typed)}</b> to confirm</label><input id="ct" autocomplete="off"></div>`:""}
      <div class="ferr" role="alert"></div><div class="dacts"><button class="btn ghost" value="cancel" type="button" data-c>Cancel</button><button class="btn ${danger?"danger":""}" type="submit">${h(confirm)}</button></div></form>`,{label:title});
    let done=false;const fin=v=>{if(!done){done=true;res(v)}};
    $("[data-c]",d).onclick=()=>{d.close();fin(null)};d.addEventListener("close",()=>fin(null));
    $("form",d).addEventListener("submit",e=>{e.preventDefault();
      const rs=reason?$("#cr",d).value.trim():"";
      if(reason&&rs.length<3){$(".ferr",d).textContent="Please give a reason (at least 3 characters).";$("#cr",d).focus();return}
      if(typed&&$("#ct",d).value.trim()!==typed){$(".ferr",d).textContent=`Type ${typed} exactly to confirm.`;return}
      fin({reason:rs});d.close()});
    setTimeout(()=>{const f=$("textarea,input",d)||$("[type=submit]",d);f&&f.focus()},30);
  });
}
// fields: [{n,l,t:"text|number|date|datetime-local|select|textarea|checkbox|password|file|perms|multiselect",o:[[v,label]],v,req,h,min,max,step,ml,accept,wide}]
function field(f){
  const id="f_"+f.n,req=f.req?" required":"",v=f.v??"";
  let inp;
  if(f.t==="select")inp=`<select id="${id}" name="${f.n}"${req}>${(f.o||[]).map(([k,l])=>`<option value="${h(k)}"${String(k)===String(v)?" selected":""}>${h(l)}</option>`).join("")}</select>`;
  else if(f.t==="textarea")inp=`<textarea id="${id}" name="${f.n}" maxlength="${f.ml||2000}"${req}>${h(v)}</textarea>`;
  else if(f.t==="checkbox")return`<label class="fld" style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="${id}" name="${f.n}"${v?" checked":""}> ${h(f.l)}</label>${f.h?`<div class="hint">${f.h}</div>`:""}`;
  else if(f.t==="perms"||f.t==="multiselect")return`<div class="fld"><span style="font-size:12.5px;font-weight:600;color:var(--ink2)">${h(f.l)}</span><div class="perms" data-multi="${f.n}">${(f.o||[]).map(([k,l,dsc,dis])=>`<label><input type="checkbox" value="${h(k)}"${(v||[]).includes(k)?" checked":""}${dis?" disabled":""}><span>${h(l)}${dsc?`<small>${h(dsc)}</small>`:""}</span></label>`).join("")}</div>${f.h?`<div class="hint">${f.h}</div>`:""}</div>`;
  else inp=`<input id="${id}" name="${f.n}" type="${f.t||"text"}" value="${f.t==="file"||f.t==="password"?"":h(v)}"${f.min!==undefined?` min="${f.min}"`:""}${f.max!==undefined?` max="${f.max}"`:""}${f.step?` step="${f.step}"`:""}${f.ml?` maxlength="${f.ml}"`:""}${f.accept?` accept="${f.accept}"`:""}${f.t==="password"?' autocomplete="new-password"':""}${req}>`;
  return`<div class="fld"><label for="${id}">${h(f.l)}${f.req?" *":""}</label>${inp}${f.h?`<div class="hint">${f.h}</div>`:""}</div>`;
}
function formDlg({title,fields,submit="Save",intro="",onSubmit,drawer=false}){
  const d=dlg(`<form novalidate><h2>${h(title)}</h2>${intro?`<p class="small" style="font-size:13.5px">${intro}</p>`:""}${fields.map(f=>Array.isArray(f)?`<div class="row2">${f.map(field).join("")}</div>`:field(f)).join("")}
    <div class="ferr" role="alert"></div><div class="dacts"><button class="btn ghost" type="button" data-c>Cancel</button><button class="btn" type="submit">${h(submit)}</button></div></form>`,{drawer,label:title});
  $("[data-c]",d).onclick=()=>d.close();
  const flat=fields.flat();
  $("form",d).addEventListener("submit",async e=>{
    e.preventDefault();const vals={},er=$(".ferr",d);er.textContent="";
    for(const f of flat){
      if(f.t==="perms"||f.t==="multiselect"){vals[f.n]=$$(`[data-multi="${f.n}"] input:checked`,d).map(x=>x.value);continue}
      const el=$("#f_"+f.n,d);if(!el)continue;
      if(f.t==="checkbox")vals[f.n]=el.checked;
      else if(f.t==="file"){const fl=el.files[0];if(fl){try{vals[f.n]=await readFile(fl,f)}catch(x){er.textContent=x.message;return}}}
      else vals[f.n]=el.value.trim();
      if(f.req&&f.t!=="checkbox"&&!vals[f.n]){er.textContent=`${f.l} is required.`;el.focus();return}
    }
    const b=$("[type=submit]",d);b.disabled=true;const old=b.textContent;b.textContent="Saving…";
    const out=await onSubmit(vals);
    b.disabled=false;b.textContent=old;
    if(out===true){d.close();return}er.textContent=out||"Could not save.";
  });
  setTimeout(()=>{const f=$("input:not([type=checkbox]),select,textarea",d);f&&f.focus()},30);
  return d;
}
// Files: images are resized/re-encoded in the browser; PDFs are sent as-is. The server re-validates the bytes.
function readFile(file,f){return new Promise((res,rej)=>{
  const max=f.maxBytes||3*1048576;
  if(file.type==="application/pdf"){if(file.size>max)return rej(new Error("PDF is larger than "+Math.round(max/1048576)+" MB."));const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error("File could not be read."));r.readAsDataURL(file);return}
  if(!/^image\/(jpeg|png|webp)$/.test(file.type))return rej(new Error("Use a JPG, PNG or WebP image"+(f.accept&&f.accept.includes("pdf")?", or a PDF.":".")));
  if(file.size>20e6)return rej(new Error("Image is too large (max 20 MB before compression)."));
  const u=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{const k=Math.min(1,(f.px||1600)/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext("2d").drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);
    const out=c.toDataURL("image/jpeg",.85);if(out.length*0.75>max)return rej(new Error("Image is still too large after compression."));res(out)};
  im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("Image could not be read."))};im.src=u;
})}
function reauth(){return new Promise(res=>{
  const d=dlg(`<form novalidate><h2>${I("lock")} Confirm your password</h2><p class="small" style="font-size:13.5px">This is a sensitive action. Confirm your password to continue (valid for 10 minutes).</p><div class="fld"><label for="ra">Password</label><input id="ra" type="password" autocomplete="current-password" required></div><div class="ferr" role="alert"></div><div class="dacts"><button class="btn ghost" type="button" data-c>Cancel</button><button class="btn" type="submit">Confirm</button></div></form>`,{label:"Confirm password"});
  let done=false;const fin=v=>{if(!done){done=true;res(v)}};
  $("[data-c]",d).onclick=()=>{d.close();fin(false)};d.addEventListener("close",()=>fin(false));
  $("form",d).addEventListener("submit",async e=>{e.preventDefault();const b=$("[type=submit]",d);b.disabled=true;
    const r=await api("reauth",{password:$("#ra",d).value},{noReauth:true});b.disabled=false;
    if(r.ok){fin(true);d.close();return}
    $(".ferr",d).textContent=r.status===429?`Too many attempts. Try again in ${Math.ceil((r.j.retry_after||60)/60)} min.`:errText(r);$("#ra",d).value="";$("#ra",d).focus()});
  setTimeout(()=>$("#ra",d).focus(),30);
})}

/* ---------------- charts (SVG, no libraries) ---------------- */
const COLORS=["#3B82F6","#22C55E","#F59E0B","#38BDF8","#A78BFA","#EF4444"];
function chart({labels,series,type="bar",fmt=num,height=240,title="Chart"}){
  if(!labels.length)return empty("No data for this period.","bar-chart");
  const W=760,H=height,L=64,R=12,T=14,B=34,n=labels.length,all=series.flatMap(s=>s.values.map(Number));
  const m=Math.max(0,...all),e=10**Math.floor(Math.log10(m||1)),mx=m?Math.ceil(m/e*1.1*2)/2*e:1;
  const X=i=>L+(n===1?(W-L-R)/2:i*(W-L-R)/(n-1)),Y=v=>H-B-v/mx*(H-T-B),bw=Math.max(2,Math.min(28,(W-L-R)/n/series.length*.7));
  let g="";for(let k=0;k<=4;k++){const y=Y(mx*k/4);g+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#22314A"/><text x="${L-8}" y="${y+4}" text-anchor="end" fill="#A5B4C7" font-size="11">${h(fmt(mx*k/4))}</text>`}
  const step=Math.max(1,Math.ceil(n/8));
  const xl=labels.map((l,i)=>i%step===0||i===n-1?`<text x="${type==="bar"?L+(i+.5)*(W-L-R)/n:X(i)}" y="${H-10}" text-anchor="middle" fill="#A5B4C7" font-size="11">${h(l)}</text>`:"").join("");
  let body="";
  series.forEach((s,si)=>{const c=s.color||COLORS[si%COLORS.length];
    if(type==="bar")s.values.forEach((v,i)=>{const cx=L+(i+.5)*(W-L-R)/n,x=cx-bw*series.length/2+si*bw,y=Y(Number(v)||0);body+=`<rect x="${x}" y="${y}" width="${bw-1}" height="${Math.max(0,H-B-y)}" rx="2" fill="${c}"><title>${h(labels[i])} · ${h(s.name)}: ${h(fmt(v))}</title></rect>`});
    else{const pts=s.values.map((v,i)=>`${X(i)},${Y(Number(v)||0)}`).join(" ");body+=`<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`+s.values.map((v,i)=>`<circle cx="${X(i)}" cy="${Y(Number(v)||0)}" r="3" fill="${c}"><title>${h(labels[i])} · ${h(s.name)}: ${h(fmt(v))}</title></circle>`).join("")}});
  const legend=series.length>1?`<div class="legend">${series.map((s,i)=>`<span><i style="background:${s.color||COLORS[i%COLORS.length]}"></i>${h(s.name)}</span>`).join("")}</div>`:"";
  const data=`<details class="data"><summary>Show data table</summary><div class="tw" style="margin-top:6px"><table><thead><tr><th>Period</th>${series.map(s=>`<th class="num">${h(s.name)}</th>`).join("")}</tr></thead><tbody>${labels.map((l,i)=>`<tr><td>${h(l)}</td>${series.map(s=>`<td class="num">${h(fmt(s.values[i]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  return`<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(title)}">${g}${body}${xl}</svg>${legend}${data}</div>`;
}

/* ---------------- navigation & router ---------------- */
const NAV=[
  ["", [["overview","Overview","layout-dashboard",null]]],
  ["People",[["users","User Management","users","manage_users"],["team","Team Management","user-plus","manage_team"],["roles","Roles & Permissions","key-round","manage_roles"],["sessions","Session Manager","monitor-smartphone","manage_security"]]],
  ["AI Support",[["ai-users","AI Support Users","user","view_ai_conversations"],["ai-conversations","AI Conversations","message-square","view_ai_conversations"],["ai-analytics","AI Resolution Analytics","pie-chart","view_ai_conversations"],["knowledge","AI Knowledge Base","book-open","manage_knowledge_base"],["handoffs","Human Handoff Queue","arrow-left-right",["manage_support","view_ai_conversations"]],["escalations","Escalation History","history",["manage_support","view_ai_conversations"]]]],
  ["Operations",[["support","Human Support","headset","manage_support"],["closed-cases","Closed Cases","lock","view_closed_cases"],["reports","Reports","file-text",["manage_reports","approve_reports"]],["revenue","Revenue","wallet","view_revenue"],["analytics","Revenue Analytics","bar-chart","view_revenue"],["performance","Live Team Performance","activity","view_revenue"],["announcements","Announcements","megaphone","manage_announcements"],["ops-analytics","Operations Analytics","activity",["manage_reports","approve_reports","manage_support","view_ai_conversations"]]]],
  ["Security & System",[["security","Security Center","shield","manage_security"],["audit","Audit Logs","scroll-text","view_audit_logs"],["emergency","Emergency Control","siren","manage_system"],["backups","Backup & Recovery","archive","manage_backups"],["health","System Health","heart-pulse","view_system_health"],["settings","System Settings","sliders","manage_settings"]]]
];
const can=p=>p===null||(Array.isArray(p)?p.some(x=>ME.perms.includes(x)):ME.perms.includes(p));
const has=p=>!!ME&&can(p);
function navHTML(){return NAV.map(([g,items])=>{const vis=items.filter(x=>can(x[3]));return vis.length?(g?`<h5>${h(g)}</h5>`:"")+vis.map(([id,l,ic])=>`<a href="#/${id}" data-nav="${id}">${I(ic)}<span>${h(l)}</span><span class="cnt" data-cnt="${id}" hidden></span></a>`).join(""):""}).join("")+`<h5>Account</h5><a href="#/profile" data-nav="profile">${I("user")}<span>My profile</span></a>`}
const titleOf=id=>{for(const[g,items]of NAV)for(const x of items)if(x[0]===id)return{group:g,label:x[1],icon:x[2],perm:x[3]};return id==="profile"?{group:"Account",label:"My profile",icon:"user",perm:null}:null};
function crumbs(extra){const t=titleOf(route)||{label:route};$("#crumbs").innerHTML=`<a href="#/overview">Dashboard</a>${t.group?I("chevron-right")+`<span>${h(t.group)}</span>`:""}${I("chevron-right")}${extra?`<a href="#/${route}">${h(t.label)}</a>${I("chevron-right")}<b>${h(extra)}</b>`:`<b>${h(t.label)}</b>`}`}
function every(fn,ms){const id=setInterval(()=>{if(!document.hidden)fn()},ms);timers.push(id);return id}
async function go(){
  timers.forEach(clearInterval);timers=[];
  document.querySelectorAll("dialog[open]").forEach(d=>d.close()); // a page change (link, Back button, notification link) never leaves a dialog of the old page on top
  const [id,...rest]=(location.hash.replace(/^#\/?/,"")||"overview").split("/");
  const t=titleOf(id);route=t&&can(t.perm)?id:"overview";
  $$("#snav a").forEach(a=>{const on=a.dataset.nav===route;a.classList.toggle("on",on);on?a.setAttribute("aria-current","page"):a.removeAttribute("aria-current")});
  closeSide();crumbs();setTitle();
  const el=$("#main");el.innerHTML=loading();
  const v=window.ADM.views[route];
  try{await v(el,rest.map(decodeURIComponent))}catch(e){console.error(e);el.innerHTML=errorBox("This page failed to load.");$("[data-retry]",el).onclick=go}
  el.focus({preventScroll:true});
}
addEventListener("hashchange",go);
const openSide=()=>{$("#side").classList.add("open");$("#scrim").hidden=false;$("#sopen").setAttribute("aria-expanded","true")},closeSide=()=>{$("#side").classList.remove("open");$("#scrim").hidden=true;$("#sopen").setAttribute("aria-expanded","false")};

/* ---------------- auth ---------------- */
let uid="";
const lerr=t=>{$("#lerr").textContent=t||""};
const setTitle=()=>{document.title=(badgeN?`(${badgeN}) `:"")+(titleOf(route)?.label||"Dashboard")+" · CHDS Admin"};
// Dashboard notifications: sidebar counters, bell indicator, title count, toast on new waiting requests.
async function badges(){
  const r=await api("badges?quiet=1");if(!r.ok)return;const b=r.j;
  $$("[data-cnt]").forEach(el=>{const v=b[el.dataset.cnt]||0;el.hidden=!v;el.textContent=v>99?"99+":String(v);el.setAttribute("aria-label",v+" pending")});
  const bell=$("#bell"),nb=(b.notifications||0);bell.dataset.count=String(nb);bell.setAttribute("aria-label",nb?`Notifications (${nb} unread)`:"Notifications and announcements");
  const sup=$('[data-cnt="support"]');if(sup&&b.my_cases){sup.hidden=false;sup.textContent=String(b.my_cases);sup.setAttribute("aria-label",b.my_cases+" of your open cases")}
  if(lastWaiting!==null&&(b.handoffs||0)>lastWaiting)toast(`New Human Support request waiting (${b.handoffs} in queue).`,"info");
  lastWaiting=b.handoffs===undefined?null:b.handoffs;badgeN=(b.handoffs||0)+(b.reports||0);setTitle();
}
function lock(){timers.forEach(clearInterval);timers=[];globalTimers.forEach(clearInterval);globalTimers=[];ME=null;lastWaiting=null;badgeN=0;$("#app").hidden=true;$("#login").hidden=false;$("#s1").hidden=false;$("#s2").hidden=true;lerr("");$$("dialog").forEach(d=>d.close())}
async function enter(){
  const r=await api("me");if(!r.ok){lock();return}
  ME=r.j;idleMs=ME.idle_ms||idleMs;last=Date.now();
  $("#login").hidden=true;$("#app").hidden=false;
  $("#snav").innerHTML=navHTML();$("#mename").textContent=ME.name;$("#merole").textContent=ME.role_name;$("#mav").textContent=ini(ME.name);
  flagbar(ME.flags);go();badges();
  globalTimers.push(setInterval(async()=>{if(document.hidden)return;const x=await api("me?quiet=1");if(x.ok){ME=x.j;flagbar(ME.flags)}},60000));
  globalTimers.push(setInterval(()=>{if(!document.hidden)badges()},30000));
}
function flagbar(f){const on=f?Object.entries(f).filter(([,v])=>v).map(([k])=>k.replace(/_/g," ")):[];const b=$("#flagbar");b.hidden=!on.length;b.innerHTML=on.length?I("siren")+`<span><b>Emergency Control active:</b> ${h(on.join(", "))}.${has("manage_system")?` <a href="#/emergency">Review</a>`:""}</span>`:""}
$("#s1").addEventListener("submit",async e=>{e.preventDefault();lerr("");uid=$("#uid").value.trim();
  if(!/^\d{1,20}$/.test(uid)){lerr("Enter your numeric Telegram user ID.");return}
  const b=$("#s1 button");b.disabled=true;const r=await api("login",{uid,password:$("#pw").value});$("#pw").value="";b.disabled=false;
  if(r.ok){$("#s1").hidden=true;$("#s2").hidden=false;$("#code").focus();return}
  lerr(r.status===429?(r.j.retry_after?`Too many failed attempts. Try again in ${Math.ceil(r.j.retry_after/60)} minute(s).`:"Too many attempts. Try again in 15 minutes."):r.status===503?(r.j.error==="db_not_migrated"?"Database is not migrated: run supabase.sql (see docs/DEPLOYMENT.md).":"Sign-in is not configured or temporarily unavailable."):r.status===502?"Could not send the code. Open the bot in Telegram, press /start, then try again.":"Something went wrong. Please try again.")});
$("#s2").addEventListener("submit",async e=>{e.preventDefault();lerr("");const b=$("#s2 button");b.disabled=true;
  const r=await api("otp",{uid,code:$("#code").value.trim()});$("#code").value="";b.disabled=false;
  if(r.ok){await enter();return}
  lerr(r.status===429?`Too many attempts. Try again in ${Math.ceil((r.j.retry_after||900)/60)} minute(s).`:"Invalid or expired code. Start over to get a new one.");if(r.status!==429){$("#s2").hidden=true;$("#s1").hidden=false}});
$("#back").onclick=()=>{$("#s2").hidden=true;$("#s1").hidden=false;lerr("")};
$("#out").onclick=async()=>{await api("logout",{});lock()};
$("#outall").onclick=async()=>{const c=await confirmAct({title:"Sign out everywhere?",text:"All of your dashboard sessions on every device will end.",confirm:"Sign out everywhere",danger:true});if(c){await api("logout",{all:true});lock()}};
$("#mebtn").onclick=e=>{e.stopPropagation();const m=$("#memenu");m.hidden=!m.hidden;$("#mebtn").setAttribute("aria-expanded",String(!m.hidden))};
document.addEventListener("click",()=>{$("#memenu").hidden=true;$("#mebtn").setAttribute("aria-expanded","false")});
$("#sopen").innerHTML=I("menu");$("#sclose").innerHTML=I("x");$("#bell").innerHTML=I("bell");$("#site").innerHTML=I("external-link");
$("#sopen").onclick=openSide;$("#sclose").onclick=closeSide;$("#scrim").onclick=closeSide;
// Notification center: own notifications (unread first, mark read) + current announcements.
$("#bell").onclick=async()=>{
  const [n,a]=await Promise.all([api("notif_list?limit=40"),api("my_announcements")]);
  if(!n.ok){toast(errText(n),"err");return}
  const rows=n.j.rows||[],ann=a.ok?a.j.rows:[];
  const d=dlg(`<div class="db"><div class="dh"><h2>Notifications${n.j.unread?` <span class="bd in">${num(n.j.unread)} unread</span>`:""}</h2><button class="ibtn" type="button" data-c aria-label="Close">${I("x")}</button></div>
    <div class="acts" style="margin-bottom:10px">${n.j.unread?`<button class="btn ghost sm" type="button" data-all>${I("check")} Mark all as read</button>`:""}</div>
    ${rows.length?`<div class="nlist">${rows.map(x=>`<div class="card nitem${x.read_at?"":" unread"}" data-id="${x.id}"><h3>${x.read_at?"":`<span class="bd in">new</span> `}${h(x.title)}</h3>${x.body?`<p class="small" style="margin:4px 0">${h(x.body)}</p>`:""}<p class="small">${when(x.created_at)}${x.link?` · <a href="${h(x.link)}" data-go="${x.id}">Open</a>`:""}${x.read_at?"":` · <button class="linkbtn" type="button" data-read="${x.id}">Mark read</button>`}</p></div>`).join("")}</div>`:empty("No notifications yet.","bell")}
    <h3 style="margin:18px 0 8px">${I("megaphone")} Announcements</h3>${ann.length?ann.map(x=>`<div class="card"><h3>${badge(x.priority)} ${h(x.title)}</h3><p style="white-space:pre-wrap;margin:0">${h(x.message)}</p><p class="small">${when(x.publish_at)}</p></div>`).join(""):empty("No announcements for you right now.","bell")}</div>`,{drawer:true,label:"Notifications"});
  $("[data-c]",d).onclick=()=>d.close();
  const read=async ids=>{const r=await api("notif_read",ids==="all"?{all:true}:{ids});if(!r.ok){toast(errText(r),"err");return false}badges();return true};
  const all=$("[data-all]",d);if(all)all.onclick=async()=>{if(await read("all")){d.close();toast("All notifications marked as read.","ok")}};
  $$("[data-read]",d).forEach(b=>b.onclick=async()=>{if(await read([+b.dataset.read])){const c=b.closest(".nitem");c.classList.remove("unread");c.querySelector(".bd")?.remove();b.remove()}});
  $$("[data-go]",d).forEach(l=>l.addEventListener("click",()=>{read([+l.dataset.go]);d.close()}));
};
const bump=()=>{last=Date.now();if(ME&&Date.now()-pingAt>60000){pingAt=Date.now();api("ping")}};
["pointerdown","keydown","touchstart","scroll"].forEach(ev=>addEventListener(ev,bump,{passive:true}));
setInterval(async()=>{if(ME&&Date.now()-last>idleMs){await api("logout",{});lock();lerr("Signed out after "+Math.round(idleMs/6e4)+" minutes of inactivity.")}},10000);
addEventListener("keydown",e=>{if(e.key==="Escape")closeSide()});
// boot: valid session cookie → straight to the dashboard
(async()=>{const r=await fetch("/api/admin/me",{credentials:"same-origin",cache:"no-store"}).catch(e=>{console.warn("Session check failed",e);return null});if(r&&r.ok)enter();else lock()})();

return{badges,$,$$,h,I,money,moneyS,num,when,day,dur,ago,ini,badge,phToday,api,errText,download,toast,loading,empty,errorBox,page,kpis,table,pager,dlg,confirmAct,formDlg,chart,every,crumbs,has,go,me:()=>ME,views:{}};
})();
