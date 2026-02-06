// kpi/kpi.js
// --------------------------------------------------------------
// Supertram — SHEQ KPI Dashboard (trends + animations + robust RIDDOR)
// --------------------------------------------------------------

const PATH_JSON = "../data/kpi_data.json"; // adjust if you place files elsewhere

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

  // Buttons
  document.getElementById("applyBtn").addEventListener("click", () => {
    FILTERS.period = document.getElementById("periodSelect").value || "";
    FILTERS.start  = document.getElementById("startDate").value || "";
    FILTERS.end    = document.getElementById("endDate").value || "";
    FILTERS.dept   = document.getElementById("deptSelect").value || "";
    applyFiltersAndRender();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    ["periodSelect","startDate","endDate","deptSelect"].forEach(
      id => document.getElementById(id).value = ""
    );
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

  // Safety actions
  RAW.safety_actions.forEach(r => {
    if (r["Period Action Raised"]) periods.add(String(r["Period Action Raised"]).trim());
    if (r["Dept"])      depts.add(String(r["Dept"]).trim());
    if (r["Function"])  depts.add(String(r["Function"]).trim());
  });

  // Incidents
  RAW.incidents.forEach(r => {
    if (r["Reporting Period"]) periods.add(String(r["Reporting Period"]).trim());
    if (r["Function"]) depts.add(String(r["Function"]).trim());
  });

  const sortedPeriods = [...Array.from(periods).filter(Boolean)]
    .map(p => parseInt(p, 10))
    .filter(Number.isFinite)
    .sort((a,b) => a - b)
    .map(n => String(n).padStart(4,"0"));

  const periodSelect = document.getElementById("periodSelect");
  sortedPeriods.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p; opt.textContent = p; periodSelect.appendChild(opt);
  });

  const deptSelect = document.getElementById("deptSelect");
  [...Array.from(depts).filter(Boolean).sort()].forEach(d => {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d; deptSelect.appendChild(opt);
  });
}

function inDateRange(dstr, startStr, endStr) {
  if (!dstr) return true;
  const d = new Date(dstr);
  if (startStr) { const s = new Date(startStr); if (d < s) return false; }
  if (endStr)   { const e = new Date(endStr);   if (d > e) return false; }
  return true;
}

function byFilters(records, kind) {
  const { period, start, end, dept } = FILTERS;
  return records.filter(r => {
    // period mapping
    const pActions = String(r["Period Action Raised"] || "").trim();
    const pInc     = String(r["Reporting Period"] || "").trim();
    if (period && !(pActions === period || pInc === period)) return false;

    // common date field
    const dateField = (kind === "actions") ? "Date Action Raised" : "Date";
    if (start || end) {
      const rawDate = r[dateField] ? String(r[dateField]) : "";
      if (!inDateRange(rawDate, start, end)) return false;
    }

    // dept/function
    const rf = String(r["Function"] || r["Dept"] || "").trim();
    if (dept && rf !== dept) return false;

    return true;
  });
}

/* =======================================================================
   METRICS + HELPERS
   ======================================================================= */
function safeLower(v){ return String(v || "").trim().toLowerCase(); }
function isClosed(status){ return safeLower(status) === "closed"; }
function isOpen(status){   return safeLower(status) === "open"; }
function isOverdueExplicit(status){ return safeLower(status) === "overdue"; }
function parseDate(d){ return d ? new Date(d) : null; }
function daysBetween(a,b){ if (!a||!b) return null; return Math.round((b-a)/(1000*60*60*24)); }
function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }

// STRICT/ROBUST RIDDOR detector.
// Primary key: "RIDDOR/ SMIS"; but supports common export variants too.
// Will treat "yes", "y", "true", "1" as positive in case your export changes later.
function isRiddor(row){
  const keys = [
    "RIDDOR/ SMIS",
    "RIDDOR",
    "RIDDOR Reportable",
    "RIDDOR (reportable)"
  ];
  for (const k of keys){
    if (k in row){
      const raw = row[k];
      if (raw === true) return true;
      if (raw === 1) return true;
      const v = safeLower(raw);
      if (!v) continue;
      if (v === "yes" || v === "y" || v === "true" || v === "1" || v.includes("reportable") || v.includes("riddor yes")) {
        return true;
      }
    }
  }
  return false;
}

