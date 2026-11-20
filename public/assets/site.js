"use strict";
(()=>{
const {CONFIG}=window.CHDS;
const API=String(CONFIG.API||"").trim().replace(/\/+$/,"");
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const I=(n,c)=>window.CHDSIcon(n,c);
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt=n=>CONFIG.CUR+Math.round(n).toLocaleString();
const tgUrl="https://t.me/"+encodeURIComponent(CONFIG.TG);
window.hydrateIcons();
if($("#yr"))$("#yr").textContent=new Date().getFullYear();

const hd=$("#hd"),nav=$("#nav"),bg=$("#burger"),pg=$("#pg");
const onScroll=()=>{hd&&hd.classList.toggle("sc",scrollY>12);const h=document.documentElement.scrollHeight-innerHeight;if(pg)pg.style.width=(h>0?scrollY/h*100:0)+"%"};onScroll();addEventListener("scroll",onScroll,{passive:true});
const scrim=nav&&bg?Object.assign(document.body.appendChild(document.createElement("div")),{className:"nav-scrim",hidden:true}):null;
if(scrim){scrim.setAttribute("aria-hidden","true");scrim.addEventListener("click",e=>{e.preventDefault();setNav(false)})}
const setNav=o=>{if(!nav||!bg)return;nav.classList.toggle("open",o);hd.classList.toggle("open",o);document.body.classList.toggle("nav-open",o);if(scrim)scrim.hidden=!o;UX.lockScroll("nav",o);bg.setAttribute("aria-expanded",String(o));bg.setAttribute("aria-label",o?"Close menu":"Open menu");bg.innerHTML=I(o?"x":"menu")};
if(bg){bg.innerHTML=I("menu");bg.addEventListener("click",()=>setNav(!nav.classList.contains("open")))}
$$("a",nav||document.createElement("div")).forEach(a=>a.addEventListener("click",()=>setNav(false)));
document.addEventListener("click",e=>{if(nav&&nav.classList.contains("open")&&!e.composedPath().some(el=>el===nav||el===bg))setNav(false)});
{const p=location.pathname.replace(/\/$/,"").replace(/\.html$/,"")||"/";$$("a",nav||document.createElement("div")).forEach(a=>{const h=(a.getAttribute("href")||"").replace(/\/$/,"")||"/";if(h===p){a.classList.add("on");a.setAttribute("aria-current","page")}})}

const watch=()=>UX.reveal(document,"footer .fgrid>*,.stat,.tcard,.secnote,.cta");
$$(".stats,.gfit,.grid2,.grid3,.tgrid").forEach(g=>[...g.children].forEach((c,i)=>c.style.setProperty("--d",Math.min(i,8)*60+"ms")));

let FLAGS={maintenance:false,ai_enabled:true};
(async()=>{
  try{
    const r=await fetch(API+"/api/public/status",{cache:"no-store"});if(!r.ok)return;
    const j=await r.json();FLAGS={maintenance:!!j.maintenance,ai_enabled:j.ai_enabled!==false};
    const items=[];
    if(j.maintenance)items.push(`<div class="maint" role="status">${I("alert-triangle")}<div><b>Scheduled maintenance</b><p>Some services, including the support chat, are temporarily unavailable. Please try again later or message us on Telegram @${esc(CONFIG.TG)}.</p></div></div>`);
    const rank={critical:0,high:1,normal:2,low:3};
    (j.announcements||[]).sort((a,b)=>rank[a.priority]-rank[b.priority]).forEach(a=>items.push(`<div class="${esc(a.priority)}">${I(a.priority==="high"||a.priority==="critical"?"alert-triangle":"megaphone")}<div><b>${esc(a.title)}</b><p>${esc(a.message)}</p></div></div>`));
    if(items.length&&hd){const b=document.createElement("div");b.className="banner";b.setAttribute("aria-label","Announcements");b.innerHTML=items.join("");hd.after(b)}
  }catch(e){console.warn("status unavailable",e)}
})();

const safe=u=>/^https:\/\//i.test(u||"")?u:"";
const tcard=m=>{
  const ini=String(m.name).split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
  const tg=m.telegram?`<a href="https://t.me/${encodeURIComponent(m.telegram)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.name)} on Telegram">${I("send")} Telegram</a>`:"";
  const fb=safe(m.facebook)?`<a href="${esc(m.facebook)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.name)} on Facebook">${I("external-link")} Facebook</a>`:"";
  const im=safe(m.photo)?`<img src="${esc(m.photo)}" alt="" loading="lazy" decoding="async">`:"";
  return `<article class="tcard"><div class="av"><b aria-hidden="true">${esc(ini)}</b>${im}</div><h4>${esc(m.name)}</h4><small>${esc(m.role)}</small>${m.bio?`<p>${esc(m.bio)}</p>`:""}<div class="tl">${tg}${fb}</div></article>`;
};
async function loadTeam(){
  const root=$("#team-root"),prev=$("#team-preview");if(!root&&!prev&&!$("#s-team"))return;
  [root,prev].forEach(el=>{if(el)el.innerHTML=`<div class="tgrid">${'<div class="skel"></div>'.repeat(prev&&!root?4:6)}</div>`});
  let L;
  try{const r=await fetch(API+"/api/public/team",{cache:"no-store"});if(!r.ok)throw new Error(r.status);L=(await r.json()).members||[]}
  catch(e){[root,prev].forEach(el=>{if(el)el.innerHTML=`<div class="state" role="status">The team directory could not be loaded right now. Please refresh the page in a moment.</div>`});if($("#s-team"))$("#s-team").textContent="—";return}
  if($("#s-team"))$("#s-team").textContent=L.length;
  ["founder","admin","member"].forEach(g=>{const e=$("#tc-"+g);if(e)e.textContent=L.filter(m=>m.group===g).length});
  if(!L.length){[root,prev].forEach(el=>{if(el)el.innerHTML=`<div class="state">Team profiles will appear here once they are published.</div>`});return}
  if(root)root.innerHTML=[["founder","Founder"],["admin","Admins"],["member","Members"]].map(([g,t])=>{const M=L.filter(m=>m.group===g);return M.length?`<div class="tg"><h3>${t} <span>${M.length}</span></h3><div class="tgrid">${M.map(tcard).join("")}</div></div>`:""}).join("");
  if(prev)prev.innerHTML=`<div class="tgrid">${L.slice(0,8).map(tcard).join("")}</div>`;
  $$(".av img").forEach(i=>i.addEventListener("error",()=>i.remove()));
}
loadTeam();

const ML=$("#main-links");if(ML)ML.innerHTML=`<a href="${tgUrl}" target="_blank" rel="noopener noreferrer">${I("send")} Telegram</a>`+(CONFIG.WA?`<a href="https://wa.me/${encodeURIComponent(CONFIG.WA)}" target="_blank" rel="noopener noreferrer">${I("message-square")} WhatsApp</a>`:"")+`<a href="mailto:${esc(CONFIG.EMAIL)}">${I("mail")} Email</a>`;
const msgText=()=>`Hi CH Digital Services,\n\nName: ${$("#fn").value.trim()}\nService: ${$("#fs").value}\n\nDetails:\n${$("#fd").value.trim()}`;
if(CONFIG.WA&&$("#wa")){const w=$("#wa");w.hidden=false;w.addEventListener("click",()=>{w.href=`https://wa.me/${encodeURIComponent(CONFIG.WA)}?text=${encodeURIComponent(msgText())}`})}
if($("#rf"))$("#rf").addEventListener("submit",async e=>{
  e.preventDefault();
  try{await navigator.clipboard.writeText(msgText());$("#fstat").textContent="Copied. Paste it in the Telegram chat that just opened."}catch{$("#fstat").textContent="Open Telegram and send us your details."}
  window.open(tgUrl,"_blank","noopener");
});
$$("[data-tg]").forEach(e=>e.textContent="@"+CONFIG.TG);
$$("[data-email]").forEach(e=>{e.textContent=CONFIG.EMAIL;e.href="mailto:"+CONFIG.EMAIL});
{const FQ=$("#fq");if(FQ){
  const items=$$("details[data-q]"),groups=$$(".fqg"),none=$("#fq-none");
  FQ.addEventListener("input",()=>{
    const q=FQ.value.trim().toLowerCase();let n=0;
    items.forEach(d=>{const ok=!q||d.textContent.toLowerCase().includes(q);d.hidden=!ok;if(ok)n++;d.open=!!q&&ok});
    groups.forEach(g=>{g.hidden=!$$("details:not([hidden])",g).length});
    if(none)none.hidden=n>0;
  });
}}
$$("[data-copy]").forEach(b=>b.addEventListener("click",async()=>{const el=$(b.dataset.copy);if(!el)return;const t=el.textContent,old=b.textContent;
  try{await navigator.clipboard.writeText(t);b.textContent="Copied"}catch{b.textContent="Select and copy the text"}setTimeout(()=>{b.textContent=old},1800)}));

let DATA=null,offline=false,metric="revenue",range=30,animate=true,prevT={rec:0,rev:0};
function count(el,to,from,f){
  if(!el)return;if(RM||from===to){el.textContent=f(to);return}
  const t0=performance.now();(function tick(t){const p=Math.min(1,(t-t0)/900),e=1-Math.pow(1-p,3);el.textContent=f(from+(to-from)*e);if(p<1)requestAnimationFrame(tick)})(t0);
}
const ago=t=>{const s=Math.max(0,(Date.now()-t)/1e3);return s<60?"just now":s<3600?Math.floor(s/60)+"m ago":s<86400?Math.floor(s/3600)+"h ago":Math.floor(s/86400)+"d ago"};
function renderStats(){
  const T=DATA.totals;
  count($("#s-rec"),T.recovered,prevT.rec,n=>Math.round(n).toLocaleString());count($("#s-rev"),T.revenue,prevT.rev,fmt);prevT={rec:T.recovered,rev:T.revenue};
  if(!$("#cwrap"))return;
  $("#live-dot").className="dot"+(offline?" off":"");
  $("#c-upd").textContent=offline?"Live data is unavailable right now. Showing nothing rather than estimates.":"Live · updated "+ago(DATA.updated);
  $("#c-title").textContent=metric==="revenue"?"Team revenue":"Accounts recovered";
  $("#recent").innerHTML=(DATA.recent.length?DATA.recent.map(r=>`<div class="rrow"><div>${esc(r.t||"Verified report")} <span>· ${esc(r.n)} · ${ago(r.ts)}</span></div><div>${r.recovered?`<b>${esc(r.recovered)}</b> recovered`:"Verified"}</div></div>`).join(""):`<div class="rrow"><span>No published reports yet.</span></div>`)+`<div class="rrow"><a href="/reports">See all verified reports →</a></div>`;
  chart();
}
function chart(){
  const S=DATA.series.slice(-range),box=$("#chart");if(!S.length||!box)return;
  const W=Math.max(300,Math.min(760,$("#cwrap").clientWidth||600)),H=W<500?230:300,L=metric==="revenue"?56:38,R=14,T=16,B=30;
  const v=S.map(d=>d[metric]),m=Math.max(...v,0),e=10**Math.floor(Math.log10(m||1)),mx=m?Math.ceil(m/e*1.1*2)/2*e:4;
  const X=i=>L+i*(W-L-R)/Math.max(1,S.length-1),Y=n=>H-B-n/mx*(H-T-B);
  const P=v.map((n,i)=>[X(i),Y(n)]);
  let ln=`M${P[0][0]},${P[0][1]}`;for(let i=1;i<P.length;i++){const[a,b]=P[i-1],[c,d]=P[i],h=(a+c)/2;ln+=`C${h},${b} ${h},${d} ${c},${d}`}
  const ar=`${ln}L${X(S.length-1)},${H-B}L${X(0)},${H-B}Z`;
  const yl=n=>(metric==="revenue"?CONFIG.CUR:"")+(n>=1000?+(n/1000).toFixed(1)+"k":Math.round(n*10)/10);
  const dl=d=>new Date(d+"T00:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"});
  let g="";for(let k=0;k<=4;k++){const y=Y(mx*k/4);g+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#22314A"/><text x="${L-8}" y="${y+4}" text-anchor="end" fill="#A5B4C7" font-size="11">${yl(mx*k/4)}</text>`}
  const xs=[0,Math.floor((S.length-1)/2),S.length-1].filter((x,i,a)=>a.indexOf(x)===i).map(i=>`<text x="${X(i)}" y="${H-8}" text-anchor="${i===0?"start":i===S.length-1?"end":"middle"}" fill="#A5B4C7" font-size="11">${dl(S[i].d)}</text>`).join("");
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric==="revenue"?"Approved revenue":"Accounts recovered"} per day, last ${S.length} days"><defs><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3B82F6" stop-opacity=".35"/><stop offset="1" stop-color="#2563EB" stop-opacity="0"/></linearGradient></defs>${g}${xs}<path d="${ar}" fill="url(#ag)"/><path class="ln${animate&&!RM?" anim":""}" pathLength="1" d="${ln}"/><g id="hv" opacity="0"><line y1="${T}" y2="${H-B}" stroke="rgba(255,255,255,.3)" stroke-dasharray="4"/><circle r="5" fill="#F8FAFC" stroke="#3B82F6" stroke-width="3"/></g><rect x="${L}" y="0" width="${W-L-R}" height="${H}" fill="transparent" id="hit"/></svg>`;
  animate=false;
  const svg=$("svg",box),hv=$("#hv",box),tip=$("#tip");
  const move=ev=>{const r=svg.getBoundingClientRect(),x=(ev.clientX-r.left)/r.width*W,i=Math.max(0,Math.min(S.length-1,Math.round((x-L)/((W-L-R)/Math.max(1,S.length-1)))));
    hv.setAttribute("opacity",1);$("line",hv).setAttribute("x1",X(i));$("line",hv).setAttribute("x2",X(i));$("circle",hv).setAttribute("cx",X(i));$("circle",hv).setAttribute("cy",Y(v[i]));
    tip.innerHTML=`${dl(S[i].d)}<b>${metric==="revenue"?fmt(v[i]):v[i]+" recovered"}</b>`;tip.style.left=(X(i)/W*100)+"%";tip.style.top=(Y(v[i])/H*r.height)+"px";tip.style.opacity=1};
  const out=()=>{hv.setAttribute("opacity",0);tip.style.opacity=0};
  $("#hit",box).addEventListener("pointermove",move);$("#hit",box).addEventListener("pointerdown",move);$("#hit",box).addEventListener("pointerleave",out);
}
async function loadStats(){
  try{const r=await fetch(API+"/api/stats",{cache:"no-store"});if(!r.ok)throw 0;const j=await r.json();if(!j||!j.totals||!Array.isArray(j.series))throw 0;DATA=j;offline=false}
  catch{offline=true;if(!DATA)DATA={totals:{recovered:0,revenue:0,reports:0},series:[],recent:[],updated:Date.now()}}
  renderStats();
}
$$("[data-m]").forEach(b=>b.addEventListener("click",()=>{metric=b.dataset.m;$$("[data-m]").forEach(x=>{x.classList.toggle("on",x===b);x.setAttribute("aria-pressed",String(x===b))});animate=true;renderStats()}));
$$("[data-r]").forEach(b=>b.addEventListener("click",()=>{range=+b.dataset.r;$$("[data-r]").forEach(x=>{x.classList.toggle("on",x===b);x.setAttribute("aria-pressed",String(x===b))});animate=true;chart()}));
if($("#s-rec")||$("#cwrap")){let rt;addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(()=>DATA&&chart(),150)});
  loadStats();setInterval(()=>{if(!document.hidden)loadStats()},CONFIG.POLL||15000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)loadStats()})}

const call=(path,body,method,timeout)=>UX.fetchJSON(API+path,{method:method||(body!==undefined?"POST":"GET"),body,headers:{"X-CHDS-Client":"1"},timeout:timeout||20000});
const fab=document.createElement("button");fab.id="fab";fab.type="button";fab.setAttribute("aria-label","Open CHDS AI Support chat");fab.setAttribute("aria-expanded","false");fab.setAttribute("aria-controls","chat");
fab.innerHTML=`<span class="fi m" aria-hidden="true">${I("message-square")}</span><span class="fi x" aria-hidden="true">${I("x")}</span>`;
const W=document.createElement("div");W.id="chat";W.setAttribute("role","dialog");W.setAttribute("aria-modal","false");W.setAttribute("aria-label","CHDS AI Support chat");W.dataset.mode="ai";W.inert=true;
W.innerHTML=`<div class="ch"><span class="mark" id="cmark" aria-hidden="true">${I("sparkles")}</span><div class="who"><b id="ct">CHDS AI Support</b><small><i class="dot" id="cd"></i><span id="cst">Online</span></small></div>
<button class="cbtn" type="button" id="c-list" aria-label="Your conversations" title="Your conversations">${I("history")}</button>
<button class="cbtn" type="button" id="c-new" aria-label="Start a new conversation" title="New conversation">${I("message-plus")}</button>
<button class="cbtn" type="button" id="cx" aria-label="Close chat" title="Close">${I("x")}</button></div>
<div id="cview" class="cview"></div>`;
document.body.append(fab,W);
const cview=$("#cview",W);
let S={loaded:false,booting:false,me:null,convs:[],conv:null,mode:"ai",busy:false,shots:[],ocr:"",pending:[],unread:0};
const hhmm=t=>{try{return new Date(t||Date.now()).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}catch{return""}};
const fmtWhen=t=>{try{return new Date(t).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}catch{return""}};
const ST={active:["Active","in"],awaiting_confirmation:["Awaiting your confirmation","wa"],resolved:["Resolved","ok"],handoff:["Read-only","no"],closed:["Closed · read-only","no"]};
const readOnly=()=>S.mode==="closed"||S.mode==="legacy";
function setHeader(){
  const m=S.mode;W.dataset.mode=m;
  $("#ct").textContent=m==="closed"?"Conversation closed":m==="legacy"?"Earlier conversation":"CHDS AI Support";
  $("#cst").textContent=m==="closed"?"Closed · read-only":m==="legacy"?"Read-only":FLAGS.ai_enabled?"Online · replies in seconds":"AI temporarily unavailable";
  $("#cd").className="dot"+(readOnly()||!FLAGS.ai_enabled?" off":"");
  $("#cmark").innerHTML=I(readOnly()?"lock":"sparkles");
  $("#c-new").hidden=!S.me;$("#c-list").hidden=!S.me;
}
function openChat(o){
  W.classList.toggle("on",o);W.inert=!o;fab.setAttribute("aria-expanded",String(o));fab.setAttribute("aria-label",o?"Close CHDS AI Support chat":"Open CHDS AI Support chat");document.body.classList.toggle("chat-open",o);
  if(o){S.unread=0;$(".fab-badge",fab)?.remove();if(!S.loaded&&!S.booting)boot();else setTimeout(()=>{const i=$("#ci")||$("#nm");i&&!i.disabled&&i.focus({preventScroll:true})},80)}else fab.focus({preventScroll:true});
}
fab.addEventListener("click",()=>openChat(!W.classList.contains("on")));
$("#cx",W).addEventListener("click",()=>openChat(false));
$$(".open-ai").forEach(b=>b.addEventListener("click",()=>openChat(true)));
addEventListener("keydown",e=>{if(e.key==="Escape"){if(nav&&nav.classList.contains("open"))setNav(false);else if(W.classList.contains("on")){const d=$(".cdlg",W);d?d.remove():openChat(false)}}});

function stateView(text,icon,{err=false,retry=null}={}){
  cview.innerHTML=`<div class="cstate${err?" err":""}" role="${err?"alert":"status"}">${icon?`<div class="ic">${I(icon)}</div>`:""}<p>${text}</p>${retry?`<button class="btn sm" type="button" data-retry>${I("refresh")} Try again</button>`:""}</div>`;
  if(retry)$("[data-retry]",cview).onclick=retry;
}
const tgLink=()=>`<a href="${tgUrl}" target="_blank" rel="noopener noreferrer">@${esc(CONFIG.TG)}</a>`;
async function boot(){
  if(S.booting)return;S.booting=true;fab.classList.add("loading");
  cview.innerHTML=UX.skeleton("bubbles");
  try{
    const r=await call("/api/ai/me");
    if(r.status===403){stateView("This chat is not available for your account. Please contact us on Telegram "+tgLink()+".","lock",{err:true});return}
    if(!r.ok){stateView(`CHDS AI Support could not be reached${r.j.error==="timeout"?" (the request timed out)":""}. You can also message us on Telegram ${tgLink()}.`,"alert-triangle",{err:true,retry:boot});return}
    FLAGS=r.j.flags||FLAGS;S.loaded=true;
    if(FLAGS.maintenance){stateView(`Support chat is paused for maintenance. Please try again later, or message us on Telegram ${tgLink()}.`,"alert-triangle");setHeader();return}
    if(!r.j.identity){nameView();setHeader();return}
    S.me=r.j.identity;S.convs=r.j.conversations||[];
    const open=S.convs.find(c=>c.status!=="resolved"&&c.status!=="closed"&&c.owner!=="human");
    if(open)await loadConv(open.id,r.j.greeting);else await newConv();
  }finally{S.booting=false;fab.classList.remove("loading")}
}

function validName(v){
  const s=v.normalize("NFC").replace(/\s+/g," ").trim(),n=[...s].length;
  if(!s)return"Please enter your name.";
  if(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/.test(v))return"Your name contains characters that are not allowed.";
  if(n<2)return"Please enter at least 2 characters.";if(n>60)return"Please keep it under 61 characters.";
  if(!/^[\p{L}\p{M}\p{N} '’\-.,()]+$/u.test(s))return"Please use letters, spaces, hyphens or apostrophes only.";
  if(!/\p{L}/u.test(s))return"Your name must contain at least one letter.";return"";
}
function nameView(){
  cview.innerHTML=`<form class="namebox" id="nf" novalidate><div class="ic">${I("sparkles")}</div><h3>Welcome to CHDS AI Support</h3><p>Before we begin, what should we call you?</p>
  <label for="nm">Your name</label><input id="nm" name="name" autocomplete="name" maxlength="80" required aria-describedby="nm-err nm-hint">
  <div class="ferr" id="nm-err" role="alert"></div><button class="btn" type="submit">Start chatting ${I("arrow-right")}</button>
  <p class="small" id="nm-hint">We use this name to greet you and to keep your conversation history. It is not treated as a verified identity. Never share your password.</p></form>`;
  const f=$("#nf"),inp=$("#nm"),err=$("#nm-err");setTimeout(()=>inp.focus({preventScroll:true}),80);
  f.addEventListener("submit",async e=>{
    e.preventDefault();const m=validName(inp.value);err.textContent=m;inp.setAttribute("aria-invalid",String(!!m));if(m){inp.focus();return}
    const b=$("button",f);if(b.dataset.uxState==="loading")return;UX.busy(b,true,"Saving…");
    const r=await call("/api/ai/identity",{name:inp.value});
    if(r.ok||r.status===409){
      if(r.status===409){S.loaded=false;return boot()}
      S.me=r.j.identity;S.conv=r.j.conversation;S.convs=[r.j.conversation];S.mode="ai";renderChat(r.j.messages||[]);setHeader();return;
    }
    UX.busy(b,false);
    err.textContent=r.status===400?(r.j.message||"Please check your name."):r.status===429?"Too many attempts. Please wait a while and try again.":r.status===0?r.j.message:"We could not save your name. Nothing was saved — please try again.";
    inp.setAttribute("aria-invalid",String(r.status===400));
  });
}

async function newConv(btn){
  if(btn)UX.busy(btn,true,"Starting…");
  const r=await call("/api/ai/new",{});
  if(btn)UX.busy(btn,false);
  if(!r.ok){if(r.status===401){S.me=null;return nameView()}stateView("We could not start a conversation.","alert-triangle",{err:true,retry:()=>newConv()});return}
  S.mode="ai";S.conv=r.j.conversation;S.convs=[S.conv,...S.convs.filter(c=>c.id!==S.conv.id)];renderChat(r.j.messages||[]);setMode("ai");
}
async function loadConv(id,greet){
  cview.innerHTML=UX.skeleton("bubbles");
  const r=await call("/api/ai/conversation?id="+encodeURIComponent(id));
  if(!r.ok){if(r.status===401){S.me=null;return nameView()}stateView("This conversation could not be loaded.","alert-triangle",{err:true,retry:()=>loadConv(id,greet)});return}
  S.conv=r.j.conversation;
  const msgs=r.j.messages||[],last=msgs[msgs.length-1];
  S.mode=S.conv.locked?"closed":S.conv.owner==="human"?"legacy":"ai";
  renderChat(msgs);
  if(S.mode==="closed")return lockChat();
  if(S.mode==="legacy")return legacyChat();
  if(r.j.pending_reply)markFailed($(`#msgs .msg[data-id="${r.j.pending_reply}"]`),{id:r.j.pending_reply});
  if(greet&&last&&Date.now()-Date.parse(last.created_at)>30*6e4)add(greet,"bot",null,"CHDS AI");
  setMode("ai");if(S.conv.status==="awaiting_confirmation")confirmCard();
}
function listView(){
  cview.innerHTML=`<div class="clist"><p class="small">Signed in as <b>${esc(S.me.display_name)}</b> · visitor ID ${esc(S.me.short_id)}</p>
  <button class="btn sm" type="button" id="l-new">${I("message-plus")} New conversation</button>
  ${S.convs.length?S.convs.map((c,i)=>{const st=ST[c.owner==="human"&&!c.locked?"handoff":c.status]||[c.status,""];return`<button class="citem" type="button" data-id="${esc(c.id)}" style="--i:${i}"><b>${esc(c.title||"New conversation")}</b><small>${esc(fmtWhen(c.updated_at||c.created_at))}</small> <span class="st ${st[1]}">${esc(st[0])}</span></button>`}).join(""):`<div class="cstate"><div class="ic">${I("message-square")}</div><p>No conversations yet. Start one to ask CHDS AI Support.</p></div>`}
  <button class="btn ghost sm" type="button" id="l-name">${I("pencil")} Change my name</button></div>`;
  $("#l-new").onclick=e=>newConv(e.currentTarget);
  $("#l-name").onclick=renameDlg;
  $$(".citem",cview).forEach(b=>b.onclick=()=>loadConv(b.dataset.id));
}
$("#c-list",W).addEventListener("click",async e=>{if(!S.me)return;const b=e.currentTarget;b.disabled=true;cview.innerHTML=UX.skeleton("list",4);const r=await call("/api/ai/conversations");b.disabled=false;if(r.ok)S.convs=r.j.conversations;listView()});
$("#c-new",W).addEventListener("click",e=>{if(S.me)newConv(e.currentTarget)});
function renameDlg(){
  const d=document.createElement("div");d.className="cdlg";d.innerHTML=`<div role="dialog" aria-label="Change your name"><h4>Change your name</h4><input id="rn" class="cfield" value="${esc(S.me.display_name)}" maxlength="80" aria-label="Your name"><div class="ferr" id="rn-err" role="alert"></div><div class="btns"><button class="btn ghost sm" type="button" data-x>Cancel</button><button class="btn sm" type="button" data-s>Save</button></div></div>`;
  cview.appendChild(d);$("#rn",d).focus();
  $("[data-x]",d).onclick=()=>d.remove();
  $("[data-s]",d).onclick=async e=>{const v=$("#rn",d).value,m=validName(v);$("#rn-err",d).textContent=m;if(m)return;
    const r=await UX.run(e.currentTarget,()=>call("/api/ai/profile",{name:v}),{label:"Saving…"});
    if(r&&r.ok){S.me=r.j.identity;d.remove();listView()}else if(r)$("#rn-err",d).textContent=r.status===400?(r.j.message||"Invalid name."):r.status===429?"Too many changes. Try again later.":"Could not save. Please try again."};
}

function renderChat(msgs){
  cview.innerHTML=`<div class="cbody" id="msgs" aria-live="polite" aria-relevant="additions"></div><div class="chips" id="chips"></div>
  <div class="prev" id="prev" hidden></div>
  <form class="cin" id="cf"><button type="button" class="cbtn" id="at" aria-label="Attach screenshot" title="Attach screenshot">${I("paperclip")}</button><input type="file" id="fi" accept="image/*" multiple hidden><textarea id="ci" rows="1" placeholder="Type your message…" aria-label="Message" maxlength="2000" autocomplete="off" enterkeyhint="send"></textarea><button class="send" type="submit" id="csend" aria-label="Send message" disabled>${I("send")}</button></form>
  <div class="cfoot">Never share your password in this chat.</div>`;
  msgs.forEach(m=>{const o={time:m.created_at,id:m.id};m.role==="user"?add(m.body,"me",null,null,o):m.role==="assistant"?add(m.body,"bot",null,"CHDS AI",o):m.role==="agent"?add(m.body,"ag",null,m.author||"CHDS Support",o):add(m.body,"sys",null,null,o)});
  if(msgs.length<=1&&S.mode==="ai")["My account was hacked","Account disabled or locked","Lost Page admin access","I need a website"].forEach(t=>{const b=document.createElement("button");b.type="button";b.textContent=t;b.onclick=()=>send(t);$("#chips").appendChild(b)});
  if(S.mode==="ai"&&S.conv&&S.conv.status==="resolved")resolvedCard();
  wire();setHeader();const box=$("#msgs");box.scrollTop=box.scrollHeight;setTimeout(()=>{const i=$("#ci");i&&!i.disabled&&W.classList.contains("on")&&i.focus({preventScroll:true})},80);
}
function add(t,cls,imgs,who,o={}){
  const box=$("#msgs");if(!box)return null;const d=document.createElement("div");d.className="msg "+cls+(o.live?" new":"");if(o.id)d.dataset.id=o.id;
  if(who){const b=document.createElement("span");b.className="who";b.textContent=who;d.appendChild(b)}
  if(imgs&&imgs.length){const w=document.createElement("div");w.className="thumbs";imgs.forEach(u=>{const i=new Image();i.src=u;i.alt="Attached screenshot";w.appendChild(i)});d.appendChild(w)}
  if(t){const x=document.createElement("span");x.className="mx";x.textContent=t;d.appendChild(x)}
  if(!/\b(sys|typing|err|warnmsg)\b/.test(cls)){const tm=document.createElement("time");tm.className="mt";tm.textContent=hhmm(o.time);if(o.time)tm.dateTime=o.time;d.appendChild(tm)}
  box.appendChild(d);box.scrollTop=box.scrollHeight;
  if(!W.classList.contains("on")&&cls==="bot"&&o.live){S.unread++;let bd=$(".fab-badge",fab);if(!bd){bd=document.createElement("span");bd.className="fab-badge";fab.appendChild(bd)}bd.textContent=S.unread;bd.setAttribute("aria-label",S.unread+" new messages")}
  return d;
}
const sys=t=>add(t,"sys",null,null,{live:true});
const typing=label=>{const box=$("#msgs");if(!box)return null;const d=document.createElement("div");d.className="msg bot typing";d.setAttribute("aria-label",label||"CHDS AI is typing");d.innerHTML=`<i></i><i></i><i></i>${label?`<em class="tl">${esc(label)}</em>`:""}`;box.appendChild(d);box.scrollTop=box.scrollHeight;return d};
function card(html){const box=$("#msgs");if(!box)return null;const d=document.createElement("div");d.className="card-in";d.innerHTML=html;box.appendChild(d);box.scrollTop=box.scrollHeight;return d}
function setMode(m){
  S.mode=m;setHeader();
  const form=$("#cf");if(!form)return;const lock=readOnly(),ci=$("#ci");
  $$("#cf textarea,#cf button").forEach(x=>x.disabled=lock);form.classList.toggle("locked",lock);
  if(lock){ci.placeholder="This conversation is read-only";ci.setAttribute("aria-disabled","true");$("#chips").innerHTML="";return}
  ci.removeAttribute("aria-disabled");ci.placeholder="Type your message…";syncSend();
}
function confirmCard(){
  const c=card(`<p><b>Have I successfully addressed your concern?</b></p><div class="opts">
    <button class="opt pri" type="button" data-o="resolved">${I("circle-check")} Yes, my concern is resolved.</button>
    <button class="opt" type="button" data-o="not_resolved">${I("refresh")} No, I still need assistance.</button></div>`);
  if(!c)return;
  $$(".opt",c).forEach(b=>b.onclick=async()=>{
    const o=b.dataset.o;$$(".opt",c).forEach(x=>x.disabled=true);UX.busy(b,true,"Saving…");
    const r=await call("/api/ai/resolve",{conversation_id:S.conv.id,outcome:o});
    UX.busy(b,false);
    if(!r.ok){$$(".opt",c).forEach(x=>x.disabled=false);if(r.status===409&&r.j.error==="case_closed")return lockChat();sys("That could not be saved. Please try again.");return}
    S.conv=r.j.conversation;c.remove();
    if(o==="resolved"){add("Yes, my concern is resolved.","me",null,null,{live:true});sys("Marked as resolved. Thank you for contacting CHDS AI Support.");resolvedCard()}
    else{add("No, I still need assistance.","me",null,null,{live:true});sys("Okay — tell me what is still not working and I will continue from here.");$("#ci").focus()}
  });
}
function resolvedCard(){const c=card(`<p>This conversation is resolved. You can still write here to reopen it, or start fresh.</p><div class="opts"><button class="opt pri" type="button">${I("message-plus")} Start a new conversation</button></div>`);if(c)$(".opt",c).onclick=e=>newConv(e.currentTarget)}
function readOnlyBox(title,text){
  if($(".closedbox",W))return;$(".typing",W)?.remove();$$(".mfail",W).forEach(x=>x.remove());
  const d=document.createElement("div");d.className="closedbox";d.setAttribute("role","status");
  d.innerHTML=`<b>${I("lock")} ${esc(title)}</b><p>${esc(text)}</p><button class="btn sm" type="button" data-newc>${I("message-plus")} Start New Conversation</button>`;
  const form=$("#cf");form?form.before(d):cview.appendChild(d);$("[data-newc]",d).onclick=e=>newConv(e.currentTarget);
}
function lockChat(){
  if(S.conv){S.conv.locked=true;S.conv.status="closed"}
  setMode("closed");readOnlyBox("This conversation has ended","This conversation is closed and read-only. Your history stays available here. Need more help? Start a new conversation with CHDS AI Support.");
}
function legacyChat(){setMode("legacy");readOnlyBox("This conversation is read-only","It was transferred to our team before live chat was retired, so new messages can't be sent here. Start a new conversation to continue with CHDS AI Support.")}
const notice=t=>{if(t)add(t,"msg warnmsg",null,null,{live:true})};

const compress=f=>new Promise((res,rej)=>{const u=URL.createObjectURL(f),i=new Image();
  i.onload=()=>{const k=Math.min(1,1280/Math.max(i.width,i.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(i.width*k));c.height=Math.max(1,Math.round(i.height*k));const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(i,0,0,c.width,c.height);URL.revokeObjectURL(u);res(c.toDataURL("image/jpeg",.72))};
  i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("unreadable"))};i.src=u});
