import { initShell } from "./shell.js";
import { boot, getState, onChange, patch } from "./state.js";
import { bindViewer, updateViewer } from "./viewer.js";

initShell("explore");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SLOTS = [];
for (let hour = 19; hour <= 23; hour++) for (const minute of [0, 30]) SLOTS.push([hour, minute]);
for (let hour = 0; hour <= 8; hour++) for (const minute of [0, 30]) SLOTS.push([hour, minute]);

let modelDoc = null;
let modelList = [];
let modelById = new Map();
let nights = [];
let nightById = new Map();
let scanById = new Map();
let defaults = {};
let rowScans = new Map();
let rows = [];
let cells = [];
let ready = false;
let lastCx = "";

function pad(n) {
  return String(n).padStart(2, "0");
}

function scoreOf(scan, model) {
  return model.family === "classifier" ? scan[model.pKey] : scan[model.aKey];
}

function formatProb(p) {
  if (p > 0 && p < 0.001) return p.toExponential(2);
  return p.toFixed(3);
}

function formatArea(km) {
  if (km >= 10000) return `${(km / 1000).toFixed(0)}k`;
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k`;
  return km.toFixed(0);
}

function formatKm(km) {
  return `${Number(km).toLocaleString("en-US", { maximumFractionDigits: 2 })} km²`;
}

function edtFromStamp(id) {
  const s = String(id).padStart(12, "0");
  const utc = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
  const edt = new Date(utc - 4 * 3600 * 1000);
  return {
    hm: `${pad(edt.getUTCHours())}:${pad(edt.getUTCMinutes())}`,
    date: `${edt.getUTCDate()} ${MONTHS[edt.getUTCMonth()]} ${edt.getUTCFullYear()}`,
  };
}

function utcFromStamp(id) {
  const s = String(id).padStart(12, "0");
  return {
    hm: `${s.slice(8, 10)}:${s.slice(10, 12)}`,
    date: `${+s.slice(6, 8)} ${MONTHS[+s.slice(4, 6) - 1]} ${s.slice(0, 4)}`,
  };
}

function inWindow(hour, rule) {
  const a = Number(rule.hourStart);
  const b = Number(rule.hourEnd);
  return a <= b ? hour >= a && hour <= b : hour >= a || hour <= b;
}

function included(st) {
  return modelList.filter(m => st.included[m.id]);
}

function ruleSentence(rule) {
  const a = pad(rule.hourStart);
  const b = pad(rule.hourEnd);
  const pct = rule.fraction * 100;
  const frac = Number.isInteger(pct) ? `${pct}%` : String(rule.fraction);
  if (rule.mode === "allpass") {
    return `The share of scans where all included models pass is at least ${frac} of the night's ${a}–${b} UTC scans, and the night has at least ${rule.minScans} scans in that window.`;
  }
  return `Every included model passes on at least ${frac} of the night's ${a}–${b} UTC scans, and the night has at least ${rule.minScans} scans in that window.`;
}

function placement(corrections) {
  const dropScan = new Set();
  const dropNight = new Set();
  const move = new Map();
  for (const c of corrections) {
    if (c.op === "exclude-scan") dropScan.add(String(c.scan));
    else if (c.op === "exclude-night") dropNight.add(c.night);
    else if (c.op === "move-scan") move.set(String(c.scan), c.to);
  }
  return { dropScan, dropNight, move };
}

function assignScans(corrections) {
  const { dropScan, dropNight, move } = placement(corrections);
  const known = new Set(nights.map(n => n.night));
  const by = new Map();
  for (const scan of scanById.values()) {
    const id = String(scan.id);
    if (dropScan.has(id)) continue;
    const night = move.get(id) || scan.night;
    if (!known.has(night) || dropNight.has(night)) continue;
    const list = by.get(night);
    if (list) list.push(scan);
    else by.set(night, [scan]);
  }
  return { by, dropNight };
}

function whyText(night, dropped) {
  if (dropped) return "Excluded in this browser. The files are unchanged.";
  const parts = [];
  if (night.status === "absent") parts.push("No files for this operational night.");
  const gap = night.missing_stretch;
  if (night.status === "gap-skipped" && gap) {
    parts.push(`Not scored. The longest gap between selected half-hour scans is ${gap.minutes} minutes, from ${gap.from} to ${gap.to}.`);
  }
  if (night.status === "partial" && gap?.timestamps?.length) {
    const ts = gap.timestamps;
    parts.push(`Scored ${night.n_scored} of 28 slots. Missing ${ts.length}, from ${ts[0]} to ${ts[ts.length - 1]}.`);
  }
  if (night.no_0008) parts.push("No scored scan in 00–08 UTC.");
  return parts.join(" ");
}

function badgeHtml(night, dropped) {
  const bits = [];
  if (night.status === "complete") bits.push(`<span class="badge">complete</span>`);
  if (night.status === "partial") bits.push(`<span class="badge partial">partial</span>`);
  if (night.status === "gap-skipped") bits.push(`<span class="badge gap">gap-skipped</span>`);
  if (night.status === "absent") bits.push(`<span class="badge none">no files</span>`);
  if (night.no_0008) bits.push(`<span class="badge morning">no 00–08</span>`);
  if (dropped) bits.push(`<span class="badge excluded">excluded</span>`);
  return bits.join("");
}

