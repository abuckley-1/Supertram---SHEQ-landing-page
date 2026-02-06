// kpi/kpi.js
// --------------------------------------------------------------
// Supertram — SHEQ KPI Dashboard (with trends + animations)
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

  // buttons
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

  // Build from both arrays
  RAW.safety_actions.forEach(r => {
    if (r["Period Action Raised"]) periods.add(String(r["Period Action Raised"]).trim());
    if (r["Dept"]) depts.add(String(r["Dept"]).trim());
    if (r["Function"]) depts.add(String(r["Function"]).trim());
  });
  RAW.incidents.forEach(r => {
    // Incidents: "Reporting Period" (confirmed)
    if (r["Reporting Period"]) periods.add(String(r["Reporting Period"]).trim());
    if (r["Function"]) depts.add(String(r["Function"]).trim());
  });

  const sortedPeriods = [...Array.from(periods).filter(Boolean)]
    .map(p => parseInt(p, 10))
    .filter(n => Number.isFinite(n))
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
   METRICS
   ======================================================================= */
function safeLower(v){ return String(v || "").trim().toLowerCase(); }
function isClosed(status){ return safeLower(status) === "closed"; }
function isOpen(status){   return safeLower(status) === "open"; }
function isOverdueExplicit(status){ return safeLower(status) === "overdue"; }
function parseDate(d){ return d ? new Date(d) : null; }
function daysBetween(a,b){ if (!a||!b) return null; return Math.round((b-a)/(1000*60*60*24)); }
function isTruthyYes(v){ return /^y(es)?/i.test(String(v||"")); }

function computeActionMetrics(rows){
  let total=rows.length, open=0, closed=0, overdue=0, slaHit=0, slaDen=0;
  let days=[];

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
    if (isTruthyYes(r["RIDDOR"])) riddor++;

    // days lost
    const dl = Number(r["Total Number of days Lost"]);
    if (!isNaN(dl)) daysLost += dl;

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