function computeActionMetrics(rows){
  let total=rows.length, open=0, closed=0, overdue=0, slaHit=0, slaDen=0;
  const days=[];

  rows.forEach(r => {
    const st = r["Status"];
    if (isClosed(st)) closed++;
    else if (isOpen(st)) open++;
    if (isOverdueExplicit(st) || r["Is Overdue (calc)"] === true) overdue++;

    const done = parseDate(r["Action Completed"]);
    const tgt  = parseDate(r["Action Completion Target Date"]);
    if (done || tgt) {
      if (done) {
        const dClose = r["Number of days taken to close"];
        if (typeof dClose === "number") days.push(dClose);
        else {
          const dr = parseDate(r["Date Action Raised"]);
          const dd = parseDate(r["Action Completed"]);
          const d  = daysBetween(dr, dd);
          if (Number.isFinite(d)) days.push(d);
        }
      }
      if (tgt) { slaDen++; if (done && done <= tgt) slaHit++; }
    }
  });

  const pctClosed = total ? Math.round((closed/total)*100) : 0;
  const avgDays   = days.length ? Math.round(days.reduce((a,b)=>a+b,0)/days.length) : 0;
  const slaPct    = slaDen ? Math.round((slaHit/slaDen)*100) : 0;

  return { total, open, closed, overdue, pctClosed, avgDays, slaPct };
}

function computeIncidentMetrics(rows){
  let total=rows.length, open=0, closed=0, overdue=0;
  let daysLost=0, riddor=0, slaHit=0, slaDen=0;

  rows.forEach(r => {
    const st = r["Status"];
    if (isClosed(st)) closed++;
    else if (isOpen(st)) open++;

    // overdue investigation: due in past and not completed or completed after due
    const due  = parseDate(r["Investigation Due"]);
    const comp = parseDate(r["Investigation Completion date"]);
    const today = new Date();
    if (due && due < today) {
      if (!comp || comp > due) overdue++;
    }

    // RIDDOR
    if (isRiddor(r)) riddor++;

    // days lost
    const dl = toNumber(r["Total Number of days Lost"]);
    daysLost += dl;

    // SLA investigate
    if (due) { slaDen++; if (comp && comp <= due) slaHit++; }
  });

  const slaPct = slaDen ? Math.round((slaHit/slaDen)*100) : 0;
  return { total, open, closed, overdue, riddor, daysLost, slaPct };
}