function withBands(pieces) {
  let html = "";
  for (let i = 0; i < pieces.length; i++) {
    if (i % 7 === 0) {
      const [hour, minute] = SLOTS[i];
      html += `<span class="band-label">${pad(hour)}:${pad(minute)}</span>`;
    }
    html += pieces[i];
    if (i === 9) html += `<span class="midnight-bar" title="Midnight UTC"></span>`;
  }
  return html;
}

function edtHm(hour, minute) {
  return `${pad((hour + 20) % 24)}:${pad(minute)}`;
}

function hourHead(hour) {
  const title = `${pad(hour)}:00–${pad(hour)}:30 UTC (${edtHm(hour, 0)}–${edtHm(hour, 30)} EDT)`;
  return `<span class="sh" data-hour="${hour}" title="${title}">${pad(hour)}</span>`;
}

function slotHeads() {
  let html = "";
  for (let hour = 19; hour <= 23; hour++) html += hourHead(hour);
  html += `<span class="midnight-bar" title="Midnight UTC"></span>`;
  for (let hour = 0; hour <= 8; hour++) html += hourHead(hour);
  return html;
}

function rowHtml(night, scans, dropped) {
  const bySlot = new Map();
  for (const scan of scans) {
    const key = `${scan.hour}:${scan.minute}`;
    const list = bySlot.get(key);
    if (list) list.push(scan);
    else bySlot.set(key, [scan]);
  }
  const buttons = SLOTS.map(([hour, minute]) => {
    const found = bySlot.get(`${hour}:${minute}`) || [];
    const scan = found[0];
    const extra = found.slice(1).map(s => `<span class="scell extra" hidden data-scan="${s.id}"></span>`).join("");
    if (!scan) {
      return `<button type="button" class="scell hatch" data-hour="${hour}" data-minute="${minute}" data-night="${night.night}"><span class="glyph">–</span></button>`;
    }
    return `<button type="button" class="scell" data-scan="${scan.id}" data-hour="${hour}" data-minute="${minute}" data-night="${night.night}" data-p-e1="${scan.p_e1}" data-p-e4="${scan.p_e4}" data-p-e1e4="${scan.p_e1e4}" data-a-e1="${scan.area_e1_km2}" data-a-e4="${scan.area_e4_km2}" data-a-e1e4="${scan.area_e1e4_km2}" data-insect="${scan.insect}" data-rain="${scan.rain}"><span class="glyph"></span>${extra}</button>`;
  });
  const slots = withBands(buttons);
  let family = "";
  const models = modelList.map(m => {
    let lead = "";
    if (m.family !== family) {
      if (family) lead += `<span class="grp-bar">|</span>`;
      lead += `<span class="grp">${m.family === "classifier" ? "Swin" : "AttUNet"}</span>`;
      family = m.family;
    }
    return `${lead}<span class="msum" data-model="${m.id}"></span>`;
  }).join("");
  const why = whyText(night, dropped);
  return `<article class="erow" data-night="${night.night}" data-year="${night.night.slice(0, 4)}" data-status="${night.status}" data-role="${night.annotation_role || ""}">
    <div class="sum">
      <button type="button" class="night-link night-pick" data-night="${night.night}">${night.night}</button>
      <span class="badges">${badgeHtml(night, dropped)}</span>
      <span data-part="qual"></span>
      <span data-part="window"></span>
      <span class="model-cols">${models}</span>
    </div>
    <p class="why"${why ? "" : " hidden"}>${why}</p>
    <div class="slots">${slots}</div>
  </article>`;
}

function buildGrid() {
  const st = getState();
  const { by, dropNight } = assignScans(st.corrections);
  rowScans = new Map();
  const head = `<div class="slot-head">${slotHeads()}</div>`;
  const html = ["2021", "2022"].map(year => {
    const body = nights.filter(n => n.night.startsWith(year)).map(n => {
      const scans = by.get(n.night) || [];
      return rowHtml(n, scans, dropNight.has(n.night));
    }).join("");
    const hidden = st.selection.year === year ? "" : " hidden";
    return `<section id="year-${year}"${hidden}>${head}${body}</section>`;
  }).join("");
  document.getElementById("grid").innerHTML = html;
  bindRows();
  const n = document.querySelectorAll(".scell[data-scan]").length;
  document.getElementById("grid-ready").textContent = `${n} scans on the grid`;
  showYear(st.selection.year || "2021");
  paintFast();
  lastScrolled = "";
  scrollSelectionIntoGrid();
  lastScrolled = `${st.selection.year}|${st.selection.night}|${st.selection.scan}`;
}

function bindRows() {
  rows = [];
  cells = [];
  for (const row of document.querySelectorAll(".erow")) {
    const scans = [];
    row._sum = {
      qual: row.querySelector('[data-part="qual"]'),
      window: row.querySelector('[data-part="window"]'),
      models: Object.fromEntries(modelList.map(m => [m.id, row.querySelector(`.msum[data-model="${m.id}"]`)])),
    };
    for (const el of row.querySelectorAll(".slots > .scell")) {
      const scan = el.dataset.scan ? scanById.get(el.dataset.scan) : null;
      if (scan) scans.push(scan);
      for (const extra of el.querySelectorAll(".extra")) {
        const more = scanById.get(extra.dataset.scan);
        if (more) scans.push(more);
      }
      cells.push({ el, glyph: el.querySelector(".glyph"), scan });
    }
    row._scans = scans;
    rows.push(row);
  }
}

