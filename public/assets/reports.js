"use strict";
/* Public report feed: reads /api/public/reports (published reports only, safe fields only).
   Live updates by polling every 30 s while the tab is visible (no Realtime: the database is not exposed to browsers). */
(()=>{
const $=s=>document.querySelector(s),I=(n)=>window.CHDSIcon(n);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const day=d=>d?new Date(d+"T00:00:00+08:00").toLocaleDateString("en-PH",{timeZone:"Asia/Manila",year:"numeric",month:"short",day:"numeric"}):"—";
const when=t=>t?new Date(t).toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}):"—";
const feed=$("#feed"),more=$("#more"),form=$("#ff"),PAGE=12;
let st={q:"",category:"",from:"",to:""},rows=[],total=0,version="",timer=0,ctrl=null,catsLoaded=false;
const qs=o=>new URLSearchParams(Object.entries(o).filter(([,v])=>v!==""&&v!==undefined)).toString();
const card=r=>`<article class="rcard"><span class="chip">${esc(r.category_label)}</span><h3>${esc(r.title)}</h3>${r.summary?`<p>${esc(r.summary)}</p>`:""}
  <div class="rmeta"><span>${I("calendar")} Activity: ${esc(day(r.activity_date))}</span><span>${I("circle-check")} Published ${esc(when(r.published_at))}</span><span>${I("user")} ${esc(r.member)}</span>${r.recovered?`<span>${I("shield-check")} ${esc(r.recovered)} recovered</span>`:""}</div></article>`;
function render(){
  feed.removeAttribute("aria-busy");
  if(!rows.length){feed.innerHTML=`<div class="state-box">${I("inbox")}<span>${st.q||st.category||st.from||st.to?"No published reports match these filters.":"No reports have been published yet."}</span></div>`;more.hidden=true;$("#cnt").textContent="";return}
  feed.innerHTML=`<div class="rgrid">${rows.map(card).join("")}</div>`;
  $("#cnt").textContent=`${rows.length} of ${total} report${total===1?"":"s"}`;more.hidden=rows.length>=total;
}
async function fetchPage(offset){
  if(ctrl)ctrl.abort();ctrl=new AbortController();
  const r=await fetch("/api/public/reports?"+qs({...st,offset,limit:PAGE}),{cache:"no-store",signal:ctrl.signal});
  if(!r.ok)throw new Error("HTTP "+r.status);return r.json();
}
function setLive(ok,msg){$("#lv").classList.toggle("off",!ok);$("#lvt").textContent=msg}
async function load(reset=true){
  if(reset){feed.setAttribute("aria-busy","true");rows=[]}
  try{
    const j=await fetchPage(reset?0:rows.length);
    if(!catsLoaded&&j.categories){$("#fc").insertAdjacentHTML("beforeend",j.categories.map(([k,l])=>`<option value="${esc(k)}">${esc(l)}</option>`).join(""));catsLoaded=true}
    rows=reset?j.rows:[...rows,...j.rows];total=j.total;if(reset)version=j.version;render();
    setLive(true,"Live · updated "+new Date().toLocaleTimeString("en-PH",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit"}));
  }catch(e){if(e.name==="AbortError")return;console.warn("feed load failed",e);
    if(reset){feed.removeAttribute("aria-busy");feed.innerHTML=`<div class="state-box err" role="alert">${I("alert-triangle")}<span>Reports could not be loaded. Check your connection.</span><button class="btn ghost sm" type="button" id="retry">${I("refresh")} Try again</button></div>`;$("#retry").onclick=()=>load(true)}
    setLive(false,"Offline · retrying");}
}
// poll: only re-render when the first page actually changed (version hash from the server)
async function poll(){
  clearTimeout(timer);
  if(!document.hidden){try{const j=await fetchPage(0);if(j.version!==version){version=j.version;total=j.total;rows=j.rows.concat(rows.slice(j.rows.length).filter(r=>!j.rows.some(x=>x.id===r.id)));if(rows.length>total)rows=rows.slice(0,Math.max(j.rows.length,total));render()}
    setLive(true,"Live · updated "+new Date().toLocaleTimeString("en-PH",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit"}))}catch(e){if(e.name!=="AbortError"){console.warn("feed poll failed",e);setLive(false,"Offline · retrying")}}}
  timer=setTimeout(poll,30000);
}
let deb;const onFilter=()=>{clearTimeout(deb);deb=setTimeout(()=>{new FormData(form).forEach((v,k)=>st[k]=String(v).trim());load(true)},300)};
form.addEventListener("input",onFilter);form.addEventListener("change",onFilter);form.addEventListener("submit",e=>e.preventDefault());
more.addEventListener("click",async()=>{more.disabled=true;await load(false);more.disabled=false});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll()});
addEventListener("pagehide",()=>{clearTimeout(timer);if(ctrl)ctrl.abort()});
load(true).then(()=>{timer=setTimeout(poll,30000)});
})();