let tl;const loadT=()=>tl||(tl=new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";s.onload=()=>res(window.Tesseract);s.onerror=()=>{tl=null;rej(new Error("ocr unavailable"))};document.head.appendChild(s)}));
const ocr=async u=>{try{const T=await loadT(),r=await T.recognize(u,"eng");return(r.data.text||"").replace(/\s+/g," ").trim().slice(0,1000)}catch(e){console.warn("OCR failed",e);return""}};
function renderPrev(){const p=$("#prev");if(!p)return;p.innerHTML="";
  S.pending.forEach((u,i)=>{const w=document.createElement("div");w.className="pv";const im=new Image();im.src=u;im.alt="Selected screenshot";const b=document.createElement("button");b.type="button";b.innerHTML=I("x");b.setAttribute("aria-label","Remove screenshot");b.onclick=()=>{S.pending.splice(i,1);renderPrev();syncSend()};w.append(im,b);p.appendChild(w)});
  p.hidden=!S.pending.length;syncSend()}
function syncSend(){const b=$("#csend"),i=$("#ci");if(!b||!i)return;const busy=b.dataset.uxState==="loading";b.disabled=busy||readOnly()||(!i.value.trim()&&!S.pending.length)}
const grow=i=>{i.style.height="auto";i.style.height=Math.min(120,i.scrollHeight)+"px"};
function wire(){
  $("#at").onclick=()=>$("#fi").click();
  $("#fi").onchange=async e=>{for(const f of[...e.target.files]){if(S.pending.length>=3){sys("You can attach up to 3 screenshots per message.");break}
    if(!f.type.startsWith("image/")||f.size>15e6){sys("Please attach image files under 15 MB.");continue}
    try{S.pending.push(await compress(f))}catch{sys("That image could not be read.")}}e.target.value="";renderPrev()};
  const ci=$("#ci");
  ci.addEventListener("input",()=>{grow(ci);syncSend()});
  ci.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();$("#cf").requestSubmit()}});
  $("#cf").addEventListener("submit",e=>{e.preventDefault();if(S.busy||readOnly())return;
    const t=ci.value.trim();if(!t&&!S.pending.length)return;ci.value="";grow(ci);send(t)});
}