function nightStats(scans, st, inc) {
  const pass = {};
  const winPass = {};
  const mean = {};
  const rule = st.nightRule;
  for (const m of modelList) {
    let n = 0;
    let w = 0;
    let sum = 0;
    const t = st.thresholds[m.id];
    for (const scan of scans) {
      const v = scoreOf(scan, m);
      sum += v;
      if (v >= t) {
        n++;
        if (inWindow(scan.hour, rule)) w++;
      }
    }
    pass[m.id] = n;
    winPass[m.id] = w;
    mean[m.id] = scans.length ? sum / scans.length : 0;
  }
  let nAll = 0;
  let winAll = 0;
  let maxK = 0;
  let nWindow = 0;
  for (const scan of scans) {
    const inside = inWindow(scan.hour, rule);
    if (inside) nWindow++;
    let k = 0;
    for (const m of inc) if (scoreOf(scan, m) >= st.thresholds[m.id]) k++;
    if (k > maxK) maxK = k;
    if (inc.length && k === inc.length) {
      nAll++;
      if (inside) winAll++;
    }
  }
  let qualifies = false;
  if (inc.length && nWindow >= rule.minScans) {
    if (rule.mode === "allpass") qualifies = winAll / nWindow >= rule.fraction;
    else qualifies = inc.every(m => winPass[m.id] / nWindow >= rule.fraction);
  }
  return { pass, winPass, mean, nAll, winAll, maxK, nScored: scans.length, nWindow, qualifies };
}

function matches(row, stat, st) {
  const f = st.filters;
  if (f.qualifies && !stat.qualifies) return false;
  if (f.status !== "all" && row.dataset.status !== f.status) return false;
  if (f.month !== "all" && !row.dataset.night.startsWith(f.month)) return false;
  if (f.annotation && !row.dataset.role) return false;
  if (Number(f.minModels) > 0 && stat.maxK < Number(f.minModels)) return false;
  return true;
}

function setClass(el, base, on) {
  const cls = on ? `${base} on` : base;
  if (el.className !== cls) el.className = cls;
}

function paintCell(item, st, inc) {
  const { el, glyph, scan } = item;
  if (!glyph) return;
  const selected = scan && String(scan.id) === st.selection.scan;
  if (!scan) {
    setClass(el, "scell hatch", false);
    if (glyph.textContent !== "–") glyph.textContent = "–";
    return;
  }
  if (st.view.mode === "pass") {
    const model = modelById.get(st.view.model) || modelList[0];
    const ok = scoreOf(scan, model) >= st.thresholds[model.id];
    const text = ok ? "✓" : "✗";
    if (glyph.textContent !== text) glyph.textContent = text;
    setClass(el, ok ? "scell ag-all" : "scell ag-none", selected);
    el.style.removeProperty("--score");
    return;
  }
  if (st.view.mode === "score") {
    const model = modelById.get(st.view.model) || modelList[0];
    const value = scoreOf(scan, model);
    const text = model.family === "classifier" ? formatProb(value) : formatArea(value);
    if (glyph.textContent !== text) glyph.textContent = text;
    setClass(el, "scell score", selected);
    const scaled = model.family === "classifier"
      ? Math.max(0, Math.min(1, value))
      : Math.log1p(Math.max(0, value)) / Math.log1p(80000);
    el.style.setProperty("--score", String(Math.max(0, Math.min(1, scaled))));
    return;
  }
  let k = 0;
  for (const m of inc) if (scoreOf(scan, m) >= st.thresholds[m.id]) k++;
  const n = inc.length;
  const text = n ? `${k}/${n}` : "–";
  let base = "scell ag-some";
  if (!n || k === 0) base = n ? "scell ag-none" : "scell ag-some";
  else if (k === n) base = "scell ag-all";
  if (glyph.textContent !== text) glyph.textContent = text;
  setClass(el, base, selected);
  el.style.removeProperty("--score");
  if (n && k > 0 && k < n) el.style.setProperty("--agree", String(k / n));
  else el.style.removeProperty("--agree");
}

