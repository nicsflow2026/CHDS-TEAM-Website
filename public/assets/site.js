"use strict";
(()=>{
const {CONFIG}=window.CHDS;
const API=String(CONFIG.API||"").trim().replace(/\/+$/,""); // "" = same origin (required for the identity cookie)
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const I=(n,c)=>window.CHDSIcon(n,c);
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt=n=>CONFIG.CUR+Math.round(n).toLocaleString();
const tgUrl="https://t.me/"+encodeURIComponent(CONFIG.TG);
window.hydrateIcons();
if($("#yr"))$("#yr").textContent=new Date().getFullYear();

/* ---------- header / nav ---------- */
const hd=$("#hd"),nav=$("#nav"),bg=$("#burger"),pg=$("#pg");
const onScroll=()=>{hd&&hd.classList.toggle("sc",scrollY>12);const h=document.documentElement.scrollHeight-innerHeight;if(pg)pg.style.width=(h>0?scrollY/h*100:0)+"%"};onScroll();addEventListener("scroll",onScroll,{passive:true});
const setNav=o=>{if(!nav||!bg)return;nav.classList.toggle("open",o);hd.classList.toggle("open",o);bg.setAttribute("aria-expanded",String(o));bg.setAttribute("aria-label",o?"Close menu":"Open menu");bg.innerHTML=I(o?"x":"menu")};
if(bg){bg.innerHTML=I("menu");bg.addEventListener("click",()=>setNav(!nav.classList.contains("open")))}
$$("a",nav||document.createElement("div")).forEach(a=>a.addEventListener("click",()=>setNav(false)));
{const p=location.pathname.replace(/\/$/,"").replace(/\.html$/,"")||"/";$$("a",nav||document.createElement("div")).forEach(a=>{const h=(a.getAttribute("href")||"").replace(/\/$/,"")||"/";if(h===p){a.classList.add("on");a.setAttribute("aria-current","page")}})}

/* ---------- reveal ---------- */
const io="IntersectionObserver" in window&&!RM?new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:.1}):null;
const watch=()=>$$(".reveal:not(.in)").forEach(el=>io?io.observe(el):el.classList.add("in"));
$$(".stats,.gfit,.grid2,.grid3,.tgrid").forEach(g=>[...g.children].forEach((c,i)=>c.style.setProperty("--d",Math.min(i,8)*60+"ms")));

/* ---------- status banner (maintenance + public announcements) ---------- */
let FLAGS={maintenance:false,ai_enabled:true,human_enabled:true};
(async()=>{
  try{
    const r=await fetch(API+"/api/public/status",{cache:"no-store"});if(!r.ok)return;
    const j=await r.json();FLAGS={maintenance:!!j.maintenance,ai_enabled:j.ai_enabled!==false,human_enabled:j.human_enabled!==false};
    const items=[];
    if(j.maintenance)items.push(`<div class="maint" role="status">${I("alert-triangle")}<div><b>Scheduled maintenance</b><p>Some services, including the support chat, are temporarily unavailable. Please try again later or message us on Telegram @${esc(CONFIG.TG)}.</p></div></div>`);
    const rank={critical:0,high:1,normal:2,low:3};
    (j.announcements||[]).sort((a,b)=>rank[a.priority]-rank[b.priority]).forEach(a=>items.push(`<div class="${esc(a.priority)}">${I(a.priority==="high"||a.priority==="critical"?"alert-triangle":"megaphone")}<div><b>${esc(a.title)}</b><p>${esc(a.message)}</p></div></div>`));
    if(items.length&&hd){const b=document.createElement("div");b.className="banner";b.setAttribute("aria-label","Announcements");b.innerHTML=items.join("");hd.after(b)}
  }catch(e){console.warn("status unavailable",e)}
})();

/* ---------- team directory (database-backed, approved public fields only) ---------- */
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

/* ---------- contact links + request form ---------- */
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

/* ---------- live results (approved reports only) ---------- */
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
  $("#recent").innerHTML=DATA.recent.length?DATA.recent.map(r=>`<div class="rrow"><div>${esc(r.n)} <span>· ${ago(r.ts)}</span></div><div><b>${r.recovered}</b> recovered · <b>${fmt(r.revenue)}</b></div></div>`).join(""):`<div class="rrow"><span>No approved reports yet.</span></div>`;
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

