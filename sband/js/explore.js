/* S-band explore. The default view is a night grid: one row per night,
   one half-hour column from 19:00 through 08:30 UTC, and the reflectivity
   thumbnail in every cell. Thumbnails and the table are the other views.
   The modal viewer is unchanged. */

import { DataTable } from "../../assets/js/lib/table.js";
import { esc } from "../../assets/js/lib/metrics.js";
import { Modal } from "../../assets/js/lib/ui.js";
import { assetUrl, fetchSbandPack, SbandPackCache, validatePackMeta } from "./pack.js";
import { boot, getState, mountClassificationCutoff, patch } from "./state.js";
import { initShell } from "./shell.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REFL_BANDS = [
  { color: [190, 222, 230], label: "-10 – -1 dBZ" },
  { color: [117, 231, 137], label: "-1.1 – 2 dBZ" },
  { color: [42, 220, 18], label: "2.1 – 7 dBZ" },
  { color: [247, 235, 39], label: "7.1 – 12 dBZ" },
  { color: [247, 139, 20], label: "12.1 – 19 dBZ" },
  { color: [242, 31, 23], label: "19.1 – 25 dBZ" },
];
const MASK_COLOR = {
  e1: [47, 140, 255],
  e4: [230, 40, 210],
  e1e4: [255, 255, 255],
};
const SEG_KEYS = ["e1", "e4", "e1e4"];
const SLOTS = [];
for (const hour of [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
  SLOTS.push([hour, 0], [hour, 30]);
}

function pad(n) { return String(n).padStart(2, "0"); }

function stamp(id) {
  const s = String(id).padStart(12, "0");
  return {
    s,
    hm: `${s.slice(8, 10)}:${s.slice(10, 12)}`,
    day: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`,
    title: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`,
  };
}

function edtOf(id) {
  const s = String(id).padStart(12, "0");
  const utc = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
  const edt = new Date(utc - 4 * 3600 * 1000);
  return {
    hm: `${pad(edt.getUTCHours())}:${pad(edt.getUTCMinutes())}`,
    date: `${edt.getUTCFullYear()}-${pad(edt.getUTCMonth() + 1)}-${pad(edt.getUTCDate())}`,
    long: `${edt.getUTCDate()} ${MONTHS[edt.getUTCMonth()]} ${edt.getUTCFullYear()}`,
  };
}

function edtHm(hour, minute) {
  const total = ((hour * 60 + minute - 4 * 60) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function inWindow(hour) { return hour >= 0 && hour <= 8; }

function dice(inter, a, b) {
  if (!a && !b) return 1;
  return (2 * inter) / (a + b);
}

function fmtProb(p) {
  if (p > 0 && p < 0.001) return p.toExponential(2);
  return Number(p).toFixed(3);
}

function fmtKm(km) {
  return `${Number(km).toLocaleString("en-US", { maximumFractionDigits: 2 })} km²`;
}

async function main() {
  initShell("explore");
  const [modelsDoc, nightDoc, scanDoc, packMeta] = await Promise.all([
    fetch("data/models.json").then(r => r.json()),
    fetch("data/nights.json").then(r => r.json()),
    fetch("data/scans.json").then(r => r.json()),
    fetch("data/packs.json").then(r => r.json()),
  ]);
  validatePackMeta(packMeta);
  boot(modelsDoc);
  const note = document.getElementById("mask-area-note");
  if (note) note.textContent = modelsDoc.mask_area_note || "";

  const modelList = [...modelsDoc.classifiers, ...modelsDoc.segmenters].map(m => ({
    id: m.id,
    key: m.key,
    family: m.family,
    label: `${m.family === "classifier" ? "Swin" : "AttUNet"} ${m.key}`,
    short: `${m.family === "classifier" ? "Swin" : "Att"} ${m.key}`,
    input: m.input,
    scoreKey: m.family === "classifier" ? `p_${m.key}` : `area_${m.key}_km2`,
    cut: m.family === "classifier" ? Number(m.default_threshold) : Number(m.threshold_km2),
    step: m.family === "classifier" ? "0.01" : "0.25",
    min: "0",
    max: m.family === "classifier" ? "1" : "200000",
  }));
  const byId = new Map(modelList.map(m => [m.id, m]));
  const classifiers = modelList.filter(m => m.family === "classifier");
  const segmenters = modelList.filter(m => m.family === "segmenter");
  const nights = nightDoc.nights;
  const nightById = new Map(nights.map(n => [n.night, n]));
  const corrections = () => getState()?.corrections || [];
  const shared = getState();
  const exp = shared.explore;
  const queryNight = new URLSearchParams(location.search).get("night") || "";

  function placedScans() {
    const dropScan = new Set();
    const dropNight = new Set();
    const move = new Map();
    for (const c of corrections()) {
      if (c.op === "exclude-scan") dropScan.add(String(c.scan));
      else if (c.op === "exclude-night") dropNight.add(c.night);
      else if (c.op === "move-scan") move.set(String(c.scan), c.to);
    }
    const out = [];
    for (const scan of scanDoc.scans) {
      const id = String(scan.id);
      if (dropScan.has(id)) continue;
      const night = move.get(id) || scan.night;
      if (dropNight.has(night) || !nightById.has(night)) continue;
      out.push(night === scan.night ? scan : { ...scan, night });
    }
    return out;
  }

  let scans = placedScans();
  const state = {
    year: exp.year || "all",
    night: queryNight && nightById.has(queryNight) ? queryNight : (exp.night || "all"),
    status: exp.status || "all",
    qualifies: !!exp.qualifies,
    annotation: !!exp.annotation,
    q: exp.q || "",
    colour: ["cls", "swin_e1", "swin_e4", "swin_e1e4"].includes(exp.colour) ? exp.colour : "cls",
    view: exp.view || "grid",
    cell: ["fit", "48", "72", "110"].includes(String(exp.cell)) ? String(exp.cell) : "fit",
    sort: "time",
    dir: 1,
    cuts: Object.fromEntries(modelList.map(m => [m.id, Number.isFinite(Number(shared.thresholds?.[m.id])) ? Number(shared.thresholds[m.id]) : m.cut])),
  };

  const passes = (scan, model) => Number(scan[model.scoreKey]) >= state.cuts[model.id];
  const kOf = scan => classifiers.reduce((n, m) => n + (passes(scan, m) ? 1 : 0), 0);

  function colourPass(scan) {
    if (state.colour !== "swin_e1" && state.colour !== "swin_e4" && state.colour !== "swin_e1e4") {
      return classifiers.every(m => passes(scan, m));
    }
    const model = byId.get(state.colour);
    return !!model && passes(scan, model);
  }

  function colourWords() {
    if (state.colour === "swin_e1" || state.colour === "swin_e4" || state.colour === "swin_e1e4") {
      const model = byId.get(state.colour);
      return model ? `Colour rule: green when ${model.label} passes the classification cutoff, red when it fails.` : "";
    }
    return "Colour rule: green when all three classifiers pass the classification cutoff, red when at least one fails.";
  }

  let fitPx = 48;
  function cellPx() {
    return state.cell === "fit" ? fitPx : Number(state.cell);
  }
  function measureFit() {
    const grid = document.querySelector("#body .night-grid");
    if (!grid) return;
    const sum = grid.querySelector(".ng-sum");
    if (!sum) return;
    const sumW = sum.getBoundingClientRect().width;
    const gridW = grid.clientWidth || document.getElementById("body").clientWidth;
    // 29 tracks, 1 px gaps, 1 px padding each side, and a 3 px midnight bar.
    const avail = gridW - sumW - 28 - 2 - 3;
    fitPx = Math.max(32, Math.min(110, Math.floor(avail / 28)));
    grid.style.setProperty("--cell", `${fitPx}px`);
  }

  let qualifying = new Map();
  let windowCounts = new Map();
  let bySlot = new Map();

  function indexScans() {
    bySlot = new Map();
    for (const scan of scans) {
      let slots = bySlot.get(scan.night);
      if (!slots) { slots = new Map(); bySlot.set(scan.night, slots); }
      slots.set(`${scan.hour}:${scan.minute}`, scan);
    }
  }

  function recomputeNights() {
    qualifying = new Map();
    windowCounts = new Map();
    const byNight = new Map();
    for (const scan of scans) {
      const list = byNight.get(scan.night);
      if (list) list.push(scan);
      else byNight.set(scan.night, [scan]);
    }
    for (const night of nights) {
      const list = (byNight.get(night.night) || []).filter(scan => inWindow(scan.hour));
      const counts = {};
      for (const model of classifiers) counts[model.id] = list.filter(scan => passes(scan, model)).length;
      for (const model of segmenters) {
        const vals = list.map(scan => Number(scan[model.scoreKey])).filter(Number.isFinite).sort((a, b) => a - b);
        counts[model.id] = vals.length ? vals[Math.floor((vals.length - 1) / 2)] : null;
      }
      const ok = list.length >= 10 && classifiers.every(model => counts[model.id] / list.length >= 0.5);
      qualifying.set(night.night, ok);
      windowCounts.set(night.night, { n: list.length, counts, qualifies: ok });
    }
  }

  function queryOk(scan) {
    if (!state.q) return true;
    const q = state.q.toLowerCase();
    return scan.night.toLowerCase().includes(q) || String(scan.id).includes(q);
  }

  function nightVisible(night) {
    if (state.year !== "all" && !night.night.startsWith(state.year)) return false;
    if (state.night !== "all" && night.night !== state.night) return false;
    if (state.status !== "all" && night.status !== state.status) return false;
    if (state.qualifies && !qualifying.get(night.night)) return false;
    if (state.annotation && !night.annotation_role) return false;
    if (!state.q) return true;
    const q = state.q.toLowerCase();
    if (night.night.toLowerCase().includes(q)) return true;
    const slots = bySlot.get(night.night);
    if (!slots) return false;
    for (const scan of slots.values()) if (String(scan.id).includes(q)) return true;
    return false;
  }

  function matchedScans() {
    const out = [];
    for (const scan of scans) {
      const meta = nightById.get(scan.night);
      if (!meta || !nightVisible(meta) || !queryOk(scan) || !presetOk(scan)) continue;
      out.push(scan);
    }
    return out.sort((a, b) => a.id - b.id);
  }

  function rows() { return matchedScans(); }

  function saveFilters() {
    patch(s => {
      s.explore.year = state.year;
      s.explore.night = state.night;
      s.explore.status = state.status;
      s.explore.qualifies = state.qualifies;
      s.explore.annotation = state.annotation;
      s.explore.q = state.q;
      s.explore.colour = state.colour;
      s.explore.view = state.view;
      s.explore.cell = state.cell;
    });
  }

  const mount = document.getElementById("main");
  const years = [...new Set(nights.map(n => n.night.slice(0, 4)))].sort();
  const ctrls = mount.querySelector("#ctrls");
  const addSelect = (label, id, options, current, onChange) => {
    const wrap = document.createElement("div");
    wrap.className = "f";
    wrap.innerHTML = `<label for="${id}">${label}</label><select id="${id}">` +
      options.map(([v, text]) => `<option value="${esc(v)}">${esc(text)}</option>`).join("") + "</select>";
    const select = wrap.querySelector("select");
    select.value = current;
    select.addEventListener("change", () => onChange(select.value));
    ctrls.appendChild(wrap);
    return select;
  };

  addSelect("Year", "s_year", [["all", "All years"], ...years.map(y => [y, y])], state.year, value => {
    state.year = value;
    if (state.night !== "all" && !state.night.startsWith(value) && value !== "all") state.night = "all";
    rebuildNights();
    saveFilters();
    draw();
  });
  const nightWrap = document.createElement("div");
  nightWrap.className = "f";
  ctrls.appendChild(nightWrap);
  function rebuildNights() {
    const ns = nights.filter(n => state.year === "all" || n.night.startsWith(state.year)).map(n => n.night);
    if (state.night !== "all" && !ns.includes(state.night)) state.night = "all";
    nightWrap.innerHTML = `<label for="s_night">Night</label><select id="s_night">` +
      `<option value="all">All nights (${ns.length})</option>` +
      ns.map(n => `<option value="${esc(n)}"${n === state.night ? " selected" : ""}>${esc(n)}</option>`).join("") +
      "</select>";
    nightWrap.querySelector("select").addEventListener("change", event => {
      state.night = event.target.value;
      saveFilters();
      draw();
    });
  }
  rebuildNights();
  addSelect("Night status", "s_status", [
    ["all", "All statuses"], ["complete", "Complete"], ["partial", "Partial"],
    ["gap-skipped", "Gap-skipped"], ["absent", "No files"],
  ], state.status, value => { state.status = value; saveFilters(); draw(); });

  const qual = document.createElement("div");
  qual.className = "f";
  qual.innerHTML = `<label for="s_qual">Night qualifies</label><span class="chk"><input type="checkbox" id="s_qual"${state.qualifies ? " checked" : ""}> 00–08 UTC rule</span>`;
  qual.querySelector("input").addEventListener("change", event => {
    state.qualifies = event.target.checked;
    saveFilters();
    draw();
  });
  ctrls.appendChild(qual);
  const ann = document.createElement("div");
  ann.className = "f";
  ann.innerHTML = `<label for="f-annotation">Annotation set</label><span class="chk"><input type="checkbox" id="f-annotation"${state.annotation ? " checked" : ""}> Annotation set</span>`;
  ann.querySelector("input").addEventListener("change", event => {
    state.annotation = event.target.checked;
    saveFilters();
    draw();
  });
  ctrls.appendChild(ann);
  addSelect("Colour by", "s_colour", [
    ["cls", "All classifiers"],
    ...classifiers.map(m => [m.id, m.label]),
  ], state.colour, value => { state.colour = value; saveFilters(); draw(); });
  addSelect("View", "s_view", [["grid", "Night grid"], ["thumbs", "Thumbnails"], ["table", "Table"]], state.view, value => {
    state.view = value;
    saveFilters();
    draw();
  });
  addSelect("Cell size", "s_cell", [["fit", "Fit"], ["48", "Small 48"], ["72", "Medium 72"], ["110", "Large 110"]], state.cell, value => {
    state.cell = value;
    saveFilters();
    draw();
  });
  addSelect("Sort by", "s_sort", [
    ["time", "Time"], ["k", "k/3 passing"],
    ...modelList.map(m => [m.scoreKey, m.label]),
  ], state.sort, value => { state.sort = value; draw(); });
  addSelect("Order", "s_dir", [["1", "Low / early first"], ["-1", "High / late first"]], String(state.dir), value => {
    state.dir = Number(value);
    draw();
  });

  const search = document.createElement("div");
  search.className = "f";
  search.innerHTML = `<label for="s_q">Find a scan</label><input id="s_q" type="search" placeholder="202207170300 or 2022-07-16" value="${esc(state.q)}">`;
  search.querySelector("input").addEventListener("input", event => {
    state.q = event.target.value.trim();
    saveFilters();
    draw();
  });
  ctrls.appendChild(search);

  const cuts = mount.querySelector("#cuts");
  mountClassificationCutoff(cuts, value => {
    for (const model of classifiers) state.cuts[model.id] = value;
    recomputeNights();
    draw();
    if (curId) renderOpenPanels();
  });
  let preset = "all";
  const presets = document.getElementById("presets");
  const PRESETS = [
    ["all", "All scans"],
    ["pass", "All classifiers pass"],
    ["disagree", "Classifiers disagree"],
    ["none", "No classifier passes"],
  ];
  function presetOk(scan) {
    const k = kOf(scan);
    if (preset === "pass") return k === 3;
    if (preset === "disagree") return k > 0 && k < 3;
    if (preset === "none") return k === 0;
    return true;
  }
  if (presets) {
    presets.innerHTML = PRESETS.map(([key, label]) =>
      `<button type="button" class="chip${key === preset ? " on" : ""}" data-p="${key}">${esc(label)}</button>`).join("");
    presets.addEventListener("click", event => {
      const button = event.target.closest("[data-p]");
      if (!button) return;
      preset = button.dataset.p;
      presets.querySelectorAll(".chip").forEach(el => el.classList.toggle("on", el === button));
      draw();
    });
  }

  const thumbUrl = ts => assetUrl(packMeta.thumbnail_path, ts, packMeta.thumbnail_version || packMeta.version);
  const packs = new SbandPackCache(ts => fetchSbandPack(assetUrl(packMeta.pack_path, ts, packMeta.version), packMeta), 3);
  let docX = 0;
  let docY = 0;
  const pinDoc = () => window.scrollTo(docX, docY);
  mount.addEventListener("pointerdown", event => {
    if (!event.target.closest(".gcell[data-ts], .scell[data-ts]")) return;
    docX = window.scrollX;
    docY = window.scrollY;
    requestAnimationFrame(pinDoc);
    setTimeout(pinDoc, 0);
    setTimeout(pinDoc, 80);
  }, true);

  function draw() {
    const matched = matchedScans();
    const count = mount.querySelector("#count");
    count.dataset.n = String(matched.length);
    count.dataset.view = state.view;
    count.dataset.colour = state.colour;
    count.innerHTML = `<b>${matched.length.toLocaleString("en-US")}</b> scans match.`;
    const selectedNight = document.getElementById("selected-night");
    if (selectedNight) selectedNight.textContent = state.night === "all" ? "none" : state.night;
    const annBox = document.getElementById("f-annotation");
    if (annBox) annBox.checked = state.annotation;
    const qualBox = document.getElementById("s_qual");
    if (qualBox) qualBox.checked = state.qualifies;
    document.getElementById("legend").innerHTML =
      `<span class="swatch-key"><i class="chip-sw pass"></i> classifiers pass</span>` +
      `<span class="swatch-key"><i class="chip-sw fail"></i> a classifier fails</span>` +
      `<span class="swatch-key"><i class="chip-sw hatch"></i> no scan</span>` +
      `<span id="colour-rule">${esc(colourWords())}</span>`;
    document.getElementById("hour-caveat").textContent =
      "Training-hour caveat: on C-band, scans at 19–23 UTC and at 09–11 UTC were all label 1. Read evening passes with care.";
    const body = mount.querySelector("#body");
    if (state.view === "table") { drawTable(body, ordered(matched)); return; }
    if (state.view === "thumbs") { drawThumbs(body, ordered(matched)); return; }
    drawGrid(body);
  }

  function ordered(list) {
    const dir = Number(state.dir) || 1;
    const value = scan => state.sort === "time" ? scan.id : state.sort === "k" ? kOf(scan) : Number(scan[state.sort]);
    return list.slice().sort((a, b) => dir * (value(a) - value(b)) || (a.id - b.id));
  }

  function slotHeads() {
    const one = (hour, minute) => {
      const label = `${pad(hour)}:${pad(minute)} UTC, ${edtHm(hour, minute)} EDT`;
      return `<span class="sh" title="${esc(label)}"><b>${pad(hour)}</b><small>:${pad(minute)}</small></span>`;
    };
    return SLOTS.slice(0, 10).map(([h, m]) => one(h, m)).join("") +
      `<span class="midnight-bar" title="Midnight UTC"></span>` +
      SLOTS.slice(10).map(([h, m]) => one(h, m)).join("");
  }

  function cellHtml(night, hour, minute) {
    const key = `${hour}:${minute}`;
    const scan = bySlot.get(night.night)?.get(key);
    const slot = `${pad(hour)}:${pad(minute)}`;
    if (!scan || !queryOk(scan)) {
      return `<div class="gcell hatch" data-pass="h" data-key="${esc(night.night)}|${slot}" data-night="${esc(night.night)}" title="No scan at ${slot} UTC"></div>`;
    }
    if (!presetOk(scan)) {
      return `<div class="gcell hatch" data-pass="h" data-key="${esc(night.night)}|${slot}" data-night="${esc(night.night)}" title="Hidden by the preset"></div>`;
    }
    const ok = colourPass(scan);
    const when = stamp(scan.id);
    const glyph = ok ? "✓" : "✗";
    const word = ok ? "pass" : "fail";
    const px = cellPx();
    return `<button type="button" class="gcell ${ok ? "pass" : "fail"}" data-pass="${ok ? "1" : "0"}" data-ts="${scan.id}" data-night="${esc(scan.night)}" data-slot="${slot}" title="${esc(when.title)} ${word}"><span class="frame"><img alt="" width="${px}" height="${px}" loading="lazy" decoding="async" src="${esc(thumbUrl(scan.id))}"></span><span class="badge" aria-hidden="true">${glyph}</span></button>`;
  }

  function rowHtml(night) {
    const stat = windowCounts.get(night.night) || { n: 0, counts: {}, qualifies: false };
    const countCell = (key, text) => `<span><small>${esc(key)}</small>${text}</span>`;
    const swin = classifiers.map(model => countCell(model.key, stat.n ? `${stat.counts[model.id] || 0}/${stat.n}` : "—")).join("");
    const att = segmenters.map(model => {
      const med = stat.counts[model.id];
      const show = med == null ? "—" : `${Math.round(med).toLocaleString("en-US")}`;
      return countCell(model.key, show);
    }).join("");
    const cells = SLOTS.slice(0, 10).map(([h, m]) => cellHtml(night, h, m)).join("") +
      `<span class="midnight-bar" title="Midnight UTC"></span>` +
      SLOTS.slice(10).map(([h, m]) => cellHtml(night, h, m)).join("");
    return `<div class="ng-row" data-night="${esc(night.night)}" data-status="${esc(night.status)}" data-qualifies="${stat.qualifies ? "1" : "0"}">
      <div class="ng-sum">
        <div class="ng-id"><b>${esc(night.night)}</b> <span class="${stat.qualifies ? "q-yes" : "q-no"}">${stat.qualifies ? "✓" : "✗"}</span></div>
        <div class="ng-meta">${esc(night.status)}${stat.n ? ` · ${stat.n} in 00–08` : ""}</div>
        <div class="ng-line" title="Classifier passes in 00–08 UTC"><b>Swin</b>${swin}</div>
        <div class="ng-line" title="Median mask area, km², in 00–08 UTC. Not a pass or fail."><b>Att</b>${att}</div>
      </div>
      <div class="ng-slots">${cells}</div>
    </div>`;
  }

  function drawGrid(body) {
    const visible = nights.filter(nightVisible);
    body.innerHTML = `<div id="grid-scroll" data-ready="0"><div class="night-grid${state.cell === "fit" ? " is-fit" : ""}" style="--cell:${cellPx()}px" data-colour="${esc(state.colour)}">
      <div class="ng-row ng-head"><div class="ng-sum">Night · 00–08 UTC</div><div class="ng-slots">${slotHeads()}</div></div>
      <div id="ng-body"></div>
    </div></div>`;
    if (state.cell === "fit") measureFit();
    const scroller = body.querySelector("#grid-scroll");
    const host = body.querySelector("#ng-body");
    scroller.addEventListener("click", event => {
      const cell = event.target.closest(".gcell[data-ts]");
      if (!cell) return;
      open(cell.dataset.ts);
      pinDoc();
    });
    if (!visible.length) {
      host.innerHTML = `<p class="small">No nights match.</p>`;
      scroller.dataset.ready = "1";
      return;
    }
    const chunk = 10;
    let index = 0;
    const paintChunk = () => {
      if (!host.isConnected) return;
      host.insertAdjacentHTML("beforeend", visible.slice(index, index + chunk).map(rowHtml).join(""));
      index += chunk;
      if (index < visible.length) requestAnimationFrame(paintChunk);
      else {
        if (state.cell === "fit") measureFit();
        scroller.dataset.ready = "1";
      }
    };
    paintChunk();
  }

  function drawThumbs(body, matched) {
    if (!matched.length) {
      body.innerHTML = `<div class="state"><div class="big">No scans match</div></div>`;
      return;
    }
    body.innerHTML = `<div class="sgrid">` + matched.slice(0, 120).map(scan => {
      const when = stamp(scan.id);
      const ok = colourPass(scan);
      return `<button type="button" class="scell ${ok ? "pass" : "fail"}" data-ts="${scan.id}" data-pass="${ok ? "1" : "0"}">
        <img class="im" width="120" height="120" loading="lazy" decoding="async" alt="" src="${esc(thumbUrl(scan.id))}">
        <span class="cap"><b>${when.hm}</b> <span class="m">${when.day}</span><br>
        <span class="glyph">${ok ? "✓" : "✗"}</span> <span class="kbadge">${kOf(scan)}/3</span></span>
      </button>`;
    }).join("") + `</div>
      <p class="small" style="margin-top:10px">Thumbnails are −0.3° reflectivity, with no mask. The border is the colour rule. ${matched.length > 120 ? `Showing the first 120 of ${matched.length.toLocaleString("en-US")}.` : ""}</p>`;
    body.querySelectorAll(".scell").forEach(button => button.addEventListener("click", () => {
      docX = window.scrollX;
      docY = window.scrollY;
      open(button.dataset.ts);
      pinDoc();
    }));
  }

  function drawTable(body, matched) {
    body.innerHTML = `<div id="tbl"></div>`;
    const tableRows = matched.map(scan => {
      const row = { ts: scan.id, night: scan.night, k: kOf(scan), pass: colourPass(scan) ? "pass" : "fail", _scan: scan };
      for (const model of modelList) row[model.id] = Number(scan[model.scoreKey]);
      return row;
    });
    new DataTable(body.querySelector("#tbl"), {
      columns: [
        { key: "ts", label: "Scan", cls: "", fmt: v => `<code>${v}</code>` },
        { key: "night", label: "Night", cls: "", fmt: v => esc(v) },
        ...modelList.map(m => ({
          key: m.id, label: m.label,
          fmt: v => m.family === "classifier" ? fmtProb(v) : fmtKm(v),
        })),
        { key: "k", label: "k/3", fmt: v => `${v}/3` },
        { key: "pass", label: "Colour", fmt: v => v === "pass" ? "✓" : "✗" },
      ],
      rows: tableRows,
      sort: state.sort === "time" ? "ts" : state.sort === "k" ? "k" : modelList.find(m => m.scoreKey === state.sort)?.id,
      dir: state.dir,
      pageSize: 25,
      onRow: row => open(String(row.ts)),
    });
  }

  /* Viewer. The shell is built once; same-night chips and arrows swap the scan. */
  const modalEl = mount.querySelector("#modal");
  const modal = new Modal(modalEl);
  const q = sel => modalEl.querySelector(sel);
  let cur = null, curId = "", pack = null, vlist = [], vidx = 0, token = 0;
  let ctx = null, image = null;
  let zoom = 1, panX = 0, panY = 0, legPos = null;
  const ZOOM_MIN = 1, ZOOM_MAX = 8, ZOOM_STEP = 1.25;

  const SHELL = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Scan viewer">
      <div class="box">
        <div class="hd">
          <h2 id="v-title" style="flex:1"></h2>
          <button id="prev" type="button" aria-label="Previous scan">←</button>
          <button id="next" type="button" aria-label="Next scan">→</button>
          <button id="x" type="button" aria-label="Close">✕ Close</button>
        </div>
        <div class="viewer-controls">
          <div class="viewer-control-row">
            <span class="viewer-control-label">Model</span>
            <div class="model-choices" role="radiogroup" aria-label="Model">
              <label class="model-choice"><input type="radio" name="v_model" value="e1" checked><span>AttUNet e1</span><small>−0.3°</small></label>
              <label class="model-choice"><input type="radio" name="v_model" value="e4"><span>AttUNet e4</span><small>0.4°</small></label>
              <label class="model-choice"><input type="radio" name="v_model" value="e1e4"><span>AttUNet e1e4</span></label>
            </div>
          </div>
          <div class="viewer-control-row">
            <span class="viewer-control-label">Layers</span>
            <div class="layer-choices" id="lays">
              <label class="chk"><input type="checkbox" id="l_refl" checked> Reflectivity</label>
              <label class="model-choice"><input type="radio" name="refl" value="m03" checked> −0.3°</label>
              <label class="model-choice"><input type="radio" name="refl" value="max6"> Max of 6 lowest tilts</label>
              <label class="chk"><input type="checkbox" id="l_e1" checked> <i class="mask-dot" style="background:rgb(${MASK_COLOR.e1.join(",")})"></i> e1</label>
              <label class="chk"><input type="checkbox" id="l_e4"> <i class="mask-dot" style="background:rgb(${MASK_COLOR.e4.join(",")})"></i> e4</label>
              <label class="chk"><input type="checkbox" id="l_e1e4"> <i class="mask-dot" style="background:rgb(${MASK_COLOR.e1e4.join(",")})"></i> e1e4</label>
            </div>
          </div>
          <div class="viewer-control-row">
            <span class="viewer-control-label">Combine</span>
            <select id="combine">
              <option value="overlay">Overlay</option>
              <option value="inter">Intersection</option>
              <option value="union">Union</option>
            </select>
          </div>
          <div class="viewer-control-row viewer-range-row">
            <span class="viewer-control-label">Display</span>
            <div class="viewer-slider"><label for="thr">Threshold <b id="thv">0.15</b></label>
              <input type="range" id="thr" min="0.02" max="0.9" step="0.01" value="0.15"></div>
            <div class="viewer-slider"><label for="op">Overlay opacity</label>
              <input type="range" id="op" min="0" max="1" step="0.05" value="0.75"></div>
            <button id="rst" type="button" class="ghost compact">Reset threshold</button>
          </div>
          <div class="viewer-control-row viewer-night-row">
            <span class="viewer-control-label">Same night</span>
            <div id="night"></div>
          </div>
        </div>
        <div class="viewer">
          <div>
            <div class="stage" id="stage">
              <div class="stage-scan" id="stage-scan"><canvas id="cv" width="480" height="480"></canvas></div>
              <div id="leg2" class="scan-legend" hidden title="Drag to move"></div>
              <div class="zoom-ctrls" role="group" aria-label="Scan zoom">
                <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
                <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
                <button type="button" id="zoom-reset" aria-label="Reset zoom">1×</button>
                <span class="zoom-lvl" id="zoom-lvl">100%</span>
              </div>
              <div id="noimg" class="state" style="display:none;position:absolute;inset:0"></div>
            </div>
            <p class="small" id="live"></p>
          </div>
          <div>
            <h3 style="margin-top:0">Scene</h3><div class="kv" id="v-scene"></div>
            <h3>Classification</h3><div class="kv" id="v-cls"></div>
            <h3>Segmentation</h3><div class="kv" id="v-seg"></div>
            <h3>Model comparison</h3><div class="kv" id="v-cmp"></div>
            <p class="small" id="v-cmp-note"></p>
          </div>
        </div>
      </div>
    </div>`;

  const modelKey = () => q('input[name="v_model"]:checked')?.value || "e1";
  const shownKeys = () => SEG_KEYS.filter(key => q("#l_" + key)?.checked);
  const threshold = () => Number(q("#thr")?.value || 0.15);

  function maskOf(key, cut) {
    const plane = pack.probabilities[key];
    const out = new Uint8Array(plane.length);
    for (let i = 0; i < plane.length; i++) if (plane[i] > cut) out[i] = 1;
    return out;
  }

  function combined(cut) {
    const keys = shownKeys();
    const masks = Object.fromEntries(keys.map(key => [key, maskOf(key, cut)]));
    const mode = q("#combine").value;
    const primary = modelKey();
    if (mode === "overlay" || keys.length < 2) return { mode, keys, masks, paint: masks };
    const out = new Uint8Array(pack.pixels);
    for (let i = 0; i < out.length; i++) {
      const hits = keys.filter(key => masks[key][i]);
      if (mode === "inter" ? hits.length === keys.length : hits.length > 0) out[i] = 1;
    }
    return { mode, keys, masks, paint: { [primary]: out } };
  }

  function applyZoom() {
    const scan = q("#stage-scan"), stage = q("#stage");
    if (!scan || !stage) return;
    if (zoom <= 1) { zoom = 1; panX = 0; panY = 0; }
    else {
      const maxX = (stage.clientWidth * (zoom - 1)) / 2;
      const maxY = (stage.clientHeight * (zoom - 1)) / 2;
      panX = Math.max(-maxX, Math.min(maxX, panX));
      panY = Math.max(-maxY, Math.min(maxY, panY));
    }
    scan.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    q("#zoom-lvl").textContent = `${Math.round(zoom * 100)}%`;
    stage.classList.toggle("is-zoomed", zoom > 1);
    q("#zoom-out").disabled = zoom <= ZOOM_MIN;
    q("#zoom-in").disabled = zoom >= ZOOM_MAX;
    q("#zoom-reset").disabled = zoom === 1;
  }

  function setZoom(next, cx, cy) {
    const stage = q("#stage");
    const prev = zoom;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    if (zoom !== prev && stage) {
      const rect = stage.getBoundingClientRect();
      const px = (cx == null ? rect.width / 2 : cx - rect.left) - rect.width / 2;
      const py = (cy == null ? rect.height / 2 : cy - rect.top) - rect.height / 2;
      const k = zoom / prev;
      panX = px - (px - panX) * k;
      panY = py - (py - panY) * k;
    }
    applyZoom();
  }

  function clampLegend() {
    const stage = q("#stage"), leg = q("#leg2");
    if (!stage || !leg || leg.hidden || !legPos) return;
    const maxX = Math.max(4, stage.clientWidth - leg.offsetWidth - 4);
    const maxY = Math.max(4, stage.clientHeight - leg.offsetHeight - 4);
    legPos.x = Math.max(4, Math.min(maxX, legPos.x));
    legPos.y = Math.max(4, Math.min(maxY, legPos.y));
    leg.style.left = legPos.x + "px";
    leg.style.top = legPos.y + "px";
    leg.style.right = "auto";
    leg.style.bottom = "auto";
  }

  function paint() {
    if (!pack || !ctx || !cur) return;
    const cut = threshold() * 255;
    const layers = combined(cut);
    const showRefl = q("#l_refl").checked;
    const refl = pack.reflectivity[q('input[name="refl"]:checked')?.value || "m03"];
    const opacity = Number(q("#op").value);
    const data = image.data;
    const counts = {};
    for (const key of Object.keys(layers.paint)) counts[key] = 0;
    const paintOrder = [...SEG_KEYS.filter(name => name !== modelKey()), modelKey()];
    let reflCount = 0;
    for (let i = 0, p = 0; i < pack.pixels; i++, p += 4) {
      let r = 0, g = 0, b = 0;
      if (showRefl && refl[i]) {
        const color = REFL_BANDS[refl[i] - 1].color;
        r = color[0]; g = color[1]; b = color[2];
        reflCount++;
      }
      const over = color => {
        r = r * (1 - opacity) + color[0] * opacity;
        g = g * (1 - opacity) + color[1] * opacity;
        b = b * (1 - opacity) + color[2] * opacity;
      };
      for (const key of paintOrder) {
        const plane = layers.paint[key];
        if (plane && plane[i]) { counts[key]++; over(MASK_COLOR[key]); }
      }
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    q("#thv").textContent = threshold().toFixed(2);
    drawLegend(showRefl, reflCount, counts, layers);
    renderOpenPanels(layers);
  }

  function pct(n) {
    const total = pack.pixels;
    const ratio = n / total;
    return { text: (ratio * 100).toFixed(ratio < 0.01 ? 2 : 1), count: n };
  }

  function drawLegend(showRefl, reflCount, counts, layers) {
    const leg = q("#leg2");
    const rowsHtml = [];
    const push = (color, name, count, id) => {
      const shown = count == null ? "" : pct(count);
      rowsHtml.push(`<div class="scan-legend-row" data-layer="${id}" data-count="${shown.count ?? ""}">
        <span class="scan-legend-sw" style="background:rgb(${color.join(",")})"></span>
        <span>${esc(name)}</span>
        ${shown.text == null ? "" : `<span class="scan-legend-pct">${shown.text}%</span>`}
      </div>`);
    };
    for (const key of SEG_KEYS) {
      if (counts[key] == null) continue;
      const name = layers.mode === "overlay" ? `AttUNet ${key}` : `${layers.mode} ${key}`;
      push(MASK_COLOR[key], name, counts[key], key);
    }
    if (showRefl) {
      push([190, 222, 230], "Reflectivity (not background)", reflCount, "refl");
      REFL_BANDS.forEach(band => {
        if (!band.label) return;
        rowsHtml.push(`<div class="scan-legend-row"><span class="scan-legend-sw" style="background:rgb(${band.color.join(",")})"></span><span>${esc(band.label)}</span></div>`);
      });
    }
    leg.innerHTML = rowsHtml.join("");
    leg.hidden = !rowsHtml.length;
    if (!legPos) { leg.style.left = "8px"; leg.style.top = "8px"; }
    else clampLegend();
  }

  function previewDice(a, b) {
    let inter = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      na += a[i]; nb += b[i]; inter += a[i] && b[i] ? 1 : 0;
    }
    return dice(inter, na, nb);
  }

  function renderOpenPanels() {
    if (!cur) return;
    const when = stamp(cur.id);
    const edt = edtOf(cur.id);
    const qualNight = qualifying.get(cur.night);
    q("#v-title").textContent = when.title;
    q("#v-title").dataset.ts = String(cur.id);
    q("#v-scene").innerHTML = [
      ["Timestamp", cur.id], ["Night", cur.night],
      ["UTC", `${when.hm} on ${when.day}`], ["EDT", `${edt.hm} on ${edt.date}`],
      ["Qualifies", qualNight ? "✓ qualifies" : "✗ does not qualify"],
    ].map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v" data-field="${esc(k)}">${esc(v)}</span>`).join("");
    q("#v-cls").innerHTML = classifiers.map(model => {
      const value = Number(cur[model.scoreKey]);
      const ok = value >= state.cuts[model.id];
      return `<span class="k">${esc(model.label)}</span><span class="v" data-metric="cls-${model.key}" data-pass="${ok ? 1 : 0}" data-value="${value}">${fmtProb(value)} ${ok ? "pass" : "fail"} <span class="m">cut ${fmtProb(state.cuts[model.id])}</span></span>`;
    }).join("");
    const key = modelKey();
    const seg = segmenters.find(model => model.key === key);
    const fullKm = Number(cur[seg.scoreKey]);
    const cut = pack ? threshold() * 255 : 0;
    const every = pack ? Object.fromEntries(SEG_KEYS.map(name => [name, maskOf(name, cut)])) : null;
    const livePx = every ? every[key].reduce((n, v) => n + v, 0) : 0;
    q("#v-seg").innerHTML = [
      [`Preview area`, `${fmtKm(livePx)} `, `live-area`, String(livePx)],
      [`Full-resolution area at 0.15`, fmtKm(fullKm), `full-area`, String(fullKm)],
    ].map(([k, v, metric, raw]) => `<span class="k">${esc(k)}</span><span class="v" data-metric="${metric}" data-value="${raw}">${v}</span>`).join("");
    const pairs = [["e1", "e4", "n_e1", "n_e4", "n_e1_and_e4"], ["e1", "e1e4", "n_e1", "n_e1e4", "n_e1_and_e1e4"], ["e4", "e1e4", "n_e4", "n_e1e4", "n_e4_and_e1e4"]];
    const liveMasks = every || {};
    q("#v-cmp").innerHTML = pairs.map(([a, b, na, nb, ni]) => {
      const full = dice(Number(cur[ni]), Number(cur[na]), Number(cur[nb]));
      const live = liveMasks[a] && liveMasks[b] ? previewDice(liveMasks[a], liveMasks[b]) : null;
      return `<span class="k">${a}–${b} full</span><span class="v" data-metric="dice-full-${a}-${b}" data-value="${full}">${full.toFixed(3)}</span>
        <span class="k">${a}–${b} preview</span><span class="v" data-metric="dice-live-${a}-${b}" data-value="${live ?? ""}">${live == null ? "—" : live.toFixed(3)}</span>`;
    }).join("");
    q("#v-cmp-note").textContent = "Full-resolution Dice uses the stored 960×960 masks at probability > 0.15. Preview Dice uses this 480 px block-max at the slider and is optimistic.";
    q("#live").textContent = `Preview threshold ${threshold().toFixed(2)} on the 480 px pack. Full-resolution area stays at 0.15.`;
  }

  function renderNight() {
    const el = q("#night");
    const sibs = scans.filter(scan => scan.night === cur.night).sort((a, b) => a.id - b.id);
    el.innerHTML = `<div class="chips">` + sibs.map(scan => {
      const k = kOf(scan);
      return `<button type="button" class="chip k${k}${scan.id === cur.id ? " on" : ""}" data-ts="${scan.id}">${stamp(scan.id).hm} · ${k}/3</button>`;
    }).join("") + `</div><p class="small">${sibs.length} scored scans on ${esc(cur.night)}, in time order.</p>`;
    el.querySelectorAll(".chip").forEach(button => button.addEventListener("click", () => loadScene(button.dataset.ts)));
  }

  async function loadScene(id) {
    const scan = scans.find(item => String(item.id) === String(id));
    if (!scan) return;
    const my = ++token;
    cur = scan;
    curId = String(scan.id);
    vidx = vlist.findIndex(item => String(item.id) === curId);
    q("#prev").disabled = vidx <= 0;
    q("#next").disabled = vidx < 0 || vidx >= vlist.length - 1;
    renderNight();
    renderOpenPanels();
    const noimg = q("#noimg");
    noimg.style.display = "flex";
    noimg.innerHTML = `<div><div class="spin"></div><div>Loading sample...</div></div>`;
    try {
      const next = await packs.get(curId);
      if (my !== token) return;
      pack = next;
      noimg.style.display = "none";
      paint();
    } catch (error) {
      if (my !== token) return;
      noimg.style.display = "flex";
      noimg.innerHTML = `<div><div class="big">Image failed to load</div><div class="small">${esc(error.message)}</div></div>`;
    }
  }

  function step(dir) {
    const next = vlist[vidx + dir];
    if (next) loadScene(next.id);
  }

  function wrapArrows() {
    const orig = modal.onKey;
    if (!orig || orig.wrapped) return;
    document.removeEventListener("keydown", orig);
    const wrapped = event => {
      const el = event.target;
      if (el && el.matches && el.matches("input, textarea, select") && String(event.key).startsWith("Arrow")) return;
      orig(event);
    };
    wrapped.wrapped = true;
    modal.onKey = wrapped;
    document.addEventListener("keydown", wrapped);
  }

  function bindViewer() {
    q("#x").addEventListener("click", () => { curId = ""; modal.close(); });
    q("#prev").addEventListener("click", () => step(-1));
    q("#next").addEventListener("click", () => step(1));
    q("#rst").addEventListener("click", () => { q("#thr").value = "0.15"; paint(); });
    ["#l_refl", "#l_e1", "#l_e4", "#l_e1e4", "#thr", "#op", "#combine"].forEach(sel => q(sel).addEventListener("input", paint));
    modalEl.querySelectorAll('input[name="refl"]').forEach(el => el.addEventListener("change", paint));
    modalEl.querySelectorAll('input[name="v_model"]').forEach(el => el.addEventListener("change", () => {
      q("#l_" + modelKey()).checked = true;
      paint();
    }));
    q("#zoom-in").addEventListener("click", () => setZoom(zoom * ZOOM_STEP));
    q("#zoom-out").addEventListener("click", () => setZoom(zoom / ZOOM_STEP));
    q("#zoom-reset").addEventListener("click", () => { zoom = 1; panX = 0; panY = 0; applyZoom(); });
    const stage = q("#stage");
    stage.addEventListener("wheel", event => {
      if (q("#noimg").style.display === "flex") return;
      event.preventDefault();
      setZoom(zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), event.clientX, event.clientY);
    }, { passive: false });
    let panDrag = null;
    stage.addEventListener("pointerdown", event => {
      if (event.button !== 0 || zoom <= 1 || event.target.closest(".scan-legend, .zoom-ctrls, #noimg")) return;
      panDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: panX, oy: panY };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("is-panning");
    });
    stage.addEventListener("pointermove", event => {
      if (!panDrag || event.pointerId !== panDrag.id) return;
      panX = panDrag.ox + (event.clientX - panDrag.x);
      panY = panDrag.oy + (event.clientY - panDrag.y);
      applyZoom();
    });
    const endPan = event => {
      if (!panDrag || event.pointerId !== panDrag.id) return;
      panDrag = null;
      stage.classList.remove("is-panning");
    };
    stage.addEventListener("pointerup", endPan);
    stage.addEventListener("pointercancel", endPan);
    const leg = q("#leg2");
    let legDrag = null;
    leg.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const rect = leg.getBoundingClientRect();
      const host = stage.getBoundingClientRect();
      legPos = { x: rect.left - host.left, y: rect.top - host.top };
      legDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: legPos.x, oy: legPos.y };
      leg.setPointerCapture(event.pointerId);
      event.stopPropagation();
    });
    leg.addEventListener("pointermove", event => {
      if (!legDrag || event.pointerId !== legDrag.id) return;
      legPos = { x: legDrag.ox + (event.clientX - legDrag.x), y: legDrag.oy + (event.clientY - legDrag.y) };
      clampLegend();
    });
    leg.addEventListener("pointerup", () => { legDrag = null; });
    ctx = q("#cv").getContext("2d", { willReadFrequently: true });
    image = ctx.createImageData(480, 480);
    applyZoom();
  }

  function open(id) {
    const known = scans.find(scan => String(scan.id) === String(id));
    if (!known) return;
    vlist = rows();
    const inList = vlist.some(scan => String(scan.id) === String(id));
    if (!inList) {
      const scan = scans.find(item => String(item.id) === String(id));
      if (scan) vlist = [scan, ...vlist];
    }
    zoom = 1; panX = 0; panY = 0; legPos = null;
    modal.open(SHELL, { onPrev: () => step(-1), onNext: () => step(1) });
    wrapArrows();
    bindViewer();
    loadScene(id);
    pinDoc();
    mount.querySelectorAll(".gcell.on").forEach(el => el.classList.remove("on"));
    const marked = mount.querySelector(`.gcell[data-ts="${id}"]`);
    if (marked) marked.classList.add("on");
  }

  function legacyId() {
    const params = new URLSearchParams(location.search);
    if (params.get("ts")) return String(params.get("ts"));
    const night = params.get("night") || "";
    const index = Number(params.get("i"));
    if (night && Number.isInteger(index) && index >= 0) {
      const list = scans.filter(scan => scan.night === night).sort((a, b) => a.id - b.id);
      if (list[index]) return String(list[index].id);
    }
    return "";
  }

  indexScans();
  recomputeNights();
  draw();
  window.addEventListener("resize", () => {
    if (state.view === "grid" && state.cell === "fit") measureFit();
  });
  const initial = legacyId();
  if (initial) open(initial);
  window.__explore = {
    rows, kOf, qualifying, passes, colourPass,
    rescan() { scans = placedScans(); indexScans(); recomputeNights(); draw(); },
  };
}

main().catch(error => {
  const note = document.createElement("p");
  note.textContent = error.message || String(error);
  document.getElementById("main").appendChild(note);
});