function buckets(rows, field, altField=null){
  const m = new Map();
  rows.forEach(r => {
    const v = String(r[field] ?? r[altField] ?? "").trim();
    if (!v) return;
    m.set(v, (m.get(v) || 0) + 1);
  });
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

/* =======================================================================
   PERIOD HELPERS (YYPP)
   ======================================================================= */
function pad2(n){ return String(n).padStart(2,"0"); }
function partsYYPP(yypp){
  const n = parseInt(String(yypp), 10);
  if (!Number.isFinite(n)) return null;
  const yy = Math.floor(n/100);
  const pp = n % 100;
  return { yy, pp };
}
function prevYYPP(yypp){
  const p = partsYYPP(yypp); if (!p) return "";
  let { yy, pp } = p;
  if (pp > 1) pp -= 1; else { yy -= 1; pp = 12; }
  return pad2(yy) + pad2(pp);
}
function lastYearYYPP(yypp){
  const p = partsYYPP(yypp); if (!p) return "";
  const { yy, pp } = p;
  return pad2(yy - 1) + pad2(pp);
}

function latestPeriodFromRows(rows, key){
  let max = -Infinity;
  rows.forEach(r => {
    const v = parseInt(String(r[key] || ""), 10);
    if (Number.isFinite(v) && v > max) max = v;
  });
  return (max === -Infinity) ? "" : String(max).padStart(4, "0");
}

/* =======================================================================
   RENDER CORE
   ======================================================================= */

// Number animation (0 -> target)
function animateNumber(id, toValue, { duration=800, suffix="" } = {}){
  const el = document.getElementById(id);
  if (!el) return;
  const clean = s => parseInt(String(s).replace(/[^\d-]/g,"") || "0", 10);
  const fromValue = clean(el.textContent);
  const target    = Number(toValue) || 0;

  const start = performance.now();
  function tick(now){
    const t = Math.min(1, (now - start) / duration);
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
    const val = Math.round(fromValue + (target - fromValue) * ease);
    el.textContent = String(val) + suffix;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  // subtle scale flicker
  el.classList.add("animate-number");
  setTimeout(() => el.classList.remove("animate-number"), duration + 50);
}

// Unified number setter with animation
function setNumberAnimated(id, value, { suffix="" } = {}){
  animateNumber(id, value, { suffix });
}

// trend builder (arrow + delta text)
function trendSpan(kind, delta, directionClass, label){
  const arrow = directionClass === "trend-up" ? "▲"
              : directionClass === "trend-down" ? "▼"
              : "●";
  return `<span class="${directionClass} trend-${kind}">${arrow} ${delta} <span style="opacity:.7">(${label})</span></span>`;
}

// compute direction + label text
function trendDelta(current, baseline, { higherIsBetter=false, isPercent=false } = {}){
  if (baseline == null || !Number.isFinite(baseline)) return { html: trendSpan("prev", "n/a", "trend-same", "n/a"), cls: "trend-same" };
  if (current == null || !Number.isFinite(current))   return { html: trendSpan("prev", "n/a", "trend-same", "n/a"), cls: "trend-same" };

  const diff = current - baseline;

  // label formatting (absolute change; use "pp" when this is a percentage KPI)
  const labelVal = isPercent ? `${diff > 0 ? "+" : ""}${diff} pp` : `${diff > 0 ? "+" : ""}${diff}`;

  let good;
  if (diff === 0) { return { html: trendSpan("prev", "0", "trend-same", "no change"), cls: "trend-same" }; }
  if (higherIsBetter) good = diff > 0; else good = diff < 0;

  return {
    html: trendSpan("prev", labelVal, good ? "trend-up" : "trend-down", higherIsBetter ? (good ? "up is good" : "down is bad") : (good ? "down is good" : "up is bad")),
    cls: (good ? "trend-up" : "trend-down")
  };
}

/* =======================================================================
   MAIN RENDER (NUMBERS + TRENDS + CHARTS + TABLES)
   ======================================================================= */
function applyFiltersAndRender(){
  // 1) Filter sets for current view
  const A = byFilters(RAW.safety_actions, "actions");
  const I = byFilters(RAW.incidents,      "incidents");

  // 2) Compute headline KPIs for CURRENT view
  const am = computeActionMetrics(A);
  const im = computeIncidentMetrics(I);

  // 3) Animate KPI numbers
  setNumberAnimated("sa_total",      am.total);
  setNumberAnimated("sa_open",       am.open);
  setNumberAnimated("sa_closed",     am.closed);
  setNumberAnimated("sa_overdue",    am.overdue);
  setNumberAnimated("sa_pct_closed", am.pctClosed, { suffix:"%" });
  setNumberAnimated("sa_avg_days",   am.avgDays);
  setNumberAnimated("sa_sla",        am.slaPct,    { suffix:"%" });

  setNumberAnimated("inc_total",     im.total);
  setNumberAnimated("inc_open",      im.open);
  setNumberAnimated("inc_closed",    im.closed);
  setNumberAnimated("inc_overdue",   im.overdue);
  setNumberAnimated("inc_riddor",    im.riddor);
  setNumberAnimated("inc_dayslost",  im.daysLost);
  setNumberAnimated("inc_sla",       im.slaPct,    { suffix:"%" });

  // 4) Trends (determine current period code)
  // If a period is selected, use it. Otherwise, detect the latest from filtered data.
  let currentPeriod = (FILTERS.period || "");
  if (!currentPeriod) {
    const latestA = latestPeriodFromRows(A, "Period Action Raised");
    const latestI = latestPeriodFromRows(I, "Reporting Period");
    currentPeriod = String(
      Math.max(parseInt(latestA || "0",10), parseInt(latestI || "0",10))
    ).padStart(4,"0");
  }

  if (currentPeriod && currentPeriod !== "NaN") {
    renderAllTrends(currentPeriod);
  } else {
    // If no clear period, clear trend rows
    ["sa_total","sa_pct_closed","sa_avg_days","sa_sla",
     "inc_total","inc_riddor","inc_dayslost","inc_sla"]
      .forEach(k => { const el = document.getElementById(`${k}_trend`); if (el) el.innerHTML = ""; });
  }

  // 5) charts
  renderBar("chartActionsByType", buckets(A, "Action/Recommendation Type"), "Type");
  renderBar("chartActionsByDept", buckets(A, "Dept", "Function"), "Department");
  renderBar("chartIncidentsByType", buckets(I, "Incident Type", "Accident/Incident Type"), "Incident Type");
  renderBar("chartIncidentsByFunction", buckets(I, "Function"), "Function");

  // 6) tables
  renderTableActions(A);
  renderTableIncidents(I);
}

/* =======================================================================
   TRENDS: compare vs P-1 and LY with dept respected
   ======================================================================= */

// Filters the RAW by exact period + (optional) dept, ignoring date range
function rowsByExactPeriod(kind, yypp, dept=""){
  const src = (kind === "actions") ? RAW.safety_actions : RAW.incidents;
  const key = (kind === "actions") ? "Period Action Raised" : "Reporting Period";
  return src.filter(r => {
    const rp = String(r[key] || "").trim();
    if (rp !== yypp) return false;
    if (dept) {
      const rf = String(r["Function"] || r["Dept"] || "").trim();
      if (rf !== dept) return false;
    }
    return true;
  });
}

function renderAllTrends(currentPeriod){
  const dept = FILTERS.dept || "";
  const pPrev = prevYYPP(currentPeriod);
  const pLY   = lastYearYYPP(currentPeriod);

  // ACTIONS: current, previous, last year
  const A_cur = rowsByExactPeriod("actions", currentPeriod, dept);
  const A_pre = rowsByExactPeriod("actions", pPrev,         dept);
  const A_ly  = rowsByExactPeriod("actions", pLY,           dept);

  const am_cur = computeActionMetrics(A_cur);
  const am_pre = computeActionMetrics(A_pre);
  const am_ly  = computeActionMetrics(A_ly);

  // INCIDENTS: current, previous, last year
  const I_cur = rowsByExactPeriod("incidents", currentPeriod, dept);
  const I_pre = rowsByExactPeriod("incidents", pPrev,         dept);
  const I_ly  = rowsByExactPeriod("incidents", pLY,           dept);

  const im_cur = computeIncidentMetrics(I_cur);
  const im_pre = computeIncidentMetrics(I_pre);
  const im_ly  = computeIncidentMetrics(I_ly);

  // KPI configuration: directionality + formatting
  // (Higher is good? false => lower is better)
  const CFG = {
    sa_total:      { higherIsBetter:false, isPercent:false },
    sa_pct_closed: { higherIsBetter:true,  isPercent:true  },
    sa_avg_days:   { higherIsBetter:false, isPercent:false },
    sa_sla:        { higherIsBetter:true,  isPercent:true  },

    inc_total:     { higherIsBetter:false, isPercent:false },
    inc_riddor:    { higherIsBetter:false, isPercent:false },
    inc_dayslost:  { higherIsBetter:false, isPercent:false },
    inc_sla:       { higherIsBetter:true,  isPercent:true  }
  };

  // Render each trend block (prev + last year)
  const map = [
    { id: "sa_total",      cur: am_cur.total,     pre: am_pre.total,     ly: am_ly.total },
    { id: "sa_pct_closed", cur: am_cur.pctClosed, pre: am_pre.pctClosed, ly: am_ly.pctClosed },
    { id: "sa_avg_days",   cur: am_cur.avgDays,   pre: am_pre.avgDays,   ly: am_ly.avgDays },
    { id: "sa_sla",        cur: am_cur.slaPct,    pre: am_pre.slaPct,    ly: am_ly.slaPct },

    { id: "inc_total",     cur: im_cur.total,     pre: im_pre.total,     ly: im_ly.total },
    { id: "inc_riddor",    cur: im_cur.riddor,    pre: im_pre.riddor,    ly: im_ly.riddor },
    { id: "inc_dayslost",  cur: im_cur.daysLost,  pre: im_pre.daysLost,  ly: im_ly.daysLost },
    { id: "inc_sla",       cur: im_cur.slaPct,    pre: im_pre.slaPct,    ly: im_ly.slaPct }
  ];

  map.forEach(k => {
    const cfg = CFG[k.id];
    const elId = `${k.id}_trend`;
    const prevBits = trendDelta(k.cur, k.pre, cfg);
    const lyBits   = trendDelta(k.cur, k.ly,  cfg);

    const prevHTML = prevBits.html.replace("(no change)","(vs P−1)").replace("(n/a)","(vs P−1)");
    const lyHTML   = lyBits.html.replace("(no change)","(vs LY)").replace("(n/a)","(vs LY)");

    const el = document.getElementById(elId);
    if (el) el.innerHTML = prevHTML + " " + lyHTML.replace('trend-prev','trend-lastyr');
  });
}

/* =======================================================================
   CHARTS
   ======================================================================= */
function destroyChart(id){
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function renderBar(canvasId, entries, label){
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const labels = entries.slice(0, 12).map(e => e[0]);
  const data   = entries.slice(0, 12).map(e => e[1]);
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label, data, backgroundColor: "#003d73" }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true, ticks: { precision:0 } } },
      plugins: { legend: { display: false } }
    }
  });
}

