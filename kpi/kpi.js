// kpi/kpi.js
// --------------------------------------------------------------
// Supertram — SHEQ KPI Dashboard (trends + animations + RIDDOR/SMIS support)
// --------------------------------------------------------------

const PATH_JSON = "../data/kpi_data.json";

let RAW = { safety_actions: [], incidents: [], meta: {} };
let FILTERS = { period: "", start: "", end: "", dept: "" };
let charts = {};

// ---------------------------
// Boot
// ---------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  buildFilterOptions();
  applyFiltersAndRender();

  document.getElementById("applyBtn").addEventListener("click", () => {
    FILTERS.period = document.getElementById("periodSelect").value || "";
    FILTERS.start  = document.getElementById("startDate").value || "";
    FILTERS.end    = document.getElementById("endDate").value || "";
    FILTERS.dept   = document.getElementById("deptSelect").value || "";
    applyFiltersAndRender();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    ["periodSelect","startDate","endDate","deptSelect"]
      .forEach(id => document.getElementById(id).value = "");
    FILTERS = { period: "", start: "", end: "", dept: "" };
    applyFiltersAndRender();
  });
});

async function loadData() {
  const res = await fetch(PATH_JSON, { cache: "no-store" });
  RAW = await res.json();
}

/* =======================================================================
   FILTERS
   ======================================================================= */
function buildFilterOptions() {
  const periods = new Set();
  const depts   = new Set();

  RAW.safety_actions.forEach(r => {
    if (r["Period Action Raised"]) periods.add(String(r["Period Action Raised"]).trim());
    if (r["Dept"])      depts.add(String(r["Dept"]).trim());
    if (r["Function"])  depts.add(String(r["Function"]).trim());
  });

  RAW.incidents.forEach(r => {
    if (r["Reporting Period"]) periods.add(String(r["Reporting Period"]).trim());
    if (r["Function"]) depts.add(String(r["Function"]).trim());
  });

  const sortedPeriods = [...periods].filter(Boolean)
    .map(p => parseInt(p)).filter(Number.isFinite)
    .sort((a,b)=>a-b)
    .map(n => String(n).padStart(4,"0"));

  const periodSelect = document.getElementById("periodSelect");
  sortedPeriods.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    periodSelect.appendChild(opt);
  });

  const deptSelect = document.getElementById("deptSelect");
  [...depts].sort().forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    deptSelect.appendChild(opt);
  });
}

function inDateRange(dt, s, e){
  if (!dt) return true;
  const d = new Date(dt);
  if (s && d < new Date(s)) return false;
  if (e && d > new Date(e)) return false;
  return true;
}

function byFilters(rows, kind){
  const { period, start, end, dept } = FILTERS;
  return rows.filter(r=>{
    const rowPeriod = kind==="actions"
      ? String(r["Period Action Raised"]||"").trim()
      : String(r["Reporting Period"]||"").trim();

    if (period && rowPeriod !== period) return false;

    const dateField = (kind==="actions" ? "Date Action Raised" : "Date");
    if (!inDateRange(r[dateField], start, end)) return false;

    const rf = String(r["Function"] || r["Dept"] || "").trim();
    if (dept && rf !== dept) return false;

    return true;
  });
}

/* =======================================================================
   METRICS + HELPERS
   ======================================================================= */
function safeLower(v){ return String(v||"").trim().toLowerCase(); }
function isClosed(v){ return safeLower(v)==="closed"; }
function isOpen(v){ return safeLower(v)==="open"; }
function isOverdueExplicit(v){ return safeLower(v)==="overdue"; }
function parseDate(x){ return x? new Date(x):null; }
function daysBetween(a,b){ if(!a||!b) return null; return Math.round((b-a)/86400000); }
function toNum(x){ const n=Number(x); return Number.isFinite(n)?n:0; }

/* -----------------------------------------------------------------------
   >>> THE REAL FIX FOR YOUR ISSUE <<<
   RIDDOR detection supporting exactly "RIDDOR/SMIS"
   ----------------------------------------------------------------------- */
