/* Date x nighttime-scan coverage used by Data exploration.

   The dataset is sampled every 30 minutes across midnight.  This helper keeps
   that exact cadence (including :30 scans) and returns both a testable data
   model and an accessible SVG. */

import { esc } from './metrics.js';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

/* Coverage uses two independent encodings: box colour says what the scan
   contains, while the circle says which split owns it. The marker palette is
   deliberately high-chroma so all three remain legible on both box colours. */
export const SCENE_TYPE_COLOR = Object.freeze({positive: '#21845f', negative: '#286fbb'});
export const SPLIT_MARKER_COLOR = Object.freeze({train: '#ffe066', val: '#ffcbe1', test: '#b9f3ff'});

export const NIGHT_SLOTS = Object.freeze([
  ...Array.from({length: 10}, (_, i) => 19 * 60 + i * 30),
  ...Array.from({length: 23}, (_, i) => i * 30),
].map(minutes => Object.freeze({
  minutes,
  key: `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`,
  label: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
})));

function timestampParts(value) {
  const ts = String(value).padStart(12, '0');
  if (!/^\d{12}$/.test(ts)) throw new Error(`Invalid scan timestamp: ${value}`);
  const year = +ts.slice(0, 4), month = +ts.slice(4, 6), day = +ts.slice(6, 8);
  const hour = +ts.slice(8, 10), minute = +ts.slice(10, 12);
  const time = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute) {
    throw new Error(`Invalid scan timestamp: ${value}`);
  }
  return {ts, year, month, day, hour, minute, date: ts.slice(0, 8),
    slot: ts.slice(8, 12), time};
}

function dateParts(key) {
  const s = String(key);
  return {year: +s.slice(0, 4), month: +s.slice(4, 6), day: +s.slice(6, 8)};
}