function paintFast() {
  const st = getState();
  const inc = included(st);
  const t0 = performance.now();
  let nMatch = 0;
  let nScans = 0;
  const globalPass = Object.fromEntries(modelList.map(m => [m.id, 0]));
  const qualNights = [];
  for (const item of cells) paintCell(item, st, inc);
  for (const row of rows) {
    const stat = nightStats(row._scans, st, inc);
    const match = matches(row, stat, st);
    if (row.hidden !== !match) row.hidden = !match;
    row.dataset.qualifies = stat.qualifies ? "1" : "0";
    row.dataset.nScored = String(stat.nScored);
    row.dataset.nAll = String(stat.nAll);
    row.dataset.nWindow = String(stat.nWindow);
    row.dataset.match = match ? "1" : "0";
    row.classList.toggle("is-qual", stat.qualifies);
    row._sum.qual.textContent = stat.qualifies ? "✓ qualifies" : "✗ does not qualify";
    row._sum.qual.className = stat.qualifies ? "q-yes" : "q-no";
    const a = pad(st.nightRule.hourStart);
    const b = pad(st.nightRule.hourEnd);
    row._sum.window.textContent = `${stat.nWindow} in ${a}–${b}`;
    row._sum.window.title = `Whole night: ${stat.nScored} scored, ${stat.nAll} all-pass. The rule uses ${stat.nWindow} scans in ${a}–${b} UTC.`;
    for (const m of modelList) {
      const el = row._sum.models[m.id];
      const on = !!st.included[m.id];
      el.hidden = !on;
      el.dataset.pass = String(stat.pass[m.id]);
      el.dataset.win = String(stat.winPass[m.id]);
      const frac = stat.nWindow ? stat.winPass[m.id] / stat.nWindow : 0;
      const fails = on && st.nightRule.mode === "every" && (!stat.nWindow || frac < st.nightRule.fraction);
      el.classList.toggle("fail-rule", fails);
      el.textContent = stat.nWindow ? `${m.short} ${stat.winPass[m.id]}/${stat.nWindow}` : `${m.short} —`;
      el.title = `Whole night ${stat.pass[m.id]}/${stat.nScored}. Window ${stat.nWindow ? `${stat.winPass[m.id]}/${stat.nWindow}` : "none"}.`;
      row.setAttribute(`data-mean-${m.id}`, String(stat.mean[m.id]));
      globalPass[m.id] += stat.pass[m.id];
    }
    if (stat.qualifies) qualNights.push(row.dataset.night);
    if (match) {
      nMatch++;
      nScans += stat.nScored;
    }
    const on = row.dataset.night === st.selection.night;
    if (row.classList.contains("on") !== on) row.classList.toggle("on", on);
  }
  sortRows(st);
  paintLegend(st, inc);
  paintGroups(st);
  paintPanel(st, inc);
  document.getElementById("rule-text").textContent = ruleSentence(st.nightRule);
  document.getElementById("shown-count").textContent = `${nMatch} nights match, ${nScans} scans`;
  paintResults(qualNights, globalPass);
  paintPassing(globalPass);
  document.getElementById("selected-night").textContent = st.selection.night || "none";
  const ms = performance.now() - t0;
  const mark = document.getElementById("paint-ms");
  mark.dataset.ms = ms.toFixed(2);
  mark.textContent = `Last recolour ${ms.toFixed(1)} ms`;
}

function sortRows(st) {
  const key = st.sort.key;
  for (const year of ["2021", "2022"]) {
    const section = document.getElementById(`year-${year}`);
    if (!section) continue;
    const list = [...section.querySelectorAll(".erow")];
    list.sort((a, b) => {
      if (key === "allpass") {
        const da = Number(a.dataset.nScored) ? Number(a.dataset.nAll) / Number(a.dataset.nScored) : -1;
        const db = Number(b.dataset.nScored) ? Number(b.dataset.nAll) / Number(b.dataset.nScored) : -1;
        if (db !== da) return db - da;
      } else if (key === "mean") {
        const ma = Number(a.getAttribute(`data-mean-${st.sort.model}`)) || 0;
        const mb = Number(b.getAttribute(`data-mean-${st.sort.model}`)) || 0;
        if (mb !== ma) return mb - ma;
      }
      return a.dataset.night < b.dataset.night ? -1 : a.dataset.night > b.dataset.night ? 1 : 0;
    });
    for (const row of list) section.appendChild(row);
  }
}

function paintLegend(st, inc) {
  const el = document.getElementById("legend");
  const n = inc.length;
  if (st.view.mode === "pass") {
    const model = modelById.get(st.view.model) || modelList[0];
    el.innerHTML = `<span class="sw ag-all">✓</span> ${model.label} pass. <span class="sw ag-none">✗</span> ${model.label} fail. <span class="sw hatch">–</span> No scan. The mark is the same fact as the colour.`;
    return;
  }
  if (st.view.mode === "score") {
    const model = modelById.get(st.view.model) || modelList[0];
    const unit = model.family === "classifier" ? "probability" : "mask area, km²";
    el.innerHTML = `<span class="ramp" title="Low score to high score"></span> ${model.label} ${unit}, continuous scale from low (light) to high (dark). The cell prints the score. Probabilities below 0.001 use scientific notation. <span class="sw hatch">–</span> No scan.`;
    return;
  }
  el.innerHTML = `<span class="sw ag-none">0/${n}</span> No included model passes. <span class="agree-ramp" title="Neutral to green"></span> Some included models pass. The cell shows k/n. <span class="sw ag-all">${n}/${n}</span> All included models pass. <span class="sw hatch">–</span> No scan.`;
}

function paintResults(qualNights, globalPass) {
  const el = document.getElementById("result-line");
  if (!el) return;
  qualNights.sort();
  const links = qualNights.map(night => `<button type="button" class="qual-link" data-night="${night}">${night}</button>`).join(" ");
  const passes = modelList.map(m => `<span data-pass-model="${m.id}">${m.label} ${globalPass[m.id]}</span>`).join(" · ");
  el.innerHTML = `<b>${qualNights.length} nights qualify</b> ${links || "none"}. <span class="pass-line">Scans passing: ${passes}</span>`;
}

function paintGroups(st) {
  const cls = modelList.filter(m => m.family === "classifier");
  const seg = modelList.filter(m => m.family === "segmenter");
  const word = group => group.every(m => st.included[m.id]) ? "on" : group.some(m => st.included[m.id]) ? "mixed" : "off";
  document.getElementById("group-classifiers").textContent = `Classifiers ${word(cls)}`;
  document.getElementById("group-segmenters").textContent = `Segmenters ${word(seg)}`;
}