function isRiddor(row){
  const keys = [
    "RIDDOR/SMIS",           // EXACT key from your JSON
    "RIDDOR",                // backup from legacy exports
    "RIDDOR Reportable",
    "RIDDOR (reportable)"
  ];

  for (const k of keys){
    if (k in row){
      const raw = row[k];
      const v = safeLower(raw);
      if (!v) continue;

      if (v==="yes" || v==="y" || v==="1" || v==="true" || v.includes("reportable"))
        return true;
    }
  }
  return false;
}

function computeActionMetrics(rows){
  let total=rows.length, open=0, closed=0, overdue=0, slaHit=0, slaDen=0;
  const days=[];

  rows.forEach(r=>{
    const st=r["Status"];
    if(isClosed(st)) closed++;
    else if(isOpen(st)) open++;

    if(isOverdueExplicit(st) || r["Is Overdue (calc)"]===true) overdue++;

    const done=parseDate(r["Action Completed"]);
    const tgt=parseDate(r["Action Completion Target Date"]);

    if(done){
      const d=daysBetween(parseDate(r["Date Action Raised"]),done);
      if(Number.isFinite(d)) days.push(d);
    }
    if(tgt){ slaDen++; if(done && done<=tgt) slaHit++; }
  });

  return {
    total,
    open,
    closed,
    overdue,
    pctClosed: total? Math.round(closed/total*100):0,
    avgDays:   days.length? Math.round(days.reduce((a,b)=>a+b,0)/days.length):0,
    slaPct:    slaDen? Math.round(slaHit/slaDen*100):0
  };
}

function computeIncidentMetrics(rows){
  let total=rows.length, open=0, closed=0, overdue=0;
  let daysLost=0, riddor=0, slaHit=0, slaDen=0;

  rows.forEach(r=>{
    const st=r["Status"];
    if(isClosed(st)) closed++;
    else if(isOpen(st)) open++;

    const due=parseDate(r["Investigation Due"]);
    const comp=parseDate(r["Investigation Completion date"]);
    if(due && due<new Date() && (!comp || comp>due)) overdue++;

    if(isRiddor(r)) riddor++;

    daysLost += toNum(r["Total Number of days Lost"]);

    if(due){ slaDen++; if(comp && comp<=due) slaHit++; }
  });

  return {
    total,
    open,
    closed,
    overdue,
    riddor,
    daysLost,
    slaPct: slaDen?Math.round(slaHit/slaDen*100):0
  };
}

