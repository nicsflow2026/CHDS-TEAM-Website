"use strict";
(()=>{
"use strict";
const {CONFIG,TEAM}=window.CHDS;
const API=String(CONFIG.API||"").trim().replace(/\/+$/,""); // "" = same origin (Vercel). Only set it if the API lives on another domain.
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt=n=>CONFIG.CUR+Math.round(n).toLocaleString();
const tgUrl="https://t.me/"+encodeURIComponent(CONFIG.TG);

if($("#yr"))$("#yr").textContent=new Date().getFullYear();

/* header / nav */
const hd=$("#hd"),nav=$("#nav"),bg=$("#burger");
const pg=$("#pg"),onScroll=()=>{hd.classList.toggle("sc",scrollY>12);const h=document.documentElement.scrollHeight-innerHeight;pg.style.width=(h>0?scrollY/h*100:0)+"%"};onScroll();addEventListener("scroll",onScroll,{passive:true});
const closeNav=()=>{nav.classList.remove("open");bg.setAttribute("aria-expanded","false")};
bg.onclick=()=>{const o=nav.classList.toggle("open");bg.setAttribute("aria-expanded",o)};
$$("a[href^='#']",nav).forEach(a=>a.addEventListener("click",closeNav));
addEventListener("keydown",e=>{if(e.key==="Escape"){closeNav();setChat(false)}});

/* reveal on scroll */
const io="IntersectionObserver" in window?new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:.12}):null;
const watch=()=>$$(".reveal:not(.in)").forEach(el=>io?io.observe(el):el.classList.add("in"));

/* team */
const safe=u=>/^https?:\/\//i.test(u)?u:"";
const card=m=>{
  const ini=m.n.split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const tg=m.tg?`<a href="https://t.me/${encodeURIComponent(m.tg.replace(/^@/,""))}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.n)} on Telegram">Telegram</a>`:"";
  const fb=safe(m.fb)?`<a href="${esc(m.fb)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.n)} on Facebook">Facebook</a>`:"";
  const im=m.img?`<img src="${esc(m.img)}" alt="${esc(m.n)}" loading="lazy">`:"";
  return `<article class="tcard"><div class="av"><b>${esc(ini)}</b>${im}</div><h4>${esc(m.n)}</h4><small>${esc(m.r)}</small><div class="tl">${tg}${fb}</div></article>`;
};
const TR=$("#team-root");if(TR)TR.innerHTML=[["founder","Founder"],["admin","Admins"],["member","Members"]].map(([g,t])=>{
  const L=TEAM.filter(m=>m.g===g);
  return L.length?`<div class="tg reveal"><h3>${t} <span>${L.length}</span></h3><div class="tgrid ${g}">${L.map(card).join("")}</div></div>`:"";
}).join("");