function scrollNearest(scroller, el) {
  // Move only this scroller (block: nearest). Use the on-screen slice when it
  // can fit the row, so a scroller taller than the viewport does not park the
  // row below the fold. Never touches window scroll.
  if (!scroller || !el || el.closest("[hidden]")) return;
  const box = scroller.getBoundingClientRect();
  const row = el.getBoundingClientRect();
  if (row.height <= 0 || box.height <= 0) return;
  const visibleTop = Math.max(box.top, 0);
  const visibleBottom = Math.min(box.bottom, window.innerHeight);
  const onScreen = visibleBottom - visibleTop > row.height;
  let top = onScreen ? visibleTop : box.top;
  const bottom = onScreen ? visibleBottom : box.bottom;
  const head = el.parentElement?.querySelector(".slot-head");
  const headH = head && getComputedStyle(head).display !== "none" ? head.offsetHeight : 0;
  if (headH > 0 && bottom - (top + headH) > row.height) top += headH;
  if (row.top < top) scroller.scrollTop += row.top - top;
  else if (row.bottom > bottom) scroller.scrollTop += row.bottom - bottom;
}

let lastScrolled = "";

function scrollSelectionIntoGrid() {
  const st = getState();
  const scroller = document.getElementById("grid-scroll");
  const night = st.selection.night;
  const row = night ? document.querySelector(`.erow[data-night="${night}"]`) : null;
  showYear(st.selection.year || "2021");
  scrollNearest(scroller, row);
}

function paintPanel(st) {
  const scan = st.selection.scan ? scanById.get(st.selection.scan) : null;
  document.getElementById("mask-area-note").textContent = modelDoc.mask_area_note || "";
  const idEl = document.getElementById("panel-id");
  const when = document.getElementById("panel-when");
  const qual = document.getElementById("panel-qual");
  const table = document.getElementById("panel-scores");
  if (!scan) {
    idEl.textContent = st.selection.night ? `Night ${st.selection.night}` : "No scan selected.";
    when.textContent = "";
    qual.textContent = "";
    table.innerHTML = "";
    paintPanel.scan = "";
    if (paintPanel.sig !== "none") {
      paintPanel.sig = "none";
      updateViewer(null, st);
    }
    return;
  }
  const utc = utcFromStamp(scan.id);
  const edt = edtFromStamp(scan.id);
  const night = document.querySelector(`.scell[data-scan="${scan.id}"]`)?.dataset.night || scan.night;
  idEl.textContent = String(scan.id);
  when.textContent = `${utc.hm} UTC · ${edt.hm} EDT`;
  when.title = `${utc.hm} UTC on ${utc.date}. ${edt.hm} EDT on ${edt.date}.`;
  const row = document.querySelector(`.erow[data-night="${night}"]`);
  qual.textContent = row?.dataset.qualifies === "1" ? "✓ qualifies" : "✗ does not qualify";
  const body = modelList.map(m => {
    const value = scoreOf(scan, m);
    const threshold = st.thresholds[m.id];
    const ok = value >= threshold;
    const shown = m.family === "classifier" ? formatProb(value) : formatKm(value);
    const cut = m.family === "classifier" ? formatProb(threshold) : formatKm(threshold);
    return `<tr data-model="${m.id}" data-pass="${ok ? "1" : "0"}"><td>${m.label}</td><td>${shown}</td><td>${cut}</td><td>${ok ? "pass" : "fail"}</td></tr>`;
  }).join("");
  table.innerHTML = `<thead><tr><th>Model</th><th>Score</th><th>Threshold</th><th>Call</th></tr></thead><tbody>${body}</tbody>`;
  const sig = `${st.selection.scan}|${st.viewer.tilt}|${st.viewer.mode}|${st.viewer.only}|${Object.entries(st.viewer.masks).map(([id, on]) => on ? id : "").join(",")}|${Object.values(st.viewer.opacity).join(",")}`;
  if (sig !== paintPanel.sig) {
    paintPanel.sig = sig;
    updateViewer(scan, st);
  }
  if (paintPanel.scan !== String(scan.id)) {
    paintPanel.scan = String(scan.id);
    const panel = document.getElementById("scan-panel");
    if (panel) panel.scrollTop = 0;
  }
}

function fillTip(el) {
  const scan = el.dataset.scan ? scanById.get(el.dataset.scan) : null;
  if (!scan) {
    el.title = "No scan";
    return;
  }
  const st = getState();
  const utc = utcFromStamp(scan.id);
  const edt = edtFromStamp(scan.id);
  const lines = [
    String(scan.id),
    `night ${el.dataset.night}`,
    `${utc.hm} UTC on ${utc.date}`,
    `${edt.hm} EDT on ${edt.date}`,
  ];
  for (const m of modelList) {
    const value = scoreOf(scan, m);
    const ok = value >= st.thresholds[m.id] ? "pass" : "fail";
    lines.push(`${m.id} ${value} ${ok}`);
  }
  lines.push(`insect ${scan.insect}`);
  lines.push(`rain ${scan.rain}`);
  el.title = lines.join("\n");
}

function showYear(year) {
  const y = year === "2022" ? "2022" : "2021";
  const a = document.getElementById("year-2021");
  const b = document.getElementById("year-2022");
  if (a) a.hidden = y !== "2021";
  if (b) b.hidden = y !== "2022";
  document.getElementById("tab-2021").classList.toggle("on", y === "2021");
  document.getElementById("tab-2022").classList.toggle("on", y === "2022");
}

