import { initShell, esc } from "./shell.js";
import { boot, getState, mountClassificationCutoff, onChange } from "./state.js";
import { chartFrame } from "../../assets/js/lib/charts.js";

initShell("analysis");

const LOGIT_LO = Math.log(1e-4 / (1 - 1e-4));
const LOGIT_HI = -LOGIT_LO;
const AREA_LO = Math.log10(0.25);
const AREA_HI = Math.log10(100000);
const N_HIST = 12;
const PAIRS = [["e1", "e4", "n_e1_and_e4"], ["e1", "e1e4", "n_e1_and_e1e4"], ["e4", "e1e4", "n_e4_and_e1e4"]];
const HOURS = [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8];

let modelList = [];
let cband = {};
let knownNights = new Set();
let scans = [];
let scatterCls = "swin_e1";
let scatterSeg = "attunet_e1";
let lastFlat = {};
let lastRows = [];

function pad(n) {
  return String(n).padStart(2, "0");
}

function attr(key, value, show) {
  const val = value == null ? "" : String(value);
  const extra = show == null ? "" : ` data-show="${esc(show)}"`;
  return `data-metric="${key}" data-value="${esc(val)}"${extra}`;
}

function inWindow(hour, rule) {
  const a = Number(rule.hourStart);
  const b = Number(rule.hourEnd);
  return a <= b ? hour >= a && hour <= b : hour >= a || hour <= b;
}

function valueOf(scan, model) {
  return model.family === "classifier" ? Number(scan[`p_${model.key}`]) : Number(scan[`area_${model.key}_km2`]);
}

function binSpan(z, lo, hi, n) {
  if (z <= lo) return 0;
  if (z >= hi) return n - 1;
  let index = Math.floor((z - lo) / (hi - lo) * n);
  if (index < 0) return 0;
  if (index > n - 1) return n - 1;
  return index;
}

function binLogit(p) {
  const x = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return binSpan(Math.log(x / (1 - x)), LOGIT_LO, LOGIT_HI, N_HIST);
}

function binArea(km) {
  return binSpan(Math.log10(Math.max(km, 0.25)), AREA_LO, AREA_HI, N_HIST);
}

function thresholdFrac(threshold, family) {
  let z;
  let lo;
  let hi;
  if (family === "classifier") {
    const x = Math.min(1 - 1e-6, Math.max(1e-6, threshold));
    z = Math.log(x / (1 - x));
    lo = LOGIT_LO;
    hi = LOGIT_HI;
  } else {
    z = Math.log10(Math.max(threshold, 0.25));
    lo = AREA_LO;
    hi = AREA_HI;
  }
  if (z <= lo) return 0;
  if (z >= hi) return 1;
  return (z - lo) / (hi - lo);
}

function bin01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 9;
  const index = Math.floor(value * 10);
  return index > 9 ? 9 : index;
}

function median(values) {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const n = ordered.length;
  if (n % 2) return ordered[Math.floor(n / 2)];
  return (ordered[n / 2 - 1] + ordered[n / 2]) / 2;
}

function agree(left, right) {
  let both = 0;
  let neither = 0;
  let aOnly = 0;
  let bOnly = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (a && b) both++;
    else if (!a && !b) neither++;
    else if (a) aOnly++;
    else bOnly++;
  }
  const n = left.length;
  if (!n) return { n: 0, both: 0, neither: 0, a_only: 0, b_only: 0, pct: null, kappa: null };
  const po = (both + neither) / n;
  const p1 = (both + aOnly) / n;
  const p2 = (both + bOnly) / n;
  const pe = p1 * p2 + (1 - p1) * (1 - p2);
  let kappa;
  if (Math.abs(1 - pe) < 1e-15) kappa = Math.abs(po - 1) < 1e-15 ? 1 : null;
  else kappa = (po - pe) / (1 - pe);
  return { n, both, neither, a_only: aOnly, b_only: bOnly, pct: 100 * po, kappa };
}

function putAgree(out, prefix, a, b, cell) {
  for (const part of ["n", "both", "neither", "a_only", "b_only", "pct", "kappa"]) {
    out[`${prefix}|${a}|${b}|${part}`] = cell[part];
  }
}

