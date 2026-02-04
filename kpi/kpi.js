// kpi/kpi.js

const PATH_JSON = "../data/kpi_data.json"; // adjust if you place files elsewhere

let RAW = { safety_actions: [], incidents: [], meta: {} };
let FILTERS = { period: "", start: "", end: "", dept: "" };
let charts = {};

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
    ["periodSelect","startDate","endDate","deptSelect"].forEach(id => document.getElementById(id).value = "");
    FILTERS = { period: "", start: "", end: "", dept: "" };
    applyFiltersAndRender();
  });
});

async function loadData() {
  const res = await fetch(PATH_JSON, { cache: "no-store" });
  RAW = await res.json();
}

/* ---------- filters ------------------------------------------------------ */
function buildFilterOptions() {
  const periods = new Set();
  const depts   = new Set();

  RAW.safety_actions.forEach(r => {
    if (r["Period Action Raised"]) periods.add(String(r["Period Action Raised"]).trim());
    if (r["Dept"]) depts.add(String(r["Dept"]).trim());
    if (r["Function"]) depts.add(String(r["Function"]).trim());
  });
  RAW.incidents.forEach(r => {
    if (r["Reporting Period"]) periods.add(String(r["Reporting Period"]).trim());
    if (r["Function"]) depts.add(String(r["Function"]).trim());
  });

  const periodSelect = document.getElementById("periodSelect");
  [...Array.from(periods).filter(Boolean).sort()].forEach(p => {
    const opt = document.createElement("option"); opt.value = p; opt.textContent = p; periodSelect.appendChild(opt);
  });

  const deptSelect = document.getElementById("deptSelect");
  [...Array.from(depts).filter(Boolean).sort()].forEach(d => {
    const opt = document.createElement("option"); opt.value = d; opt.textContent = d; deptSelect.appendChild(opt);
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

/* ---------- metrics ------------------------------------------------------ */
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

    // overdue investigation: no completion OR completed after due, and due in the past
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

/* ---------- render ------------------------------------------------------- */
function setText(id, val){ document.getElementById(id).textContent = val; }

function applyFiltersAndRender(){
  // filter sets
  const A = byFilters(RAW.safety_actions, "actions");
  const I = byFilters(RAW.incidents,      "incidents");

  // ---- headline KPIs
  const am = computeActionMetrics(A);
  setText("sa_total", am.total);
  setText("sa_open", am.open);
  setText("sa_closed", am.closed);
  setText("sa_overdue", am.overdue);
  setText("sa_pct_closed", am.pctClosed + "%");
  setText("sa_avg_days", am.avgDays);
  setText("sa_sla", am.slaPct + "%");

  const im = computeIncidentMetrics(I);
  setText("inc_total", im.total);
  setText("inc_open", im.open);
  setText("inc_closed", im.closed);
  setText("inc_overdue", im.overdue);
  setText("inc_riddor", im.riddor);
  setText("inc_dayslost", im.daysLost);
  setText("inc_sla", im.slaPct + "%");

  // ---- charts
  renderBar("chartActionsByType", buckets(A, "Action/Recommendation Type"), "Type");
  renderBar("chartActionsByDept", buckets(A, "Dept", "Function"), "Department");
  renderBar("chartIncidentsByType", buckets(I, "Incident Type", "Accident/Incident Type"), "Incident Type");
  renderBar("chartIncidentsByFunction", buckets(I, "Function"), "Function");

  // ---- tables
  renderTableActions(A);
  renderTableIncidents(I);
}

function destroyChart(id){
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function renderBar(canvasId, entries, label){
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
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

function renderTableActions(rows){
  const body = document.querySelector("#tblActions tbody");
  body.innerHTML = "";
  const openOrOverdue = rows.filter(r => {
    const st = String(r["Status"] || "").toLowerCase();
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
  body.innerHTML = "";
  const needs = rows.filter(r => {
    const st = String(r["Status"] || "").toLowerCase();
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
      <td>${r["RIDDOR"] ?? ""}</td>
      <td>${Number(r["Total Number of days Lost"] ?? 0) || ""}</td>
    `;
    body.appendChild(tr);
  });
}