/* =====================================================================
   CHDS AI Support widget — persistent identity, AI first, human handoff
   ===================================================================== */
const call=async(path,body,method)=>{
  const o={method:method||(body!==undefined?"POST":"GET"),credentials:"same-origin",cache:"no-store",headers:{"X-CHDS-Client":"1"}};
  if(body!==undefined){o.headers["Content-Type"]="application/json";o.body=JSON.stringify(body)}
  let r;try{r=await fetch(API+path,o)}catch{return{ok:false,status:0,j:{error:"network"}}}
  let j={};try{j=await r.json()}catch{}
  return{ok:r.ok,status:r.status,j};
};
const fab=document.createElement("button");fab.id="fab";fab.type="button";fab.setAttribute("aria-label","Open CHDS AI Support chat");fab.setAttribute("aria-expanded","false");fab.setAttribute("aria-controls","chat");fab.innerHTML=I("message-square");
const W=document.createElement("div");W.id="chat";W.setAttribute("role","dialog");W.setAttribute("aria-modal","false");W.setAttribute("aria-label","CHDS support chat");
W.innerHTML=`<div class="ch"><div class="who"><b id="ct">CHDS AI Support</b><small><i class="dot" id="cd"></i><span id="cst">Online</span></small></div>
<button class="cbtn" type="button" id="c-list" aria-label="Your conversations" title="Your conversations">${I("history")}</button>
<button class="cbtn" type="button" id="c-new" aria-label="Start a new conversation" title="New conversation">${I("message-plus")}</button>
<button class="cbtn" type="button" id="cx" aria-label="Close chat">${I("x")}</button></div><div id="cview" style="display:flex;flex-direction:column;flex:1;min-height:0;position:relative"></div>`;
document.body.append(fab,W);
const cview=$("#cview",W);
let S={loaded:false,me:null,convs:[],conv:null,mode:"ai",sid:"",after:0,pollT:0,busy:false,offerReason:null,idem:null,shots:[],ocr:"",pending:[],agentShown:false,unread:0,quota:null,cdT:0};
const setHeader=()=>{
  const human=S.mode!=="ai";
  $("#ct").textContent=human?"CHDS Human Support":"CHDS AI Support";
  $("#cst").textContent=S.mode==="wait"?"Waiting for Agent":S.mode==="human"?"Connected to Human Agent":FLAGS.ai_enabled?"Online · replies instantly":"AI temporarily unavailable";
  $("#cd").className="dot"+(S.mode==="wait"||!FLAGS.ai_enabled?" off":"");
  $("#c-new").hidden=human||!S.me;$("#c-list").hidden=!S.me;
};
const fmtWhen=t=>{try{return new Date(t).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}catch{return""}};
const ST={active:["Active","in"],awaiting_confirmation:["Awaiting your confirmation","wa"],resolved:["Resolved","ok"],handoff:["With Human Support","wa"],closed:["Closed",""]};

function openChat(o){W.classList.toggle("on",o);fab.setAttribute("aria-expanded",String(o));document.body.classList.toggle("chat-open",o);
  if(o){S.unread=0;fab.innerHTML=I("message-square");if(!S.loaded)boot();else setTimeout(()=>{const i=$("#ci")||$("#nm");i&&i.focus()},60)}else fab.focus()}
fab.addEventListener("click",()=>openChat(!W.classList.contains("on")));
$("#cx",W).addEventListener("click",()=>openChat(false));
$$(".open-ai").forEach(b=>b.addEventListener("click",()=>openChat(true)));
addEventListener("keydown",e=>{if(e.key==="Escape"){if(nav&&nav.classList.contains("open"))setNav(false);else if(W.classList.contains("on")){const d=$(".cdlg",W);d?d.remove():openChat(false)}}});

