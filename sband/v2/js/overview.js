import { esc, initShell } from "./shell.js";
import { addCorrection, boot, exportCorrections, getState, onChange, resetCorrections } from "./state.js";

initShell("overview");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const VARS = [
  ["TH", "Total reflectivity, unfiltered. A clutter diagnostic. Not a model input."],
  ["DBZH", "Filtered reflectivity. The six models read −0.3° and, where noted, 0.4°."],
  ["ZDR", "Differential reflectivity at −0.3°. Kept as a number, not a picture."],
  ["RHOHV", "Correlation coefficient at −0.3°. Kept as a number, not a picture."],
  ["WRADH", "Spectrum width. Not read by these six models."],
  ["VRADH", "Radial velocity. Not read by these six models."],
  ["PHIDP", "Differential phase. Not read by these six models."],
  ["DR", "Depolarization-like ratio in dB. The file does not name it. Not read by these six models."],
];

let nights = [];
let scanById = new Map();
let scored = new Map();
let models = null;
let shownYear = "2021";

function fmtTs(ts) {
  const s = String(ts).padStart(12, "0");
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)} UTC`;
}

function edtOf(ts) {
  const s = String(ts).padStart(12, "0");
  const utc = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
  const edt = new Date(utc - 4 * 3600 * 1000);
  const hm = `${String(edt.getUTCHours()).padStart(2, "0")}:${String(edt.getUTCMinutes()).padStart(2, "0")}`;
  return `${hm} EDT on ${edt.getUTCDate()} ${MONTHS[edt.getUTCMonth()]} ${edt.getUTCFullYear()}`;
}

function utcClock(ts) {
  const s = String(ts).padStart(12, "0");
  return `${s.slice(8, 10)}:${s.slice(10, 12)} UTC`;
}

function num(n) {
  return Number(n).toLocaleString("en-US");
}

function excludedNights() {
  return new Set(getState().corrections.filter(c => c.op === "exclude-night").map(c => c.night));
}

function statusBadges(n) {
  const bits = [];
  if (n.status === "complete") bits.push(`<span class="badge">complete</span>`);
  if (n.status === "partial") bits.push(`<span class="badge partial">partial</span>`);
  if (n.status === "gap-skipped") bits.push(`<span class="badge gap">gap-skipped</span>`);
  if (n.status === "absent") bits.push(`<span class="badge none">no files</span>`);
  if (n.no_0008) bits.push(`<span class="badge morning">no 00–08</span>`);
  if (excludedNights().has(n.night)) bits.push(`<span class="badge excluded">excluded</span>`);
  return bits.join("");
}

function reason(n) {
  const parts = [];
  if (n.status === "absent") parts.push("No files in the archive for this operational night.");
  if (n.status === "gap-skipped" && n.missing_stretch) {
    const g = n.missing_stretch;
    parts.push(`Not scored. The longest gap between selected half-hour scans is ${g.minutes} minutes, from ${fmtTs(g.from)} to ${fmtTs(g.to)}. ${g.files_inside} six-minute files sit inside that hole.`);
  }
  if (n.status === "partial" && n.missing_stretch?.timestamps?.length) {
    const ts = n.missing_stretch.timestamps;
    parts.push(`Scored ${n.n_scored} of 28 half-hour slots. Missing ${ts.length} slots, from ${fmtTs(ts[0])} to ${fmtTs(ts[ts.length - 1])}.`);
  }
  if (n.no_0008) parts.push("No scored scan falls in 00–08 UTC, so the default night rule does not use this night.");
  return parts.join(" ");
}

const NIGHT_HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function shortDate(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function edtHour(hour) {
  return (hour + 20) % 24;
}

function inScoredWindow(hour) {
  return hour <= 8 || hour >= 19;
}

function marks(hour, have) {
  if (!inScoredWindow(hour)) return "";
  const a = have?.has(0) ? `<b class="yes">●</b>` : "<span>○</span>";
  const b = have?.has(30) ? `<b class="yes">●</b>` : "<span>○</span>";
  return `${a}${b}`;
}

function hourHeads() {
  const cell = hour => {
    const edt = edtHour(hour);
    return `<span class="hh" data-hour="${hour}" data-edt="${edt}" title="${pad2(hour)}:00 UTC, ${pad2(edt)}:00 EDT"><b>${pad2(hour)}</b><small>${pad2(edt)}</small></span>`;
  };
  return `${NIGHT_HOURS.slice(0, 12).map(cell).join("")}<span class="midnight-bar" title="Midnight UTC"></span>${NIGHT_HOURS.slice(12).map(cell).join("")}`;
}

function dateSplit(night) {
  const morning = addDays(night, 1);
  return `<div class="hours date-split">
    <span class="eve">evening ${shortDate(night)}</span>
    <span class="midnight-bar" title="Midnight UTC"></span>
    <span class="morn">morning ${shortDate(morning)}</span>
  </div>`;
}

function renderCards() {
  const nFiles = nights.reduce((s, n) => s + n.n_files, 0);
  const withFiles = nights.filter(n => n.status !== "absent").length;
  const scoredN = nights.filter(n => n.status === "complete" || n.status === "partial").length;
  const nScans = scanById.size;
  const nModels = models.classifiers.length + models.segmenters.length;
  document.getElementById("summary-cards").innerHTML = `
    <div class="card"><div class="k">Years</div><div class="v" id="card-years">2021, 2022</div><div class="s">June–August seasons</div></div>
    <div class="card"><div class="k">Files</div><div class="v" id="card-files">${num(nFiles)}</div><div class="s">6-minute volumes</div></div>
    <div class="card"><div class="k">Nights with files</div><div class="v" id="card-nights-files">${num(withFiles)}</div><div class="s">of ${nights.length} season nights</div></div>
    <div class="card"><div class="k">Scored nights</div><div class="v" id="card-nights-scored">${num(scoredN)}</div><div class="s">${nights.filter(n => n.status === "complete").length} complete, ${nights.filter(n => n.status === "partial").length} partial</div></div>
    <div class="card"><div class="k">Scored scans</div><div class="v" id="card-scans">${num(nScans)}</div><div class="s">:00 and :30, 19:00–08:30 UTC</div></div>
    <div class="card"><div class="k">Models</div><div class="v" id="card-models">${nModels}</div><div class="s">3 classifiers, 3 segmenters</div></div>`;
}

function renderGrid() {
  const years = ["2021", "2022"];
  const headHours = hourHeads();
  const html = years.map(year => {
    const rows = nights.filter(n => n.night.startsWith(year)).map(n => {
      const have = scored.get(n.night);
      const one = hour => {
        const count = n.files_by_hour[hour];
        const slot = have?.get(hour);
        const windowed = inScoredWindow(hour);
        const date = hour >= 12 ? n.night : addDays(n.night, 1);
        const label = `${pad2(hour)} UTC on ${longDate(date)}`;
        const scoredTxt = !windowed ? "outside the scored window"
          : `${slot?.has(0) ? "scored" : "not scored"} at :00, ${slot?.has(30) ? "scored" : "not scored"} at :30`;
        return `<div class="hcell${windowed ? " in" : ""}" data-hour="${hour}" data-date="${date}" data-window="${windowed ? "1" : "0"}" data-label="${esc(label)}" title="${esc(label)}, ${pad2(edtHour(hour))}:00 EDT. ${count} files, ${scoredTxt}"><span class="cnt">${count}</span><span class="mk">${marks(hour, slot)}</span></div>`;
      };
      const cells = `${NIGHT_HOURS.slice(0, 12).map(one).join("")}<span class="midnight-bar" title="Midnight UTC"></span>${NIGHT_HOURS.slice(12).map(one).join("")}`;
      return `<div class="night-row" data-night="${esc(n.night)}" data-year="${year}">
        <a class="night-link" href="explore.html#night=${esc(n.night)}">${esc(n.night)}</a>
        <div class="badges">${statusBadges(n)}</div>
        <div class="hours-wrap">${dateSplit(n.night)}<div class="hours">${cells}</div></div>
      </div>`;
    }).join("");
    const hidden = year === shownYear ? "" : " hidden";
    return `<section class="year-block" id="year-${year}"${hidden}>
      <div class="hhead"><span class="spacer"></span><span class="spacer"></span><div class="hours-wrap"><div class="hours date-split"><span class="eve">evening</span><span class="midnight-bar" title="Midnight UTC"></span><span class="morn">morning</span></div><div class="hours">${headHours}</div></div></div>
      ${rows}
    </section>`;
  }).join("");
  document.getElementById("completeness").innerHTML = html;
  document.getElementById("tab-2021").classList.toggle("on", shownYear === "2021");
  document.getElementById("tab-2022").classList.toggle("on", shownYear === "2022");
}

function renderExample() {
  const id = 202107280000;
  const scan = scanById.get(String(id));
  const night = scan ? scan.night : "";
  document.getElementById("worked-example").innerHTML = `
    <p>An operational night is not a calendar date. The night id is the UTC date of (timestamp − 12 h). Scans from 12:00 through 23:59 UTC keep that calendar date. Scans from 00:00 through 11:59 UTC belong to the previous date.</p>
    <p>The radar is CASVD at Val d’Irène, Quebec, 48.48°N, 67.60°W. Every file in this archive falls in Eastern Daylight Time, so local time is UTC−4.</p>
    <p>Night <b>${esc(night)}</b> runs from 19:00 UTC (15:00 EDT on 27 July) through 08:30 UTC (04:30 EDT on 28 July).</p>
    <p id="example-scan">Scan <b>202107280000</b> is <b>00:00 UTC</b> on 28 July 2021, which is <b>20:00 EDT</b> on 27 July, and it belongs to night <b>2021-07-27</b>.</p>
    <p class="small">Checked against the scan file: ${scan ? `${utcClock(scan.id)} is stored on night ${esc(scan.night)}, ${edtOf(scan.id)}.` : "scan missing."}</p>
    <h3>Sunset and sunrise, approximate</h3>
    <p>These are a NOAA solar-elevation approximation at the radar, not an almanac. They are labelled approximate on purpose.</p>
    <table class="v2-table">
      <thead><tr><th>Date</th><th>Sunrise</th><th>Sunset</th></tr></thead>
      <tbody>
        <tr><td>21 June</td><td>08:28 UTC (04:28 EDT), approximate</td><td>00:35 UTC (20:35 EDT), approximate</td></tr>
        <tr><td>21 July</td><td>08:50 UTC (04:50 EDT), approximate</td><td>00:23 UTC (20:23 EDT), approximate</td></tr>
        <tr><td>21 August</td><td>09:31 UTC (05:31 EDT), approximate</td><td>23:37 UTC (19:37 EDT), approximate</td></tr>
      </tbody>
    </table>
    <p class="small">The scored window starts at 19:00 UTC (15:00 EDT), which is before sunset, and ends at 08:30 UTC (04:30 EDT), near sunrise in June.</p>`;
}

function renderQuestionable() {
  const rows = nights.filter(n => n.status !== "complete" || n.no_0008);
  document.getElementById("questionable").innerHTML = `<div class="qlist">${rows.map(n => `
    <article class="qnight">
      <h3>${esc(n.night)} ${statusBadges(n)}</h3>
      <p>${esc(reason(n))}</p>
    </article>`).join("")}</div>`;
}

function renderModels() {
  const body = [...models.classifiers, ...models.segmenters].map(m => {
    const cut = m.family === "classifier"
      ? `${Number(m.default_threshold).toFixed(2)} probability`
      : `${num(m.threshold_km2)} km² (${num(m.threshold_pixels)} px)`;
    return `<tr><td>${esc(m.id)}</td><td>${esc(m.input)}</td><td>${esc(m.score === "probability" ? "Probability, 0–1" : "Mask area, km²")}</td><td>${cut}</td><td>${esc(m.pass_rule)}</td></tr>`;
  }).join("");
  document.getElementById("models-table").innerHTML = `
    <p>${esc(models.label)}</p>
    <table class="v2-table">
      <thead><tr><th>Model</th><th>Input</th><th>Scan score</th><th>Default threshold</th><th>Pass rule</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p id="mask-area-note">${esc(models.mask_area_note || "")}</p>
    <p class="small">The 0.15 rule is a fixed pixel cut (probability &gt; 0.15). It is not a scan threshold. Classifier calls use ≥. Segmenter area calls use ≥ the Youden cut above.</p>`;
}

function renderVariables(dataset) {
  const tilts = dataset.elev_s_to_c.map(r =>
    `<tr><td>${r.s_index}</td><td>${Number(r.s_deg).toFixed(1)}°</td><td>${r.c_index}</td><td>${Number(r.c_deg).toFixed(1)}°</td><td>${Number(r.mismatch_deg).toFixed(1)}°</td></tr>`
  ).join("");
  document.getElementById("variables").innerHTML = `
    <table class="v2-table">
      <thead><tr><th>Variable</th><th>Role here</th></tr></thead>
      <tbody>${VARS.map(([name, role]) => `<tr><td>${esc(name)}</td><td>${esc(role)}</td></tr>`).join("")}</tbody>
    </table>
    <p>S-band has 17 tilts. The models use two of them: −0.3°, which matches C-band −0.3°, and 0.4°, which stands in for C-band 0.3° (+0.1°). e4’s mask is the 0.4° beam.</p>
    <table class="v2-table">
      <thead><tr><th>S index</th><th>S °</th><th>Nearest C index</th><th>C °</th><th>S − C °</th></tr></thead>
      <tbody>${tilts}</tbody>
    </table>`;
}

function renderNotes(dataset) {
  const s = dataset.sband;
  const months = dataset.months.map(r =>
    `<tr><td>${esc(r.month)}</td><td>${num(r.n_files)}</td><td>${num(r.days_present)}</td><td>${esc(r.days_missing || "none")}</td><td>${num(r.missing_6min_slots)} / ${num(r.expected_6min_slots)}</td></tr>`
  ).join("");
  const trap = dataset.index_trap.map(r =>
    `<tr><td>${esc(r.channel)}</td><td>${Number(r.c_deg).toFixed(1)}°</td><td>${Number(r.s_deg_at_index).toFixed(1)}°</td><td>${Number(r.error_deg).toFixed(1)}°</td></tr>`
  ).join("");
  document.getElementById("dataset-notes").innerHTML = `
    <h3>Coverage</h3>
    <p>S-band cadence is ${s.delta_mode_min} minutes, from ${esc(s.first)} through ${esc(s.last)}. A complete day is 240 slots. Hour 17 UTC has ${num(s.hour17_utc)} files. 17:18 UTC is missing on 179 of 180 days and is present only on 2022-08-02.</p>
    <table class="v2-table">
      <thead><tr><th>Month</th><th>Files</th><th>Days with a file</th><th>Days missing</th><th>Missing 6-min slots</th></tr></thead>
      <tbody>${months}</tbody>
    </table>
    <h3>Tilts and the index trap</h3>
    <p>C-band channel names are elevation indexes, not angles. <code>th_e1</code> is C-band −0.3°. The same index on S-band is 0.4°. These runs do not select by index: −0.3° is the S-band −0.3° tilt, and C-band 0.3° is taken from S-band 0.4°.</p>
    <table class="v2-table">
      <thead><tr><th>Channel</th><th>C-band °</th><th>S-band ° at that index</th><th>Index error °</th></tr></thead>
      <tbody>${trap}</tbody>
    </table>
    <h3>Height</h3>
    <p>S-band height follows the labelled angle with k ≈ 4/3. C-band height follows the labelled angle at twice the range (k ≈ 1/3). The six models do not read height.</p>`;
}

function fillNightSelect() {
  const sel = document.getElementById("cx-night");
  sel.innerHTML = nights.map(n => `<option value="${esc(n.night)}">${esc(n.night)}</option>`).join("");
  if ([...sel.options].some(o => o.value === "2021-07-27")) sel.value = "2021-07-27";
}

function wireCorrections() {
  const err = document.getElementById("cx-error");
  const say = text => { err.textContent = text || ""; };
  document.getElementById("cx-exclude-night").addEventListener("click", () => {
    const night = document.getElementById("cx-night").value;
    if (!nights.some(n => n.night === night)) { say("That night is not in the season list."); return; }
    addCorrection({ op: "exclude-night", night });
    say("");
  });
  document.getElementById("cx-exclude-scan").addEventListener("click", () => {
    const scan = document.getElementById("cx-scan").value.trim();
    if (!scanById.has(scan)) { say("That scan is not in the 4,666 scored scans."); return; }
    addCorrection({ op: "exclude-scan", scan });
    say("");
  });
  document.getElementById("cx-move-scan").addEventListener("click", () => {
    const scan = document.getElementById("cx-scan").value.trim();
    const to = document.getElementById("cx-dest").value.trim();
    const row = scanById.get(scan);
    if (!row) { say("That scan is not in the 4,666 scored scans."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || !nights.some(n => n.night === to)) {
      say("The destination must be one of the season nights.");
      return;
    }
    const from = new Date(`${row.night}T00:00:00Z`).getTime();
    const dest = new Date(`${to}T00:00:00Z`).getTime();
    if (Math.abs(dest - from) !== 86400000) {
      say(`A scan can move only to an adjacent night. ${scan} is on ${row.night}.`);
      return;
    }
    addCorrection({ op: "move-scan", scan, to });
    say("");
  });
  document.getElementById("cx-export").addEventListener("click", () => {
    document.getElementById("export-json").textContent = exportCorrections();
  });
  document.getElementById("cx-reset").addEventListener("click", () => {
    resetCorrections();
    document.getElementById("export-json").textContent = "";
    say("");
  });
}

function paint() {
  renderCards();
  renderGrid();
  renderQuestionable();
}

async function main() {
  const [modelDoc, nightDoc, scanDoc, dataset] = await Promise.all([
    fetch("data/models.json").then(r => r.json()),
    fetch("data/nights.json").then(r => r.json()),
    fetch("data/scans.json").then(r => r.json()),
    fetch("../data/dataset.json").then(r => r.json()),
  ]);
  models = modelDoc;
  nights = nightDoc.nights;
  for (const s of scanDoc.scans) {
    scanById.set(String(s.id), s);
    let byHour = scored.get(s.night);
    if (!byHour) { byHour = new Map(); scored.set(s.night, byHour); }
    let mins = byHour.get(s.hour);
    if (!mins) { mins = new Set(); byHour.set(s.hour, mins); }
    mins.add(s.minute);
  }
  onChange(() => { renderGrid(); renderQuestionable(); });
  boot(models);
  renderExample();
  renderVariables(dataset);
  renderModels();
  renderNotes(dataset);
  fillNightSelect();
  wireCorrections();
  paint();
  document.getElementById("tab-2021").addEventListener("click", () => { shownYear = "2021"; renderGrid(); });
  document.getElementById("tab-2022").addEventListener("click", () => { shownYear = "2022"; renderGrid(); });
  document.getElementById("grid-legend").textContent =
    "Columns run noon to noon: 12 UTC through 11 UTC. The bar is midnight UTC. Each row is labelled evening date | morning date. The upper number is the UTC hour and the lower number is EDT (UTC−4). The cell number is how many 6-minute files exist. In the scored window the marks are the :00 and :30 slots: ● scored, ○ not scored. Hours 09–18 UTC were not scored. Corrections do not change these counts.";
}

main().catch(err => {
  const mainEl = document.getElementById("main");
  const note = document.createElement("p");
  note.textContent = err.message || String(err);
  mainEl.appendChild(note);
});
