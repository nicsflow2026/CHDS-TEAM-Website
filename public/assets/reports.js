"use strict";
/* Public report feed: reads /api/public/reports (published reports only, safe fields only, plus photos an
   administrator explicitly approved for public display — served from the PUBLIC image bucket).
   V6: photo carousel per card (scroll-snap, prev/next, swipe), lightbox (keyboard, swipe, focus returns),
   lazy loading, fixed aspect ratios (no layout shift), loading placeholders and a broken-image fallback.
   Live updates by polling every 30 s while the tab is visible. */
(()=>{
const $=s=>document.querySelector(s),I=n=>window.CHDSIcon(n),esc=UX.esc;
const day=d=>d?new Date(d+"T00:00:00+08:00").toLocaleDateString("en-PH",{timeZone:"Asia/Manila",year:"numeric",month:"short",day:"numeric"}):"—";
const when=t=>t?new Date(t).toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}):"—";
const feed=$("#feed"),more=$("#more"),form=$("#ff"),PAGE=12,guard=UX.latest();
let st={q:"",category:"",from:"",to:""},rows=[],total=0,version="",timer=0,ctrl=null,catsLoaded=false;
const qs=o=>new URLSearchParams(Object.entries(o).filter(([,v])=>v!==""&&v!==undefined)).toString();
const safeUrl=u=>{try{const x=new URL(u);return x.protocol==="https:"||x.hostname==="localhost"||x.hostname==="127.0.0.1"?x.href:""}catch{return""}};

/* ---------- photos ---------- */
const photoAlt=(r,p,i,n)=>p.alt||`Photo ${i+1} of ${n} for “${r.title}”`;
function gallery(r){
  const ph=(r.photos||[]).filter(p=>safeUrl(p.url));if(!ph.length)return"";
  const n=ph.length;
  return`<div class="rgal" data-id="${esc(r.id)}" role="region" aria-roledescription="carousel" aria-label="Photos for ${esc(r.title)}">
    <div class="rtrack"${n>1?' tabindex="0" aria-label="Photos. Use the arrow keys to browse."':""}>${ph.map((p,i)=>`<figure class="rslide" aria-roledescription="slide" aria-label="${i+1} of ${n}"><button type="button" class="rph ld" data-open="${i}" aria-label="Open photo ${i+1} of ${n} in full size">
      <img src="${esc(safeUrl(p.url))}" alt="${esc(photoAlt(r,p,i,n))}" loading="lazy" decoding="async"${p.w&&p.h?` width="${+p.w}" height="${+p.h}"`:""}></button></figure>`).join("")}</div>
    ${n>1?`<button type="button" class="rnav prev" data-dir="-1" aria-label="Previous photo">${I("chevron-left")}</button><button type="button" class="rnav next" data-dir="1" aria-label="Next photo">${I("chevron-right")}</button><span class="rcount" aria-live="polite">1 / ${n}</span>`:""}
  </div>`;
}
// image loaded → remove the placeholder; failed → readable fallback instead of a broken icon
function wireImages(root){
  root.querySelectorAll(".rph img,.lbx-img").forEach(im=>{
    const box=im.closest(".rph,.lbx-fig");
    const ok=()=>box&&box.classList.remove("ld");
    const bad=()=>{if(!box)return;box.classList.remove("ld");box.classList.add("broken");im.hidden=true;if(!box.querySelector(".rbroken"))box.insertAdjacentHTML("beforeend",`<span class="rbroken">${I("image")}<span>Image unavailable</span></span>`)};
    if(im.complete){im.naturalWidth?ok():bad()}else{im.addEventListener("load",ok,{once:true});im.addEventListener("error",bad,{once:true})}
  });
}
const rm=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
function slideTo(g,i){const tr=g.querySelector(".rtrack"),n=tr.children.length;i=(i+n)%n;tr.scrollTo({left:i*tr.clientWidth,behavior:rm()?"auto":"smooth"})}
const curIndex=g=>{const tr=g.querySelector(".rtrack");return Math.round(tr.scrollLeft/Math.max(1,tr.clientWidth))};
feed.addEventListener("click",e=>{
  const nav=e.target.closest(".rnav");if(nav){const g=nav.closest(".rgal");slideTo(g,curIndex(g)+Number(nav.dataset.dir));return}
  const op=e.target.closest("[data-open]");if(op){const g=op.closest(".rgal"),r=rows.find(x=>x.id===g.dataset.id);if(r)lightbox(r,Number(op.dataset.open),op)}
});
feed.addEventListener("scroll",e=>{const tr=e.target;if(!tr.classList||!tr.classList.contains("rtrack"))return;const g=tr.closest(".rgal"),c=g.querySelector(".rcount");if(c)c.textContent=`${curIndex(g)+1} / ${tr.children.length}`},true);
feed.addEventListener("keydown",e=>{const tr=e.target.closest&&e.target.closest(".rtrack");if(!tr)return;if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();const g=tr.closest(".rgal");slideTo(g,curIndex(g)+(e.key==="ArrowRight"?1:-1))}});