function buckets(rows, field, alt=null){
  const m=new Map();
  rows.forEach(r=>{
    const v = String(r[field] ?? r[alt] ?? "").trim();
    if(v) m.set(v,(m.get(v)||0)+1);
  });
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

/* =======================================================================
   PERIOD HELPERS
   ======================================================================= */
function pad2(n){ return String(n).padStart(2,"0"); }
function partsYYPP(n){
  const v=parseInt(n); if(!Number.isFinite(v)) return null;
  return { yy: Math.floor(v/100), pp: v%100 };
}
function prevYYPP(p){
  const o=partsYYPP(p); if(!o) return "";
  let {yy,pp}=o;
  if(pp>1) pp--; else { yy--; pp=12; }
  return pad2(yy)+pad2(pp);
}
function lastYearYYPP(p){
  const o=partsYYPP(p); if(!o) return "";
  return pad2(o.yy-1)+pad2(o.pp);
}
function latestPeriodFromRows(rows, key){
  let max=-Infinity;
  rows.forEach(r=>{
    const v=parseInt(r[key]);
    if(Number.isFinite(v) && v>max) max=v;
  });
  return max>0? String(max).padStart(4,"0"):"";
}

/* =======================================================================
   RENDER CORE
   ======================================================================= */
function animateNumber(id, val, opts={}){
  const el=document.getElementById(id);
  if(!el) return;
  const suffix=opts.suffix||"";

  const clean=s=>parseInt(String(s).replace(/[^\d-]/g,"")||"0");
  const fromVal=clean(el.textContent);
  const toVal=Number(val)||0;
  const dur=opts.duration||800;

  const start=performance.now();
  function tick(now){
    const t=Math.min(1,(now-start)/dur);
    const ease=1-Math.pow(1-t,3);
    const cur=Math.round(fromVal+(toVal-fromVal)*ease);
    el.textContent=cur+suffix;
    if(t<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function trendSpan(kind, delta, cl, label){
  const arrow = cl==="trend-up"?"▲":cl==="trend-down"?"▼":"●";
  return `<span class="${cl} trend-${kind}">${arrow} ${delta} <span style="opacity:.7">(${label})</span></span>`;
}

function trendDelta(cur, pre, cfg){
  if(pre==null || !Number.isFinite(pre))
    return {html:trendSpan("prev","n/a","trend-same","n/a"),cls:"trend-same"};
  if(cur==null || !Number.isFinite(cur))
    return {html:trendSpan("prev","n/a","trend-same","n/a"),cls:"trend-same"};

  const diff=cur-pre;
  if(diff===0)
    return {html:trendSpan("prev","0","trend-same","no change"),cls:"trend-same"};

  const good = cfg.higherIsBetter ? diff>0 : diff<0;
  const label = cfg.isPercent ? `${diff>0?"+":""}${diff} pp` : `${diff>0?"+":""}${diff}`;

  return {
    html: trendSpan("prev",label,good?"trend-up":"trend-down",
      cfg.higherIsBetter?(good?"up is good":"down is bad"):(good?"down is good":"up is bad")),
    cls: good?"trend-up":"trend-down"
  };
}

function applyFiltersAndRender(){
  const A=byFilters(RAW.safety_actions,"actions");
  const I=byFilters(RAW.incidents,"incidents");

  const am=computeActionMetrics(A);
  const im=computeIncidentMetrics(I);

  animateNumber("sa_total",am.total);
  animateNumber("sa_open",am.open);
  animateNumber("sa_closed",am.closed);
  animateNumber("sa_overdue",am.overdue);
  animateNumber("sa_pct_closed",am.pctClosed,{suffix:"%"});
  animateNumber("sa_avg_days",am.avgDays);
  animateNumber("sa_sla",am.slaPct,{suffix:"%"});

  animateNumber("inc_total",im.total);
  animateNumber("inc_open",im.open);
  animateNumber("inc_closed",im.closed);
  animateNumber("inc_overdue",im.overdue);
  animateNumber("inc_riddor",im.riddor);
  animateNumber("inc_dayslost",im.daysLost);
  animateNumber("inc_sla",im.slaPct,{suffix:"%"});

  let period=FILTERS.period;
  if(!period){
    const latestA=latestPeriodFromRows(A,"Period Action Raised");
    const latestI=latestPeriodFromRows(I,"Reporting Period");
    period=String(Math.max(parseInt(latestA||"0"),parseInt(latestI||"0"))).padStart(4,"0");
  }

  if(period) renderAllTrends(period);

  renderBar("chartActionsByType", buckets(A,"Action/Recommendation Type"), "Type");
  renderBar("chartActionsByDept", buckets(A,"Dept","Function"), "Department");
  renderBar("chartIncidentsByType", buckets(I,"Incident Type", "Accident/Incident Type"), "Incident Type");
  renderBar("chartIncidentsByFunction", buckets(I,"Function"), "Function");

  renderTableActions(A);
  renderTableIncidents(I);
}

function renderAllTrends(period){
  const dept=FILTERS.dept||"";
  const pPrev=prevYYPP(period);
  const pLY=lastYearYYPP(period);

  const A_cur=rowsByExactPeriod("actions",period,dept);
  const A_pre=rowsByExactPeriod("actions",pPrev,dept);
  const A_ly =rowsByExactPeriod("actions",pLY,dept);

  const I_cur=rowsByExactPeriod("incidents",period,dept);
  const I_pre=rowsByExactPeriod("incidents",pPrev,dept);
  const I_ly =rowsByExactPeriod("incidents",pLY,dept);

  const amc=computeActionMetrics(A_cur),
        amp=computeActionMetrics(A_pre),
        aml=computeActionMetrics(A_ly);

  const imc=computeIncidentMetrics(I_cur),
        imp=computeIncidentMetrics(I_pre),
        iml=computeIncidentMetrics(I_ly);

  const CFG={
    sa_total:{higherIsBetter:false},
    sa_pct_closed:{higherIsBetter:true,isPercent:true},
    sa_avg_days:{higherIsBetter:false},
    sa_sla:{higherIsBetter:true,isPercent:true},

    inc_total:{higherIsBetter:false},
    inc_riddor:{higherIsBetter:false},
    inc_dayslost:{higherIsBetter:false},
    inc_sla:{higherIsBetter:true,isPercent:true}
  };

  const MAP=[
    {id:"sa_total",cur:amc.total,pre:amp.total,ly:aml.total},
    {id:"sa_pct_closed",cur:amc.pctClosed,pre:amp.pctClosed,ly:aml.pctClosed},
    {id:"sa_avg_days",cur:amc.avgDays,pre:amp.avgDays,ly:aml.avgDays},
    {id:"sa_sla",cur:amc.slaPct,pre:amp.slaPct,ly:aml.slaPct},

    {id:"inc_total",cur:imc.total,pre:imp.total,ly:iml.total},
    {id:"inc_riddor",cur:imc.riddor,pre:imp.riddor,ly:iml.riddor},
    {id:"inc_dayslost",cur:imc.daysLost,pre:imp.daysLost,ly:iml.daysLost},
    {id:"inc_sla",cur:imc.slaPct,pre:imp.slaPct,ly:iml.slaPct}
  ];

  MAP.forEach(k=>{
    const el=document.getElementById(`${k.id}_trend`);
    if(!el) return;

    const cfg=CFG[k.id];
    const prev=trendDelta(k.cur,k.pre,cfg);
    const last=trendDelta(k.cur,k.ly,cfg);

    const prevHTML=prev.html.replace("(no change)","(vs P−1)").replace("(n/a)","(vs P−1)");
    const lastHTML=last.html.replace("(no change)","(vs LY)").replace("(n/a)","(vs LY)");

    el.innerHTML = prevHTML + " " + lastHTML.replace("trend-prev","trend-lastyr");
  });
}

/* =======================================================================
   CHARTS
   ======================================================================= */
function destroyChart(id){
  if(charts[id]){
    charts[id].destroy();
    delete charts[id];
  }
}

function renderBar(id, entries, label){
  destroyChart(id);
  const ctx=document.getElementById(id);
  if(!ctx) return;

  const labels=entries.slice(0,12).map(e=>e[0]);
  const data  =entries.slice(0,12).map(e=>e[1]);

  charts[id]=new Chart(ctx,{
    type:"bar",
    data:{ labels, datasets:[{ label, data, backgroundColor:"#003d73" }]},
    options:{
      responsive:true,
      scales:{ y:{ beginAtZero:true, ticks:{precision:0} } },
      plugins:{ legend:{display:false} }
    }
  });
}

/* =======================================================================
   TABLES
   ======================================================================= */
function renderTableActions(rows){
  const body=document.querySelector("#tblActions tbody");
  if(!body) return;
  body.innerHTML="";

  rows.filter(r=>{
    const st=safeLower(r["Status"]);
    return st==="open" || st==="overdue" || r["Is Overdue (calc)"]===true;
  }).slice(0,50).forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${r["Status"]||""}</td>
      <td>${r["Action/Recommendation Type"]||""}</td>
      <td>${r["Dept"]||""}</td>
      <td>${r["Action Owner"]||""}</td>
      <td>${r["Date Action Raised"]||""}</td>
      <td>${r["Action Completion Target Date"]||""}</td>
      <td>${r["Action Completed"]||""}</td>
      <td>${r["Comments"]||""}</td>
    `;
    body.appendChild(tr);
  });
}

function renderTableIncidents(rows){
  const body=document.querySelector("#tblIncidents tbody");
  if(!body) return;
  body.innerHTML="";

  rows.filter(r=>{
    const st=safeLower(r["Status"]);
    if(st==="open") return true;
    const due=r["Investigation Due"]?new Date(r["Investigation Due"]):null;
    const comp=r["Investigation Completion date"]?new Date(r["Investigation Completion date"]):null;
    return (due && due<new Date() && (!comp || comp>due));
  }).slice(0,50).forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${r["Status"]||""}</td>
      <td>${r["Incident Type"]||r["Accident/Incident Type"]||""}</td>
      <td>${r["Function"]||""}</td>
      <td>${r["Date"]||""}</td>
      <td>${r["Investigation Due"]||""}</td>
      <td>${r["Investigation Completion date"]||""}</td>
      <td>${isRiddor(r)?"Yes":"No"}</td>
      <td>${toNum(r["Total Number of days Lost"])||""}</td>
    `;
    body.appendChild(tr);
  });
}