function activeScans(list, corrections) {
  const dropScan = new Set();
  const dropNight = new Set();
  const move = new Map();
  for (const item of corrections) {
    if (item.op === "exclude-scan") dropScan.add(String(item.scan));
    else if (item.op === "exclude-night") dropNight.add(item.night);
    else if (item.op === "move-scan") move.set(String(item.scan), item.to);
  }
  const out = [];
  for (const scan of list) {
    const id = String(scan.id);
    if (dropScan.has(id)) continue;
    const night = move.get(id) || scan.night;
    if (!knownNights.has(night) || dropNight.has(night)) continue;
    out.push(night === scan.night ? scan : { ...scan, night });
  }
  return out;
}

function qualifies(group, included, thresholds, rule) {
  const windowScans = group.filter(scan => inWindow(scan.hour, rule));
  if (!included.length || windowScans.length < Number(rule.minScans)) return false;
  if (rule.mode === "allpass") {
    let allPass = 0;
    for (const scan of windowScans) {
      if (included.every(model => valueOf(scan, model) >= thresholds[model.id])) allPass++;
    }
    return allPass / windowScans.length >= Number(rule.fraction);
  }
  return included.every(model => {
    const passed = windowScans.reduce((n, scan) => n + (valueOf(scan, model) >= thresholds[model.id] ? 1 : 0), 0);
    return passed / windowScans.length >= Number(rule.fraction);
  });
}