function scanOrder() {
  const ids = [];
  for (const year of ["2021", "2022"]) {
    const section = document.getElementById(`year-${year}`);
    if (!section) continue;
    for (const cell of section.querySelectorAll(".erow .slots > .scell[data-scan]")) {
      ids.push({
        id: cell.dataset.scan,
        night: cell.dataset.night,
        hour: Number(cell.dataset.hour),
        minute: Number(cell.dataset.minute),
      });
    }
  }
  return ids;
}

function selectScan(entry) {
  if (!entry) return;
  patch(s => {
    s.selection.scan = entry.id;
    s.selection.night = entry.night;
    s.selection.year = entry.night.slice(0, 4);
  });
  showYear(entry.night.slice(0, 4));
}

function stepScan(dir) {
  const order = scanOrder();
  if (!order.length) return;
  const cur = getState().selection.scan;
  let index = order.findIndex(s => s.id === cur);
  if (index < 0) index = dir > 0 ? -1 : order.length;
  selectScan(order[index + dir]);
}

function stepNight(dir) {
  const order = [...document.querySelectorAll(".erow")].map(row => row.dataset.night);
  const st = getState();
  let index = order.indexOf(st.selection.night);
  if (index < 0) index = dir > 0 ? -1 : order.length;
  const night = order[index + dir];
  if (!night) return;
  const scan = st.selection.scan ? scanById.get(st.selection.scan) : null;
  const row = document.querySelector(`.erow[data-night="${night}"]`);
  let cell = null;
  if (scan) {
    cell = row.querySelector(`.slots > .scell[data-hour="${scan.hour}"][data-minute="${scan.minute}"][data-scan]`);
  }
  if (!cell) cell = row.querySelector(".slots > .scell[data-scan]");
  if (cell) selectScan({ id: cell.dataset.scan, night });
  else {
    patch(s => {
      s.selection.night = night;
      s.selection.scan = "";
      s.selection.year = night.slice(0, 4);
    });
    showYear(night.slice(0, 4));
  }
}

function reveal(night) {
  showYear(night.slice(0, 4));
  const row = document.querySelector(`.erow[data-night="${night}"]`);
  if (!row) return;
  if (row.hidden) row.hidden = false;
  scrollNearest(document.getElementById("grid-scroll"), row);
}

function applyLegacyQuery() {
  const params = new URLSearchParams(location.search);
  if (!params.has("night") && !params.has("i")) return;
  const night = params.get("night") || "";
  const index = Number(params.get("i"));
  let scanId = "";
  if (night && Number.isInteger(index) && index >= 0) {
    const list = [...scanById.values()].filter(scan => scan.night === night).sort((a, b) => a.id - b.id);
    if (list[index]) scanId = String(list[index].id);
  }
  patch(s => {
    if (night) {
      s.selection.night = night;
      s.selection.year = night.slice(0, 4);
    }
    if (scanId) s.selection.scan = scanId;
  });
  history.replaceState(null, "", `${location.pathname}${location.hash}`);
}

function goSearch() {
  const q = document.getElementById("scan-search").value.trim();
  const say = document.getElementById("find-error");
  if (/^\d{12}$/.test(q)) {
    const scan = scanById.get(q);
    if (!scan) { say.textContent = "That scan is not in the 4,666 scored scans."; return; }
    const cell = document.querySelector(`.scell[data-scan="${q}"]`);
    if (!cell) { say.textContent = "That scan is excluded by a correction."; return; }
    say.textContent = "";
    patch(s => {
      s.selection.scan = q;
      s.selection.night = cell.dataset.night;
      s.selection.year = cell.dataset.night.slice(0, 4);
    });
    reveal(cell.dataset.night);
    return;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q) && nightById.has(q)) {
    say.textContent = "";
    patch(s => {
      s.selection.night = q;
      s.selection.scan = "";
      s.selection.year = q.slice(0, 4);
    });
    reveal(q);
    return;
  }
  say.textContent = "Enter a night date (2021-07-27) or a 12-digit scan id.";
}

function syncControls() {
  const st = getState();
  for (const m of modelList) {
    const num = document.querySelector(`.th-num[data-model="${m.id}"]`);
    const range = document.querySelector(`.th-range[data-model="${m.id}"]`);
    const inc = document.querySelector(`.inc[data-model="${m.id}"]`);
    num.value = String(st.thresholds[m.id]);
    range.value = String(Math.min(Number(range.max), st.thresholds[m.id]));
    inc.checked = !!st.included[m.id];
  }
  document.getElementById("rule-mode").value = st.nightRule.mode;
  document.getElementById("rule-fraction").value = String(st.nightRule.fraction);
  document.getElementById("rule-min").value = String(st.nightRule.minScans);
  document.getElementById("rule-h0").value = String(st.nightRule.hourStart);
  document.getElementById("rule-h1").value = String(st.nightRule.hourEnd);
  document.getElementById("view-mode").value = st.view.mode;
  document.getElementById("view-model").value = st.view.model;
  document.getElementById("sort-key").value = st.sort.key;
  document.getElementById("sort-model").value = st.sort.model;
  document.getElementById("f-qualifies").checked = !!st.filters.qualifies;
  document.getElementById("f-status").value = st.filters.status;
  document.getElementById("f-month").value = st.filters.month;
  document.getElementById("f-annotation").checked = !!st.filters.annotation;
  document.getElementById("f-k").value = String(st.filters.minModels);
}