/* contact links + form */
const ML=$("#main-links");if(ML)ML.innerHTML=`<a href="${tgUrl}" target="_blank" rel="noopener noreferrer">Telegram</a>`+(CONFIG.WA?`<a href="https://wa.me/${encodeURIComponent(CONFIG.WA)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:"")+`<a href="mailto:${esc(CONFIG.EMAIL)}">Email</a>`;
const msgText=()=>`Hi CH Digital Services,\n\nName: ${$("#fn").value.trim()}\nService: ${$("#fs").value}\n\nDetails:\n${$("#fd").value.trim()}`;
if(CONFIG.WA&&$("#wa")){const w=$("#wa");w.hidden=false;w.onclick=()=>{w.href=`https://wa.me/${encodeURIComponent(CONFIG.WA)}?text=${encodeURIComponent(msgText())}`}}
if($("#rf"))$("#rf").addEventListener("submit",async e=>{
  e.preventDefault();
  try{await navigator.clipboard.writeText(msgText());$("#fstat").textContent="Copied. Paste it in the Telegram chat."}catch{$("#fstat").textContent="Open Telegram and send us your details."}
  window.open(tgUrl,"_blank","noopener");
});

/* live data */
let DATA=null,demo=false,metric="revenue",range=30,animate=true,prev={rec:0,rev:0};
const day=t=>new Date(t).toISOString().slice(0,10);
function demoData(){
  const S=[];
  for(let i=29;i>=0;i--)S.push({d:day(Date.now()-i*864e5),revenue:0,recovered:0});
  return{totals:{recovered:0,revenue:0,reports:0},series:S,recent:[],updated:Date.now()};
}
function count(el,to,from,f){
  if(RM||from===to){el.textContent=f(to);return}
  const t0=performance.now();
  (function tick(t){const p=Math.min(1,(t-t0)/900),e=1-Math.pow(1-p,3);el.textContent=f(from+(to-from)*e);if(p<1)requestAnimationFrame(tick)})(t0);
}
const ago=t=>{const s=Math.max(0,(Date.now()-t)/1e3);return s<60?"just now":s<3600?Math.floor(s/60)+"m ago":s<86400?Math.floor(s/3600)+"h ago":Math.floor(s/86400)+"d ago"};
function render(){
  const T=DATA.totals;
  count($("#s-rec"),T.recovered,prev.rec,n=>Math.round(n).toLocaleString());
  count($("#s-rev"),T.revenue,prev.rev,fmt);
  prev={rec:T.recovered,rev:T.revenue};
  $("#s-team").textContent=TEAM.length;
  $("#live-dot").className="dot"+(demo?" off":"");
  $("#c-upd").textContent=demo?"Backend not connected yet. Showing zero until the first approved report.":"Live · updated "+ago(DATA.updated);
  $("#c-title").textContent=metric==="revenue"?"Team revenue":"Accounts recovered";
  $("#recent").innerHTML=DATA.recent.length?DATA.recent.map(r=>`<div class="rrow"><div>${esc(r.n)} <span>· ${ago(r.ts)}</span></div><div><b>${r.recovered}</b> recovered · <b>${fmt(r.revenue)}</b></div></div>`).join(""):`<div class="rrow"><span>No approved reports yet.</span></div>`;
  chart();
}
function chart(){
  const S=DATA.series.slice(-range),box=$("#chart");if(!S.length)return;
  const W=Math.max(300,Math.min(760,$("#cwrap").clientWidth||600)),H=W<500?230:300,L=metric==="revenue"?52:38,R=14,T=16,B=30;
  const v=S.map(d=>d[metric]),m=Math.max(...v,0),e=10**Math.floor(Math.log10(m||1)),mx=m?Math.ceil(m/e*1.1*2)/2*e:4;
  const X=i=>L+i*(W-L-R)/Math.max(1,S.length-1),Y=n=>H-B-n/mx*(H-T-B);
  const P=v.map((n,i)=>[X(i),Y(n)]);
  let ln=`M${P[0][0]},${P[0][1]}`;for(let i=1;i<P.length;i++){const[a,b]=P[i-1],[c,d]=P[i],h=(a+c)/2;ln+=`C${h},${b} ${h},${d} ${c},${d}`}
  const ar=`${ln}L${X(S.length-1)},${H-B}L${X(0)},${H-B}Z`;
  const yl=n=>(metric==="revenue"?CONFIG.CUR:"")+(n>=1000?+(n/1000).toFixed(1)+"k":Math.round(n*10)/10);
  const dl=d=>new Date(d+"T00:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"});
  let g="";for(let k=0;k<=4;k++){const y=Y(mx*k/4);g+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.08)"/><text x="${L-8}" y="${y+4}" text-anchor="end" fill="#a9a4d6" font-size="11">${yl(mx*k/4)}</text>`}
  const xs=[0,Math.floor((S.length-1)/2),S.length-1].filter((x,i,a)=>a.indexOf(x)===i).map(i=>`<text x="${X(i)}" y="${H-8}" text-anchor="${i===0?"start":i===S.length-1?"end":"middle"}" fill="#a9a4d6" font-size="11">${dl(S[i].d)}</text>`).join("");
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric} over the last ${S.length} days"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#3b82f6"/></linearGradient><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7c3aed" stop-opacity=".4"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></linearGradient></defs>${g}${xs}<path class="${animate?"ar":""}" d="${ar}" fill="url(#ag)"/><path class="ln${animate?" anim":""}" pathLength="1" d="${ln}"/><g id="hv" opacity="0"><line y1="${T}" y2="${H-B}" stroke="rgba(255,255,255,.3)" stroke-dasharray="4"/><circle r="5" fill="#fff" stroke="#7c3aed" stroke-width="3"/></g><rect x="${L}" y="0" width="${W-L-R}" height="${H}" fill="transparent" id="hit"/></svg>`;
  animate=false;
  const svg=$("svg",box),hv=$("#hv",box),tip=$("#tip");
  const move=ev=>{
    const r=svg.getBoundingClientRect(),x=(ev.clientX-r.left)/r.width*W,i=Math.max(0,Math.min(S.length-1,Math.round((x-L)/((W-L-R)/Math.max(1,S.length-1)))));
    hv.setAttribute("opacity",1);$("line",hv).setAttribute("x1",X(i));$("line",hv).setAttribute("x2",X(i));$("circle",hv).setAttribute("cx",X(i));$("circle",hv).setAttribute("cy",Y(v[i]));
    tip.innerHTML=`${dl(S[i].d)}<b>${metric==="revenue"?fmt(v[i]):v[i]+" recovered"}</b>`;tip.style.left=(X(i)/W*100)+"%";tip.style.top=(Y(v[i])/H*r.height)+"px";tip.style.opacity=1;
  };
  const out=()=>{hv.setAttribute("opacity",0);tip.style.opacity=0};
  $("#hit",box).addEventListener("pointermove",move);$("#hit",box).addEventListener("pointerdown",move);$("#hit",box).addEventListener("pointerleave",out);
}
async function load(){
  try{
    const r=await fetch(API+"/api/stats",{cache:"no-store"});if(!r.ok)throw 0;
    const j=await r.json();if(!j||!j.totals||!Array.isArray(j.series)||!j.series.length)throw 0;
    DATA=j;demo=false;
  }catch{if(!DATA){DATA=demoData();demo=true}}
  render();
}
$$("[data-m]").forEach(b=>b.onclick=()=>{metric=b.dataset.m;$$("[data-m]").forEach(x=>x.classList.toggle("on",x===b));animate=true;render()});
$$("[data-r]").forEach(b=>b.onclick=()=>{range=+b.dataset.r;$$("[data-r]").forEach(x=>x.classList.toggle("on",x===b));animate=true;chart()});
if($("#cwrap")){let rt;addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(()=>DATA&&chart(),150)});
load();setInterval(()=>{if(!document.hidden)load()},CONFIG.POLL);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)load()});}