function compute(st) {
  const rows = activeScans(scans, st.corrections);
  const groups = new Map();
  for (const scan of rows) {
    const list = groups.get(scan.night);
    if (list) list.push(scan);
    else groups.set(scan.night, [scan]);
  }
  const out = {
    n_scans: rows.length,
    rule_fraction: Number(st.nightRule.fraction),
    rule_min: Number(st.nightRule.minScans),
    rule_h0: Number(st.nightRule.hourStart),
    rule_h1: Number(st.nightRule.hourEnd),
  };
  const flags = {};
  for (const model of modelList) {
    const values = rows.map(scan => valueOf(scan, model));
    const passed = values.map(value => value >= st.thresholds[model.id]);
    flags[model.id] = passed;
    out[`included|${model.id}`] = st.included[model.id] ? 1 : 0;
    out[`threshold|${model.id}`] = Number(st.thresholds[model.id]);
    out[`threshold_frac|${model.id}`] = thresholdFrac(Number(st.thresholds[model.id]), model.family);
    out[`pass_count|${model.id}`] = passed.reduce((n, ok) => n + (ok ? 1 : 0), 0);
    const hist = Array(N_HIST).fill(0);
    for (const value of values) hist[model.family === "classifier" ? binLogit(value) : binArea(value)]++;
    hist.forEach((count, index) => { out[`hist|${model.id}|${index}`] = count; });
    for (let hour = 0; hour < 24; hour++) {
      const subset = rows.filter(scan => scan.hour === hour);
      const passed = subset.reduce((n, scan) => n + (valueOf(scan, model) >= st.thresholds[model.id] ? 1 : 0), 0);
      out[`hour|${model.id}|${hour}|n`] = subset.length;
      out[`hour|${model.id}|${hour}|pass`] = passed;
      out[`hour|${model.id}|${hour}|rate`] = subset.length ? passed / subset.length : null;
    }
  }
  const months = [...new Set(rows.map(scan => scan.month))].sort();
  for (const model of modelList) {
    for (const month of months) {
      const subset = rows.filter(scan => scan.month === month);
      const passed = subset.reduce((n, scan) => n + (valueOf(scan, model) >= st.thresholds[model.id] ? 1 : 0), 0);
      out[`month|${model.id}|${month}|n`] = subset.length;
      out[`month|${model.id}|${month}|pass`] = passed;
      out[`month|${model.id}|${month}|rate`] = subset.length ? passed / subset.length : null;
    }
  }
  for (const left of modelList) {
    for (const right of modelList) putAgree(out, "agree_scan", left.id, right.id, agree(flags[left.id], flags[right.id]));
  }
  const nightFlags = Object.fromEntries(modelList.map(model => [model.id, {}]));
  for (const [night, group] of groups) {
    const windowScans = group.filter(scan => inWindow(scan.hour, st.nightRule));
    if (windowScans.length < Number(st.nightRule.minScans)) continue;
    for (const model of modelList) {
      const passed = windowScans.reduce((n, scan) => n + (valueOf(scan, model) >= st.thresholds[model.id] ? 1 : 0), 0);
      nightFlags[model.id][night] = passed / windowScans.length >= Number(st.nightRule.fraction);
    }
  }
  let called = groups.size ? Object.keys(nightFlags[modelList[0].id]).sort() : [];
  out.night_n = called.length;
  for (const left of modelList) {
    for (const right of modelList) {
      putAgree(out, "agree_night", left.id, right.id, agree(
        called.map(night => nightFlags[left.id][night]),
        called.map(night => nightFlags[right.id][night]),
      ));
    }
  }
  const included = modelList.filter(model => model.family === "classifier" && st.included[model.id]);
  let qual = 0;
  for (const group of groups.values()) if (qualifies(group, included, st.thresholds, st.nightRule)) qual++;
  out.qual_nights = qual;
  for (let step = 1; step <= 9; step++) {
    const rule = { ...st.nightRule, fraction: step / 10 };
    let count = 0;
    for (const group of groups.values()) if (qualifies(group, included, st.thresholds, rule)) count++;
    out[`qual_frac|${(step / 10).toFixed(1)}|n`] = count;
  }
  out.confound_09_11 = [9, 10, 11].reduce((n, hour) => n + out[`hour|swin_e1|${hour}|n`], 0);
  for (const [a, b, interKey] of PAIRS) {
    const diceVals = [];
    const iouVals = [];
    const diceBins = Array(10).fill(0);
    const iouBins = Array(10).fill(0);
    for (const scan of rows) {
      const na = Number(scan[`n_${a}`]);
      const nb = Number(scan[`n_${b}`]);
      const inter = Number(scan[interKey]);
      if (na + nb === 0) continue;
      const score = (2 * inter) / (na + nb);
      diceVals.push(score);
      diceBins[bin01(score)]++;
      const den = na + nb - inter;
      if (den === 0) continue;
      const iou = inter / den;
      iouVals.push(iou);
      iouBins[bin01(iou)]++;
    }
    out[`dice|${a}|${b}|n`] = diceVals.length;
    out[`dice|${a}|${b}|median`] = median(diceVals);
    out[`iou|${a}|${b}|n`] = iouVals.length;
    out[`iou|${a}|${b}|median`] = median(iouVals);
    diceBins.forEach((count, index) => { out[`dice|${a}|${b}|${index}`] = count; });
    iouBins.forEach((count, index) => { out[`iou|${a}|${b}|${index}`] = count; });
  }
  for (const model of modelList) {
    if (model.family !== "segmenter") continue;
    for (let hour = 0; hour < 24; hour++) {
      const vals = rows.filter(scan => scan.hour === hour).map(scan => valueOf(scan, model));
      out[`area_hour|${model.id}|${hour}`] = median(vals);
    }
  }
  for (const [key, value] of Object.entries(cband)) out[`cband|${key}`] = value;
  lastRows = rows;
  return out;
}

function pctShow(value) {
  return value == null ? "—" : `${Number(value).toFixed(1)}%`;
}

function kapShow(value) {
  return value == null ? "—" : `κ ${Number(value).toFixed(3)}`;
}

function medShow(value) {
  return value == null ? "—" : Number(value).toFixed(3);
}

