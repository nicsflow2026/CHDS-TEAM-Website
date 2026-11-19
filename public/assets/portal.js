"use strict";
/* CHDS private report portal. Every rule here is mirrored and ENFORCED by /api/portal (ownership, status
   eligibility, dates, permissions); the page only gives fast feedback. */
(()=>{
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const I=n=>window.CHDSIcon(n);window.hydrateIcons();
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const day=d=>d?new Date(d+"T00:00:00+08:00").toLocaleDateString("en-PH",{timeZone:"Asia/Manila",year:"numeric",month:"short",day:"numeric"}):"—";
const when=t=>t?new Date(t).toLocaleString("en-PH",{timeZone:"Asia/Manila",year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"—";
const peso=n=>"₱"+Number(n||0).toLocaleString("en-PH",{maximumFractionDigits:2});
const addDays=(s,n)=>{const d=new Date(s+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const CHIP={pending:"wa",reviewed:"",approved:"ok",rejected:"no",changes_requested:"wa"};
let ME=null,uid="";
async function api(path,body){
  const o={credentials:"same-origin",cache:"no-store",headers:{}};
  if(body!==undefined){o.method="POST";o.headers["Content-Type"]="application/json";o.headers["X-CHDS-Portal"]="1";o.body=JSON.stringify(body)}
  let r;try{r=await fetch("/api/portal/"+path,o)}catch{return{ok:false,status:0,j:{message:"Network error. Check your connection and try again."}}}
  let j={};try{j=await r.json()}catch(e){console.warn("non-JSON",path,r.status)}
  if(r.status===401&&!/^(start|verify)/.test(path)&&ME){ME=null;showAuth("Your session ended. Please sign in again.");}
  return{ok:r.ok,status:r.status,j};
}
const errText=r=>r.j&&r.j.message?r.j.message:{0:"Network error.",403:"Not allowed.",404:"Not found.",409:"This was changed meanwhile. Reload and try again.",423:"Temporarily disabled by an administrator.",429:"Too many requests. Please wait a moment."}[r.status]||"Something went wrong. Please try again.";
const notice=(el,msg,kind)=>{el.className=kind==="ok"?"fok":"ferr";el.textContent=msg||""};

/* ---------------- sign-in ---------------- */
function showAuth(msg){$("#app").hidden=true;$("#lo").hidden=true;$("#auth").hidden=false;$("#ps1").hidden=false;$("#ps2").hidden=true;notice($("#perr"),msg||"");setTimeout(()=>$("#puid").focus(),30)}
$("#ps1").addEventListener("submit",async e=>{e.preventDefault();uid=$("#puid").value.trim();
  if(!/^\d{1,20}$/.test(uid)){notice($("#perr"),"Enter your numeric Telegram user ID.");$("#puid").focus();return}
  const b=$("#ps1 button");b.disabled=true;b.textContent="Sending…";const r=await api("start",{uid});b.disabled=false;b.textContent="Send me a code";
  if(!r.ok){notice($("#perr"),r.status===429?"Too many attempts. Please wait a few minutes.":errText(r));return}
  notice($("#perr"),"");$("#ps2-msg").textContent=r.j.message;$("#ps1").hidden=true;$("#ps2").hidden=false;$("#pcode").focus()});
$("#ps2").addEventListener("submit",async e=>{e.preventDefault();const code=$("#pcode").value.trim();
  if(!/^\d{6}$/.test(code)){notice($("#perr"),"Enter the 6-digit code.");return}
  const b=$("#ps2 button[type=submit]");b.disabled=true;const r=await api("verify",{uid,code});b.disabled=false;$("#pcode").value="";
  if(r.ok){notice($("#perr"),"");return boot()}
  notice($("#perr"),r.status===429?"Too many attempts. Please wait and start over.":"Invalid or expired code. Start over to get a new one.")});
$("#pback").onclick=()=>showAuth("");
$("#lo").onclick=async()=>{await api("logout",{});ME=null;showAuth("You signed out.")};

/* ---------------- tabs ---------------- */
function tab(name){const n=name==="mine"?"mine":"new";
  $("#t-new").setAttribute("aria-selected",String(n==="new"));$("#t-mine").setAttribute("aria-selected",String(n==="mine"));
  $("#tab-new").hidden=n!=="new";$("#tab-mine").hidden=n!=="mine";if(location.hash!=="#"+n)history.replaceState(null,"","#"+n);
  if(n==="mine")mine.load(true);else newForm();}
$("#t-new").onclick=()=>tab("new");$("#t-mine").onclick=()=>tab("mine");
$$("[role=tab]").forEach(t=>t.addEventListener("keydown",e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){const o=t.id==="t-new"?$("#t-mine"):$("#t-new");o.focus();o.click()}}));

/* ---------------- report form (new + edit) ---------------- */
const cats=()=>ME.categories;
const maxDate=cat=>{const c=cats().find(x=>x.id===cat);return addDays(ME.today,c?c.future_days:0)};
function formHTML(r,isEdit){
  const v=r||{},opt=cats().map(c=>`<option value="${esc(c.id)}"${(v.category||"account_recovery")===c.id?" selected":""}>${esc(c.label)}</option>`).join("");
  return`<form class="pform" id="rf" novalidate>
  ${isEdit&&(v.status==="approved"||v.published)?`<div class="feedback" role="note">${I("alert-triangle")} Editing this ${v.published?"published":"approved"} report sends it back to review${v.published?" and removes it from the public feed until it is approved and published again":""}.</div>`:""}
  <div><label for="r_title">Report title *</label><input id="r_title" name="title" maxlength="120" required value="${esc(v.title||"")}"></div>
  <div class="row2"><div><label for="r_cat">Report category *</label><select id="r_cat" name="category">${opt}</select></div>
    <div><label for="r_date">Activity date *</label><input id="r_date" name="report_date" type="date" min="2020-01-01" required value="${esc(v.activity_date||ME.today)}"><div class="hint" id="r_date_h"></div></div></div>
  <div><label for="r_desc">Report description *</label><textarea id="r_desc" name="description" maxlength="4000" required>${esc(v.description||"")}</textarea><div class="hint">What happened and what was done (at least 10 characters).</div></div>
  <div><label for="r_acc">Relevant account or case information</label><textarea id="r_acc" name="account_info" maxlength="2000">${esc(v.account_info||"")}</textarea><div class="hint">Private: only you and authorized CHDS staff can see it. Never include passwords, login codes or cookies.</div></div>
  <div class="row2"><div><label for="r_rec">Recovered accounts</label><input id="r_rec" name="recovered" type="number" min="0" max="9999" step="1" value="${esc(v.recovered??0)}"></div>
    <div><label for="r_rev">Earnings (PHP)</label><input id="r_rev" name="revenue" type="number" min="0" max="10000000" step="0.01" value="${esc(v.revenue??0)}"></div></div>
  <div><label for="r_add">Additional information</label><textarea id="r_add" name="additional_info" maxlength="2000">${esc(v.additional_info||"")}</textarea></div>
  ${isEdit?"":`<div><label for="r_ev">Supporting evidence (optional)</label><input id="r_ev" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><div class="hint">JPG, PNG, WebP or PDF, up to 3 MB. Stored privately.</div></div>`}
  <label style="display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--ink2)"><input type="checkbox" id="r_ok" style="width:auto;min-height:0;margin-top:4px"> <span>I confirm this information is accurate and I did not include passwords, one-time codes or other credentials.</span></label>
  <div class="ferr" id="rf_err" role="alert"></div>
  <div class="acts"><button class="btn" type="submit">${isEdit?"Save changes":"Submit report"}</button>${isEdit?`<button class="btn ghost" type="button" data-cancel>Cancel</button>`:""}</div></form>`;
}
function bindDate(f){const c=$("#r_cat",f),d=$("#r_date",f),h=$("#r_date_h",f);
  const upd=()=>{const cat=cats().find(x=>x.id===c.value);d.max=maxDate(c.value);h.textContent=cat&&cat.future_days?`Planned activity allowed up to ${cat.future_days} days ahead.`:"Must be today or earlier (Philippine time)."};c.addEventListener("change",upd);upd()}
function readForm(f){const o={};for(const el of $$("input[name],select[name],textarea[name]",f))o[el.name]=el.value.trim();return o}
function check(o){
  $$(".fld-err",$("#rf").parentElement).forEach(x=>x.classList.remove("fld-err"));
  // mark only the field's own wrapper (the confirmation checkbox sits in a <label>, not a field <div>)
  const bad=(id,msg)=>{const el=$("#"+id),w=el.type==="checkbox"?el.closest("label"):el.closest("div");if(w)w.classList.add("fld-err");el.focus();return msg};
  if([...o.title].length<3)return bad("r_title","Title must be at least 3 characters.");
  if([...o.description].length<10)return bad("r_desc","Description must be at least 10 characters.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(o.report_date)||o.report_date<"2020-01-01")return bad("r_date","Enter a valid activity date from 2020-01-01.");
  if(o.report_date>maxDate(o.category))return bad("r_date",o.report_date>ME.today&&maxDate(o.category)===ME.today?"This report type cannot have a future activity date. Choose “Scheduled / planned activity” for planned work.":"That date is too far ahead for this report type.");
  if(o.recovered!==""&&!/^\d{1,4}$/.test(o.recovered))return bad("r_rec","Recovered must be a whole number 0–9999.");
  if(o.revenue!==""&&!(/^\d{1,8}(\.\d{1,2})?$/.test(o.revenue)))return bad("r_rev","Earnings: up to 2 decimals, max 10,000,000.");
  if(!$("#r_ok").checked)return bad("r_ok","Please confirm the information before submitting.");
  return"";
}
function readFile(file){return new Promise((res,rej)=>{
  if(file.type==="application/pdf"){if(file.size>3*1048576)return rej(new Error("PDF is larger than 3 MB."));const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error("File could not be read."));r.readAsDataURL(file);return}
  if(!/^image\/(jpeg|png|webp)$/.test(file.type))return rej(new Error("Use a JPG, PNG or WebP image, or a PDF."));
  const u=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{const k=Math.min(1,1600/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext("2d").drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);const out=c.toDataURL("image/jpeg",.85);out.length*.75>3*1048576?rej(new Error("Image is still too large after compression.")):res(out)};
  im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("Image could not be read."))};im.src=u})}
let busy=false;
function newForm(){
  const box=$("#tab-new");
  if(ME.reports_disabled){box.innerHTML=`<div class="state-box">${I("lock")}<span>Report submissions are temporarily disabled by an administrator.</span></div>`;return}
  box.innerHTML=`<div class="panel">${formHTML(null,false)}</div>`;const f=$("#rf",box);bindDate(f);
  f.addEventListener("submit",async e=>{e.preventDefault();if(busy)return;const o=readForm(f),er=$("#rf_err",f),m=check(o);notice(er,m);if(m)return;
    const fi=$("#r_ev",f).files[0];if(fi){try{o.evidence=await readFile(fi)}catch(x){notice(er,x.message);return}}
    busy=true;const b=$("[type=submit]",f);b.disabled=true;b.textContent="Submitting…";
    const r=await api("submit",o);busy=false;b.disabled=false;b.textContent="Submit report";
    if(!r.ok){notice(er,errText(r));return}
    box.innerHTML=`<div class="okbox" role="status" tabindex="-1" id="okb"><h2 style="font-size:20px;margin:0 0 8px">${I("circle-check")} Report ${esc(r.j.report.id)} submitted</h2>
      <p style="margin:0 0 6px">Status: <b>Pending review</b>. An approver was notified. You will see approval, corrections or rejection feedback in My reports.</p>
      <p class="note" style="margin:0">Activity date ${esc(day(r.j.report.activity_date))} · submitted ${esc(when(r.j.report.submitted_at))}</p>
      ${r.j.notice?`<p class="feedback" style="margin:10px 0 0">${esc(r.j.notice)}</p>`:""}${r.j.warning?`<p class="ferr">${esc(r.j.warning)}</p>`:""}
      <div class="acts" style="margin-top:14px"><button class="btn sm" type="button" id="go-mine">View in My reports</button><button class="btn ghost sm" type="button" id="go-new">Submit another</button></div></div>`;
    $("#okb").focus();$("#go-mine").onclick=()=>tab("mine");$("#go-new").onclick=newForm;});
}

/* ---------------- My reports ---------------- */
const mine={st:{q:"",status:"",basis:"activity",from:"",to:"",archived:""},rows:[],total:0,
  init(){const box=$("#tab-mine");box.innerHTML=`<form class="fbar" id="mf" role="search" aria-label="Filter my reports" style="grid-template-columns:minmax(0,2fr) repeat(5,minmax(0,1fr))">
    <div class="wide"><label for="m_q">Search</label><input id="m_q" name="q" type="search" maxlength="60" placeholder="ID, title or description"></div>
    <div><label for="m_s">Status</label><select id="m_s" name="status"><option value="">All</option>${Object.entries(ME.statuses).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join("")}<option value="published">Published</option></select></div>
    <div><label for="m_b">Date type</label><select id="m_b" name="basis"><option value="activity">Activity date</option><option value="submission">Submitted</option></select></div>
    <div><label for="m_f">From</label><input id="m_f" name="from" type="date"></div><div><label for="m_t">To</label><input id="m_t" name="to" type="date"></div>
    <div><label for="m_a">Show</label><select id="m_a" name="archived"><option value="">Active</option><option value="1">Archived</option><option value="all">All</option></select></div></form>
    <div id="ml" aria-live="polite"></div><div class="more-row"><button class="btn ghost" type="button" id="mmore" hidden>Load more</button></div>`;
    let t;const f=$("#mf",box),upd=()=>{clearTimeout(t);t=setTimeout(()=>{new FormData(f).forEach((v,k)=>this.st[k]=String(v));this.load(true)},300)};
    f.addEventListener("input",upd);f.addEventListener("change",upd);f.addEventListener("submit",e=>e.preventDefault());$("#mmore").onclick=()=>this.load(false);this.ready=true},
  async load(reset){if(!this.ready)this.init();const box=$("#ml");if(reset){this.rows=[];box.innerHTML=`<div class="skel" style="height:72px"></div>`;box.setAttribute("aria-busy","true")}
    const p=new URLSearchParams(Object.entries({...this.st,sort:this.st.basis==="submission"?"submitted":"activity",offset:reset?0:this.rows.length,limit:20}).filter(([,v])=>v!=="")).toString();
    const r=await api("reports?"+p);box.removeAttribute("aria-busy");
    if(!r.ok){box.innerHTML=`<div class="state-box err" role="alert">${I("alert-triangle")}<span>${esc(errText(r))}</span><button class="btn ghost sm" type="button" id="mretry">Try again</button></div>`;$("#mretry").onclick=()=>this.load(true);return}
    this.rows=reset?r.j.rows:[...this.rows,...r.j.rows];this.total=r.j.total;
    box.innerHTML=this.rows.length?`<p class="note">${this.rows.length} of ${this.total}</p><div class="plist">${this.rows.map((x,i)=>`<button type="button" class="pitem" data-i="${i}"><b>${esc(x.title)}</b>
      <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><span class="chip ${CHIP[x.status]||""}">${esc(ME.statuses[x.status]||x.status)}</span>${x.published?`<span class="chip ok">Published</span>`:""}${x.archived?`<span class="chip mu">Archived</span>`:""}</span>
      <small><code>${esc(x.id)}</code> · Activity ${esc(day(x.activity_date))} · Submitted ${esc(when(x.submitted_at))}</small></button>`).join("")}</div>`
      :`<div class="state-box">${I("inbox")}<span>No reports match these filters.</span></div>`;
    $("#mmore").hidden=this.rows.length>=this.total;
    $$(".pitem",box).forEach(b=>b.onclick=()=>detail(this.rows[+b.dataset.i].id,b));}
};

/* ---------------- dialogs ---------------- */
function dlg(html,label,back){const d=document.createElement("div");d.className="pdlg";d.innerHTML=`<div role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">${html}</div>`;document.body.appendChild(d);
  const close=()=>{d.remove();document.removeEventListener("keydown",key);back&&back.focus&&back.focus()},key=e=>{if(e.key==="Escape")close()};
  document.addEventListener("keydown",key);d.addEventListener("click",e=>{if(e.target===d)close()});setTimeout(()=>$("[role=dialog]",d).focus(),20);return{d,close}}
function confirmBox(title,text,okLabel,danger){return new Promise(res=>{const{d,close}=dlg(`<h2>${esc(title)}</h2><p style="color:var(--ink2)">${esc(text)}</p><div class="acts"><button class="btn ghost" type="button" data-n>Cancel</button><button class="btn" type="button" data-y ${danger?'style="background:var(--bad)"':""}>${esc(okLabel)}</button></div>`,title);
  $("[data-n]",d).onclick=()=>{close();res(false)};$("[data-y]",d).onclick=()=>{close();res(true)};})}
const ACT={created:"Submitted",status:"Status changed",edited:"Edited",published:"Published on the public feed",unpublished:"Removed from the public feed",archived:"Archived",restored:"Restored",deleted:"Deleted"};
async function detail(id,back){
  const r=await api("report?id="+encodeURIComponent(id));
  if(!r.ok){if(r.status===401)return;const e=dlg(`<h2>Could not open the report</h2><p style="color:var(--ink2)">${esc(errText(r))}</p><div class="acts"><button class="btn ghost" type="button" data-x>Close</button></div>`,"Error",back);$("[data-x]",e.d).onclick=e.close;return}
  const x=r.j.report,fb=x.correction_request&&x.status==="changes_requested"?`<div class="feedback"><b>Corrections requested:</b> ${esc(x.correction_request)}</div>`:x.status==="rejected"&&x.rejection_reason?`<div class="feedback"><b>Rejected:</b> ${esc(x.rejection_reason)}</div>`:"";
  const{d,close}=dlg(`<h2>${esc(x.title)}</h2><div class="acts" style="margin-bottom:12px"><span class="chip ${CHIP[x.status]||""}">${esc(ME.statuses[x.status]||x.status)}</span>${x.published?`<span class="chip ok">Published</span>`:""}${x.archived?`<span class="chip mu">Archived</span>`:""}</div>${fb}
   <dl class="kv" style="margin-top:12px"><dt>Reference</dt><dd><code>${esc(x.id)}</code></dd><dt>Category</dt><dd>${esc((cats().find(c=>c.id===x.category)||{}).label||x.category)}</dd><dt>Activity date</dt><dd>${esc(day(x.activity_date))}</dd><dt>Submitted</dt><dd>${esc(when(x.submitted_at))}</dd>
   <dt>Last update</dt><dd>${esc(when(x.updated_at))}</dd><dt>Reviewed</dt><dd>${esc(when(x.reviewed_at))}</dd><dt>Description</dt><dd>${esc(x.description||"—")}</dd><dt>Account / case info</dt><dd>${esc(x.account_info||"—")}</dd>
   <dt>Recovered</dt><dd>${esc(x.recovered)}</dd><dt>Earnings</dt><dd>${esc(peso(x.revenue))}</dd><dt>Additional</dt><dd>${esc(x.additional_info||"—")}</dd>${x.feedback?`<dt>Reviewer remarks</dt><dd>${esc(x.feedback)}</dd>`:""}
   ${x.published?`<dt>Public title</dt><dd>${esc(x.public_title)}</dd><dt>Public summary</dt><dd>${esc(x.public_summary||"—")}</dd>`:""}</dl>
   <h3 style="font-size:15px;margin:16px 0 8px">Evidence</h3><div class="acts">${r.j.evidence.length?r.j.evidence.map(e=>`<button class="btn ghost sm" type="button" data-ev="${e.id}">${I(e.mime==="application/pdf"?"file-text":"image")} ${esc(e.mime.split("/")[1].toUpperCase())} · ${Math.round(e.size_bytes/1024)} KB</button>`).join(""):`<span class="note">No evidence attached.</span>`}</div>
   <h3 style="font-size:15px;margin:16px 0 8px">History</h3><ol class="timeline">${r.j.history.map(h=>`<li><b>${esc(ACT[h.action]||h.action)}</b>${h.to_status&&h.action==="status"?` → ${esc(ME.statuses[h.to_status]||h.to_status)}`:""}${h.fields.length?` (${esc(h.fields.join(", "))})`:""} · ${esc(h.by)} · ${esc(when(h.at))}${h.reason?`<br>${esc(h.reason)}`:""}</li>`).join("")}</ol>
   <div class="ferr" id="d_err" role="alert"></div>
   <div class="acts" style="margin-top:16px">${x.can_edit?`<button class="btn sm" type="button" data-a="edit">${I("pencil")} Edit</button><button class="btn ghost sm" type="button" data-a="ev">${I("upload")} Add evidence</button>`:""}
   ${x.can_archive?`<button class="btn ghost sm" type="button" data-a="archive">${I("archive")} Archive</button>`:""}${x.can_restore?`<button class="btn ghost sm" type="button" data-a="restore">Restore</button>`:""}
   ${x.can_delete?`<button class="btn ghost sm" type="button" data-a="delete" style="color:#FCA5A5">${I("trash")} Delete</button>`:""}<button class="btn ghost sm" type="button" data-a="close">Close</button></div>
   <input type="file" id="d_file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden aria-label="Evidence file">`,"Report "+x.id,back);
  const er=$("#d_err",d),re=()=>{close();mine.load(true);detail(id)};
  $$("[data-ev]",d).forEach(b=>b.onclick=async()=>{const y=await api("evidence?id="+b.dataset.ev);if(y.ok)window.open(y.j.url,"_blank","noopener");else notice(er,errText(y))});
  $$("[data-a]",d).forEach(b=>b.onclick=async()=>{const a=b.dataset.a;
    if(a==="close")return close();
    if(a==="ev"){$("#d_file",d).click();return}
    if(a==="delete"){if(!(await confirmBox("Delete this report?","It is removed from your list. The record and its history are kept for auditing.","Delete",true)))return;const y=await api("delete",{id});if(y.ok){close();mine.load(true)}else notice(er,errText(y));return}
    if(a==="archive"||a==="restore"){const y=await api("archive",{id,archived:a==="archive"});if(y.ok)re();else notice(er,errText(y));return}
    if(a==="edit"){close();const e2=dlg(`<h2>Edit ${esc(x.id)}</h2>${formHTML(x,true)}`,"Edit report "+x.id,back),f=$("#rf",e2.d);bindDate(f);$("[data-cancel]",f).onclick=()=>{e2.close();detail(id)};
      f.addEventListener("submit",async e=>{e.preventDefault();if(busy)return;const o=readForm(f),ee=$("#rf_err",f),m=check(o);notice(ee,m);if(m)return;
        const patch={id};for(const k of["title","category","report_date","description","account_info","recovered","revenue","additional_info"]){const old=k==="report_date"?x.activity_date:x[k];if(String(o[k]??"")!==String(old??""))patch[k]=o[k]}
        if(Object.keys(patch).length===1){notice(ee,"Nothing changed.");return}
        busy=true;const sb2=$("[type=submit]",f);sb2.disabled=true;sb2.textContent="Saving…";const y=await api("update",patch);busy=false;sb2.disabled=false;sb2.textContent="Save changes";
        if(!y.ok){notice(ee,errText(y));return}e2.close();mine.load(true);detail(id)});return}
  });
  $("#d_file",d).onchange=async e=>{const fi=e.target.files[0];if(!fi)return;let data;try{data=await readFile(fi)}catch(x2){notice(er,x2.message);return}const y=await api("evidence_add",{id,file:data});if(y.ok)re();else notice(er,errText(y))};
}

/* ---------------- boot ---------------- */
async function boot(){
  const r=await api("me");
  if(!r.ok){if(r.status===401||r.status===403)return showAuth("");$("#auth").hidden=false;notice($("#perr"),errText(r));return}
  ME=r.j;$("#auth").hidden=true;$("#app").hidden=false;$("#lo").hidden=false;
  $("#who").textContent=`Signed in as ${ME.name} (Telegram ID …${ME.uid_tail})`;$("#sess").textContent="Session ends after 30 minutes of inactivity.";
  mine.ready=false;tab(location.hash==="#mine"?"mine":"new");$("#main").focus({preventScroll:true});
}
boot();
})();
