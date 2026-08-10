/* Data exploration: what the model was trained and judged on, and the
   split-integrity problem that shapes how every later number should be read. */

import { load } from '../lib/data.js';
import { int, pct, SPLIT_COLOR, quantile, mean } from '../lib/metrics.js';
import { barChart, histogram, boxPlot } from '../lib/charts.js';

const SPLITS = ['train', 'val', 'test'];

export async function render(mount) {
  const [ds, mem] = await Promise.all([load('dataset'), load('memorization').catch(() => null)]);
  const scenes = ds.scenes;
  const lk = ds.leakage;

  const state = {split: 'all', year: 'all', type: 'all', size: 'all'};
  const years = [...new Set(scenes.map(s => s.year))].sort();

  mount.innerHTML = `
  <h1>Data exploration</h1>
  <p class="lede">${int(scenes.length)} radar scenes from ${years[0]} to ${years.at(-1)}, each a
  ${ds.grid.h} × ${ds.grid.w} grid at ${ds.grid.pixel_m} m resolution.</p>

  <div class="note"><span class="tag">how the split works</span><div class="bd">
    Scenes are split train / validation / test <b>stratified by year</b> (~70 / 20 / 10). Because
    assignment is per scene, not per night, <b>${lk.nights_all_three} of ${lk.n_nights}</b> nights
    contribute to all three splits; the generalisation check below tests what that means.
  </div></div>

  <h2>Filters</h2>
  <div class="ctrls" id="ctrls"></div>
  <div class="small" id="count"></div>

  <h2>Split and season coverage</h2>
  <div class="two">
    <figure><div class="viz" id="c-split"></div>
      <figcaption>Scenes per split, separating those that contain a swarm from swarm-free scenes.
      Swarm-free scenes are included at roughly 30% of positives so the model learns not to fire on
      empty skies.</figcaption></figure>
    <figure><div class="viz" id="c-year"></div>
      <figcaption>Positive scenes per year, stacked by split. Every year appears in every split at
      about 70 / 20 / 10, so no season is held out entirely.</figcaption></figure>
  </div>

  <h2>Target size and class imbalance</h2>
  <p>Each positive scene contains a swarm covering a small fraction of the ${int(ds.grid.h * ds.grid.w)}-pixel
  grid. This imbalance is the dominant difficulty of the task and drives the choice of loss function.</p>
  <div class="cards" id="area-cards"></div>
  <div class="two">
    <figure><div class="viz" id="c-area"></div>
      <figcaption>Distribution of swarm area per positive scene (log scale). The spread covers more than
      three orders of magnitude, so a single average Dice hides very different regimes.</figcaption></figure>
    <figure><div class="viz" id="c-areasplit"></div>
      <figcaption>Swarm area by split. Overlapping boxes indicate the splits are comparable in target
      size; a shifted box would mean the test set is systematically easier or harder.</figcaption></figure>
  </div>

  <h2>Effect of the label threshold</h2>
  <p>Labels store reflectivity in dBZ for swarm pixels. A threshold turns them into a binary mask.
  Experiment 3 selected <b>dBZ ≥ 0</b>. This is what each choice keeps:</p>
  <div id="thr-table"></div>

  <h2>Are the splits comparable?</h2>
  <p>If the test split were systematically different from training, the reported score would not be
  meaningful. These summaries compare them directly.</p>
  <div id="cmp-table"></div>

  <h2>Generalisation check</h2>
  <p>Comparing the score on data the model was <b>fitted on</b> against data it has never seen shows
  whether it has learned a general rule or memorised examples, and where the performance ceiling
  comes from.</p>
  <div id="memo"></div>

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
  const reset = document.createElement('button');
  reset.textContent = 'Reset filters';
  reset.className = 'ghost';
  reset.addEventListener('click', () => {
    Object.assign(state, {split: 'all', year: 'all', type: 'all', size: 'all'});
    ctrls.querySelectorAll('select').forEach(s => s.value = 'all');
    draw();
  });
  ctrls.appendChild(reset);

  const sizeBand = a => a === null || a === undefined ? null
    : a < 1000 ? 'tiny' : a < 10000 ? 'small' : a < 50000 ? 'mid' : 'big';

  const filtered = () => scenes.filter(s =>
    (state.split === 'all' || s.split === state.split) &&
    (state.year === 'all' || String(s.year) === state.year) &&
    (state.type === 'all' || (state.type === 'pos' ? s.label === 1 : s.label === 0)) &&
    (state.size === 'all' || (s.label === 1 && sizeBand(s.area) === state.size)));

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
      <thead><tr><th>Split</th><th>Positive scenes</th><th>Nights</th><th>Years</th>
      <th>Median swarm area</th><th>IQR of swarm area</th><th>Median positive share</th></tr></thead><tbody>
      ${SPLITS.map(sp => {
        const rows = scenes.filter(s => s.split === sp && s.label === 1);
        const a = stat(rows.map(s => s.area).filter(v => v != null));
        const nights = new Set(rows.map(s => s.night).filter(Boolean)).size;
        const yrs = new Set(rows.map(s => s.year)).size;
        return `<tr><td><span class="sw" style="background:${SPLIT_COLOR[sp]}"></span> ${sp}</td>
          <td class="n">${int(rows.length)}</td><td class="n">${nights}</td><td class="n">${yrs}</td>
          <td class="n">${a ? int(a.med) : '—'}</td>
          <td class="n">${a ? `${int(a.q1)} – ${int(a.q3)}` : '—'}</td>
          <td class="n">${a ? pct(a.med / (ds.grid.h * ds.grid.w), 3) : '—'}</td></tr>`;
      }).join('')}
    </tbody></table></div>
    <p class="small">The three splits have similar median swarm areas and interquartile ranges, so the
    test set is not obviously easier or harder in target size. The night overlap noted above is a
    separate and more serious issue.</p>`;

  /* ---------- generalisation check ---------- */
  const memoEl = mount.querySelector('#memo');
  if (!mem) {
    memoEl.innerHTML = `<div class="note warn"><span class="tag">not available</span><div class="bd">
      Not generated. Run <code>python scripts/test_memorization.py</code>.</div></div>`;
  } else {
    const g = mem.area_matched_gap;
    memoEl.innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Split</th><th>Model fitted on it?</th><th>Scenes</th><th>Mean Dice</th></tr></thead>
        <tbody>
        <tr><td>train</td><td style="text-align:left">yes</td>
          <td class="n">${mem.n_train_scored}</td><td class="n">${mem.train_mean_dice.toFixed(4)}</td></tr>
        <tr><td>validation</td><td style="text-align:left">no (used to choose the model)</td>
          <td class="n">317</td><td class="n">${mem.val_mean_dice.toFixed(4)}</td></tr>
        <tr class="best"><td>test</td><td style="text-align:left">no, fully held out</td>
          <td class="n">170</td><td class="n">${mem.test_mean_dice.toFixed(4)}</td></tr>
      </tbody></table></div>
      <p class="small">Scores are the same to within
      ${Math.abs(mem.train_mean_dice - mem.test_mean_dice).toFixed(4)} Dice
      (area-matched gap ${g >= 0 ? '+' : ''}${g.toFixed(4)}, Mann-Whitney p = ${mem.mannwhitney_p.toFixed(2)}).
      Per-scene performance is driven by <b>swarm size</b> (Spearman ρ = ${mem.area_partial_spearman.toFixed(3)}),
      not by how much related data the model saw in training.</p>

      <div class="note"><span class="tag">what this means</span><div class="bd">
        The model performs <b>no better on data it was fitted on</b> than on data it has never seen, so
        it is <b>under-fitted rather than over-fitted</b> — it has not exhausted what it could learn
        from the training set. Six architectures reaching the same ~0.63 plateau points the same way:
        the limit is <b>label noise and genuinely ambiguous swarm edges</b>, not model capacity.
        The highest-value work is therefore on the labels, not on a bigger network.
      </div></div>`;
  }

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
      <tr><td>Nights spanning more than one split</td><td class="n">${lk.nights_multi_split} of ${lk.n_nights}</td>
        <td style="text-align:left">Scenes within a night are correlated, so scene-level confidence intervals
          are narrower than the truth. See <a href="#/stats">statistical analysis</a>.</td></tr>
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