function setBusy(on){S.busy=on;const b=$("#csend");if(b){UX.busy(b,on,"");if(on)b.innerHTML='<span class="ux-spin" aria-hidden="true"></span>';syncSend()}}
function markFailed(el,{id=null,text="",why=""}={}){
  if(!el)return;el.classList.add("failed");el.classList.remove("pending");el.nextElementSibling?.classList.contains("mfail")&&el.nextElementSibling.remove();
  const f=document.createElement("div");f.className="mfail";f.innerHTML=`${I("alert-circle")}<span>${esc(why||"No reply yet.")}</span><button type="button">${I("refresh")} Retry</button>`;
  el.after(f);$("#msgs").scrollTop=$("#msgs").scrollHeight;
  $("button",f).onclick=()=>retry(el,f,{id,text});
}
async function retry(el,f,{id,text}){
  if(S.busy||S.mode!=="ai")return;
  if(!id){
    const c=await call("/api/ai/conversation?id="+encodeURIComponent(S.conv.id));
    if(!c.ok){$("span",f).textContent="Still offline. Check your connection.";return}
    if(c.j.pending_reply&&(c.j.messages||[]).some(m=>m.id===c.j.pending_reply&&m.body===text))id=c.j.pending_reply;
    else if((c.j.messages||[]).some(m=>m.role==="user"&&m.body===text)){await loadConv(S.conv.id);return}
    else{f.remove();el.remove();return send(text)}
  }
  f.remove();el.classList.remove("failed");el.classList.add("pending");
  await askAI(el,{retry_of:id},text);
}
async function askAI(el,body,text){
  setBusy(true);const w=typing();
  const r=await call("/api/chat",{conversation_id:S.conv.id,...body},"POST",45000);
  w&&w.remove();setBusy(false);el&&el.classList.remove("pending");
  if(r.ok){
    if(el&&r.j.user_message_id)el.dataset.id=r.j.user_message_id;
    notice(r.j.notice);add(r.j.reply,"bot",null,"CHDS AI",{live:true,id:r.j.message_id});S.conv.status=r.j.ask_confirmation?"awaiting_confirmation":"active";UX.announce("CHDS AI replied");
    if(r.j.ask_confirmation)confirmCard();
    return;
  }
  if(r.status===409&&r.j.error==="case_closed")return lockChat();
  if(r.status===409&&(r.j.error==="retry_not_needed"||r.j.error==="human_owned"))return loadConv(S.conv.id);
  if(r.status===401){S.me=null;S.loaded=false;sys("Your chat session expired. Please enter your name again.");setTimeout(nameView,1200);return}
  if(r.status===429){if(el)markFailed(el,{id:r.j.saved_message_id||null,text,why:"You are sending messages too fast. Wait a moment."});return}
  if(r.j.error==="maintenance"){add("Support chat is paused for maintenance. Please try again later.","msg err");return}
  if(r.j.error==="ai_disabled"||r.j.error==="not_configured"){add("CHDS AI Support is unavailable right now. Please try again later, or message us through the Contact page.","msg err");return}
  notice(r.j.notice);
  if(el)markFailed(el,{id:r.j.saved_message_id||body.retry_of||null,text,why:r.status===0?(r.j.error==="timeout"?"The reply took too long.":"Connection lost."):"CHDS AI could not answer right now."});
}
async function send(t){
  if(S.busy||!S.conv||S.mode!=="ai")return;
  const sh=S.pending.splice(0);renderPrev();if(!t&&!sh.length)return;
  if(!FLAGS.ai_enabled){sys("CHDS AI Support is unavailable right now. Please try again later, or message us through the Contact page.");return}
  $("#chips").innerHTML="";const el=add(t||"Please review my screenshot.","me pending",sh,null,{live:true});
  let o="";
  if(sh.length){setBusy(true);const w=typing("Reading your screenshot…"),tx=await Promise.all(sh.map(ocr));w&&w.remove();setBusy(false);S.shots=[...S.shots,...sh].slice(-3);o=tx.map((x,i)=>`#${i+1}: ${x||"(no readable text)"}`).join("\n");S.ocr=(S.ocr+" "+tx.join(" ")).trim().slice(-600)}
  await askAI(el,{text:t||"Please review my screenshot.",ocr:o},t);
}
try{sessionStorage.removeItem("chds_live")}catch{}

watch();
})();