/* ---------- lightbox ---------- */
let lb=null;
function lightbox(r,start,opener){
  const ph=r.photos.filter(p=>safeUrl(p.url)),n=ph.length;let i=start;
  if(lb)lb.close();
  lb=document.createElement("dialog");lb.className="lbx";lb.setAttribute("aria-label",`Photos for ${r.title}`);
  lb.innerHTML=`<div class="lbx-bar"><span class="lbx-count" aria-live="polite"></span><button type="button" class="lbx-btn" data-x aria-label="Close photo viewer">${I("x")}</button></div>
    <div class="lbx-stage"><figure class="lbx-fig ld"></figure>${n>1?`<button type="button" class="lbx-btn lbx-prev" data-d="-1" aria-label="Previous photo">${I("chevron-left")}</button><button type="button" class="lbx-btn lbx-next" data-d="1" aria-label="Next photo">${I("chevron-right")}</button>`:""}</div>
    <p class="lbx-cap"></p>`;
  document.body.appendChild(lb);
  const fig=lb.querySelector(".lbx-fig"),cap=lb.querySelector(".lbx-cap"),cnt=lb.querySelector(".lbx-count");
  const show=k=>{i=(k+n)%n;const p=ph[i];fig.className="lbx-fig ld";
    fig.innerHTML=`<img class="lbx-img" src="${esc(safeUrl(p.url))}" alt="${esc(photoAlt(r,p,i,n))}" decoding="async"${p.w&&p.h?` width="${+p.w}" height="${+p.h}"`:""}>`;
    cap.textContent=p.alt||r.title;cnt.textContent=n>1?`${i+1} / ${n}`:"";wireImages(lb);
    if(n>1){const nx=new Image();nx.src=safeUrl(ph[(i+1)%n].url)}}; // preload the next photo
  lb.addEventListener("click",e=>{if(e.target===lb||e.target.closest("[data-x]")){lb.close();return}const d=e.target.closest("[data-d]");if(d)show(i+Number(d.dataset.d))});
  lb.addEventListener("keydown",e=>{if(e.key==="ArrowRight"&&n>1)show(i+1);else if(e.key==="ArrowLeft"&&n>1)show(i-1)});
  let x0=null;lb.addEventListener("pointerdown",e=>{x0=e.clientX},{passive:true});
  lb.addEventListener("pointerup",e=>{if(x0===null||n<2)return;const dx=e.clientX-x0;x0=null;if(Math.abs(dx)>45&&!e.target.closest("button"))show(i+(dx<0?1:-1))},{passive:true});
  lb.addEventListener("close",()=>{lb.remove();lb=null;document.documentElement.classList.remove("lbx-open");if(opener&&opener.isConnected)opener.focus()});
  document.documentElement.classList.add("lbx-open");show(i);lb.showModal();lb.querySelector("[data-x]").focus();
}

/* ---------- cards ---------- */
const card=r=>`<article class="rcard${r.photos&&r.photos.length?" has-ph":""}">${gallery(r)}<div class="rbody"><span class="chip">${esc(r.category_label)}</span><h3>${esc(r.title)}</h3>${r.summary?`<p>${esc(r.summary)}</p>`:""}
  <div class="rmeta"><span>${I("calendar")} Activity: ${esc(day(r.activity_date))}</span><span>${I("circle-check")} Published ${esc(when(r.published_at))}</span><span>${I("user")} ${esc(r.member)}</span>${r.recovered?`<span>${I("shield-check")} ${esc(r.recovered)} recovered</span>`:""}</div></div></article>`;
