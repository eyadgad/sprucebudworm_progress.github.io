/* Performance breakdown by year, night, time, plume size, density and difficulty.
   Every group carries its sample count and spread so a group of 3 scenes is not
   read as confidently as a group of 60. */

import { load } from '../lib/data.js';
import { M, fmtOr, int, esc, mean, std, quantile, bootCI } from '../lib/metrics.js';
import { boxPlot, barChart } from '../lib/charts.js';
import { DataTable } from '../lib/table.js';

const MIN_N = 5;   // groups below this are shown but flagged as unreliable

export async function render(mount) {
  const sm = await load('samples');
  const S = sm.samples.filter(s => s.label === 1);
  let split = 'test', metric = 'dice';

  mount.innerHTML = `
  <h1>Performance breakdown</h1>
  <p class="lede">Where the selected model does well and where it struggles, grouped by the metadata
  that exists for every scene. Small groups are flagged: with fewer than ${MIN_N} scenes a mean is not
  a reliable estimate.</p>

  <div class="ctrls">
    <div class="f"><label for="sp">Split</label><select id="sp">
      <option value="test">Test (held out)</option><option value="val">Validation</option>
      <option value="both">Both (shown separately)</option></select></div>
    <div class="f"><label for="mx">Metric</label><select id="mx">
      ${['dice','iou','precision','recall','boundary_iou','nsd'].map(k=>
        `<option value="${k}">${M[k].label}</option>`).join('')}</select></div>
  </div>
  <div class="note"><span class="tag">reading groups</span><div class="bd">
    Bars and boxes show the group mean or distribution; <b>n</b> is always printed. A group with a high
    mean and n = 2 tells you almost nothing. Use the confidence intervals in the tables rather than the
    bar heights when comparing small groups.
  </div></div>

  <h2>By year</h2>
  <figure><div class="viz" id="c-year"></div><figcaption id="cap-year"></figcaption></figure>
  <div id="t-year"></div>

  <h2>By time of night</h2>
  <p class="small">Hour is taken from the scan timestamp (UTC). Moth flights peak after dusk, so early
  and late hours have fewer scans and noisier estimates.</p>
  <figure><div class="viz" id="c-hour"></div><figcaption id="cap-hour"></figcaption></figure>

  <h2>By plume size</h2>
  <p>This is the strongest pattern in the whole evaluation, and it matches the baseline report's finding:
  performance rises steeply with the size of the target.</p>
  <figure><div class="viz" id="c-size"></div><figcaption id="cap-size"></figcaption></figure>
  <div id="t-size"></div>

  <h2>By plume density and fragmentation</h2>
  <p class="small">Density is the mean reflectivity of the labelled pixels; fragmentation is the number of
  separate connected regions in the ground truth. Both describe how "clean" a target is.</p>
  <div class="two">
    <figure><div class="viz" id="c-frag"></div><figcaption id="cap-frag"></figcaption></figure>
    <figure><div class="viz" id="c-dist"></div><figcaption id="cap-dist"></figcaption></figure>
  </div>

  <h2>By night</h2>
  <p class="small">Nights aggregate several scans of the same weather situation, so a night mean is more
  stable than a single scan. Sorted worst first, so the problem nights are visible immediately.</p>
  <div id="t-night"></div>

  <h2>Difficulty tiers</h2>
  <p class="small">Scenes split into thirds by their own Dice, to characterise what an easy, moderate and
  hard scene looks like. This is descriptive, not predictive: the tiers are defined using the score itself.</p>
  <div id="t-tier"></div>`;

  const cur = () => split === 'both' ? S : S.filter(s => s.split === split);
  const grp = (rows, keyFn) => {
    const g = new Map();
    rows.forEach(r => { const k = keyFn(r); if (k == null) return; (g.get(k) ?? g.set(k, []).get(k)).push(r); });
    return g;
  };
  const summarize = (rows, k) => {
    const v = rows.map(r => r[k]).filter(x => x != null);
    if (!v.length) return null;
    const ci = bootCI(v);
    return {n: v.length, mean: mean(v), med: quantile(v, .5), sd: v.length > 2 ? std(v) : null,
      q1: quantile(v, .25), q3: quantile(v, .75), lo: quantile(v, .05), hi: quantile(v, .95), ci};
  };
  const flag = n => n < MIN_N ? ` <span class="pill" style="color:var(--warn);border-color:var(--warn)">n=${n}, unreliable</span>` : '';

  function draw() {
    const rows = cur();
    const label = M[metric].label;

    /* ---- year ---- */
    const gy = grp(rows, r => r.year);
    const years = [...gy.keys()].sort();
    mount.querySelector('#c-year').innerHTML = boxPlot({
      groups: years.map(y => {
        const s = summarize(gy.get(y), metric);
        return s ? {label: String(y), n: s.n, c: 'var(--accent2)', lo: s.lo, q1: s.q1, med: s.med, q3: s.q3, hi: s.hi, mean: s.mean}
                 : {label: String(y), n: 0, q1: null};
      }), ylo: 0, yhi: 1, ylabel: `per-scene ${label}`, W: 880, H: 330,
      aria: `${label} by year`,
    });
    mount.querySelector('#cap-year').textContent =
      `Per-scene ${label} by year on the ${split} split. Sample counts are printed under each box.`;
    mount.querySelector('#t-year').innerHTML = groupTable(
      years.map(y => ({key: String(y), rows: gy.get(y)})), metric);

    /* ---- hour ---- */
    const gh = grp(rows, r => r.hour);
    const hours = [...gh.keys()].sort((a, b) => a - b);
    mount.querySelector('#c-hour').innerHTML = barChart({
      cats: hours.map(h => String(h).padStart(2, '0')),
      series: [{label, c: 'var(--accent2)', values: hours.map(h => summarize(gh.get(h), metric)?.mean)}],
      lo: 0, hi: 1, ylabel: `mean ${label}`, W: 880, H: 280, aria: `${label} by hour`,
    });
    const thin = hours.filter(h => gh.get(h).length < MIN_N).length;
    mount.querySelector('#cap-hour').textContent =
      `Mean ${label} by hour (UTC). ${thin} of ${hours.length} hours have fewer than ${MIN_N} scenes and should not be compared.`;

    /* ---- size ---- */
    const bands = [
      ['< 1k px', r => r.gt_area < 1000],
      ['1k – 5k', r => r.gt_area >= 1000 && r.gt_area < 5000],
      ['5k – 20k', r => r.gt_area >= 5000 && r.gt_area < 20000],
      ['20k – 50k', r => r.gt_area >= 20000 && r.gt_area < 50000],
      ['50k – 150k', r => r.gt_area >= 50000 && r.gt_area < 150000],
      ['> 150k px', r => r.gt_area >= 150000],
    ];
    const bandRows = bands.map(([k, f]) => ({key: k, rows: rows.filter(f)}));
    mount.querySelector('#c-size').innerHTML = boxPlot({
      groups: bandRows.map(b => {
        const s = summarize(b.rows, metric);
        return s ? {label: b.key, n: s.n, c: 'var(--accent2)', lo: s.lo, q1: s.q1, med: s.med, q3: s.q3, hi: s.hi, mean: s.mean}
                 : {label: b.key, n: b.rows.length, q1: null};
      }), ylo: 0, yhi: 1, ylabel: `per-scene ${label}`, W: 880, H: 340,
      aria: `${label} by plume size`,
    });
    const smallB = summarize(bandRows[0].rows, metric), bigB = summarize(bandRows.at(-1).rows, metric);
    mount.querySelector('#cap-size').textContent =
      (smallB && bigB)
        ? `${label} rises from ${smallB.mean.toFixed(3)} on the smallest plumes (n=${smallB.n}) to ${bigB.mean.toFixed(3)} on the largest (n=${bigB.n}).`
        : `Per-scene ${label} by ground-truth plume area.`;
    mount.querySelector('#t-size').innerHTML = groupTable(bandRows, metric);

    /* ---- fragmentation ---- */
    const fr = [['1 region', r => r.n_gt_regions <= 1], ['2 – 3', r => r.n_gt_regions >= 2 && r.n_gt_regions <= 3],
                ['4 – 8', r => r.n_gt_regions >= 4 && r.n_gt_regions <= 8], ['> 8 regions', r => r.n_gt_regions > 8]];
    mount.querySelector('#c-frag').innerHTML = boxPlot({
      groups: fr.map(([k, f]) => {
        const s = summarize(rows.filter(f), metric);
        return s ? {label: k, n: s.n, c: 'var(--accent2)', lo: s.lo, q1: s.q1, med: s.med, q3: s.q3, hi: s.hi, mean: s.mean}
                 : {label: k, n: 0, q1: null};
      }), ylo: 0, yhi: 1, ylabel: `per-scene ${label}`, W: 520, H: 300,
      aria: `${label} by number of truth regions`,
    });
    mount.querySelector('#cap-frag').textContent =
      `Grouped by how many separate connected regions the ground truth contains.`;

    /* ---- radial distance ---- */
    const dbands = [['< 60 km', r => r.gt_dist_km < 60], ['60 – 110', r => r.gt_dist_km >= 60 && r.gt_dist_km < 110],
                    ['110 – 160', r => r.gt_dist_km >= 110 && r.gt_dist_km < 160], ['> 160 km', r => r.gt_dist_km >= 160]];
    mount.querySelector('#c-dist').innerHTML = boxPlot({
      groups: dbands.map(([k, f]) => {
        const s = summarize(rows.filter(r => r.gt_dist_km != null && f(r)), metric);
        return s ? {label: k, n: s.n, c: 'var(--accent2)', lo: s.lo, q1: s.q1, med: s.med, q3: s.q3, hi: s.hi, mean: s.mean}
                 : {label: k, n: 0, q1: null};
      }), ylo: 0, yhi: 1, ylabel: `per-scene ${label}`, W: 520, H: 300,
      aria: `${label} by mean distance from the radar`,
    });
    mount.querySelector('#cap-dist').textContent =
      `Grouped by the mean distance of the labelled plume from the radar. Beam height rises with range, so distant plumes are sampled higher in the atmosphere.`;

    /* ---- nights ---- */
    const gn = grp(rows, r => r.night);
    const nightRows = [...gn.entries()].map(([k, v]) => {
      const s = summarize(v, metric);
      return {night: k, n: s.n, mean: s.mean, sd: s.sd, med: s.med,
        precision: mean(v.map(r => r.precision).filter(x => x != null)),
        recall: mean(v.map(r => r.recall).filter(x => x != null)),
        area: v.reduce((a, r) => a + (r.gt_area || 0), 0),
        splits: [...new Set(v.map(r => r.split))].join(', ')};
    }).sort((a, b) => a.mean - b.mean);
    new DataTable(mount.querySelector('#t-night'), {
      columns: [
        {key: 'night', label: 'Night', cls: '', fmt: (v, r) => esc(v) + flag(r.n)},
        {key: 'n', label: 'Scans'},
        {key: 'mean', label: `Mean ${label}`, fmt: v => fmtOr(v, metric)},
        {key: 'med', label: 'Median', fmt: v => fmtOr(v, metric)},
        {key: 'sd', label: 'Std dev', fmt: v => v == null ? '—' : v.toFixed(3)},
        {key: 'precision', label: 'Precision', fmt: v => fmtOr(v, 'precision')},
        {key: 'recall', label: 'Recall', fmt: v => fmtOr(v, 'recall')},
        {key: 'area', label: 'Truth px', fmt: v => int(v)},
      ],
      rows: nightRows, sort: 'mean', dir: 1, pageSize: 12,
      empty: 'No nights in this split.',
    });

    /* ---- difficulty tiers ---- */
    const vals = rows.map(r => r[metric]).filter(v => v != null).sort((a, b) => a - b);
    const t1 = quantile(vals, 1 / 3), t2 = quantile(vals, 2 / 3);
    const tiers = [
      ['Hard (bottom third)', rows.filter(r => r[metric] != null && r[metric] <= t1)],
      ['Moderate (middle)', rows.filter(r => r[metric] != null && r[metric] > t1 && r[metric] <= t2)],
      ['Easy (top third)', rows.filter(r => r[metric] != null && r[metric] > t2)],
    ];
    mount.querySelector('#t-tier').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Tier</th><th>Scenes</th><th>Mean ${esc(label)}</th><th>Median truth area</th>
        <th>Median truth regions</th><th>Median predicted regions</th><th>Mean precision</th><th>Mean recall</th></tr></thead>
        <tbody>${tiers.map(([k, v]) => {
          const areas = v.map(r => r.gt_area).filter(x => x != null);
          return `<tr><td>${esc(k)}</td><td class="n">${v.length}</td>
            <td class="n">${fmtOr(mean(v.map(r => r[metric])), metric)}</td>
            <td class="n">${areas.length ? int(quantile(areas, .5)) : '—'}</td>
            <td class="n">${int(quantile(v.map(r => r.n_gt_regions).filter(x => x != null), .5))}</td>
            <td class="n">${int(quantile(v.map(r => r.n_pred_regions).filter(x => x != null), .5))}</td>
            <td class="n">${fmtOr(mean(v.map(r => r.precision).filter(x => x != null)), 'precision')}</td>
            <td class="n">${fmtOr(mean(v.map(r => r.recall).filter(x => x != null)), 'recall')}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="small">Tier boundaries are the 33rd and 67th percentiles of ${esc(label)} on this split
      (${t1?.toFixed(3)} and ${t2?.toFixed(3)}). The clearest separator between tiers is target area.</p>`;
  }

  function groupTable(groups, metric) {
    const label = M[metric].label;
    return `<div class="tscroll"><table>
      <thead><tr><th>Group</th><th>Scenes</th><th>Mean ${esc(label)}</th><th>Median</th>
      <th>Std dev</th><th>95% CI of mean</th><th>Mean truth area</th></tr></thead><tbody>
      ${groups.map(g => {
        const v = g.rows.map(r => r[metric]).filter(x => x != null);
        if (!v.length) return `<tr><td>${esc(g.key)}</td><td class="n">0</td><td colspan="5" class="na">no scenes</td></tr>`;
        const ci = bootCI(v);
        return `<tr><td>${esc(g.key)}${flag(v.length)}</td><td class="n">${v.length}</td>
          <td class="n">${fmtOr(mean(v), metric)}</td><td class="n">${fmtOr(quantile(v, .5), metric)}</td>
          <td class="n">${v.length > 2 ? std(v).toFixed(3) : '—'}</td>
          <td class="n">${ci ? `${ci[0].toFixed(3)} – ${ci[1].toFixed(3)}` : '—'}</td>
          <td class="n">${int(mean(g.rows.map(r => r.gt_area).filter(x => x != null)))}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  mount.querySelector('#sp').addEventListener('change', e => { split = e.target.value; draw(); });
  mount.querySelector('#mx').addEventListener('change', e => { metric = e.target.value; draw(); });
  draw();
}
