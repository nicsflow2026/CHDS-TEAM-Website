"use strict";
/* CHDS V6 — shared loading & request helpers (window.UX). No dependencies.
   • busy/run: idle → loading → success | error, duplicate clicks ignored, state always cleaned up (finally)
   • fetchJSON: timeout + cancellation, never throws, never hangs
   • latest(): stale-response guard (only the newest request may render)
   • upload(): XHR with real upload progress; success only when the server confirms
   • skeleton(): placeholders shaped like the content
   • announce(): polite screen-reader announcements; top progress bar for navigation */
window.UX=(()=>{
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let live=null;
function announce(msg){if(!live){live=document.createElement("div");live.className="ux-sr";live.setAttribute("aria-live","polite");live.setAttribute("role","status");document.body.appendChild(live)}live.textContent="";setTimeout(()=>{live.textContent=msg},40)}

/* ---- buttons ---- */
function busy(btn,on,label){
  if(!btn)return;
  if(on){if(btn.dataset.uxState==="loading")return;btn.dataset.uxOrig=btn.dataset.uxOrig||btn.innerHTML;btn.dataset.uxState="loading";btn.setAttribute("aria-busy","true");btn.disabled=true;
    btn.innerHTML=`<span class="ux-lbl"><span class="ux-spin" aria-hidden="true"></span>${esc(label||"Working…")}</span>`;return}
  if(btn.dataset.uxOrig!==undefined)btn.innerHTML=btn.dataset.uxOrig;delete btn.dataset.uxOrig;delete btn.dataset.uxState;btn.removeAttribute("aria-busy");btn.disabled=false;
}
function flash(btn,state,label,ms=1400){
  if(!btn||!btn.isConnected)return;const orig=btn.dataset.uxOrig||btn.innerHTML;btn.dataset.uxState=state;
  if(label)btn.innerHTML=`<span class="ux-lbl">${state==="success"?"✓ ":""}${esc(label)}</span>`;
  setTimeout(()=>{if(btn.dataset.uxState===state){delete btn.dataset.uxState;if(label)btn.innerHTML=orig}},ms);
}
// run(btn, async fn, {label, success, error}) → fn's result, or undefined when the button was already busy.
async function run(btn,fn,o={}){
  if(btn&&btn.dataset.uxState==="loading")return undefined; // duplicate submission
  busy(btn,true,o.label);
  let out,ok=false;
  try{out=await fn();ok=out===undefined||out===true||(out&&out.ok!==false)}
  catch(e){console.error(e);out={ok:false,error:e}}
  finally{busy(btn,false)}
  if(btn){flash(btn,ok?"success":"error",ok?o.success:o.error);if(o.success&&ok)announce(o.success)}
  return out;
}

/* ---- requests ---- */
async function fetchJSON(url,{method,body,headers={},timeout=20000,signal}={}){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort("timeout"),timeout);
  if(signal){if(signal.aborted)ctl.abort("cancel");else signal.addEventListener("abort",()=>ctl.abort("cancel"),{once:true})}
  const o={method:method||(body!==undefined?"POST":"GET"),credentials:"same-origin",cache:"no-store",headers:{...headers},signal:ctl.signal};
  if(body!==undefined){o.headers["Content-Type"]="application/json";o.body=JSON.stringify(body)}
  try{const r=await fetch(url,o);let j={};try{j=await r.json()}catch{/* non-JSON body */}return{ok:r.ok,status:r.status,j}}
  catch(e){const to=ctl.signal.reason==="timeout";return{ok:false,status:0,aborted:!to&&ctl.signal.aborted,timedOut:to,j:{error:to?"timeout":"network",message:to?"The request took too long. Check your connection and try again.":"Network error. Check your connection and try again."}}}
  finally{clearTimeout(t)}
}
function latest(){let n=0;return{next:()=>++n,is:t=>t===n}}

// upload(url, payload, {headers, onProgress(0..1), timeout}) — JSON body; progress from the browser upload events.
function upload(url,payload,{headers={},onProgress,timeout=60000}={}){
  return new Promise(res=>{
    const x=new XMLHttpRequest();x.open("POST",url);x.withCredentials=true;x.timeout=timeout;x.setRequestHeader("Content-Type","application/json");
    for(const[k,v]of Object.entries(headers))x.setRequestHeader(k,v);
    if(onProgress)x.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.min(.98,e.loaded/e.total))}; // 100% only after the server answered
    const done=(ok,status,j)=>res({ok,status,j});
    x.onload=()=>{let j={};try{j=JSON.parse(x.responseText||"{}")}catch{/* non-JSON */}if(x.status>=200&&x.status<300&&onProgress)onProgress(1);done(x.status>=200&&x.status<300,x.status,j)};
    x.onerror=()=>done(false,0,{error:"network",message:"Upload failed: network error."});
    x.ontimeout=()=>done(false,0,{error:"timeout",message:"Upload took too long. Try again."});
    x.send(JSON.stringify(payload));
  });
}