function render(){
  feed.removeAttribute("aria-busy");
  if(!rows.length){feed.innerHTML=`<div class="ux-state">${I("inbox")}<span>${st.q||st.category||st.from||st.to?"No published reports match these filters. Clear a filter to see more.":"No reports have been published yet."}</span></div>`;more.hidden=true;$("#cnt").textContent="";return}
  feed.innerHTML=`<div class="rgrid">${rows.map(card).join("")}</div>`;wireImages(feed);
  $("#cnt").textContent=`${rows.length} of ${total} report${total===1?"":"s"}`;more.hidden=rows.length>=total;
}
async function fetchPage(offset){
  if(ctrl)ctrl.abort();ctrl=new AbortController();
  const r=await UX.fetchJSON("/api/public/reports?"+qs({...st,offset,limit:PAGE}),{signal:ctrl.signal,timeout:15000});
  if(r.aborted)throw Object.assign(new Error("aborted"),{name:"AbortError"});
  if(!r.ok)throw new Error(r.j.message||"The server answered "+r.status+".");return r.j;
}
function setLive(ok,msg){$("#lv").classList.toggle("off",!ok);$("#lvt").textContent=msg}
const stamp=()=>"Live · updated "+new Date().toLocaleTimeString("en-PH",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit"});
async function load(reset=true){
  const t=guard.next();
  if(reset){feed.setAttribute("aria-busy","true");feed.innerHTML=UX.skeleton("cards",6,{img:true});rows=[]}
  try{
    const j=await fetchPage(reset?0:rows.length);if(!guard.is(t))return; // a newer search replaced this one
    if(!catsLoaded&&j.categories){$("#fc").insertAdjacentHTML("beforeend",j.categories.map(([k,l])=>`<option value="${esc(k)}">${esc(l)}</option>`).join(""));catsLoaded=true}
    rows=reset?j.rows:[...rows,...j.rows.filter(x=>!rows.some(y=>y.id===x.id))];total=j.total;if(reset)version=j.version;render();setLive(true,stamp());
  }catch(e){if(e.name==="AbortError"||!guard.is(t))return;console.warn("feed load failed",e);
    if(reset){feed.removeAttribute("aria-busy");feed.innerHTML=`<div class="ux-state err" role="alert">${I("alert-triangle")}<span>Reports could not be loaded. ${esc(e.message)}</span><button class="btn ghost sm" type="button" id="retry">${I("refresh")} Try again</button></div>`;$("#retry").onclick=()=>load(true)}
    setLive(false,"Offline · retrying");}
}
// poll: re-render only when the first page changed (the server version hash covers photos, publications and deletions)
async function poll(){
  clearTimeout(timer);
  if(!document.hidden&&!lb){try{const j=await fetchPage(0);if(j.version!==version){version=j.version;total=j.total;
      const keep=rows.slice(j.rows.length).filter(r=>!j.rows.some(x=>x.id===r.id));rows=j.rows.concat(keep).slice(0,Math.max(j.rows.length,Math.min(total,rows.length)));render()}
    setLive(true,stamp())}catch(e){if(e.name!=="AbortError"){console.warn("feed poll failed",e);setLive(false,"Offline · retrying")}}}
  timer=setTimeout(poll,30000);
}
let deb;const onFilter=()=>{clearTimeout(deb);deb=setTimeout(()=>{new FormData(form).forEach((v,k)=>st[k]=String(v).trim());load(true)},300)};
form.addEventListener("input",onFilter);form.addEventListener("change",onFilter);form.addEventListener("submit",e=>e.preventDefault());
more.addEventListener("click",()=>UX.run(more,()=>load(false),{label:"Loading…"}));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll()});
addEventListener("pagehide",()=>{clearTimeout(timer);if(ctrl)ctrl.abort()});
load(true).then(()=>{timer=setTimeout(poll,30000)});
})();
