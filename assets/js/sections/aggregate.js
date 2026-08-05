/* Aggregate evaluation of the selected model, with validation and test kept
   strictly apart (they are never pooled into one headline number). */

import { load } from '../lib/data.js';
import { fmtOr, tip, int, esc, mean, std, quantile, bootCI } from '../lib/metrics.js';
import { confusion, boxPlot, legend } from '../lib/charts.js';

export async function render(mount) {
  const [sm, ex] = await Promise.all([load('samples'), load('experiments')]);
  const sel = ex.experiments.find(r => r.selected);
  const S = sm.samples;
  const thr = sm.threshold;

  const pos = sp => S.filter(s => s.split === sp && s.label === 1);
  const neg = sp => S.filter(s => s.split === sp && s.label === 0);

  mount.innerHTML = `
  <h1>Aggregate evaluation</h1>
  <p class="lede">Full-scene performance of the selected model at its calibrated threshold of ${thr}.
  Validation and test are reported separately throughout; they are never averaged together.</p>

  <div class="note"><span class="tag">how to read this</span><div class="bd">
    <b>Macro</b> metrics average per-scene scores, so every scene counts equally and small plumes drag
    the number down. <b>Micro</b> metrics pool all pixels, so large plumes dominate. Both are legitimate
    and they answer different questions. Metrics over plume-bearing scenes exclude the
    ${int(neg('test').length + neg('val').length)} plume-free scenes, which are summarised separately
    as a false-alarm rate.
  </div></div>

  <div id="tables"></div>

  <h2>Confusion matrices</h2>
  <p class="small">Pixel counts pooled over all plume-bearing scenes in each split, at threshold ${thr}.
  Note the scale: background dominates, which is why accuracy is close to 1 for any model and is a poor
  guide here.</p>
  <div class="two" id="cms"></div>
  <div id="cmleg"></div>

  <h2>Per-scene variability</h2>
  <p>A single average hides how uneven performance is. These distributions come from
  ${int(pos('test').length)} test and ${int(pos('val').length)} validation scenes.</p>
  <figure><div class="viz" id="c-box"></div>
    <figcaption>Distribution of per-scene Dice, IoU, precision and recall. The box spans the
    interquartile range, the thick line is the median, the dot is the mean, and whiskers are the 5th and
    95th percentiles.</figcaption></figure>

  <h2>Uncertainty on the headline number</h2>
  <p class="small">Bootstrap percentile intervals over scenes (2000 resamples, fixed seed so the numbers
  reproduce). These capture scene-to-scene variability only: they do <b>not</b> capture the night-overlap
  bias described in <a href="#/data">data exploration</a>, which is a systematic effect that no
  resampling of these scenes can reveal.</p>
  <div id="ci"></div>

  <h2>Agreement with the training-time evaluation</h2>
  <div id="cross"></div>`;

  /* ---------------- metric tables ---------------- */
  const agg = rows => {
    if (!rows.length) return null;
    const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const TP = sum('tp'), FP = sum('fp'), FN = sum('fn'), TN = sum('tn');
    const m = k => mean(rows.map(r => r[k]).filter(v => v != null));
    const e = 1e-8;
    return {
      n: rows.length, TP, FP, FN, TN,
      dice: m('dice'), iou: m('iou'), precision: m('precision'), recall: m('recall'),
      accuracy: m('accuracy'), specificity: m('specificity'),
      boundary_iou: m('boundary_iou'), nsd: m('nsd'), hd95: m('hd95'), assd: m('assd'),
      balanced: (m('recall') != null && m('specificity') != null) ? (m('recall') + m('specificity')) / 2 : null,
      dice_micro: 2 * TP / (2 * TP + FP + FN + e),
      iou_micro: TP / (TP + FP + FN + e),
      prec_micro: TP / (TP + FP + e),
      rec_micro: TP / (TP + FN + e),
    };
  };
  const A = {val: agg(pos('val')), test: agg(pos('test'))};

  const rowsSpec = [
    ['Scenes with a plume', s => int(s.n), null],
    ['Dice (macro)', s => fmtOr(s.dice, 'dice'), 'dice'],
    ['Dice (micro)', s => fmtOr(s.dice_micro, 'dice_micro'), 'dice_micro'],
    ['IoU (macro)', s => fmtOr(s.iou, 'iou'), 'iou'],
    ['IoU (micro)', s => fmtOr(s.iou_micro, 'iou_micro'), 'iou_micro'],
    ['Precision (macro)', s => fmtOr(s.precision, 'precision'), 'precision'],
    ['Recall (macro)', s => fmtOr(s.recall, 'recall'), 'recall'],
    ['F1 (macro)', s => fmtOr(s.dice, 'f1'), 'f1'],
    ['Accuracy', s => fmtOr(s.accuracy, 'accuracy'), 'accuracy'],
    ['Specificity', s => fmtOr(s.specificity, 'specificity'), 'specificity'],
    ['Balanced accuracy', s => fmtOr(s.balanced, 'balanced_acc'), 'balanced_acc'],
    ['Boundary IoU', s => fmtOr(s.boundary_iou, 'boundary_iou'), 'boundary_iou'],
    ['NSD @2px', s => fmtOr(s.nsd, 'nsd'), 'nsd'],
    ['HD95 (px)', s => fmtOr(s.hd95, 'hd95'), 'hd95'],
    ['ASSD (px)', s => fmtOr(s.assd, 'assd'), 'assd'],
    ['True positives (px)', s => int(s.TP), 'tp'],
    ['False positives (px)', s => int(s.FP), 'fp'],
    ['False negatives (px)', s => int(s.FN), 'fn'],
    ['True negatives (px)', s => int(s.TN), 'tn'],
  ];
  const negRow = sp => {
    const n = neg(sp);
    return n.length
      ? `${fmtOr(mean(n.map(r => r.bg_fp_rate)), 'bg_fp_rate')} <span class="small">(${n.length} scenes)</span>`
      : '<span class="na">none in split</span>';
  };
  mount.querySelector('#tables').innerHTML = `
    <h2>Metrics by split</h2>
    <div class="tscroll"><table>
      <thead><tr><th>Metric</th><th>Validation</th><th>Test (held out)</th><th>Difference</th></tr></thead>
      <tbody>
      ${rowsSpec.map(([label, f, key]) => {
        const v = A.val ? f(A.val) : '—', t = A.test ? f(A.test) : '—';
        const nv = A.val && key ? A.val[keyOf(key)] : null, nt = A.test && key ? A.test[keyOf(key)] : null;
        const d = (typeof nv === 'number' && typeof nt === 'number')
          ? (nt - nv) : null;
        return `<tr><td>${key ? tip(key, label) : esc(label)}</td><td class="n">${v}</td><td class="n">${t}</td>
          <td class="n" style="color:${d == null ? 'var(--muted)' : (Math.abs(d) < 1e-9 ? 'var(--muted)' : 'inherit')}">${
            d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(Math.abs(d) < 1 ? 4 : 1)}</td></tr>`;
      }).join('')}
      <tr><td>${tip('bg_fp_rate', 'Background false-positive rate')}</td>
        <td class="n">${negRow('val')}</td><td class="n">${negRow('test')}</td><td class="n">—</td></tr>
      </tbody></table></div>
    <p class="small">Computed by <code>scripts/export_dashboard_data.py</code> from a forward pass of
    checkpoint <code>${esc(sm.selected)}</code> over every scene in each split, at threshold ${thr}.
    “Difference” is test minus validation: a large negative value would indicate the model was tuned to
    the validation set.</p>`;

  function keyOf(k) {
    return ({dice:'dice', dice_micro:'dice_micro', iou:'iou', iou_micro:'iou_micro',
             precision:'precision', recall:'recall', f1:'dice', accuracy:'accuracy',
             specificity:'specificity', balanced_acc:'balanced', boundary_iou:'boundary_iou',
             nsd:'nsd', hd95:'hd95', assd:'assd', tp:'TP', fp:'FP', fn:'FN', tn:'TN'})[k] || k;
  }

  /* ---------------- confusion matrices ---------------- */
  mount.querySelector('#cms').innerHTML = ['val', 'test'].map(sp => {
    const a = A[sp];
    if (!a) return `<div class="state"><div class="big">No ${sp} scenes</div></div>`;
    return `<figure><div class="viz">${confusion({tp: a.TP, fp: a.FP, fn: a.FN, tn: a.TN,
      title: `${sp} confusion matrix`})}</div>
      <figcaption><b>${sp === 'val' ? 'Validation' : 'Test'}</b> — ${int(a.n)} plume-bearing scenes,
      ${int(a.TP + a.FP + a.FN + a.TN)} pixels. Precision ${fmtOr(a.prec_micro, 'precision')},
      recall ${fmtOr(a.rec_micro, 'recall')} (pixel pooled).</figcaption></figure>`;
  }).join('');
  mount.querySelector('#cmleg').innerHTML = legend([
    {c: 'var(--tp)', label: 'TP — predicted plume, is plume'},
    {c: 'var(--fp)', label: 'FP — predicted plume, is background'},
    {c: 'var(--fn)', label: 'FN — missed plume'},
    {c: 'var(--tn)', label: 'TN — correctly ignored background'},
  ]);

  /* ---------------- per-scene distributions ---------------- */
  const mkBox = (label, key, sp, c) => {
    const v = pos(sp).map(r => r[key]).filter(x => x != null);
    return v.length ? {label: `${label}\n${sp}`, n: v.length, c,
      lo: quantile(v, .05), q1: quantile(v, .25), med: quantile(v, .5),
      q3: quantile(v, .75), hi: quantile(v, .95), mean: mean(v)}
      : {label, n: 0, q1: null, c};
  };
  mount.querySelector('#c-box').innerHTML = boxPlot({
    groups: [
      mkBox('Dice', 'dice', 'val', 'var(--accent2)'), mkBox('Dice', 'dice', 'test', 'var(--best)'),
      mkBox('IoU', 'iou', 'val', 'var(--accent2)'), mkBox('IoU', 'iou', 'test', 'var(--best)'),
      mkBox('Prec', 'precision', 'val', 'var(--accent2)'), mkBox('Prec', 'precision', 'test', 'var(--best)'),
      mkBox('Rec', 'recall', 'val', 'var(--accent2)'), mkBox('Rec', 'recall', 'test', 'var(--best)'),
    ],
    ylo: 0, yhi: 1, ylabel: 'per-scene value', W: 880, H: 350,
    aria: 'Per-scene metric distributions for validation and test',
  });

  /* ---------------- bootstrap CIs ---------------- */
  mount.querySelector('#ci').innerHTML = `
    <div class="tscroll"><table>
      <thead><tr><th>Split</th><th>Metric</th><th>n scenes</th><th>Mean</th><th>Median</th>
      <th>Std dev</th><th>95% CI of the mean</th></tr></thead><tbody>
      ${['test', 'val'].flatMap(sp => ['dice', 'iou', 'precision', 'recall'].map(k => {
        const v = pos(sp).map(r => r[k]).filter(x => x != null);
        const ci = bootCI(v);
        return `<tr><td>${sp}</td><td>${tip(k)}</td><td class="n">${v.length}</td>
          <td class="n">${fmtOr(mean(v), k)}</td><td class="n">${fmtOr(quantile(v, .5), k)}</td>
          <td class="n">${v.length > 2 ? std(v).toFixed(3) : '—'}</td>
          <td class="n">${ci ? `${ci[0].toFixed(3)} – ${ci[1].toFixed(3)}` : '—'}</td></tr>`;
      })).join('')}
    </tbody></table></div>`;

  /* ---------------- cross-check against training-time numbers ---------------- */
  const dTest = A.test ? A.test.dice : null;
  const diff = (dTest != null && sel.dice != null) ? dTest - sel.dice : null;
  mount.querySelector('#cross').innerHTML = `
    <div class="tscroll"><table>
      <thead><tr><th>Quantity</th><th>Training pipeline</th><th>This dashboard</th><th>Difference</th></tr></thead>
      <tbody>
      ${[['Test Dice (macro)', sel.dice, A.test?.dice, 'dice'],
         ['Test Dice (micro)', sel.dice_micro, A.test?.dice_micro, 'dice_micro'],
         ['Test IoU (macro)', sel.iou, A.test?.iou, 'iou'],
         ['Test precision', sel.precision, A.test?.precision, 'precision'],
         ['Test recall', sel.recall, A.test?.recall, 'recall'],
         ['Test boundary IoU', sel.boundary_iou, A.test?.boundary_iou, 'boundary_iou'],
        ].map(([l, a, b, k]) => {
          const d = (a != null && b != null) ? b - a : null;
          const ok = d != null && Math.abs(d) < 5e-3;
          return `<tr><td>${esc(l)}</td><td class="n">${fmtOr(a, k)}</td><td class="n">${fmtOr(b, k)}</td>
            <td class="n" style="color:${ok ? 'var(--ok)' : (d == null ? 'var(--muted)' : 'var(--warn)')}">${
              d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(4)}</td></tr>`;
        }).join('')}
    </tbody></table></div>
    <p class="small">The left column is what <code>outputs/experiments/${esc(sm.selected)}_result.json</code>
    recorded at the end of training. The right column is recomputed here from a fresh forward pass.
    ${diff != null && Math.abs(diff) < 5e-3
      ? 'They agree to within 0.005, which confirms the dashboard is reading the same model and the same split.'
      : 'A difference larger than 0.005 would indicate a mismatch in threshold, split or checkpoint and should be investigated.'}</p>`;
}
