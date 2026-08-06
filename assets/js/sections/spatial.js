/* Segmentation and spatial analysis: region structure and where in the scan
   the errors concentrate. */

import { load } from '../lib/data.js';
import { fmtOr, int, pct, esc, mean, quantile, SEG } from '../lib/metrics.js';
import { barChart, scatter, histogram, legend, lineChart } from '../lib/charts.js';
import { card, sceneFilters } from '../lib/ui.js';

export async function render(mount) {
  const [sm, th] = await Promise.all([load('samples'), load('threshold')]);

  mount.innerHTML = `
  <h1>Spatial analysis</h1>
  <p class="lede">How predicted shapes compare with labelled shapes, and whether errors cluster at
  particular ranges from the radar. The filters narrow the scene-level charts; the radial profile is a
  precomputed per-split aggregate, so it follows the split only.</p>

  <div id="filters"></div>

  <h2>Region structure</h2>
  <p class="small">A connected region is a blob of at least 10 touching pixels. Comparing the number of
  regions in the prediction with the number in the label shows whether the model fragments one plume
  into many pieces, or merges several into one.</p>
  <div id="regcards"></div>
  <div class="two">
    <figure><div class="viz" id="c-reg"></div>
      <figcaption>Predicted regions against labelled regions, one point per scene. Points on the dashed
      line have matching structure; points far above it are fragmented predictions.
      <span style="color:var(--fp)">Red</span> marks failing scenes (Dice &lt; 0.3),
      <span style="color:var(--accent2)">blue</span> the rest.</figcaption></figure>
    <figure><div class="viz" id="c-regdist"></div>
      <figcaption>Distribution of the fragmentation ratio (predicted regions ÷ labelled regions).
      A ratio of 1 means the prediction has the same number of pieces as the label.</figcaption></figure>
  </div>
  <div id="regtable"></div>

  <h2>Predicted area against labelled area</h2>
  <figure><div class="viz" id="c-area"></div>
    <figcaption id="cap-area"></figcaption></figure>

  <h2>Errors by distance from the radar</h2>
  <p class="small">The radar sits at the centre of the grid. The beam climbs with range, so a plume
  160 km away is sampled far higher in the atmosphere than one at 30 km. These profiles pool every
  pixel of every plume-bearing scene in the split.</p>
  <figure><div class="viz" id="c-radial"></div><figcaption id="cap-radial"></figcaption></figure>
  <div id="l-radial"></div>
  <figure><div class="viz" id="c-radrate"></div>
    <figcaption>Recall and precision computed inside each range ring. Rings holding very little
    labelled signal are noisy and are marked in the table below.</figcaption></figure>
  <div id="radtable"></div>

  <h2>Shape failure categories</h2>
  <p class="small">Every scene is assigned to one category using its region counts and area ratio.
  Categories are defined by rule, so they are reproducible; the thresholds are stated in each row.</p>
  <div id="cats"></div>`;

  function draw() {
    const S = sm.samples.filter(s => s.label === 1 && filt.predicate(s));
    const split = filt.state.split;
    const R = th.radial[split];   // radial profile is precomputed per split only

    /* ---- region structure ---- */
    const withReg = S.filter(s => s.n_gt_regions != null && s.n_pred_regions != null);
    const ratios = withReg.filter(s => s.n_gt_regions > 0).map(s => s.n_pred_regions / s.n_gt_regions);
    mount.querySelector('#regcards').innerHTML = `<div class="cards">
      ${card('Median labelled regions', int(quantile(withReg.map(s => s.n_gt_regions), .5)), 'per scene', 'n_gt_regions')}
      ${card('Median predicted regions', int(quantile(withReg.map(s => s.n_pred_regions), .5)), 'per scene', 'n_pred_regions')}
      ${card('Median ratio', ratios.length ? quantile(ratios, .5).toFixed(2) : '—', 'predicted ÷ labelled')}
      ${card('Fragmented scenes', withReg.filter(s => s.n_pred_regions > 3 * s.n_gt_regions).length,
             'more than 3× the labelled regions')}
      ${card('Merged / sparse', withReg.filter(s => s.n_pred_regions < s.n_gt_regions).length,
             'fewer regions than labelled')}
    </div>`;

    const maxR = Math.max(10, ...withReg.map(s => Math.max(s.n_gt_regions, s.n_pred_regions)));
    mount.querySelector('#c-reg').innerHTML = scatter({
      points: withReg.map(s => ({
        x: s.n_gt_regions, y: s.n_pred_regions,
        c: s.dice < 0.3 ? 'var(--fp)' : 'var(--accent2)', r: 3.4, o: .6,
        t: `${s.ts} — ${s.n_gt_regions} labelled, ${s.n_pred_regions} predicted, Dice ${s.dice}`})),
      xlo: 0, xhi: maxR, ylo: 0, yhi: maxR,
      xlabel: 'labelled regions', ylabel: 'predicted regions', W: 520, H: 330,
      trend: {x0: 0, y0: 0, x1: maxR, y1: maxR},
      aria: 'Predicted against labelled region counts',
    });

    const lr = ratios.map(r => Math.log2(Math.max(r, 0.05)));
    const lo = -3, hi = 5, nb = 24, w = (hi - lo) / nb;
    const counts = new Array(nb).fill(0);
    lr.forEach(v => { const i = Math.floor((v - lo) / w); if (i >= 0 && i < nb) counts[i]++; });
    mount.querySelector('#c-regdist').innerHTML = histogram({
      bins: Array.from({length: nb}, (_, i) => Math.pow(2, lo + i * w)),
      counts, xlabel: 'predicted ÷ labelled regions', ylabel: 'scenes', W: 520, H: 330,
      aria: 'Distribution of fragmentation ratio',
    });

    /* ---- area agreement ---- */
    const areas = S.filter(s => s.gt_area > 0 && s.pred_area > 0);
    const over = areas.filter(s => s.pred_area > s.gt_area).length;
    mount.querySelector('#c-area').innerHTML = scatter({
      points: areas.map(s => ({
        x: s.gt_area, y: s.pred_area,
        c: s.pred_area > s.gt_area ? 'var(--fp)' : 'var(--fn)', r: 3.4, o: .62,
        t: `${s.ts} — labelled ${int(s.gt_area)} px, predicted ${int(s.pred_area)} px, Dice ${s.dice}`})),
      xlo: 100, xhi: 1e6, ylo: 100, yhi: 1e6, logx: true,
      xlabel: 'labelled area (pixels, log)', ylabel: 'predicted area (pixels)', W: 880, H: 360,
      aria: 'Predicted area against labelled area',
    });
    mount.querySelector('#cap-area').innerHTML =
      `${over} of ${areas.length} scenes (${pct(over / areas.length, 0)}) have a predicted area larger than the
       labelled area, shown in <span style="color:var(--fp)">red</span>; the rest under-predict, in
       <span style="color:var(--fn)">blue</span>. Systematic over-prediction is consistent with precision
       (${fmtOr(mean(S.map(s => s.precision).filter(Boolean)), 'precision')}) being lower than recall
       (${fmtOr(mean(S.map(s => s.recall).filter(Boolean)), 'recall')}).`;

    /* ---- radial ---- */
    const edges = R.edges_km, n = R.tp.length;
    const cats = Array.from({length: n}, (_, i) => `${Math.round(edges[i])}–${Math.round(edges[i + 1])}`);
    mount.querySelector('#c-radial').innerHTML = barChart({
      cats,
      series: [
        {label: 'TP', c: SEG.tp.c, values: R.tp},
        {label: 'FN', c: SEG.fn.c, values: R.fn},
        {label: 'FP', c: SEG.fp.c, values: R.fp},
      ], stacked: true, ylabel: 'pixels', xlabel: 'distance from the radar (km)',
      W: 880, H: 320, aria: 'Pixel outcomes by distance ring', inlineLegend: true,
    });
    mount.querySelector('#l-radial').innerHTML = legend([
      {c: SEG.tp.c, label: SEG.tp.label}, {c: SEG.fn.c, label: SEG.fn.label}, {c: SEG.fp.c, label: SEG.fp.label},
    ]);
    const totGt = R.gt.reduce((a, b) => a + b, 0);
    const peak = R.gt.indexOf(Math.max(...R.gt));
    mount.querySelector('#cap-radial').innerHTML =
      `Pixel outcomes pooled over every plume-bearing ${split} scene, by distance ring from the radar.
       Most labelled signal sits in the ${cats[peak]} km ring
       (${pct(R.gt[peak] / totGt, 0)} of all labelled pixels).`;

    const rec = R.tp.map((tp, i) => (tp + R.fn[i]) ? tp / (tp + R.fn[i]) : null);
    const pre = R.tp.map((tp, i) => (tp + R.fp[i]) ? tp / (tp + R.fp[i]) : null);
    const mid = cats.map((_, i) => (edges[i] + edges[i + 1]) / 2);
    mount.querySelector('#c-radrate').innerHTML = lineChart({
      series: [
        {label: 'recall', c: SEG.fn.c, points: mid.map((x, i) => [x, rec[i]])},
        {label: 'precision', c: SEG.fp.c, points: mid.map((x, i) => [x, pre[i]])},
      ], xlo: 0, xhi: edges.at(-1), ylo: 0, yhi: 1,
      xlabel: 'distance from radar (km)', ylabel: 'rate within ring', W: 880, H: 300,
      aria: 'Recall and precision by distance ring',
    });
    mount.querySelector('#radtable').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Ring (km)</th><th>Labelled px</th><th>Share of signal</th><th>Recall</th>
        <th>Precision</th><th>FP px</th><th>Reliability</th></tr></thead><tbody>
        ${cats.map((c, i) => {
          const share = R.gt[i] / totGt;
          const thin = share < 0.01;
          return `<tr><td>${c}</td><td class="n">${int(R.gt[i])}</td><td class="n">${pct(share, 1)}</td>
            <td class="n">${rec[i] == null ? '—' : rec[i].toFixed(3)}</td>
            <td class="n">${pre[i] == null ? '—' : pre[i].toFixed(3)}</td>
            <td class="n">${int(R.fp[i])}</td>
            <td class="n">${thin ? '<span class="pill" style="color:var(--warn);border-color:var(--warn)">sparse</span>' : 'ok'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="small">Rings holding under 1% of the labelled signal are marked sparse: their rates come
      from very few pixels and should not be read as a range-dependent trend.</p>`;

    /* ---- categories ---- */
    const cat = s => {
      if (s.dice === 0) return 'Zero overlap';
      if (s.n_gt_regions > 0 && s.n_pred_regions > 3 * s.n_gt_regions) return 'Fragmented';
      if (s.pred_area > 2 * s.gt_area) return 'Over-extended';
      if (s.pred_area < 0.5 * s.gt_area) return 'Under-covered';
      if (s.n_pred_regions < s.n_gt_regions) return 'Merged';
      return 'Structurally similar';
    };
    const groups = {};
    S.forEach(s => { (groups[cat(s)] ||= []).push(s); });
    const RULES = {
      'Zero overlap': 'Dice exactly 0',
      'Fragmented': 'predicted regions > 3 × labelled regions',
      'Over-extended': 'predicted area > 2 × labelled area',
      'Under-covered': 'predicted area < 0.5 × labelled area',
      'Merged': 'fewer predicted regions than labelled',
      'Structurally similar': 'none of the above',
    };
    mount.querySelector('#cats').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Category</th><th>Rule</th><th>Scenes</th><th>Share</th><th>Mean Dice</th>
        <th>Median labelled area</th><th>Example</th></tr></thead><tbody>
        ${Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => {
          const ex = [...v].sort((a, b) => a.dice - b.dice)[0];
          return `<tr><td>${esc(k)}</td><td style="text-align:left" class="small">${esc(RULES[k])}</td>
            <td class="n">${v.length}</td><td class="n">${pct(v.length / S.length, 0)}</td>
            <td class="n">${fmtOr(mean(v.map(x => x.dice)), 'dice')}</td>
            <td class="n">${int(quantile(v.map(x => x.gt_area), .5))}</td>
            <td class="n"><a href="#/samples?ts=${ex.ts}"><code>${ex.ts}</code></a></td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="small">Categories are mutually exclusive and evaluated in the order listed. Click an
      example to open it in the sample explorer.</p>`;
  }

  const filt = sceneFilters(mount.querySelector('#filters'), {samples: sm.samples, onChange: draw});
  draw();
}

