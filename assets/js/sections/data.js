/* Data exploration: what the model was trained and judged on, and how the
   night-disjoint split keeps every test night unseen during training. */

import { load } from '../lib/data.js';
import { int, pct, SPLIT_COLOR, quantile, mean, esc, tsLabel } from '../lib/metrics.js';
import { barChart, histogram, boxPlot } from '../lib/charts.js';
import { DataTable } from '../lib/table.js';
import { scanCoverageChart, SCENE_TYPE_COLOR, SPLIT_MARKER_COLOR } from '../lib/scan-coverage.js';

const SPLITS = ['train', 'val', 'test'];

export async function render(mount) {
  const ds = await load('dataset');
  const scenes = ds.scenes;
  const lk = ds.leakage;
  const ns = ds.split_summary.night_split;
  const fr = ds.split_summary.fractions;
  const pctFrac = f => Math.round(f * 100);

  const years = [...new Set(scenes.map(s => s.year))].sort();
  let coverageYear = years.at(-1);
  const state = {split: 'all', year: 'all', type: 'all', size: 'all', query: ''};

  mount.innerHTML = `
  <h1>Data exploration</h1>
  <p class="lede">${int(scenes.length)} radar scenes from ${years[0]} to ${years.at(-1)}, each a
  ${ds.grid.h} × ${ds.grid.w} grid at ${ds.grid.pixel_m} m resolution.</p>

  <div class="note"><span class="tag">how the split works</span><div class="bd">
    Whole <b>operational nights</b> (${esc(ns.night_boundary)}) are assigned to train / validation / test
    (${pctFrac(fr.train)} / ${pctFrac(fr.val)} / ${pctFrac(fr.test)} of scans), so every scan of a night lands in
    the same split. <b>${int(ns.overlap_nights)} of ${int(ns.total_nights)}</b> nights contribute to more than one
    split, and <b>${int(lk.test_scenes_night_in_train)} of ${int(lk.test_scenes_total)}</b> positive test scans come
    from a night seen in training. The manifest is frozen and pinned by its SHA-256, so every run on this
    site was trained and scored on the same assignment.
  </div></div>

  <h2>Scan dates and split assignments</h2>
  <p class="small">Every coloured cell is one exact half-hour scan in the machine-learning manifest.
  Dates run down the chart and UTC time runs across it, matching the overnight collection window.
  Season buttons change this chart; the filters below control the exact scan list.</p>
  <div class="coverage-toolbar">
    <div><div class="control-label" id="coverage-years-label">Season</div>
      <div class="chips" id="coverage-years" role="group" aria-labelledby="coverage-years-label"></div></div>
    <div class="coverage-summary" id="coverage-summary"></div>
  </div>
  <figure>
    <div class="coverage-legend">
      <div class="coverage-key"><b>Scene type</b>
        <span><i class="sw coverage-with-swarm-key" style="background:${SCENE_TYPE_COLOR.positive}"></i>with swarm</span>
        <span><i class="sw" style="background:${SCENE_TYPE_COLOR.negative}"></i>swarm free</span>
        <span><i class="coverage-empty" aria-hidden="true"></i>not in the ML manifest</span>
      </div>
      <div class="coverage-key"><b>Split assignment</b>
        ${SPLITS.map(s => `<span><i class="coverage-split-dot" style="--marker:${SPLIT_MARKER_COLOR[s]}"></i>${s === 'val' ? 'validation' : s}</span>`).join('')}
      </div>
    </div>
    <div class="coverage-scroll" id="coverage-chart" tabindex="0" role="region"
      aria-label="Scrollable scan assignment chart; green and blue boxes show scene type, circles show data split"></div>
    <figcaption>Box colour shows scene type; circle colour shows split. Blank cells may be a missing scan or
    an unused negative scene; this view describes the frozen ${int(scenes.length)}-scene ML manifest, not all raw PPI files.
    An operational night runs from noon to noon UTC and therefore occupies two calendar-date rows.</figcaption>
  </figure>

  <h3>Exact scan list</h3>
  <p class="small">Use these filters to list the precise timestamps assigned to train, validation, or test.</p>
  <div class="ctrls" id="ctrls"></div>
  <div class="small" id="count" role="status" aria-live="polite"></div>
  <div id="scan-table"></div>

  <h2>Split and season coverage</h2>
  <div class="two">
    <figure><div class="viz" id="c-split"></div>
      <figcaption>Scenes per split by type. Swarm-free scans were sampled to about one per scan with a
      swarm, so these counts describe a balanced cohort, not the raw archive.</figcaption></figure>
    <figure><div class="viz" id="c-year"></div>
      <figcaption>Positive scenes per year, stacked by split.</figcaption></figure>
  </div>

  <h2>Target size and class imbalance</h2>
  <div class="cards" id="area-cards"></div>
  <div class="two">
    <figure><div class="viz" id="c-area"></div>
      <figcaption>Swarm area per positive scene (log scale).</figcaption></figure>
    <figure><div class="viz" id="c-areasplit"></div>
      <figcaption>Swarm area by split.</figcaption></figure>
  </div>

  <h2>Effect of the label threshold</h2>
  <p class="small">Labels store dBZ per swarm pixel; a threshold binarises them. The frozen protocol uses
  <b>dBZ ≥ 0</b>.</p>
  <div id="thr-table"></div>

  <h2>Are the splits comparable?</h2>
  <div id="cmp-table"></div>

  <h2>Data quality notes</h2>
  <div id="quality"></div>`;

  /* ---------- filters ---------- */
  const ctrls = mount.querySelector('#ctrls');
  const mk = (label, key, opts) => {
    const w = document.createElement('div');
    w.className = 'f';
    const id = 'f_' + key;
    w.innerHTML = `<label for="${id}">${label}</label><select id="${id}">` +
      opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('') + `</select>`;
    w.querySelector('select').addEventListener('change', e => { state[key] = e.target.value; draw(); });
    ctrls.appendChild(w);
  };
  mk('Split', 'split', [['all', 'All splits'], ...SPLITS.map(s => [s, s])]);
  mk('Year', 'year', [['all', 'All years'], ...years.map(y => [y, y])]);
  mk('Scene type', 'type', [['all', 'All scenes'], ['pos', 'With swarm'], ['neg', 'Swarm free']]);
  mk('Swarm size', 'size', [['all', 'Any size'], ['tiny', 'Under 1k px'], ['small', '1k – 10k px'],
    ['mid', '10k – 50k px'], ['big', 'Over 50k px']]);
  const searchWrap = document.createElement('div');
  searchWrap.className = 'f';
  searchWrap.innerHTML = `<label for="scan-search">Scan / date</label>
    <input id="scan-search" type="search" placeholder="e.g. 2019-07-24 or 00:30">`;
  const search = searchWrap.querySelector('input');
  search.addEventListener('input', e => { state.query = e.target.value; draw(); });
  ctrls.appendChild(searchWrap);
  const reset = document.createElement('button');
  reset.textContent = 'Reset filters';
  reset.className = 'ghost';
  reset.addEventListener('click', () => {
    Object.assign(state, {split: 'all', year: 'all', type: 'all', size: 'all', query: ''});
    ctrls.querySelectorAll('select').forEach(s => s.value = 'all');
    search.value = '';
    draw();
  });
  ctrls.appendChild(reset);

  const sizeBand = a => a === null || a === undefined ? null
    : a < 1000 ? 'tiny' : a < 10000 ? 'small' : a < 50000 ? 'mid' : 'big';

  const filtered = () => {
    const q = state.query.trim().toLowerCase();
    return scenes.filter(s => {
      const stamp = tsLabel(s.ts);
      const searchable = `${stamp} ${stamp.slice(0, 10)} ${stamp.slice(11)} ${s.ts} ${s.split} ` +
        `${s.split === 'val' ? 'validation' : ''} ${s.label === 1 ? 'with swarm positive' : 'swarm free negative'} ${s.night || ''}`;
      return (state.split === 'all' || s.split === state.split) &&
        (state.year === 'all' || String(s.year) === state.year) &&
        (state.type === 'all' || (state.type === 'pos' ? s.label === 1 : s.label === 0)) &&
        (state.size === 'all' || (s.label === 1 && sizeBand(s.area) === state.size)) &&
        (!q || searchable.toLowerCase().includes(q));
    });
  };

  /* ---------- exact assignment timeline ---------- */
  const yearBar = mount.querySelector('#coverage-years');
  years.forEach(year => {
    const button = document.createElement('button');
    button.className = 'chip';
    button.textContent = year;
    button.dataset.year = year;
    button.addEventListener('click', () => { coverageYear = year; drawCoverage(); });
    yearBar.appendChild(button);
  });

  function drawCoverage() {
    const {model, svg} = scanCoverageChart(scenes, coverageYear);
    yearBar.querySelectorAll('button').forEach(button => {
      const active = Number(button.dataset.year) === coverageYear;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    });
    mount.querySelector('#coverage-summary').innerHTML =
      `<span><b>${model.cells.length.toLocaleString('en-US')}</b>&nbsp;assigned scans</span><i class="coverage-sep">·</i>` +
      `<span><i class="coverage-split-dot" style="--marker:${SPLIT_MARKER_COLOR.train}"></i>${model.counts.train} train</span><i class="coverage-sep">·</i>` +
      `<span><i class="coverage-split-dot" style="--marker:${SPLIT_MARKER_COLOR.val}"></i>${model.counts.val} validation</span><i class="coverage-sep">·</i>` +
      `<span><i class="coverage-split-dot" style="--marker:${SPLIT_MARKER_COLOR.test}"></i>${model.counts.test} test</span>`;
    mount.querySelector('#coverage-chart').innerHTML = svg;
  }
  drawCoverage();

  const scanTable = new DataTable(mount.querySelector('#scan-table'), {
    rows: [], pageSize: 30, sort: 'ts', dir: 1,
    columns: [
      {key: 'ts', label: 'Scan timestamp (UTC)', fmt: value => `<code>${esc(tsLabel(value))}</code>`},
      {key: 'split', label: 'Split', fmt: value =>
        `<span class="coverage-split-dot" style="--marker:${SPLIT_MARKER_COLOR[value]}"></span> ${value === 'val' ? 'validation' : esc(value)}`},
      {key: 'label', label: 'Scene type', fmt: value =>
        `<span class="sw" style="background:${SCENE_TYPE_COLOR[value === 1 ? 'positive' : 'negative']}"></span> ` +
        (value === 1 ? 'with swarm' : 'swarm free')},
      {key: 'area', label: 'Swarm area (px)', fmt: value => value == null ? '<span class="na">—</span>' : int(value)},
      {key: 'night', label: 'Operational night', fmt: value => value ? esc(value) : '<span class="na">not assigned</span>'},
    ],
  });

  /* ---------- static (unfiltered) figures ---------- */
  const cnt = ds.split_summary.counts;
  mount.querySelector('#c-split').innerHTML = barChart({
    cats: SPLITS,
    series: [
      {label: 'with swarm', c: 'var(--accent2)', values: SPLITS.map(s => cnt[s].positives)},
      {label: 'swarm free', c: 'var(--tn)', values: SPLITS.map(s => cnt[s].negatives)},
    ],
    stacked: true, ylabel: 'scenes', xlabel: 'data split', W: 420, H: 300, valueLabels: true,
    aria: 'Scenes per split by type',
    legend: [{c: 'var(--accent2)', label: 'contains a swarm'}, {c: 'var(--tn)', label: 'swarm-free'}],
  });

  const pps = ds.split_summary.positives_per_year_per_split;
  mount.querySelector('#c-year').innerHTML = barChart({
    cats: years.map(String),
    series: SPLITS.map(s => ({
      label: s, c: SPLIT_COLOR[s],
      values: years.map(y => pps[y]?.[s] ?? 0),
    })),
    stacked: true, ylabel: 'positive scenes', xlabel: 'season (year)', W: 420, H: 300,
    valueLabels: true, aria: 'Positive scenes per year stacked by split',
    legend: SPLITS.map(s => ({c: SPLIT_COLOR[s], label: `${s} split`})),
  });

  /* ---------- label-threshold table (whole dataset) ---------- */
  const pos = scenes.filter(s => s.label === 1 && s.area_isfinite != null);
  const sum = k => pos.reduce((a, s) => a + (s[k] ?? 0), 0);
  const [sIsf, s0, s5] = [sum('area_isfinite'), sum('area'), sum('area_dbz5')];
  mount.querySelector('#thr-table').innerHTML = `
    <div class="tscroll"><table>
      <thead><tr><th>Label definition</th><th>Positive pixels kept</th><th>Share of “any echo”</th>
      <th>Median area / scene</th><th>Scenes left empty</th></tr></thead><tbody>
      ${[['any echo (isfinite)', 'area_isfinite', sIsf],
         ['dBZ ≥ 0 (selected)', 'area', s0],
         ['dBZ ≥ 5', 'area_dbz5', s5]].map(([lbl, key, tot]) => {
        const vals = pos.map(s => s[key] ?? 0);
        const empty = vals.filter(v => v === 0).length;
        const isSel = key === 'area';
        return `<tr class="${isSel ? 'best' : ''}"><td>${lbl}${isSel ? ' <span class="pill">selected</span>' : ''}</td>
          <td class="n">${int(tot)}</td><td class="n">${pct(tot / sIsf, 1)}</td>
          <td class="n">${int(quantile(vals, .5))}</td><td class="n">${empty}</td></tr>`;
      }).join('')}
    </tbody></table></div>
    <p class="small">Computed over all ${int(pos.length)} positive scenes from the cached label masks.
    “Scenes left empty” counts scenes where the threshold removes every positive pixel — those scenes
    become unlearnable under that definition.</p>`;

  /* ---------- comparability table ---------- */
  const stat = arr => arr.length ? {
    n: arr.length, med: quantile(arr, .5), q1: quantile(arr, .25), q3: quantile(arr, .75), mean: mean(arr),
  } : null;
  mount.querySelector('#cmp-table').innerHTML = `
    <div class="tscroll"><table>
      <thead><tr><th>Split</th><th>Positive scenes</th><th>Migration nights</th><th>Quiet nights</th><th>Years</th>
      <th>Median swarm area</th><th>IQR of swarm area</th><th>Median positive share</th></tr></thead><tbody>
      ${SPLITS.map(sp => {
        const rows = scenes.filter(s => s.split === sp && s.label === 1);
        const a = stat(rows.map(s => s.area).filter(v => v != null));
        const ps = ns.per_split[sp];
        const yrs = new Set(rows.map(s => s.year)).size;
        return `<tr><td><span class="sw" style="background:${SPLIT_COLOR[sp]}"></span> ${sp}</td>
          <td class="n">${int(rows.length)}</td><td class="n">${int(ps.migration_nights)}</td>
          <td class="n">${int(ps.quiet_nights)}</td><td class="n">${yrs}</td>
          <td class="n">${a ? int(a.med) : '—'}</td>
          <td class="n">${a ? `${int(a.q1)} – ${int(a.q3)}` : '—'}</td>
          <td class="n">${a ? pct(a.med / (ds.grid.h * ds.grid.w), 3) : '—'}</td></tr>`;
      }).join('')}
    </tbody></table></div>
    <p class="small">Target size is summarised so a reader can judge whether the test nights are easier or
    harder than the others. The splits share no night, so the test set is the only part of the data that
    played no role in training, checkpoint choice or threshold choice.</p>`;

  /* ---------- data-quality notes ---------- */
  const noArea = scenes.filter(s => s.label === 1 && s.area == null).length;
  const zero0 = pos.filter(s => (s.area ?? 0) === 0).length;
  mount.querySelector('#quality').innerHTML = `
    <div class="tscroll"><table>
      <thead><tr><th>Check</th><th>Result</th><th>Effect on the evaluation</th></tr></thead><tbody>
      <tr><td>Positive scenes without a cached label</td><td class="n">${noArea}</td>
        <td style="text-align:left">${noArea ? 'Excluded from area statistics.' : 'None: every positive scene has a label mask.'}</td></tr>
      <tr><td>Positive scenes emptied by the dBZ ≥ 0 threshold</td><td class="n">${zero0}</td>
        <td style="text-align:left">${zero0 ? 'These scenes have no learnable target under the selected label.' : 'None: the selected label keeps signal in every positive scene.'}</td></tr>
      <tr><td>Nights spanning more than one split</td><td class="n">${int(ns.overlap_nights)} of ${int(ns.total_nights)}</td>
        <td style="text-align:left">${ns.overlap_nights ? 'Those nights leak correlated scans across splits.'
          : 'None: no night is shared between splits.'} Scans within one night are still correlated, so
          intervals resample whole nights. See <a href="#/stats">statistical analysis</a>.</td></tr>
      <tr><td>Input channels with missing values</td><td class="n">handled</td>
        <td style="text-align:left">Radar tilts are sparse; missing values are filled before normalisation and a
          <code>valid_mask</code> channel tells the model where a real echo existed.</td></tr>
    </tbody></table></div>`;

  /* ---------- filtered figures ---------- */
  function draw() {
    const f = filtered();
    mount.querySelector('#count').innerHTML =
      `Matching <b>${int(f.length)}</b> of ${int(scenes.length)} scenes` +
      (f.length ? '' : ' — no scenes match, widen a filter.');
    scanTable.setRows(f);

    const areas = f.filter(s => s.label === 1 && s.area > 0).map(s => s.area);
    const cardsEl = mount.querySelector('#area-cards');
    if (!areas.length) {
      cardsEl.innerHTML = `<div class="card"><div class="k">Swarm area</div><div class="v">—</div>
        <div class="s">no positive scenes in this filter</div></div>`;
      mount.querySelector('#c-area').innerHTML =
        `<div class="state"><div class="big">No positive scenes selected</div>
         <div class="small">Set “Scene type” to “With swarm” or widen the filters.</div></div>`;
    } else {
      const px = ds.grid.h * ds.grid.w;
      cardsEl.innerHTML = [
        ['Positive scenes', int(areas.length), 'in current filter'],
        ['Median swarm', int(quantile(areas, .5)) + ' px', pct(quantile(areas, .5) / px, 3) + ' of the grid'],
        ['Smallest', int(Math.min(...areas)) + ' px', 'hardest cases'],
        ['Largest', int(Math.max(...areas)) + ' px', 'easiest cases'],
        ['Range', `${(Math.log10(Math.max(...areas) / Math.min(...areas))).toFixed(1)} decades`, 'spread of target size'],
      ].map(([k, v, s]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

      const lg = areas.map(a => Math.log10(a));
      const lo = Math.floor(Math.min(...lg) * 2) / 2, hi = Math.ceil(Math.max(...lg) * 2) / 2;
      const nb = 26, w = (hi - lo) / nb;
      const counts = new Array(nb).fill(0);
      lg.forEach(v => counts[Math.min(nb - 1, Math.max(0, Math.floor((v - lo) / w)))]++);
      mount.querySelector('#c-area').innerHTML = histogram({
        bins: Array.from({length: nb}, (_, i) => lo + i * w),
        counts, xlabel: 'swarm area, log10(pixels)', ylabel: 'scenes', W: 520, H: 300,
        aria: 'Distribution of swarm area',
      });
    }

    const groups = SPLITS.map(sp => {
      const a = f.filter(s => s.split === sp && s.label === 1 && s.area > 0).map(s => Math.log10(s.area));
      return a.length ? {
        label: sp, n: a.length, c: SPLIT_COLOR[sp],
        lo: quantile(a, .05), q1: quantile(a, .25), med: quantile(a, .5),
        q3: quantile(a, .75), hi: quantile(a, .95), mean: mean(a),
      } : {label: sp, n: 0, q1: null, c: SPLIT_COLOR[sp]};
    });
    mount.querySelector('#c-areasplit').innerHTML = boxPlot({
      groups, ylo: 1.5, yhi: 6, ylabel: 'swarm area, log10(pixels)', xlabel: 'data split',
      W: 520, H: 300, aria: 'Swarm area by split',
    });
  }
  draw();
}