function buildControls() {
  const month = document.getElementById("f-month");
  for (const year of [2021, 2022]) {
    for (const m of [5, 6, 7, 8]) {
      const value = `${year}-${pad(m)}`;
      month.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`);
    }
  }
  const options = modelList.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
  document.getElementById("view-model").innerHTML = options;
  document.getElementById("sort-model").innerHTML = options;
  const body = modelList.map(m => {
    const prob = m.family === "classifier";
    return `<div class="th-row">
      <label class="check"><input type="checkbox" class="inc" data-model="${m.id}"> ${m.label}</label>
      <span class="tiny">${prob ? "probability" : "area km²"}</span>
      <span class="th-cell">
        <input type="range" class="th-range" data-model="${m.id}" min="0" max="${prob ? 1 : 80000}" step="${prob ? 0.01 : 1}">
        <input type="number" class="th-num" data-model="${m.id}" min="0" step="${prob ? 0.01 : 0.25}">
      </span>
      <span class="npass" data-model="${m.id}"></span>
      <button type="button" class="th-reset" data-model="${m.id}">Reset</button>
    </div>`;
  }).join("");
  document.getElementById("model-controls").innerHTML = `<div class="th-grid">${body}</div>`;
}

function paintPassing(globalPass) {
  for (const m of modelList) {
    const el = document.querySelector(`.npass[data-model="${m.id}"]`);
    if (el) el.textContent = String(globalPass[m.id]);
  }
}

function wire() {
  for (const m of modelList) {
    const num = document.querySelector(`.th-num[data-model="${m.id}"]`);
    const range = document.querySelector(`.th-range[data-model="${m.id}"]`);
    const inc = document.querySelector(`.inc[data-model="${m.id}"]`);
    num.addEventListener("input", () => {
      const value = Number(num.value);
      if (!Number.isFinite(value)) return;
      range.value = String(Math.min(Number(range.max), value));
      patch(s => { s.thresholds[m.id] = value; });
    });
    range.addEventListener("input", () => {
      const value = Number(range.value);
      num.value = String(value);
      patch(s => { s.thresholds[m.id] = value; });
    });
    inc.addEventListener("change", () => {
      patch(s => { s.included[m.id] = inc.checked; });
    });
    document.querySelector(`.th-reset[data-model="${m.id}"]`).addEventListener("click", () => {
      patch(s => { s.thresholds[m.id] = defaults[m.id]; });
      num.value = String(defaults[m.id]);
      range.value = String(Math.min(Number(range.max), defaults[m.id]));
    });
  }
  const toggle = family => {
    const group = modelList.filter(m => m.family === family);
    const allOn = group.every(m => getState().included[m.id]);
    patch(s => { for (const m of group) s.included[m.id] = !allOn; });
    syncControls();
  };
  document.getElementById("group-classifiers").addEventListener("click", () => toggle("classifier"));
  document.getElementById("group-segmenters").addEventListener("click", () => toggle("segmenter"));
  document.getElementById("th-reset-all").addEventListener("click", () => {
    patch(s => { for (const m of modelList) s.thresholds[m.id] = defaults[m.id]; });
    syncControls();
  });
  const rule = () => patch(s => {
    s.nightRule.mode = document.getElementById("rule-mode").value;
    const fraction = Number(document.getElementById("rule-fraction").value);
    const minScans = Number(document.getElementById("rule-min").value);
    const hourStart = Number(document.getElementById("rule-h0").value);
    const hourEnd = Number(document.getElementById("rule-h1").value);
    if (Number.isFinite(fraction)) s.nightRule.fraction = fraction;
    if (Number.isFinite(minScans)) s.nightRule.minScans = minScans;
    if (Number.isFinite(hourStart)) s.nightRule.hourStart = hourStart;
    if (Number.isFinite(hourEnd)) s.nightRule.hourEnd = hourEnd;
  });
  for (const id of ["rule-mode", "rule-fraction", "rule-min", "rule-h0", "rule-h1"]) {
    document.getElementById(id).addEventListener("change", rule);
    document.getElementById(id).addEventListener("input", rule);
  }
  document.getElementById("view-mode").addEventListener("change", () => {
    patch(s => { s.view.mode = document.getElementById("view-mode").value; });
  });
  document.getElementById("view-model").addEventListener("change", () => {
    patch(s => { s.view.model = document.getElementById("view-model").value; });
  });
  document.getElementById("sort-key").addEventListener("change", () => {
    patch(s => { s.sort.key = document.getElementById("sort-key").value; });
  });
  document.getElementById("sort-model").addEventListener("change", () => {
    patch(s => { s.sort.model = document.getElementById("sort-model").value; });
  });
  document.getElementById("f-qualifies").addEventListener("change", () => {
    patch(s => { s.filters.qualifies = document.getElementById("f-qualifies").checked; });
  });
  document.getElementById("f-status").addEventListener("change", () => {
    patch(s => { s.filters.status = document.getElementById("f-status").value; });
  });
  document.getElementById("f-month").addEventListener("change", () => {
    patch(s => { s.filters.month = document.getElementById("f-month").value; });
  });
  document.getElementById("f-annotation").addEventListener("change", () => {
    patch(s => { s.filters.annotation = document.getElementById("f-annotation").checked; });
  });
  document.getElementById("f-k").addEventListener("input", () => {
    const value = Number(document.getElementById("f-k").value);
    if (Number.isFinite(value)) patch(s => { s.filters.minModels = value; });
  });
  document.getElementById("scan-go").addEventListener("click", goSearch);
  document.getElementById("scan-search").addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); goSearch(); }
  });
  document.getElementById("tab-2021").addEventListener("click", () => {
    patch(s => { s.selection.year = "2021"; });
    showYear("2021");
  });
  document.getElementById("tab-2022").addEventListener("click", () => {
    patch(s => { s.selection.year = "2022"; });
    showYear("2022");
  });
  const grid = document.getElementById("grid");
  grid.addEventListener("mousedown", event => {
    if (event.target.closest(".scell, .night-pick")) event.preventDefault();
  });
  grid.addEventListener("click", event => {
    const nightBtn = event.target.closest(".night-pick");
    if (nightBtn) {
      patch(s => {
        s.selection.night = nightBtn.dataset.night;
        s.selection.year = nightBtn.dataset.night.slice(0, 4);
        s.selection.scan = "";
      });
      return;
    }
    const cell = event.target.closest(".scell");
    if (!cell?.dataset.scan || cell.classList.contains("extra") || !cell.closest(".slots")) return;
    patch(s => {
      s.selection.scan = cell.dataset.scan;
      s.selection.night = cell.dataset.night;
      s.selection.year = cell.dataset.night.slice(0, 4);
    });
  });
  grid.addEventListener("mouseover", event => {
    const cell = event.target.closest(".scell");
    if (cell && !cell.classList.contains("extra") && cell.closest(".slots")) fillTip(cell);
  });
  document.getElementById("result-line").addEventListener("click", event => {
    const link = event.target.closest(".qual-link");
    if (!link) return;
    patch(s => {
      s.selection.night = link.dataset.night;
      s.selection.scan = "";
      s.selection.year = link.dataset.night.slice(0, 4);
    });
    reveal(link.dataset.night);
  });
  document.getElementById("prev-scan").addEventListener("click", () => stepScan(-1));
  document.getElementById("next-scan").addEventListener("click", () => stepScan(1));
  document.getElementById("prev-night").addEventListener("click", () => stepNight(-1));
  document.getElementById("next-night").addEventListener("click", () => stepNight(1));
  document.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (event.key === "ArrowRight") { event.preventDefault(); stepScan(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); stepScan(-1); }
    else if (event.key === "ArrowDown") { event.preventDefault(); stepNight(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); stepNight(-1); }
  });
  window.__setViewer = (mode, on, only) => {
    patch(s => {
      s.viewer.mode = mode;
      if (only) s.viewer.only = only;
      for (const id of Object.keys(s.viewer.masks)) s.viewer.masks[id] = on.includes(id);
    });
  };
  bindViewer(document.getElementById("viewer"), { patch, getState, nextId: id => {
    const order = scanOrder();
    const index = order.findIndex(s => s.id === id);
    return index >= 0 && order[index + 1] ? order[index + 1].id : "";
  } });
}

function prepareModels(doc) {
  modelDoc = doc;
  modelList = [...doc.classifiers, ...doc.segmenters].map(m => ({
    id: m.id,
    key: m.key,
    family: m.family,
    label: `${m.family === "classifier" ? "Swin" : "AttUNet"} ${m.key}`,
    short: m.key,
    input: m.input,
    pKey: `p_${m.key}`,
    aKey: `area_${m.key}_km2`,
  }));
  modelById = new Map(modelList.map(m => [m.id, m]));
  defaults = {};
  for (const m of [...doc.classifiers, ...doc.segmenters]) {
    defaults[m.id] = m.family === "classifier" ? Number(m.default_threshold) : Number(m.threshold_km2);
  }
}

async function main() {
  const [models, nightDoc, scanDoc] = await Promise.all([
    fetch("data/models.json").then(r => r.json()),
    fetch("data/nights.json").then(r => r.json()),
    fetch("data/scans.json").then(r => r.json()),
  ]);
  prepareModels(models);
  nights = nightDoc.nights;
  nightById = new Map(nights.map(n => [n.night, n]));
  for (const scan of scanDoc.scans) scanById.set(String(scan.id), scan);
  onChange(() => {
    if (!ready) return;
    const cx = JSON.stringify(getState().corrections);
    if (cx !== lastCx) {
      lastCx = cx;
      buildGrid();
      return;
    }
    paintFast();
    const st = getState();
    const key = `${st.selection.year}|${st.selection.night}|${st.selection.scan}`;
    showYear(st.selection.year || "2021");
    if (key !== lastScrolled) {
      lastScrolled = key;
      scrollSelectionIntoGrid();
    }
  });
  boot(models);
  lastCx = JSON.stringify(getState().corrections);
  document.getElementById("mask-area-note").textContent = models.mask_area_note || "";
  document.getElementById("selected-night").textContent = getState().selection.night || "none";
  buildControls();
  wire();
  syncControls();
  buildGrid();
  ready = true;
  applyLegacyQuery();
}

main().catch(err => {
  const note = document.createElement("p");
  note.textContent = err.message || String(err);
  document.getElementById("main").appendChild(note);
});