function histSvg(modelId, cut) {
  const bins = [];
  for (let i = 0; i < N_HIST; i++) bins.push(lastFlat[`hist|${modelId}|${i}`]);
  const max = Math.max(1, ...bins);
  const w = 120;
  const h = 46;
  const bw = w / N_HIST;
  const bars = bins.map((count, i) => {
    const bh = (count / max) * (h - 8);
    return `<rect class="bar" x="${(i * bw).toFixed(2)}" y="${(h - bh).toFixed(2)}" width="${(bw - 0.35).toFixed(2)}" height="${Math.max(0, bh).toFixed(2)}" ${attr(`hist|${modelId}|${i}`, count, String(count))}><title>${count}</title></rect>`;
  }).join("");
  const mark = cut == null ? "" : `<line class="cut" x1="${(Math.min(1, Math.max(0, cut)) * w).toFixed(2)}" y1="0" x2="${(Math.min(1, Math.max(0, cut)) * w).toFixed(2)}" y2="${h}"></line>`;
  return `<svg viewBox="0 0 ${w} ${h}" role="img" ${chartFrame(w)} preserveAspectRatio="xMidYMid meet">${bars}${mark}</svg>`;
}

function smallHist(prefix, a, b) {
  const bins = [];
  for (let i = 0; i < 10; i++) bins.push(lastFlat[`${prefix}|${a}|${b}|${i}`]);
  const max = Math.max(1, ...bins);
  const w = 100;
  const h = 40;
  const bars = bins.map((count, i) => {
    const bh = (count / max) * (h - 6);
    return `<rect class="bar" x="${i * 10}" y="${(h - bh).toFixed(2)}" width="9.4" height="${Math.max(0, bh).toFixed(2)}" ${attr(`${prefix}|${a}|${b}|${i}`, count, String(count))}><title>${count}</title></rect>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" ${chartFrame(w)} preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}

function matrix(prefix, caption, models) {
  const list = models || modelList.filter(model => model.family === "classifier");
  const head = list.map(model => {
    const off = lastFlat[`included|${model.id}`] ? "" : " ex";
    return `<th class="${off}" title="${esc(model.label)}">${esc(model.label)}</th>`;
  }).join("");
  const body = list.map(row => {
    const off = lastFlat[`included|${row.id}`] ? "" : " ex";
    const cells = list.map(col => {
      const pct = lastFlat[`${prefix}|${row.id}|${col.id}|pct`];
      const kappa = lastFlat[`${prefix}|${row.id}|${col.id}|kappa`];
      return `<td class="${off}"><b ${attr(`${prefix}|${row.id}|${col.id}|pct`, pct, pctShow(pct))}>${pctShow(pct)}</b><span class="kap" ${attr(`${prefix}|${row.id}|${col.id}|kappa`, kappa, kapShow(kappa))}>${kapShow(kappa)}</span></td>`;
    }).join("");
    return `<tr><th class="${off}">${esc(row.label)}</th>${cells}</tr>`;
  }).join("");
  return `<table class="matrix"><caption>${caption}</caption><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function pctInt(rate) {
  return rate == null ? "—" : String(Math.round(Number(rate) * 100));
}

function hourTable() {
  const rows = modelList.filter(model => model.family === "classifier").map(model => {
    const cells = HOURS.map(hour => {
      const rate = lastFlat[`hour|${model.id}|${hour}|rate`];
      const show = pctInt(rate);
      const cls = hour >= 19 ? "hour-pos" : "hour-neg";
      const edt = pad((hour + 20) % 24);
      const pass = lastFlat[`hour|${model.id}|${hour}|pass`];
      const n = lastFlat[`hour|${model.id}|${hour}|n`];
      return `<span class="chip ${cls}" title="${pad(hour)}:00 UTC (${edt}:00 EDT), ${pass} of ${n}"><small>${pad(hour)}</small> <b ${attr(`hour|${model.id}|${hour}|rate`, rate, show)}>${show}</b></span>`;
    }).join("");
    return `<div class="rate-row"><b>${esc(model.label)}</b>${cells}</div>`;
  }).join("");
  return `<div class="rate-block"><p class="pair-note">Pass rate in percent by UTC hour. Gold hours are C-band label 1 only. Green hours are the only C-band hours with negatives. The tooltip gives EDT and the counts.</p>${rows}</div>`;
}

function monthTable() {
  const months = [...new Set(lastRows.map(scan => scan.month))].sort();
  const rows = modelList.filter(model => model.family === "classifier").map(model => {
    const cells = months.map(month => {
      const rate = lastFlat[`month|${model.id}|${month}|rate`];
      const show = pctInt(rate);
      return `<span class="chip" title="${lastFlat[`month|${model.id}|${month}|pass`]} of ${lastFlat[`month|${model.id}|${month}|n`]}"><small>${month}</small> <b ${attr(`month|${model.id}|${month}|rate`, rate, show)}>${show}</b></span>`;
    }).join("");
    return `<div class="rate-row"><b>${esc(model.label)}</b>${cells}</div>`;
  }).join("");
  return `<div class="rate-block"><p class="pair-note">Pass rate in percent by UTC month.</p>${rows}</div>`;
}

function paintScatter() {
  const host = document.getElementById("scatter-card");
  const canvas = document.getElementById("scatter");
  if (!host || !canvas) return;
  const cls = modelList.find(model => model.id === scatterCls) || modelList[0];
  const seg = modelList.find(model => model.id === scatterSeg) || modelList.find(model => model.family === "segmenter");
  const quad = document.getElementById("quads");
  if (quad) quad.textContent = "";
  const cssW = host.clientWidth || 320;
  const cssH = 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.round(cssH * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);
  const padL = 46;
  const padB = 22;
  const padT = 8;
  const padR = 8;
  const x0 = padL;
  const y0 = cssH - padB;
  const x1 = cssW - padR;
  const y1 = padT;
  const clsCut = Number(getState().thresholds[cls.id]);
  const yOf = km => {
    const z = Math.min(AREA_HI, Math.max(AREA_LO, Math.log10(Math.max(km, 0.25))));
    const t = (z - AREA_LO) / (AREA_HI - AREA_LO);
    return y0 - t * (y0 - y1);
  };
  const xOf = p => {
    const x = Math.min(1 - 1e-6, Math.max(1e-6, p));
    const z = Math.min(LOGIT_HI, Math.max(LOGIT_LO, Math.log(x / (1 - x))));
    const t = (z - LOGIT_LO) / (LOGIT_HI - LOGIT_LO);
    return x0 + t * (x1 - x0);
  };
  g.strokeStyle = "rgba(120,130,142,.45)";
  g.strokeRect(x0, y1, x1 - x0, y0 - y1);
  g.fillStyle = "rgba(20,90,140,.55)";
  for (const scan of lastRows) {
    g.fillRect(xOf(valueOf(scan, cls)), yOf(valueOf(scan, seg)), 1.6, 1.6);
  }
  g.strokeStyle = "rgb(179,55,47)";
  g.beginPath();
  g.moveTo(xOf(clsCut), y1);
  g.lineTo(xOf(clsCut), y0);
  g.stroke();
  g.fillStyle = "currentColor";
  g.font = "11px sans-serif";
  for (const p of [0.01, 0.1, 0.5, 0.9, 0.99]) {
    const x = xOf(p);
    const label = p === 0.5 ? "0.5" : String(p);
    g.fillText(label, Math.min(x1 - 18, Math.max(x0, x - 8)), y0 + 14);
  }
  g.textAlign = "right";
  for (const km of [1, 100, 10000]) g.fillText(String(km), x0 - 4, yOf(km) + 3);
  g.textAlign = "left";
}

function render(st) {
  const root = document.getElementById("main");
  root.dataset.ready = "0";
  const flat = compute(st);
  lastFlat = flat;
  window.__analysis = flat;
  const stateLine = modelList.map(model => {
    if (model.family !== "classifier") return `<span>${esc(model.label)} inspection only</span>`;
    const cut = Number(st.thresholds[model.id]).toFixed(2);
    const pass = flat[`pass_count|${model.id}`];
    return `<span>${esc(model.label)} <b ${attr(`threshold|${model.id}`, st.thresholds[model.id], cut)}>${cut}</b>, <b ${attr(`pass_count|${model.id}`, pass, String(pass))}>${pass}</b> pass</span>`;
  }).join("");
  document.getElementById("state-line").innerHTML = stateLine;
  const rule = st.nightRule;
  document.getElementById("rule-line").innerHTML = `Night rule: each classifier, fraction <span ${attr("rule_fraction", rule.fraction, String(rule.fraction))}>${rule.fraction}</span>, at least <span ${attr("rule_min", rule.minScans, String(rule.minScans))}>${rule.minScans}</span> scans, hours <span ${attr("rule_h0", rule.hourStart, pad(rule.hourStart))}>${pad(rule.hourStart)}</span>–<span ${attr("rule_h1", rule.hourEnd, pad(rule.hourEnd))}>${pad(rule.hourEnd)}</span> UTC.`;
  document.getElementById("distributions").innerHTML = modelList.map(model => {
    const classifier = model.family === "classifier";
    const axis = classifier ? "Logit of probability. Line is the classification cutoff." : "Log of mask area, km². No pass cutoff.";
    return `<article class="chart"><h3>${esc(model.label)}</h3><p class="small">${axis}</p>${histSvg(model.id, classifier ? flat[`threshold_frac|${model.id}`] : null)}</article>`;
  }).join("");
  const clsOpts = modelList.filter(model => model.family === "classifier").map(model => `<option value="${model.id}">${esc(model.label)}</option>`).join("");
  const segOpts = modelList.filter(model => model.family === "segmenter").map(model => `<option value="${model.id}">${esc(model.label)}</option>`).join("");
  document.getElementById("compare").innerHTML = `
    <p class="pair-note">Percentage is the share of classifier calls that match. κ is Cohen's kappa. The matrix is the three classifiers. <span ${attr("n_scans", flat.n_scans, String(flat.n_scans))}>${flat.n_scans}</span> scans. <span ${attr("night_n", flat.night_n, String(flat.night_n))}>${flat.night_n}</span> nights have enough window scans for a night call. A night call is that classifier's own fraction. Nights with too few window scans are left out.</p>
    ${matrix("agree_scan", "Scan agreement")}
    ${matrix("agree_night", "Night agreement")}
    <div id="scatter-card" class="chart scatter-wrap">
      <h3>Classifier probability against segmenter area</h3>
      <p class="pair-note">Probability is on a logit axis. Mask area is on a log axis, in km². An area of 0 is drawn at 0.25 km², which is one pixel. The line is the classification cutoff. Area has no pass cutoff.</p>
      <p class="pair-note">
        <label>Classifier <select id="scatter-cls">${clsOpts}</select></label>
        <label>Segmenter <select id="scatter-seg">${segOpts}</select></label>
      </p>
      <canvas id="scatter"></canvas>
      <p id="quads" class="pair-note"></p>
    </div>`;
  document.getElementById("scatter-cls").value = scatterCls;
  document.getElementById("scatter-seg").value = scatterSeg;
  paintScatter();
  const steps = [];
  for (let step = 1; step <= 9; step++) {
    const label = (step / 10).toFixed(1);
    const count = flat[`qual_frac|${label}|n`];
    const mark = Number(rule.fraction) === step / 10 ? " <b>current</b>" : "";
    steps.push(`<span ${attr(`qual_frac|${label}|n`, count, String(count))}>${label}: ${count}${mark}</span>`);
  }
  document.getElementById("patterns").innerHTML = `
    <p class="pair-note">Training-hour confound: on C-band, every scan at 19–23 UTC and at 09–11 UTC is label 1. Negatives occur only at 00–08 UTC. This scored set has <span ${attr("confound_09_11", flat.confound_09_11, String(flat.confound_09_11))}>${flat.confound_09_11}</span> scans at 09–11 UTC.</p>
    ${hourTable()}
    ${monthTable()}
    <p class="frac-note"><span ${attr("qual_nights", flat.qual_nights, String(flat.qual_nights))}>${flat.qual_nights}</span> nights qualify at the current fraction. A night qualifies when each classifier passes at least that fraction of its 00–08 UTC scans, and the night has at least 10 of those scans. Segmenters are not part of the rule.</p>
    <p class="state-line">${steps.join("")}</p>`;
  const segCards = PAIRS.map(([a, b]) => {
    const diceMed = flat[`dice|${a}|${b}|median`];
    const iouMed = flat[`iou|${a}|${b}|median`];
    const diceN = flat[`dice|${a}|${b}|n`];
    const iouN = flat[`iou|${a}|${b}|n`];
    return `<article class="chart"><h3>${a} and ${b}</h3>
      <p class="small">Dice median <b ${attr(`dice|${a}|${b}|median`, diceMed, medShow(diceMed))}>${medShow(diceMed)}</b> over <span ${attr(`dice|${a}|${b}|n`, diceN, String(diceN))}>${diceN}</span> scans. IoU median <b ${attr(`iou|${a}|${b}|median`, iouMed, medShow(iouMed))}>${medShow(iouMed)}</b> over <span ${attr(`iou|${a}|${b}|n`, iouN, String(iouN))}>${iouN}</span>.</p>
      <p class="small">Dice</p>${smallHist("dice", a, b)}
      <p class="small">IoU</p>${smallHist("iou", a, b)}
    </article>`;
  }).join("");
  const areaBody = modelList.filter(model => model.family === "segmenter").map(model => {
    const cells = HOURS.map(hour => {
      const value = flat[`area_hour|${model.id}|${hour}`];
      const show = value == null ? "—" : String(Math.round(Number(value)));
      return `<span class="chip"><small>${pad(hour)}</small> <b ${attr(`area_hour|${model.id}|${hour}`, value, show)}>${show}</b></span>`;
    }).join("");
    return `<div class="rate-row"><b>${esc(model.label)}</b>${cells}</div>`;
  }).join("");
  document.getElementById("segmentation-body").innerHTML = `
    <div class="seg-grid">${segCards}</div>
    <p class="pair-note">Median mask area, km², by UTC hour. Empty pairs are left out of the Dice and IoU distributions.</p>
    ${areaBody}`;
  const ref = ["e1", "e4", "e1e4"].map(key => {
    const value = flat[`cband|${key}`];
    return `<span ${attr(`cband|${key}`, value, Number(value).toFixed(3))}>${key} ${Number(value).toFixed(3)}</span>`;
  }).join(", ");
  document.getElementById("cband-ref").innerHTML = `C-band validation Dice, reference only: ${ref}. This is not an S-band score.`;
  root.dataset.ready = "1";
}

function prepare(doc) {
  modelList = [];
  cband = {};
  for (const model of doc.classifiers) {
    modelList.push({ id: model.id, family: "classifier", key: model.key, label: `Swin ${model.key}` });
  }
  for (const model of doc.segmenters) {
    modelList.push({ id: model.id, family: "segmenter", key: model.key, label: `AttUNet ${model.key}` });
    cband[model.key] = Number(model.cband_val_dice);
  }
}

document.getElementById("main").addEventListener("change", event => {
  if (event.target.id === "scatter-cls") scatterCls = event.target.value;
  if (event.target.id === "scatter-seg") scatterSeg = event.target.value;
  if (event.target.id === "scatter-cls" || event.target.id === "scatter-seg") paintScatter();
});

async function main() {
  const landSegmentation = location.hash.replace(/^#/, "").split("&")[0] === "segmentation";
  const [models, nightDoc, scanDoc] = await Promise.all([
    fetch("data/models.json").then(r => { if (!r.ok) throw new Error(`models.json ${r.status}`); return r.json(); }),
    fetch("data/nights.json").then(r => { if (!r.ok) throw new Error(`nights.json ${r.status}`); return r.json(); }),
    fetch("data/scans.json").then(r => { if (!r.ok) throw new Error(`scans.json ${r.status}`); return r.json(); }),
  ]);
  prepare(models);
  knownNights = new Set(nightDoc.nights.map(night => night.night));
  scans = scanDoc.scans.map(scan => {
    const id = String(scan.id).padStart(12, "0");
    return { ...scan, hour: Number(scan.hour), month: `${id.slice(0, 4)}-${id.slice(4, 6)}` };
  });
  boot(models);
  mountClassificationCutoff(document.getElementById("cls-cut-mount"));
  onChange(() => render(getState()));
  render(getState());
  if (landSegmentation) {
    document.getElementById("segmentation")?.scrollIntoView({ block: "start", behavior: "instant" });
  }
}

main().catch(err => {
  const note = document.createElement("p");
  note.textContent = err.message || String(err);
  document.getElementById("main").appendChild(note);
});