/* =======================================================================
   TABLES
   ======================================================================= */
function renderTableActions(rows){
  const body = document.querySelector("#tblActions tbody");
  if (!body) return;
  body.innerHTML = "";
  const openOrOverdue = rows.filter(r => {
    const st = safeLower(r["Status"] || "");
    return st === "open" || st === "overdue" || r["Is Overdue (calc)"] === true;
  }).slice(0, 50);
  openOrOverdue.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r["Status"] ?? ""}</td>
      <td>${r["Action/Recommendation Type"] ?? ""}</td>
      <td>${r["Dept"] ?? ""}</td>
      <td>${r["Action Owner"] ?? ""}</td>
      <td>${r["Date Action Raised"] ?? ""}</td>
      <td>${r["Action Completion Target Date"] ?? ""}</td>
      <td>${r["Action Completed"] ?? ""}</td>
      <td>${r["Comments"] ?? ""}</td>
    `;
    body.appendChild(tr);
  });
}

function renderTableIncidents(rows){
  const body = document.querySelector("#tblIncidents tbody");
  if (!body) return;
  body.innerHTML = "";
  const needs = rows.filter(r => {
    const st = safeLower(r["Status"] || "");
    if (st === "open") return true;
    const due  = r["Investigation Due"] ? new Date(r["Investigation Due"]) : null;
    const comp = r["Investigation Completion date"] ? new Date(r["Investigation Completion date"]) : null;
    return (due && due < new Date() && (!comp || comp > due));
  }).slice(0, 50);
  needs.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r["Status"] ?? ""}</td>
      <td>${r["Incident Type"] ?? r["Accident/Incident Type"] ?? ""}</td>
      <td>${r["Function"] ?? ""}</td>
      <td>${r["Date"] ?? ""}</td>
      <td>${r["Investigation Due"] ?? ""}</td>
      <td>${r["Investigation Completion date"] ?? ""}</td>
      <td>${isRiddor(r) ? "Yes" : "No"}</td>
      <td>${toNumber(r["Total Number of days Lost"]) || ""}</td>
    `;
    body.appendChild(tr);
  });
}

/* =======================================================================
   (Optional) quick console diagnostics
   ======================================================================= */
// Uncomment to quickly see how many RIDDOR Yes rows exist in the currently loaded data.
// setTimeout(() => {
//   const yesAll = (RAW.incidents || []).filter(isRiddor).length;
//   console.log("[Diag] Total incidents with RIDDOR=Yes in RAW:", yesAll);
// }, 500);