/* Support chat: CHDS AI (Groq) + human handoff via Telegram */
const chat=$("#chat"),msgs=$("#msgs"),hist=[];
let sid="";try{sid=sessionStorage.getItem("chds_sid")||""}catch{}
if(!/^[a-f0-9]{16}$/.test(sid)){sid=[...crypto.getRandomValues(new Uint8Array(8))].map(b=>b.toString(16).padStart(2,"0")).join("");try{sessionStorage.setItem("chds_sid",sid)}catch{}}
const flag=v=>{try{v?sessionStorage.setItem("chds_h","1"):sessionStorage.removeItem("chds_h")}catch{}};
let mode="ai",busy=false,after=0,pollT=0,pending=[],shots=[],ocrTxt="";
const post=(p,b)=>fetch(API+p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
const HUMAN=/(real|live)\s*(human|person|agent)|human\s*(support|agent)|talk to (a |an )?(human|person|agent|someone)|speak (to|with) (a |an )?(human|person|agent|someone)|connect.*(human|agent|person)|totoong\s*tao|kausapin.*(tao|agent)/i;

function setMode(m){
  mode=m;const h=m!=="ai";
  $("#ct").textContent=h?"CHDS Human Support":"CHDS AI Support";
  $("#cst").textContent=m==="ai"?"Online · replies instantly":m==="wait"?"Waiting for an agent to join…":"Connected to the CHDS team";
  $("#cd").className="dot"+(m==="wait"?" off":"");
  $("#hu").hidden=h;$("#bk").hidden=!h;
}
function add(t,cls,imgs,who){
  const d=document.createElement("div");d.className="msg "+cls;
  if(who){const b=document.createElement("b");b.className="who";b.textContent=who;d.appendChild(b)}
  if(imgs&&imgs.length){const w=document.createElement("div");w.className="thumbs";imgs.forEach(u=>{const i=new Image();i.src=u;i.alt="Attached screenshot";w.appendChild(i)});d.appendChild(w)}
  if(t){const x=document.createElement("span");x.textContent=t;d.appendChild(x)}
  msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;
}
const sys=t=>add(t,"sys");

/* screenshots: compress + OCR (Tesseract.js, runs in the browser) */
const compress=f=>new Promise((res,rej)=>{
  const u=URL.createObjectURL(f),i=new Image();
  i.onload=()=>{const k=Math.min(1,1280/Math.max(i.width,i.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(i.width*k));c.height=Math.max(1,Math.round(i.height*k));const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(i,0,0,c.width,c.height);URL.revokeObjectURL(u);res(c.toDataURL("image/jpeg",.72))};
  i.onerror=()=>{URL.revokeObjectURL(u);rej()};i.src=u;
});
let tl;const loadT=()=>tl||(tl=new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";s.onload=()=>res(window.Tesseract);s.onerror=()=>{tl=null;rej()};document.head.appendChild(s)}));
const ocr=async u=>{try{const T=await loadT(),r=await T.recognize(u,"eng");return(r.data.text||"").replace(/\s+/g," ").trim().slice(0,1000)}catch{return""}};
function renderPrev(){
  const p=$("#prev");p.innerHTML="";
  pending.forEach((u,i)=>{const w=document.createElement("div");w.className="pv";const im=new Image();im.src=u;im.alt="Selected screenshot";const b=document.createElement("button");b.type="button";b.textContent="✕";b.setAttribute("aria-label","Remove screenshot");b.onclick=()=>{pending.splice(i,1);renderPrev()};w.append(im,b);p.appendChild(w)});
  p.hidden=!pending.length;
}
$("#at").onclick=()=>$("#fi").click();
$("#fi").onchange=async e=>{
  for(const f of [...e.target.files]){
    if(pending.length>=3){sys("You can attach up to 3 screenshots per message.");break}
    if(!f.type.startsWith("image/")||f.size>15e6){sys("Please attach image files under 15 MB.");continue}
    try{pending.push(await compress(f))}catch{sys("That image could not be read.")}
  }
  e.target.value="";renderPrev();
};

/* sending */
async function send(t){
  if(busy)return;
  const sh=pending.splice(0);renderPrev();
  if(!t&&!sh.length)return;
  if(mode!=="ai"){
    busy=true;add(t,"me",sh);
    try{for(let i=0;i<Math.max(1,sh.length);i++){const r=await post("/api/human/send",{sid,text:i?"":t,img:sh[i]||""});const j=await r.json().catch(()=>({}));if(!r.ok)throw 0;if(j.st==="ended"){endHuman();break}}}
    catch{sys("Message could not be delivered. Please try again.")}
    busy=false;return;
  }
  if(!sh.length&&HUMAN.test(t)){add(t,"me");return handoff()}
  busy=true;$("#chips").innerHTML="";add(t,"me",sh);
  let body=t;
  if(sh.length){
    const w=add("Analyzing your screenshot…","bot typing"),tx=await Promise.all(sh.map(ocr));w.remove();
    shots=[...shots,...sh].slice(-3);ocrTxt=(ocrTxt+" "+tx.filter(Boolean).join(" ")).trim().slice(-600);
    body=(t||"Please review my screenshot.")+"\n\n[Screenshot text extracted by OCR]\n"+tx.map((x,i)=>`#${i+1}: ${x||"(no readable text)"}`).join("\n");
  }
  hist.push({role:"user",content:body});
  const w=add("Typing…","bot typing");let out="CHDS AI Support is unavailable right now. Please message us on Telegram @"+CONFIG.TG+".";
  try{const r=await post("/api/chat",{messages:hist.slice(-8)});const j=await r.json().catch(()=>({}));if(r.status===429)out="You are sending messages too fast. Please wait a moment and try again.";else if(r.ok&&j.reply)out=j.reply;else out+=" [ai:"+(j.error||r.status)+"]"}catch{out+=" [ai:network]"}
  w.remove();add(out,"bot");hist.push({role:"assistant",content:out});busy=false;
}

/* human handoff */
async function handoff(){
  if(busy||mode!=="ai")return;busy=true;
  const w=add("Contacting the CHDS team…","bot typing");
  try{
    const r=await post("/api/human/request",{sid,tr:hist.slice(-10).map(m=>({r:m.role==="user"?"user":"ai",c:m.content.split("\n\n[Screenshot")[0]})),imgs:shots,ocr:ocrTxt});
    if(!r.ok)throw 0;w.remove();$("#chips").innerHTML="";after=0;flag(true);setMode("wait");poll();
  }catch{w.remove();sys("Human support is unavailable right now. Please message us on Telegram @"+CONFIG.TG+".")}
  busy=false;
}
async function poll(){
  clearTimeout(pollT);if(mode==="ai")return;
  try{
    const r=await fetch(`${API}/api/human/poll?sid=${sid}&after=${after}`,{cache:"no-store"});
    if(r.ok){
      const j=await r.json();
      j.msgs.forEach(m=>{after=Math.max(after,m.i);m.f==="agent"?add(m.t,"ag",null,m.a):sys(m.t)});
      if(j.st==="ended"){endHuman();return}
      setMode(j.st==="live"?"human":"wait");
    }
  }catch{}
  pollT=setTimeout(poll,document.hidden?6000:2000);
}
function endHuman(){clearTimeout(pollT);flag(false);setMode("ai");shots=[];ocrTxt=""}
$("#bk").onclick=async()=>{try{await post("/api/human/end",{sid})}catch{}sys("CHDS AI Support is back to assist you.");endHuman()};
$("#hu").onclick=()=>{add("Talk to a human","me");handoff()};

/* open / greet */
function setChat(open){chat.classList.toggle("on",open);$("#fab").setAttribute("aria-expanded",open);if(open){if(!msgs.children.length)greet();setTimeout(()=>$("#ci").focus(),60)}}
function greet(){
  add("Hi, I'm CHDS AI Support. I help with Facebook and Instagram account issues. Tell me what happened, and attach a screenshot with 📎 if you have one.","bot");
  ["My account was hacked","Account disabled or locked","Lost page admin access"].forEach(t=>{const b=document.createElement("button");b.type="button";b.textContent=t;b.onclick=()=>send(t);$("#chips").appendChild(b)});
}
$("#cf").addEventListener("submit",e=>{e.preventDefault();const i=$("#ci"),t=i.value.trim();i.value="";send(t)});
$("#fab").onclick=()=>setChat(!chat.classList.contains("on"));$("#cx").onclick=()=>setChat(false);$$(".open-ai").forEach(b=>b.onclick=()=>setChat(true));
try{if(sessionStorage.getItem("chds_h")){setMode("wait");poll()}}catch{}

/* polish: spotlight, stagger, active nav */
document.addEventListener("pointermove",e=>{const c=e.target.closest&&e.target.closest(".stat,.panel,.svc,.step,.tcard");if(c){const r=c.getBoundingClientRect();c.style.setProperty("--mx",(e.clientX-r.left)+"px");c.style.setProperty("--my",(e.clientY-r.top)+"px")}},{passive:true});
$$(".stats,.grid3,.tgrid").forEach(g=>[...g.children].forEach((c,i)=>c.style.setProperty("--d",i*70+"ms")));
{const p=location.pathname.replace(/\/$/,"")||"/";$$("a",nav).forEach(a=>{const h=(a.getAttribute("href")||"").replace(/\/$/,"")||"/";a.classList.toggle("on",h===p)})}
$$("#team-root .av img").forEach(i=>i.addEventListener("error",()=>i.remove()));

watch();
})();
