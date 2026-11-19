"use strict";
/* CHDS admin views (part 3, V5): Closed Cases, AI Knowledge Base (+ AI instructions, quick replies), Operations Analytics. */
(()=>{
const A=window.ADM,{$,$$,h,I,num,when,day,dur,ago,badge,api,errText,toast,loading,empty,errorBox,page,kpis,table,confirmAct,formDlg,chart,crumbs,has}=A;
const V=A.views;

/* ---------------- Closed Cases (view_closed_cases) ---------------- */
V["closed-cases"]=async(el,[id])=>{
  if(id)return A.handoffDetail(el,id);
  const meta=await api("closed_cases_list?limit=1");if(!meta.ok){el.innerHTML=errorBox(errText(meta));$("[data-retry]",el).onclick=A.go;return}
  A.list(el,{title:"Closed Cases",icon:"lock",desc:"Human Support cases closed with <b>Close This Case</b>. They are locked: customers, agents and CHDS AI can no longer add messages. History stays readable; reopening is a separate audited administrator action.",op:"closed_cases_list",
    filters:[{n:"q",l:"Search case ID, reason or closer",w:1},{n:"from",l:"Closed from",t:"date"},{n:"to",l:"Closed to",t:"date"},
      {n:"agent",l:"Assigned agent",t:"select",o:[["","All agents"],...meta.j.agents.map(([u,n])=>[u,`${n} (…${u.slice(-4)})`])]},{n:"closer",l:"Closed by",t:"select",o:[["","Anyone"],...meta.j.closers.map(([u,n])=>[u,`${n} (…${u.slice(-4)})`])]}],
    cols:[{l:"Case",f:x=>`<b>${h(x.id)}</b><br><span class="small">${h(x.user?.display_name||"")}</span>`},{l:"Assigned agent",f:x=>h(x.assigned_name||"—")},{l:"Closed by",f:x=>h(x.closed_by_name||x.closed_by||"—")},
      {l:"Closed",f:x=>when(x.closed_at)},{l:"Status before",f:x=>badge(x.status_before_close||"—")},{l:"Reason",f:x=>h(x.close_reason||"—"),c:"wide"},{l:"CSAT",f:x=>x.csat_rating?`${x.csat_rating}/5`:"—",c:"num"}],
    emptyText:"No closed cases match these filters.",click:x=>location.hash="#/closed-cases/"+x.id});
};

/* ---------------- AI Knowledge Base (manage_knowledge_base) ---------------- */
async function kbForm(e,reload){
  formDlg({title:e?`Edit “${e.title}”`:"New knowledge entry",intro:"The AI uses enabled entries when they are relevant to the customer's question. Write verified facts only. Entries that ask customers for passwords, codes, cookies or tokens are refused (Never-Ask-For-Password policy).",
    fields:[{n:"title",l:"Title / question",v:e?.title,req:true,ml:120},[{n:"category",l:"Category",v:e?.category||"general",ml:40,h:"lowercase, e.g. pricing, security, process"},{n:"sort_order",l:"Order",t:"number",min:0,max:100000,v:e?.sort_order??100}],
      {n:"body",l:"Answer / content",t:"textarea",v:e?.body,req:true,ml:4000},{n:"keywords",l:"Keywords (comma separated)",v:(e?.keywords||[]).join(", "),ml:400,h:"Words customers use; they help the AI find this entry."},
      [{n:"is_faq",l:"Frequently asked question",t:"checkbox",v:e?e.is_faq:false},{n:"enabled",l:"Enabled",t:"checkbox",v:e?e.enabled:true}]],
    onSubmit:async v=>{const r=await api("kb_save",{...v,id:e?.id,sort_order:Number(v.sort_order)});if(r.ok){toast("Knowledge entry saved.","ok");reload();return true}return errText(r)}});
}
async function qrForm(q,reload){
  formDlg({title:q?`Edit quick reply “${q.title}”`:"New quick reply",intro:"Agents insert quick replies into Human Support messages. They can never ask customers for passwords, one-time codes, login or recovery codes, cookies or tokens.",
    fields:[[{n:"title",l:"Title",v:q?.title,req:true,ml:60},{n:"sort_order",l:"Order",t:"number",min:0,max:100000,v:q?.sort_order??100}],{n:"body",l:"Reply text",t:"textarea",v:q?.body,req:true,ml:1000},{n:"enabled",l:"Enabled",t:"checkbox",v:q?q.enabled:true}],
    onSubmit:async v=>{const r=await api("quick_reply_save",{...v,id:q?.id,sort_order:Number(v.sort_order)});if(r.ok){toast("Quick reply saved.","ok");reload();return true}return errText(r)}});
}
V.knowledge=async el=>{
  el.innerHTML=`<div data-kb></div><div class="grid g2" style="margin-top:16px"><div class="card" data-ins>${loading(2)}</div><div class="card" data-qr>${loading(2)}</div></div>`;
  const kbBox=$("[data-kb]",el);
  const L=A.list(kbBox,{title:"AI Knowledge Base",icon:"book-open",desc:"Business knowledge and FAQs for CHDS AI Support (Groq). The fixed CHDS rules and the mandatory security policy always apply after these entries.",
    actions:`<button class="btn sm" type="button" data-newkb>${I("plus")} New entry</button>`,op:"kb_list",limit:50,
    filters:[{n:"q",l:"Search",w:1},{n:"enabled",l:"Status",t:"select",o:[["","All"],["1","Enabled"],["0","Disabled"]]},{n:"faq",l:"Type",t:"select",o:[["","All"],["1","FAQs only"]]}],
    cols:[{l:"Entry",f:e=>`<b>${h(e.title)}</b><br><span class="small">${h(e.body.slice(0,140))}${e.body.length>140?"…":""}</span>`,c:"wide"},{l:"Category",f:e=>`<span class="bd">${h(e.category)}</span>`},{l:"FAQ",f:e=>e.is_faq?"yes":"—"},
      {l:"Status",f:e=>badge(e.enabled?"active":"inactive").replace(">inactive<",">disabled<").replace(">active<",">enabled<")},{l:"Updated",f:e=>ago(e.updated_at)},
      {l:"Actions",f:e=>`<div class="acts"><button class="btn ghost sm" data-act="edit" aria-label="Edit ${h(e.title)}">${I("pencil")}</button><button class="btn ghost sm" data-act="toggle">${e.enabled?"Disable":"Enable"}</button><button class="btn danger sm" data-act="del" aria-label="Delete ${h(e.title)}">${I("trash")}</button></div>`}],
    emptyText:"No knowledge entries yet.",
    act:async(a,e,b,reload)=>{
      if(a==="edit")return kbForm(e,reload);
      if(a==="toggle"){if((await A.run("kb_toggle",{id:e.id,enabled:!e.enabled},e.enabled?"Entry disabled.":"Entry enabled.")).ok)reload();return}
      if(a==="del"){const c=await confirmAct({title:`Delete “${e.title}”?`,text:"The AI stops using it. The change is recorded in the audit log.",danger:true,confirm:"Delete"});if(c&&(await A.run("kb_delete",{id:e.id},"Entry deleted.")).ok)reload()}
    }});
  $("[data-newkb]",kbBox).onclick=()=>kbForm(null,L.reload);
  // AI instructions
  const ins=$("[data-ins]",el);
  const loadIns=async()=>{const r=await api("ai_instructions_get");if(!r.ok){ins.innerHTML=errorBox(errText(r));return}
    ins.innerHTML=`<h3>${I("bot")} AI instructions</h3><p class="small">${h(r.j.note)}</p><form data-insf style="display:grid;gap:8px"><label for="ai_ins">Additional instructions for CHDS AI Support</label><textarea id="ai_ins" maxlength="3000" style="min-height:140px">${h(r.j.instructions)}</textarea><div class="ferr" role="alert"></div><button class="btn sm" type="submit" style="justify-self:start">Save instructions</button></form>`;
    $("[data-insf]",ins).addEventListener("submit",async e=>{e.preventDefault();const b=$("[type=submit]",ins);b.disabled=true;const x=await api("ai_instructions_save",{instructions:$("#ai_ins",ins).value});b.disabled=false;
      if(x.ok){toast("AI instructions saved.","ok");$(".ferr",ins).textContent=""}else $(".ferr",ins).textContent=errText(x)})};
  // Quick replies
  const qb=$("[data-qr]",el);
  const loadQr=async()=>{const r=await api("quick_replies_list?all=1");if(!r.ok){qb.innerHTML=errorBox(errText(r));return}
    qb.innerHTML=`<h3>${I("message-plus")} Quick replies</h3><p class="small">Reusable Human Support answers for agents.</p><div class="acts" style="margin-bottom:10px"><button class="btn sm" type="button" data-newqr>${I("plus")} New quick reply</button></div>`+
      table([{l:"Title",f:q=>`<b>${h(q.title)}</b><br><span class="small">${h(q.body.slice(0,90))}${q.body.length>90?"…":""}</span>`},{l:"Status",f:q=>q.enabled?"enabled":"disabled"},{l:"",f:(q,i)=>`<div class="acts"><button class="btn ghost sm" data-qe="${h(q.id)}" aria-label="Edit ${h(q.title)}">${I("pencil")}</button><button class="btn danger sm" data-qd="${h(q.id)}" aria-label="Delete ${h(q.title)}">${I("trash")}</button></div>`}],r.j.rows,{emptyText:"No quick replies yet."});
    $("[data-newqr]",qb).onclick=()=>qrForm(null,loadQr);
    $$("[data-qe]",qb).forEach(b=>b.onclick=()=>qrForm(r.j.rows.find(x=>x.id===b.dataset.qe),loadQr));
    $$("[data-qd]",qb).forEach(b=>b.onclick=async()=>{const q=r.j.rows.find(x=>x.id===b.dataset.qd);const c=await confirmAct({title:`Delete “${q.title}”?`,text:"Agents can no longer insert it.",danger:true,confirm:"Delete"});if(c&&(await A.run("quick_reply_delete",{id:q.id},"Quick reply deleted.")).ok)loadQr()})};
  await Promise.all([loadIns(),loadQr()]);
};

/* ---------------- Operations Analytics ---------------- */
const PRESETS=[["today","Today"],["this_week","This week"],["this_month","This month"],["last_month","Last month"],["this_year","This year"],["last_year","Last year"],["all","All time"],["custom","Custom range"]];
V["ops-analytics"]=async el=>{
  const st={preset:"this_month",from:"",to:"",basis:"activity"};
  const draw=async()=>{
    const box=$("[data-oa]",el);box.setAttribute("aria-busy","true");box.innerHTML=loading(3);
    const r=await api("ops_analytics?"+A.qs(st));box.removeAttribute("aria-busy");
    if(!r.ok){box.innerHTML=errorBox(errText(r));$("[data-retry]",box).onclick=draw;return}
    const o=r.j,R=o.reports,S=o.support,k=[];
    if(R)k.push({l:`Reports (${o.basis==="submission"?"submitted":"activity date"} in range)`,v:num(R.total),i:"file-text"},{l:"Approved",v:num(R.approved),i:"circle-check"},{l:"Rejected",v:num(R.rejected),i:"circle-x"},{l:"Published",v:num(R.published),i:"globe"},{l:"Corrections requested",v:num((R.by_status||{}).changes_requested||0),i:"pencil"});
    if(S)k.push({l:"Active support cases now",v:num(S.active_now),i:"headset"},{l:"Cases created",v:num(S.created),i:"inbox"},{l:"Closed (locked) in range",v:num(S.closed_in_range),i:"lock"},{l:"Avg first response",v:dur(S.avg_first_response_sec),i:"clock",s:`SLA ${num(o.sla.first_response_minutes)} min`},{l:"Avg resolution",v:dur(S.avg_resolution_sec),i:"clock",s:`SLA ${num(o.sla.resolution_hours)} h`},{l:"Customer satisfaction",v:S.csat_avg===null||S.csat_avg===undefined?"—":S.csat_avg+" / 5",i:"star",s:`${num(S.csat_count)} rating(s)`});
    box.innerHTML=kpis(k)+`<div class="grid g2">${R?`<div class="card"><h3>${I("bar-chart")} Reports by month (${o.basis==="submission"?"submission date":"activity date"})</h3>${chart({labels:R.by_month.map(m=>m.month),series:[{name:"Total",values:R.by_month.map(m=>m.total)},{name:"Approved",values:R.by_month.map(m=>m.approved),color:"#22C55E"},{name:"Published",values:R.by_month.map(m=>m.published),color:"#38BDF8"}],title:"Reports by month"})}
        <p class="small">By status: ${Object.entries(R.by_status).map(([s2,n])=>`${badge(s2)} ${num(n)}`).join(" ")||"—"}</p></div>`:""}
      ${S?`<div class="card"><h3>${I("users")} Agent workload</h3>${table([{l:"Agent",f:w=>`${h(w.agent)} <code>…${h(w.uid_tail)}</code>`},{l:"Handled",f:w=>num(w.handled),c:"num"},{l:"Open",f:w=>num(w.open),c:"num"},{l:"Closed",f:w=>num(w.closed),c:"num"},{l:"Avg first reply",f:w=>dur(w.avg_first_response_sec)},{l:"CSAT",f:w=>w.csat===null||w.csat===undefined?"—":w.csat}],S.workload,{emptyText:"No assigned cases in this period."})}
        <p class="small">Priority: ${Object.entries(S.by_priority||{}).map(([p,n])=>`${badge(p)} ${num(n)}`).join(" ")||"—"} · resolved ${num(S.resolved)} · closed ${num(S.closed)} of the cases created in range.</p></div>`:""}</div>
      <p class="small">All figures come from database records (Asia/Manila calendar). Activity date = when the reported work happened; submission date = when it entered CHDS. Currency for revenue metrics: PHP (see Revenue Analytics).</p>`;
  };
  el.innerHTML=page("Operations Analytics","activity","Reports and Human Support performance from live records. Choose whether report periods use the activity date or the submission date.")+
    `<form class="bar" data-oaf><div class="f"><label for="oa_p">Period</label><select id="oa_p" name="preset">${PRESETS.map(([v,l])=>`<option value="${v}"${v===st.preset?" selected":""}>${l}</option>`).join("")}</select></div>
     <div class="f" data-cus hidden><label for="oa_f">From</label><input id="oa_f" name="from" type="date" min="2020-01-01"></div><div class="f" data-cus hidden><label for="oa_t">To</label><input id="oa_t" name="to" type="date" min="2020-01-01"></div>
     <div class="f"><label for="oa_b">Report dates</label><select id="oa_b" name="basis"><option value="activity">Activity date</option><option value="submission">Submission date</option></select></div></form><div data-oa></div>`;
  const f=$("[data-oaf]",el);
  f.addEventListener("change",()=>{new FormData(f).forEach((v,k2)=>st[k2]=String(v));$$("[data-cus]",f).forEach(x=>x.hidden=st.preset!=="custom");if(st.preset!=="custom"||(st.from&&st.to))draw()});
  f.addEventListener("submit",e=>e.preventDefault());
  await draw();
};
})();
