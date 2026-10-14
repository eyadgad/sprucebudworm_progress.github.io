import { MODEL_COLOR, esc, initShell, load, loadOptional, num } from "./common.js";

initShell();
const main = document.getElementById("main");
const NAMES = ["e1", "e4", "e1e4"];
const FIELDS = [
  ["dbzh", "DBZH −0.3°"],
  ["rho", "RHOHV −0.3°"],
  ["zdr", "ZDR −0.3°"],
];

let cls, nights, nightId, scans, seg, index, maskChoice;

function qs() {
  return new URLSearchParams(location.search);
}

function setQuery() {
  const u = new URL(location.href);
  u.searchParams.set("night", nightId);
  u.searchParams.set("i", String(index));
  history.replaceState(null, "", u);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

async function drawPane(canvas, ts, field) {
  const ctx = canvas.getContext("2d");
  const w = 480, h = 480;
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = "#121820";
  ctx.fillRect(0, 0, w, h);
  const base = `img/scans/${ts}_${field}.webp`;
  try {
    const img = await loadImage(base);
    ctx.drawImage(img, 0, 0, w, h);
  } catch {
    ctx.fillStyle = "#9aabbd";
    ctx.font = "15px Segoe UI, sans-serif";
    ctx.fillText("No picture for this night", 28, 230);
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.fillText(base, 28, 254);
    return;
  }
  if (maskChoice === "none") return;
  try {
    const mask = await loadImage(`img/scans/${ts}_${maskChoice}.png`);
    ctx.drawImage(mask, 0, 0, w, h);
  } catch {
    /* mask file arrives with the segmentation images */
  }
}

function timeline() {
  const W = 860, H = 168, padL = 36, padR = 12, padT = 16, padB = 28;
  const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;
  const n = scans.length;
  const xOf = i => n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * i / (n - 1);
  let g = "";
  for (const t of [0, 0.5, 1]) {
    const Y = y0 - t * (y0 - y1);
    g += `<line x1="${x0}" y1="${Y}" x2="${x1}" y2="${Y}" stroke="var(--grid)"/>`;
    g += `<text x="${x0 - 6}" y="${Y}" text-anchor="end" dominant-baseline="middle" class="ax">${t.toFixed(1)}</text>`;
  }
  // Areas, if the segmentation file is present, as a faint second encoding: not drawn here.
  NAMES.forEach((name, s) => {
    let d = "";
    scans.forEach((sc, i) => {
      const x = xOf(i);
      const y = y0 - Math.max(0, Math.min(1, sc.p[s])) * (y0 - y1);
      d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    });
    g += `<path d="${d}" fill="none" stroke="${MODEL_COLOR[s]}" stroke-width="1.6"/>`;
  });
  scans.forEach((sc, i) => {
    const x = xOf(i);
    g += `<rect class="hit" data-i="${i}" x="${(x - 6).toFixed(1)}" y="${y1}" width="12" height="${y0 - y1}" fill="transparent"><title>${esc(String(sc.ts))}</title></rect>`;
    if (i === index) g += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y0}" stroke="var(--ink)" stroke-width="1.2"/>`;
    if (i % Math.ceil(n / 8) === 0) {
      g += `<text x="${x}" y="${y0 + 16}" text-anchor="middle" class="ax">${String(sc.hour).padStart(2, "0")}:${String(sc.minute).padStart(2, "0")}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Classifier probability across the night">${g}</svg>`;
}

function areaLine() {
  if (!seg) return "";
  const bits = NAMES.map((name, s) => {
    const km = seg[scans[index].ts]?.[s];
    return `<span><i class="sw" style="background:${MODEL_COLOR[s]}"></i>${name} mask ${num(km, 0)} km²</span>`;
  }).join(" ");
  return `<div class="legend-inline">${bits}</div>`;
}

async function paint() {
  const sc = scans[index];
  setQuery();
  const mount = document.getElementById("explorer");
  const opts = nights.map(n => `<option value="${esc(n)}"${n === nightId ? " selected" : ""}>${esc(n)}</option>`).join("");
  const probs = NAMES.map((name, s) => `
    <div class="card"><div class="k" style="color:${MODEL_COLOR[s]}">${name}</div>
      <div class="v">${num(sc.p[s], 3)}</div>
      <div class="s">${sc.y[s] ? "scan positive" : "scan negative"}</div></div>`).join("");
  mount.innerHTML = `
    <div class="ctrls">
      <div class="f"><label for="night">Night</label>
        <select id="night">${opts}</select></div>
      <button type="button" id="prev">Previous scan</button>
      <button type="button" id="next">Next scan</button>
      <span class="small" id="pos">Scan ${index + 1} of ${scans.length}</span>
      <div class="f"><label for="mask">Mask overlay</label>
        <select id="mask">
          <option value="none">None</option>
          <option value="e1">e1</option>
          <option value="e4">e4</option>
          <option value="e1e4">e1e4</option>
        </select></div>
    </div>
    <div class="timeline" id="tl">${timeline()}</div>
    <div class="scan-meta">
      <b>${esc(String(sc.ts))}</b>
      <span>${String(sc.hour).padStart(2, "0")}:${String(sc.minute).padStart(2, "0")} UTC</span>
      <span>echo ${num(sc.echo_km2, 0)} km²</span>
      <span>insect ${num(sc.insect, 3)}</span>
      <span>rain ${num(sc.rain, 3)}</span>
      <span>median ρhv ${num(sc.rho, 3)}</span>
      <span>median ZDR ${num(sc.zdr, 2)} dB</span>
    </div>
    ${areaLine()}
    <div class="probs">${probs}</div>
    <div class="panes">
      ${FIELDS.map(([id, label]) => `<div class="pane"><h3>${esc(label)}</h3><div class="frame"><canvas id="c-${id}" aria-label="${esc(label)} for ${esc(String(sc.ts))}"></canvas></div></div>`).join("")}
    </div>
    <p class="small">Arrow keys move one scan. Probabilities and mask areas are stored for every scored night. Pictures are included for the 23 annotation nights and the 28 nights all three classifiers call positive: DBZH, RHOHV, and ZDR at −0.3°, 480 px, scaled to −5…40 dBZ, 0.40…1.00, and −1…6 dB. The mask is drawn on top. e4’s mask was computed from 0.4° DBZH and is overlaid on these −0.3° pictures. Other nights keep the timeline and the numbers, without a picture.</p>
  `;
  document.getElementById("mask").value = maskChoice;
  document.getElementById("night").addEventListener("change", e => { void goNight(e.target.value, false); });
  document.getElementById("prev").addEventListener("click", () => { void step(-1); });
  document.getElementById("next").addEventListener("click", () => { void step(1); });
  document.getElementById("mask").addEventListener("change", e => { maskChoice = e.target.value; void paint(); });
  document.getElementById("tl").addEventListener("click", e => {
    const hit = e.target.closest("[data-i]");
    if (!hit) return;
    index = Number(hit.dataset.i);
    void paint();
  });
  await Promise.all(FIELDS.map(([id]) => drawPane(document.getElementById(`c-${id}`), sc.ts, id)));
}

async function goNight(id, keepIndex) {
  nightId = id;
  scans = await load(`scans/${id}.json`);
  seg = await loadOptional(`seg/${id}.json`);
  if (!keepIndex) index = 0;
  if (index < 0 || index >= scans.length) index = 0;
  await paint();
}

async function step(d) {
  const next = index + d;
  if (next < 0 || next >= scans.length) return;
  index = next;
  await paint();
}

window.addEventListener("keydown", e => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (e.key === "ArrowLeft") { e.preventDefault(); void step(-1); }
  if (e.key === "ArrowRight") { e.preventDefault(); void step(1); }
});

try {
  cls = await load("classification.json");
  const excluded = cls.excluded_nights || [];
  nights = [...cls.nights.map(n => n.night), ...excluded].sort();
  maskChoice = "e1";
  const asked = qs().get("night");
  nightId = nights.includes(asked) ? asked : (cls.roles && Object.keys(cls.roles)[0]) || nights[0];
  const requested = Number(qs().get("i"));
  index = Number.isInteger(requested) && requested >= 0 ? requested : 0;
  main.innerHTML = `
    <h1>Night explorer</h1>
    <p class="lede">One scan at a time. The lines are the three classifier probabilities. Mask area is added when the segmentation table for that night is on the site.</p>
    <div id="explorer"><p class="small">Loading ${esc(nightId)}…</p></div>`;
  await goNight(nightId, true);
} catch (err) {
  main.innerHTML = `<h1>Night explorer</h1><div class="note bad"><span class="tag">error</span><div class="bd">${esc(err.message)}</div></div>`;
}