function dateKey(time) {
  const d = new Date(time);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dateLabel(key) {
  const {month, day} = dateParts(key);
  return `${MONTH[month - 1]} ${String(day).padStart(2, '0')}`;
}

/** Build the exact year/date/time matrix without touching the DOM. */
export function scanCoverageModel(scenes, selectedYear) {
  const year = Number(selectedYear);
  const rows = scenes.filter(s => Number(s.year) === year)
    .map(scene => ({scene, ...timestampParts(scene.ts)}))
    .sort((a, b) => a.time - b.time);
  if (!rows.length) throw new Error(`No assigned scans found for ${selectedYear}`);

  const slotIndex = new Map(NIGHT_SLOTS.map((s, i) => [s.key, i]));
  const seen = new Set();
  const counts = {train: 0, val: 0, test: 0, positive: 0, negative: 0};
  const cells = rows.map(row => {
    const split = row.scene.split;
    if (!Object.hasOwn(SPLIT_MARKER_COLOR, split)) throw new Error(`Unknown split for ${row.ts}: ${split}`);
    if (row.scene.label !== 0 && row.scene.label !== 1)
      throw new Error(`Invalid scene label for ${row.ts}: ${row.scene.label}`);
    if (Number(row.scene.year) !== row.year || String(row.scene.date) !== row.date ||
        Number(row.scene.hour) !== row.hour)
      throw new Error(`Timestamp metadata mismatch for ${row.ts}`);
    const col = slotIndex.get(row.slot);
    if (col === undefined) throw new Error(`Scan ${row.ts} falls outside the nighttime coverage window`);
    const key = `${row.date}-${row.slot}`;
    if (seen.has(key)) throw new Error(`Duplicate scan cell: ${key}`);
    seen.add(key);
    counts[split]++;
    counts[row.scene.label === 1 ? 'positive' : 'negative']++;
    return {...row, split, positive: row.scene.label === 1, col};
  });

  const first = cells[0], last = cells.at(-1);
  const dates = [];
  const firstDay = Date.UTC(first.year, first.month - 1, first.day);
  const lastDay = Date.UTC(last.year, last.month - 1, last.day);
  for (let t = firstDay; t <= lastDay; t += DAY_MS) dates.push(dateKey(t));
  dates.reverse(); // newest at the top, matching the field-season coverage view
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  cells.forEach(c => { c.row = dateIndex.get(c.date); });

  return {year, dates, slots: NIGHT_SLOTS, cells, counts,
    firstDate: first.date, lastDate: last.date};
}

/** Render one year's assignment grid. Exact records remain available below it in a table. */
export function scanCoverageChart(scenes, selectedYear) {
  const model = scanCoverageModel(scenes, selectedYear);
  const {year, dates, slots, cells, counts} = model;
  const left = 68, top = 34, right = 12, bottom = 9;
  const cellW = 26, rowH = 13;
  const plotW = slots.length * cellW, plotH = dates.length * rowH;
  const W = left + plotW + right, H = top + plotH + bottom;
  const titleId = `coverage-title-${year}`, descId = `coverage-desc-${year}`;
  const aria = `${year} scan assignments: ${cells.length} scenes; ${counts.positive} with swarm and ` +
    `${counts.negative} swarm free; ${counts.train} training, ${counts.val} validation, and ${counts.test} test.`;

  const hourLabels = slots.map((slot, col) => slot.minutes % 60 === 0
    ? `<text x="${left + col * cellW + cellW / 2}" y="21" text-anchor="middle" class="ax">${slot.label}</text>`
    : '').join('');
  const vertical = Array.from({length: slots.length + 1}, (_, i) =>
    `<line x1="${left + i * cellW}" y1="${top}" x2="${left + i * cellW}" y2="${top + plotH}" class="coverage-grid"/>`).join('');
  const horizontal = Array.from({length: dates.length + 1}, (_, i) =>
    `<line x1="${left}" y1="${top + i * rowH}" x2="${left + plotW}" y2="${top + i * rowH}" class="coverage-grid"/>`).join('');
  const dateLabels = dates.map((date, row) =>
    `<text x="${left - 8}" y="${top + row * rowH + rowH / 2 + 3}" text-anchor="end" class="ax">${dateLabel(date)}</text>`).join('');
  const monthLines = dates.map((date, row) => row > 0 && date.slice(4, 6) !== dates[row - 1].slice(4, 6)
    ? `<line x1="4" y1="${top + row * rowH}" x2="${left + plotW}" y2="${top + row * rowH}" class="coverage-month"/>`
    : '').join('');

  const marks = cells.map(cell => {
    const x = left + cell.col * cellW + .5, y = top + cell.row * rowH + .5;
    const label = `${cell.ts.slice(0, 4)}-${cell.ts.slice(4, 6)}-${cell.ts.slice(6, 8)} ` +
      `${cell.ts.slice(8, 10)}:${cell.ts.slice(10, 12)} UTC — ` +
      `${cell.split === 'val' ? 'validation' : cell.split} — ${cell.positive ? 'with swarm' : 'swarm free'}`;
    return `<g class="coverage-scan" data-ts="${cell.ts}" data-split="${cell.split}" data-positive="${cell.positive ? '1' : '0'}">` +
      `<title>${esc(label)}</title>` +
      `<rect x="${x}" y="${y}" width="${cellW - 1}" height="${rowH - 1}" ` +
        `rx="${cell.positive ? 3 : 0}" fill="${SCENE_TYPE_COLOR[cell.positive ? 'positive' : 'negative']}" ` +
        `class="${cell.positive ? 'coverage-with-swarm' : 'coverage-swarm-free'}"/>` +
      `<circle cx="${x + (cellW - 1) / 2}" cy="${y + (rowH - 1) / 2}" r="3.35" ` +
        `fill="${SPLIT_MARKER_COLOR[cell.split]}" class="coverage-split-marker"/>` +
      `</g>`;
  }).join('');
  const midnightX = left + 10 * cellW;

  return {model, svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${titleId} ${descId}">
    <title id="${titleId}">${esc(aria)}</title>
    <desc id="${descId}">Dates are rows, newest first. Half-hour UTC times from 19:00 through 11:00 are columns. Green boxes contain a spruce budworm swarm and blue boxes are swarm free. Each box has a coloured circle giving its train, validation, or test assignment. The exact records are listed in the table below.</desc>
    <rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" rx="2" fill="var(--panel2)"/>
    ${hourLabels}${vertical}${horizontal}${monthLines}${dateLabels}
    <line x1="${midnightX}" y1="${top - 7}" x2="${midnightX}" y2="${top + plotH}" class="coverage-midnight"/>
    <text x="${midnightX + 5}" y="${top - 5}" class="ax">midnight</text>
    ${marks}
  </svg>`};
}