function info(t,icon){cview.innerHTML=`<div class="namebox" role="status">${icon?`<div class="ic">${I(icon)}</div>`:""}<p>${t}</p></div>`}
async function boot(){
  info("Loading…");
  const r=await call("/api/ai/me");
  if(r.status===403){info("This chat is not available for your account. Please contact us on Telegram @"+esc(CONFIG.TG)+".","lock");return}
  if(!r.ok){info(`CHDS AI Support is unavailable right now. Please try again in a moment, or message us on Telegram <a href="${tgUrl}" target="_blank" rel="noopener noreferrer">@${esc(CONFIG.TG)}</a>. <br><br><button class="btn sm" type="button" id="retry">Try again</button>`,"alert-triangle");$("#retry").onclick=boot;return}
  FLAGS=r.j.flags||FLAGS;S.loaded=true;
  if(FLAGS.maintenance){info(`Support chat is paused for maintenance. Please try again later, or message us on Telegram <a href="${tgUrl}" target="_blank" rel="noopener noreferrer">@${esc(CONFIG.TG)}</a>.`,"alert-triangle");setHeader();return}
  if(!r.j.identity){nameView();setHeader();return}
  S.me=r.j.identity;S.convs=r.j.conversations||[];S.quota=r.j.quota||null;
  const open=S.convs.find(c=>c.status!=="resolved"&&c.status!=="closed");
  if(open)await loadConv(open.id,r.j.greeting);else await newConv();
}