/* ---- placeholders ---- */
function skeleton(kind,n=3,o={}){
  const L=w=>`<div class="ux-sk line ${w||""}"></div>`;
  if(kind==="table"){const c=o.cols||4;return`<div class="ux-sk-table" style="--ux-cols:2fr ${"1fr ".repeat(Math.max(1,c-1))}" aria-busy="true" aria-label="Loading">${Array.from({length:n+1},()=>`<div class="r">${'<div class="ux-sk"></div>'.repeat(c)}</div>`).join("")}</div>`}
  if(kind==="cards")return`<div class="ux-sk-cards" aria-busy="true" aria-label="Loading">${Array.from({length:n},()=>`<div class="ux-sk-card">${o.img?'<div class="ux-sk img"></div>':""}<div class="ux-sk title"></div>${L("w80")}${L("w60")}</div>`).join("")}</div>`;
  if(kind==="kpis")return`<div class="ux-sk-cards" aria-busy="true" aria-label="Loading">${Array.from({length:n},()=>`<div class="ux-sk-card">${L("w40")}<div class="ux-sk title" style="height:28px;width:60%"></div></div>`).join("")}</div>`;
  if(kind==="detail")return`<div aria-busy="true" aria-label="Loading"><div class="ux-sk title"></div>${Array.from({length:n},(_, i)=>L(["w80","w60","w40"][i%3])).join("")}</div>`;
  if(kind==="bubbles")return`<div class="ux-sk-bubbles" aria-busy="true" aria-label="Loading conversation"><div class="ux-sk b"></div><div class="ux-sk b me"></div><div class="ux-sk b"></div><div class="ux-sk b s"></div></div>`;
  return`<div aria-busy="true" aria-label="Loading">${Array.from({length:n},()=>L("w80")).join("")}</div>`;
}

/* ---- navigation progress bar ---- */
let barEl=null,barT=0;
const bar={start(){if(!barEl){barEl=document.createElement("div");barEl.id="ux-bar";barEl.setAttribute("aria-hidden","true");document.body.appendChild(barEl)}clearTimeout(barT);barEl.classList.add("on");barEl.style.width="12%";requestAnimationFrame(()=>{barEl.style.width="72%"})},
  done(){if(!barEl)return;barEl.style.width="100%";barT=setTimeout(()=>{barEl.classList.remove("on");barEl.style.width="0"},260)}};
document.addEventListener("click",e=>{const a=e.target.closest&&e.target.closest("a[href]");if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==="_blank"||a.hasAttribute("download"))return;
  let u;try{u=new URL(a.href,location.href)}catch{return}if(u.origin!==location.origin||(u.pathname===location.pathname&&u.hash))return;if(u.pathname.startsWith("/api/"))return;bar.start()});
addEventListener("pageshow",()=>bar.done());

return{esc,announce,busy,flash,run,fetchJSON,latest,upload,skeleton,bar};
})();