/* ---------- first visit: name required ---------- */
function validName(v){
  const s=v.normalize("NFC").replace(/\s+/g," ").trim(),n=[...s].length;
  if(!s)return"Please enter your name.";
  if(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/.test(v))return"Your name contains characters that are not allowed.";
  if(n<2)return"Please enter at least 2 characters.";if(n>60)return"Please keep it under 61 characters.";
  if(!/^[\p{L}\p{M}\p{N} '’\-.,()]+$/u.test(s))return"Please use letters, spaces, hyphens or apostrophes only.";
  if(!/\p{L}/u.test(s))return"Your name must contain at least one letter.";return"";
}
function nameView(){
  cview.innerHTML=`<form class="namebox" id="nf" novalidate><div class="ic">${I("sparkles")}</div><h3>Welcome to CHDS AI Support.</h3><p>Before we begin, what should we call you?</p>
  <label for="nm">Your name</label><input id="nm" name="name" autocomplete="name" maxlength="80" required aria-describedby="nm-err nm-hint">
  <div class="ferr" id="nm-err" role="alert"></div><button class="btn" type="submit">Start chatting ${I("arrow-right")}</button>
  <p class="small" id="nm-hint">We use this name to greet you and to help our team follow your case. It is not treated as a verified identity. Never share passwords or login codes.</p></form>`;
  const f=$("#nf"),inp=$("#nm"),err=$("#nm-err");setTimeout(()=>inp.focus(),60);
  f.addEventListener("submit",async e=>{
    e.preventDefault();const m=validName(inp.value);err.textContent=m;inp.setAttribute("aria-invalid",String(!!m));if(m){inp.focus();return}
    const b=$("button",f);b.disabled=true;b.textContent="Saving…";
    const r=await call("/api/ai/identity",{name:inp.value});
    if(r.ok||r.status===409){
      if(r.status===409){S.loaded=false;return boot()}
      S.me=r.j.identity;S.conv=r.j.conversation;S.convs=[r.j.conversation];renderChat(r.j.messages||[]);setHeader();return;
    }
    b.disabled=false;b.innerHTML=`Start chatting ${I("arrow-right")}`;
    err.textContent=r.status===400?(r.j.message||"Please check your name."):r.status===429?"Too many attempts. Please wait a while and try again.":"We could not save your name. Nothing was saved — please try again.";
    inp.setAttribute("aria-invalid",String(r.status===400));
  });
}

/* ---------- conversations ---------- */
async function newConv(){
  const r=await call("/api/ai/new",{});
  if(!r.ok){if(r.status===401){S.me=null;return nameView()}info("We could not start a conversation. Please try again.","alert-triangle");return}
  S.conv=r.j.conversation;S.convs=[S.conv,...S.convs.filter(c=>c.id!==S.conv.id)];S.idem=null;renderChat(r.j.messages||[]);
}
async function loadConv(id,greet){
  const r=await call("/api/ai/conversation?id="+encodeURIComponent(id));
  if(!r.ok){if(r.status===401){S.me=null;return nameView()}info("This conversation could not be loaded.","alert-triangle");return}
  S.conv=r.j.conversation;S.quota=r.j.quota||S.quota;S.idem=null;
  const msgs=r.j.messages||[],last=msgs[msgs.length-1];
  renderChat(msgs);
  if(greet&&last&&Date.now()-Date.parse(last.created_at)>30*6e4&&S.conv.owner==="ai")add(greet,"bot");
  const h=r.j.handoff;
  if(h&&h.open){S.sid=h.sid;S.after=0;S.agentShown=false;setMode(h.status==="waiting"?"wait":"human");if(h.agent)agentCard(h.agent);markLive(true);poll(true)}
  else{setMode("ai");markLive(false);if(S.conv.status==="awaiting_confirmation")confirmCard()}
}
function listView(){
  clearTimeout(S.pollT);
  cview.innerHTML=`<div class="clist"><p class="small">Signed in as <b>${esc(S.me.display_name)}</b> · visitor ID ${esc(S.me.short_id)}</p>
  <button class="btn sm" type="button" id="l-new">${I("message-plus")} New conversation</button>
  ${S.convs.length?S.convs.map(c=>{const st=ST[c.status]||[c.status,""];return`<button class="citem" type="button" data-id="${esc(c.id)}"><b>${esc(c.title||"New conversation")}</b><small>${esc(fmtWhen(c.updated_at||c.created_at))}</small> <span class="st ${st[1]}">${esc(st[0])}</span></button>`}).join(""):`<p class="small">No conversations yet.</p>`}
  <button class="btn ghost sm" type="button" id="l-name">${I("pencil")} Change my name</button></div>`;
  $("#l-new").onclick=()=>newConv();
  $("#l-name").onclick=renameDlg;
  $$(".citem",cview).forEach(b=>b.onclick=()=>loadConv(b.dataset.id));
}
$("#c-list",W).addEventListener("click",async()=>{if(!S.me)return;const r=await call("/api/ai/conversations");if(r.ok)S.convs=r.j.conversations;listView()});
$("#c-new",W).addEventListener("click",()=>{if(S.me&&S.mode==="ai")newConv()});
function renameDlg(){
  const d=document.createElement("div");d.className="cdlg";d.innerHTML=`<div role="dialog" aria-label="Change your name"><h4>Change your name</h4><input id="rn" value="${esc(S.me.display_name)}" maxlength="80" aria-label="Your name" style="font:inherit;font-size:16px;color:var(--ink);background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:10px 12px"><div class="ferr" id="rn-err" role="alert"></div><div class="btns"><button class="btn ghost sm" type="button" data-x>Cancel</button><button class="btn sm" type="button" data-s>Save</button></div></div>`;
  cview.appendChild(d);$("#rn",d).focus();
  $("[data-x]",d).onclick=()=>d.remove();
  $("[data-s]",d).onclick=async e=>{const v=$("#rn",d).value,m=validName(v);$("#rn-err",d).textContent=m;if(m)return;e.target.disabled=true;
    const r=await call("/api/ai/profile",{name:v});e.target.disabled=false;
    if(r.ok){S.me=r.j.identity;d.remove();listView()}else $("#rn-err",d).textContent=r.status===400?(r.j.message||"Invalid name."):r.status===429?"Too many changes. Try again later.":"Could not save. Please try again."};
}

/* ---------- chat rendering ---------- */
function renderChat(msgs){
  cview.innerHTML=`<div class="cbody" id="msgs" aria-live="polite"></div><div class="chips" id="chips"></div>
  <div class="ctools"><button type="button" class="hu" id="hu">${I("headset")} Talk to a Human Agent</button><button type="button" id="hcancel" hidden>${I("x")} Cancel request</button><button type="button" id="hleave" hidden>${I("log-out")} Leave chat</button></div>
  <div class="prev" id="prev" hidden></div>
  <form class="cin" id="cf"><button type="button" class="cbtn" id="at" aria-label="Attach screenshot">${I("paperclip")}</button><input type="file" id="fi" accept="image/*" multiple hidden><input type="text" id="ci" placeholder="Type your message…" aria-label="Message" maxlength="2000" autocomplete="off"><button class="btn" type="submit" aria-label="Send">${I("send")}</button></form>`;
  msgs.forEach(m=>m.role==="user"?add(m.body,"me"):m.role==="assistant"?add(m.body,"bot"):m.role==="agent"?add(m.body,"ag",null,m.author):add(m.body,"sys"));
  if(msgs.length<=1&&S.conv&&S.conv.owner==="ai")["My account was hacked","Account disabled or locked","Lost Page admin access","I need a website"].forEach(t=>{const b=document.createElement("button");b.type="button";b.textContent=t;b.onclick=()=>send(t);$("#chips").appendChild(b)});
  if(S.conv&&(S.conv.status==="resolved"||S.conv.status==="closed"))resolvedCard();
  wire();setHeader();setTimeout(()=>{const i=$("#ci");i&&i.focus()},60);
}
function add(t,cls,imgs,who){
  const box=$("#msgs");if(!box)return null;const d=document.createElement("div");d.className="msg "+cls;
  if(who){const b=document.createElement("span");b.className="who";b.textContent=who;d.appendChild(b)}
  if(imgs&&imgs.length){const w=document.createElement("div");w.className="thumbs";imgs.forEach(u=>{const i=new Image();i.src=u;i.alt="Attached screenshot";w.appendChild(i)});d.appendChild(w)}
  if(t){const x=document.createElement("span");x.textContent=t;d.appendChild(x)}
  box.appendChild(d);box.scrollTop=box.scrollHeight;
  if(!W.classList.contains("on")&&(cls==="ag"||cls==="sys")){S.unread++;fab.innerHTML=I("message-square")+`<span style="position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#EF4444;font:700 11px/20px var(--font);color:#fff" aria-label="${S.unread} new">${S.unread}</span>`}
  return d;
}
const sys=t=>add(t,"sys");
function card(html){const box=$("#msgs");if(!box)return null;const d=document.createElement("div");d.className="card-in";d.innerHTML=html;box.appendChild(d);box.scrollTop=box.scrollHeight;return d}
function setMode(m){
  S.mode=m;setHeader();
  const hu=$("#hu"),hc=$("#hcancel"),hl=$("#hleave");if(!hu)return;
  hu.hidden=m!=="ai"||!FLAGS.human_enabled;hc.hidden=m!=="wait";hl.hidden=m!=="human";
  $("#chips").innerHTML=m==="ai"?$("#chips").innerHTML:"";
  $("#ci").placeholder=m==="ai"?"Type your message…":m==="wait"?"Add details while you wait…":"Message the CHDS agent…";
}
const markLive=on=>{try{on?sessionStorage.setItem("chds_live",S.conv.id):sessionStorage.removeItem("chds_live")}catch{}};
function offerHuman(reason,why){
  if(!FLAGS.human_enabled)return;
  S.offerReason=reason||S.offerReason||"user_requested";
  const hu=$("#hu");if(hu){hu.classList.remove("hl");void hu.offsetWidth;hu.classList.add("hl")}
  const c=card(`<p>${esc(why||"A CHDS team member can take it from here.")}</p><div class="opts"><button class="opt hum" type="button">${I("headset")} Talk to a Human Agent</button></div>`);
  if(c)$(".opt",c).onclick=()=>confirmHandoff();
}
function confirmCard(){
  const c=card(`<p><b>Have I successfully addressed your concern?</b></p><div class="opts">
    <button class="opt pri" type="button" data-o="resolved">${I("circle-check")} Yes, my concern is resolved.</button>
    <button class="opt" type="button" data-o="not_resolved">${I("refresh")} No, I still need assistance.</button>
    ${FLAGS.human_enabled?`<button class="opt hum" type="button" data-o="human">${I("headset")} Talk to a Human Agent</button>`:""}</div>`);
  if(!c)return;
  $$(".opt",c).forEach(b=>b.onclick=async()=>{
    const o=b.dataset.o;
    if(o==="human"){confirmHandoff("rejected_resolution");return}
    $$(".opt",c).forEach(x=>x.disabled=true);
    const r=await call("/api/ai/resolve",{conversation_id:S.conv.id,outcome:o});
    if(!r.ok){$$(".opt",c).forEach(x=>x.disabled=false);sys(r.status===409?"A human agent is handling this conversation now.":"That could not be saved. Please try again.");return}
    S.conv=r.j.conversation;c.remove();
    if(o==="resolved"){add("Yes, my concern is resolved.","me");sys("Marked as resolved. Thank you for contacting CHDS AI Support.");resolvedCard()}
    else{add("No, I still need assistance.","me");sys("Okay — tell me what is still not working, or talk to a human agent.");offerHuman(r.j.reason,"If my answers did not solve it, a CHDS team member can review your case with the full conversation.");$("#ci").focus()}
  });
}
function resolvedCard(){const c=card(`<p>This conversation is resolved. You can still write here to reopen it, or start fresh.</p><div class="opts"><button class="opt pri" type="button">${I("message-plus")} Start a new conversation</button></div>`);if(c)$(".opt",c).onclick=()=>newConv()}
function agentCard(a){
  if(S.agentShown||!a)return;S.agentShown=true;
  const ini=String(a.name).split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
  const box=$("#msgs");if(!box)return;const d=document.createElement("div");d.className="agentc";
  d.innerHTML=`<div class="av"><b aria-hidden="true">${esc(ini)}</b>${safe(a.photo)?`<img src="${esc(a.photo)}" alt="">`:""}</div><div><strong>Connected to Human Agent</strong><small>${esc(a.name)} · ${esc(a.role||"CHDS Support")}</small></div>`;
  box.appendChild(d);box.scrollTop=box.scrollHeight;
}

/* ---------- screenshots: compress + OCR in the browser (Tesseract.js) ---------- */
const compress=f=>new Promise((res,rej)=>{const u=URL.createObjectURL(f),i=new Image();
  i.onload=()=>{const k=Math.min(1,1280/Math.max(i.width,i.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(i.width*k));c.height=Math.max(1,Math.round(i.height*k));const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(i,0,0,c.width,c.height);URL.revokeObjectURL(u);res(c.toDataURL("image/jpeg",.72))};
  i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("unreadable"))};i.src=u});
let tl;const loadT=()=>tl||(tl=new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";s.onload=()=>res(window.Tesseract);s.onerror=()=>{tl=null;rej(new Error("ocr unavailable"))};document.head.appendChild(s)}));
const ocr=async u=>{try{const T=await loadT(),r=await T.recognize(u,"eng");return(r.data.text||"").replace(/\s+/g," ").trim().slice(0,1000)}catch(e){console.warn("OCR failed",e);return""}};
function renderPrev(){const p=$("#prev");if(!p)return;p.innerHTML="";
  S.pending.forEach((u,i)=>{const w=document.createElement("div");w.className="pv";const im=new Image();im.src=u;im.alt="Selected screenshot";const b=document.createElement("button");b.type="button";b.innerHTML=I("x");b.setAttribute("aria-label","Remove screenshot");b.onclick=()=>{S.pending.splice(i,1);renderPrev()};w.append(im,b);p.appendChild(w)});
  p.hidden=!S.pending.length}

function wire(){
  $("#at").onclick=()=>$("#fi").click();
  $("#fi").onchange=async e=>{for(const f of[...e.target.files]){if(S.pending.length>=3){sys("You can attach up to 3 screenshots per message.");break}
    if(!f.type.startsWith("image/")||f.size>15e6){sys("Please attach image files under 15 MB.");continue}
    try{S.pending.push(await compress(f))}catch{sys("That image could not be read.")}}e.target.value="";renderPrev()};
  $("#cf").addEventListener("submit",e=>{e.preventDefault();const i=$("#ci"),t=i.value.trim();i.value="";send(t)});
  $("#hu").onclick=()=>confirmHandoff();
  $("#hcancel").onclick=()=>leave(true);
  $("#hleave").onclick=()=>leave(false);
}

/* ---------- sending ---------- */
async function send(t){
  if(S.busy||!S.conv)return;
  const sh=S.pending.splice(0);renderPrev();if(!t&&!sh.length)return;
  if(S.mode!=="ai")return sendHuman(t,sh);
  if(!FLAGS.ai_enabled){sys("CHDS AI Support is unavailable right now."+(FLAGS.human_enabled?" You can talk to a human agent instead.":""));if(FLAGS.human_enabled)offerHuman("other");return}
  S.busy=true;$("#chips").innerHTML="";add(t,"me",sh);
  let o="";
  if(sh.length){const w=add("Reading your screenshot…","bot typing"),tx=await Promise.all(sh.map(ocr));w&&w.remove();S.shots=[...S.shots,...sh].slice(-3);o=tx.map((x,i)=>`#${i+1}: ${x||"(no readable text)"}`).join("\n");S.ocr=(S.ocr+" "+tx.join(" ")).trim().slice(-600)}
  const w=add("Typing…","bot typing");
  const r=await call("/api/chat",{conversation_id:S.conv.id,text:t||"Please review my screenshot.",ocr:o});
  w&&w.remove();S.busy=false;
  if(r.ok){
    add(r.j.reply,"bot");S.conv.status=r.j.ask_confirmation?"awaiting_confirmation":"active";
    if(r.j.offer_human)offerHuman(r.j.reason,r.j.reason==="user_requested"?"You asked for a person. Tap below and we'll forward this conversation to the CHDS team.":"This needs a CHDS team member. They will receive this conversation and a summary, so you won't have to repeat yourself.");
    else if(r.j.ask_confirmation)confirmCard();
    return;
  }
  if(r.status===409&&r.j.error==="human_owned"){sys("A human agent is handling this conversation.");await loadConv(S.conv.id);if(S.mode!=="ai"&&t)sendHuman(t,[]);return}
  if(r.status===401){S.me=null;S.loaded=false;sys("Your chat session expired. Please enter your name again.");setTimeout(nameView,1200);return}
  if(r.status===429){add("You are sending messages too fast. Please wait a moment and try again.","msg err");return}
  if(r.j.error==="maintenance"){add("Support chat is paused for maintenance. Please try again later.","msg err");return}
  add("CHDS AI Support could not answer right now. Your message was saved."+(FLAGS.human_enabled?" You can talk to a human agent instead.":" Please try again shortly."),"msg err");
  if(r.j.offer_human&&FLAGS.human_enabled)offerHuman(r.j.reason||"knowledge_limit");
}
async function sendHuman(t,sh){
  S.busy=true;add(t,"me",sh);
  try{for(let i=0;i<Math.max(1,sh.length);i++){const r=await call("/api/human/send",{sid:S.sid,text:i?"":t,img:sh[i]||""});if(!r.ok)throw new Error(String(r.status));if(r.j.st==="ended"){await backToAI();break}}}
  catch{add("Message could not be delivered. Please try again.","msg err")}
  S.busy=false;
}

/* ---------- handoff ---------- */
const newIdem=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");
function confirmHandoff(reason){
  if(!FLAGS.human_enabled||S.mode!=="ai"||$(".cdlg",W))return;
  const q=S.quota,left=q&&typeof q.remaining==="number"?`<p class="small">Human Support requests available: ${q.remaining} of ${q.limit}.</p>`:"";
  const d=document.createElement("div");d.className="cdlg";
  d.innerHTML=`<div role="alertdialog" aria-labelledby="hd-t" aria-describedby="hd-d"><h4 id="hd-t">Connect with Human Support?</h4><p id="hd-d">We'll forward this conversation, a short AI-generated summary${S.shots.length?" and your screenshots":""} to the CHDS team, so you won't need to explain everything again. AI replies pause while an agent handles your case.</p>${left}<div class="ferr" id="hd-err" role="alert"></div><div class="btns"><button class="btn ghost sm" type="button" data-x>Not now</button><button class="btn sm" type="button" data-ok>${I("headset")} Connect</button></div></div>`;
  cview.appendChild(d);$("[data-ok]",d).focus();
  $("[data-x]",d).onclick=()=>d.remove();
  $("[data-ok]",d).onclick=async e=>{
    const b=e.currentTarget;b.disabled=true;b.textContent="Connecting…";$("[data-x]",d).disabled=true;
    S.idem=S.idem||newIdem(); // same key on retry → never a duplicate request
    const r=await call("/api/ai/handoff",{conversation_id:S.conv.id,idempotency_key:S.idem,reason:reason||S.offerReason||"user_requested",imgs:S.shots,ocr:S.ocr});
    if(r.ok){
      d.remove();S.sid=r.j.sid;S.after=0;S.agentShown=false;S.conv.owner="human";setMode("wait");markLive(true);
      // the server's own "Request … sent" message arrives through polling; only add what it does not say
      if(!r.j.existing&&!r.j.notified)sys(`We could not alert the team instantly, but request ${r.j.request_id} stays in the queue and you'll see here when an agent accepts it.`);
      else if(r.j.existing)sys(`Your request ${r.j.request_id} is already with CHDS Human Support.`);
      if(typeof r.j.remaining==="number"&&S.quota)S.quota.remaining=r.j.remaining;
      poll(true);return;
    }
    b.disabled=false;b.innerHTML=`${I("headset")} Connect`;$("[data-x]",d).disabled=false;
    const err=$("#hd-err",d);
    if(r.j.error==="support_limit")return countdown(err,r.j.retry_after,r.j.limit);
    err.textContent=r.j.error==="human_disabled"?"New Human Support requests are paused right now. Please message us on Telegram @"+CONFIG.TG+".":r.j.error==="no_team"?"No support team is configured yet. Please message us on Telegram @"+CONFIG.TG+".":r.status===401?"Your chat session expired. Please refresh the page.":r.status===429?"Please wait a moment before trying again.":"We could not send your request. Nothing was created — please try again.";
  };
}
function countdown(el,sec,limit){
  clearInterval(S.cdT);const end=Date.now()+Math.max(1,sec|0)*1000;
  const tick=()=>{const s=Math.max(0,Math.round((end-Date.now())/1000));
    el.textContent=s?`You've reached the limit of ${limit||3} Human Support requests. You can request again in ${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}.`:"You can request Human Support again now.";
    if(!s)clearInterval(S.cdT)};
  tick();S.cdT=setInterval(tick,1000);
}
async function poll(now){
  clearTimeout(S.pollT);if(S.mode==="ai"||!S.sid)return;
  if(!now){S.pollT=setTimeout(()=>poll(true),document.hidden?6000:2500);return}
  const r=await call(`/api/human/poll?sid=${encodeURIComponent(S.sid)}&after=${S.after}`);
  if(r.ok){
    r.j.msgs.forEach(m=>{S.after=Math.max(S.after,m.i);m.f==="agent"?add(m.t,"ag",null,m.a):sys(m.t)});
    if(r.j.st==="ended"){await backToAI();return}
    if(r.j.st==="live"){if(S.mode!=="human")setMode("human");agentCard(r.j.agent)}
    else{$("#cst").textContent="Waiting for Agent";}
  }else if(r.status===401||r.status===404){await backToAI();return}
  poll(false);
}
async function backToAI(){
  clearTimeout(S.pollT);
  // resume AI only after the backend confirms ownership changed
  const r=await call("/api/ai/conversation?id="+encodeURIComponent(S.conv.id));
  if(r.ok&&r.j.conversation.owner==="ai"){S.conv=r.j.conversation;S.sid="";markLive(false);setMode("ai");if(S.conv.status==="resolved")resolvedCard();return}
  S.pollT=setTimeout(()=>poll(true),4000);
}
function leave(waiting){
  if($(".cdlg",W))return;
  const d=document.createElement("div");d.className="cdlg";
  d.innerHTML=`<div role="alertdialog" aria-labelledby="lv-t"><h4 id="lv-t">${waiting?"Cancel your request?":"Leave the chat with the agent?"}</h4><p>${waiting?"The team will no longer see it in the queue.":"The agent can no longer reply here. CHDS AI Support will continue with the full conversation."}</p><div class="btns"><button class="btn ghost sm" type="button" data-x>Stay</button><button class="btn sm" type="button" data-ok>${waiting?"Cancel request":"Leave chat"}</button></div></div>`;
  cview.appendChild(d);$("[data-x]",d).onclick=()=>d.remove();
  $("[data-ok]",d).onclick=async e=>{e.currentTarget.disabled=true;const r=await call("/api/human/end",{sid:S.sid});d.remove();if(!r.ok){sys("That did not work. Please try again.");return}await backToAI()};
}

// A Human Support chat that was open on another page keeps receiving agent messages here.
try{const live=sessionStorage.getItem("chds_live");if(live)(async()=>{const r=await call("/api/ai/me");if(r.ok&&r.j.identity){FLAGS=r.j.flags||FLAGS;S.me=r.j.identity;S.convs=r.j.conversations||[];S.loaded=true;await loadConv(live)}})()}catch{}

watch();
})();
