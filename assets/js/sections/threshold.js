/* Threshold and calibration analysis.

   The project's operating threshold (0.15) is preserved throughout; this
   section tests it against the alternatives rather than assuming either 0.15
   or the conventional 0.5 is right. */

import { load } from '../lib/data.js';
import { fmtOr, tip, pct, mean, quantile } from '../lib/metrics.js';
import { lineChart, histogram, legend } from '../lib/charts.js';
import { card } from '../lib/ui.js';

export async function render(mount) {
  const [th, sm] = await Promise.all([load('threshold'), load('samples')]);
  let split = 'test';
  const T = th.selected_threshold;

  mount.innerHTML = `
  <h1>Threshold and calibration</h1>
  <p class="lede">The network outputs a probability per pixel. A threshold turns it into a mask.
  This section shows what that choice costs and buys, measured at full resolution over every scene
  in the split.</p>

  <div class="ctrls">
    <div class="f"><label for="sp">Split</label><select id="sp">
      <option value="test">Test (held out)</option><option value="val">Validation</option></select></div>
  </div>

  <div class="note sel"><span class="tag">operating point</span><div class="bd">
    The project calibrated the threshold to <b>${T}</b> on validation scenes, not to the conventional 0.5.
    That is deliberate: the target covers well under 1% of pixels, so a 0.5 cut-off suppresses most of
    the plume. The comparison below quantifies it.
  </div></div>

  <div id="cards"></div>

  <h2>Metrics across thresholds</h2>
  <p class="small">The threshold barely moves any metric here. That is the result, not a missing signal:
  raising it trades a little recall for a little precision and leaves Dice almost unchanged. The reason is
  the saturated probability distribution shown in the next chart. The vertical axis is zoomed to the data
  range so the small trends are visible.</p>
  <figure><div class="viz" id="c-sweep"></div>
    <figcaption id="cap-sweep"></figcaption></figure>
  <div id="l-sweep"></div>
  <div id="t-sweep"></div>

  <h2>Where the probabilities sit</h2>
  <p class="small">Distribution of predicted probability over pixels that are truly plume and pixels that
  are truly background, pooled over all plume-bearing scenes in the split. Note the log count axis:
  background pixels outnumber plume pixels by more than a hundred to one.</p>
  <figure><div class="viz" id="c-hist"></div>
    <figcaption id="cap-hist"></figcaption></figure>
  <div id="l-hist"></div>

  <h2>Calibration</h2>
  <p class="small">If the model were perfectly calibrated, pixels assigned probability p would be plume
  about p of the time, tracing the diagonal. Deviation above the line means under-confidence, below means
  over-confidence.</p>
  <figure><div class="viz" id="c-cal"></div>
    <figcaption id="cap-cal"></figcaption></figure>
  <div id="l-cal"></div>

  <h2>Per-scene optimal thresholds</h2>
  <p class="small">One global threshold is a compromise. This shows how much each scene would gain from
  its own ideal threshold, which is an upper bound that no deployable single-threshold model can reach.</p>
  <div id="oracle"></div>

  <h2>Why not an ROC curve</h2>
  <div class="note"><span class="tag">deliberately omitted</span><div class="bd">
    An ROC curve plots recall against the false-positive rate. Here the negative class is roughly
    99.5% of all pixels, so even a very poor mask has a false-positive rate near zero and the curve is
    pinned to the top-left corner regardless of quality. It would look excellent and mean nothing.
    The precision and recall lines in the sweep above are the informative equivalent for this imbalance,
    which is why they are shown instead.
  </div></div>`;

  function draw() {
    const curve = th.curves[split] || [];
    const dist = th.distributions[split];
    const at = t => curve.find(c => Math.abs(c.t - t) < 1e-9);
    const selP = at(T), halfP = at(0.5);
    const bestDice = curve.length ? curve.reduce((a, b) => b.dice_macro > a.dice_macro ? b : a) : null;

    mount.querySelector('#cards').innerHTML = `<div class="cards">
      ${card('Selected threshold', T, 'calibrated on validation')}
      ${card('Dice at ' + T, fmtOr(selP?.dice_macro, 'dice'), 'macro, this split', 'dice')}
      ${card('Best swept threshold', bestDice ? bestDice.t : '—',
             bestDice ? `Dice ${fmtOr(bestDice.dice_macro, 'dice')}` : '')}
      ${card('Dice at 0.5', fmtOr(halfP?.dice_macro, 'dice'),
             (selP && halfP) ? `${(halfP.dice_macro - selP.dice_macro >= 0 ? '+' : '')}${(halfP.dice_macro - selP.dice_macro).toFixed(3)} vs selected` : '', 'dice')}
      ${card('Recall (micro) at 0.5', halfP ? fmtOr(halfP.recall, 'recall') : '—',
             selP ? `vs ${fmtOr(selP.recall, 'recall')} at ${T}` : '', 'recall')}
    </div>
    ${(selP && halfP) ? `<p class="small">Moving from the selected ${T} to the conventional 0.5 changes macro Dice by
      <b>${(halfP.dice_macro - selP.dice_macro).toFixed(4)}</b>: pixel-pooled recall falls from
      ${fmtOr(selP.recall, 'recall')} to ${fmtOr(halfP.recall, 'recall')} while pixel-pooled precision rises from
      ${fmtOr(selP.precision, 'precision')} to ${fmtOr(halfP.precision, 'precision')}.
      ${halfP.dice_macro > selP.dice_macro
        ? `<b>On this split 0.5 scores marginally higher on Dice than the calibrated ${T}</b> (by
           ${(halfP.dice_macro - selP.dice_macro).toFixed(4)}, far below the scene-to-scene spread).
           This is a real result and is reported rather than smoothed over: the calibration optimised
           validation Dice, and its choice does not transfer to the test split as an improvement.
           The practical reading is that <b>Dice is nearly flat between about 0.15 and 0.6</b>, so the
           operating point should be chosen from the precision/recall balance the application needs,
           not from Dice.`
        : 'The calibrated threshold holds up: 0.5 does not beat it on Dice.'}</p>` : ''}`;

    const S = ['dice_macro', 'dice_micro', 'precision', 'recall', 'iou_micro'];
    const C = {dice_macro: 'var(--accent2)', dice_micro: 'var(--tp)', precision: 'var(--fp)',
               recall: 'var(--fn)', iou_micro: 'var(--ok)'};
    // precision/recall in the sweep are pixel pooled (micro), like dice_micro
    const LBL = {dice_macro: 'Dice (macro)', dice_micro: 'Dice (micro)', precision: 'Precision (micro)',
                 recall: 'Recall (micro)', iou_micro: 'IoU (micro)'};
    const vals = curve.flatMap(c => S.map(k => c[k])).filter(v => v != null);
    const ylo = vals.length ? Math.max(0, Math.min(...vals) - 0.04) : 0;
    const yhi = vals.length ? Math.min(1, Math.max(...vals) + 0.04) : 1;
    mount.querySelector('#c-sweep').innerHTML = lineChart({
      series: S.map(k => ({label: LBL[k], c: C[k], points: curve.map(c => [c.t, c[k]]), dots: false})),
      xlo: Math.min(...th.swept), xhi: Math.max(...th.swept), ylo, yhi,
      xlabel: 'probability threshold', ylabel: 'metric value (axis zoomed to data)', W: 880, H: 360,
      marks: [{x: T, label: `selected ${T}`}, {x: 0.5, label: 'conventional 0.5', c: 'var(--muted)'}],
      aria: 'Metrics across probability thresholds',
    });
    mount.querySelector('#l-sweep').innerHTML = legend(S.map(k => ({c: C[k], label: LBL[k]})));
    const c0 = curve[0], cN = curve[curve.length - 1];
    const dRange = curve.length ? Math.max(...curve.map(c => c.dice_macro)) - Math.min(...curve.map(c => c.dice_macro)) : 0;
    mount.querySelector('#cap-sweep').innerHTML = (c0 && cN)
      ? `Every metric recomputed at ${th.swept.length} thresholds over all ${selP?.n ?? '—'} plume-bearing
         ${split} scenes at full 960×960 resolution. Across the whole range macro Dice varies by only
         <b>${dRange.toFixed(3)}</b>. Raising the threshold from ${c0.t} to ${cN.t} moves pixel-pooled recall
         from ${fmtOr(c0.recall, 'recall')} to ${fmtOr(cN.recall, 'recall')} and precision from
         ${fmtOr(c0.precision, 'precision')} to ${fmtOr(cN.precision, 'precision')}: a small trade, not an
         optimum to tune. The axis is zoomed to the data; on a full 0–1 axis every line would look flat.`
      : `Every metric recomputed at ${th.swept.length} thresholds over the ${split} scenes.`;

    mount.querySelector('#t-sweep').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Threshold</th><th>${tip('dice', 'Dice (macro)')}</th><th>${tip('dice_micro', 'Dice (micro)')}</th>
        <th>${tip('iou_micro', 'IoU (micro)')}</th><th>${tip('precision', 'Precision')}</th><th>${tip('recall', 'Recall')}</th></tr></thead>
        <tbody>${curve.map(c => `<tr class="${Math.abs(c.t - T) < 1e-9 ? 'best' : ''}">
          <td>${c.t}${Math.abs(c.t - T) < 1e-9 ? ' <span class="pill" style="color:var(--best);border-color:var(--best)">selected</span>' : ''}${c.t === 0.5 ? ' <span class="pill">conventional</span>' : ''}</td>
          <td class="n">${fmtOr(c.dice_macro, 'dice')}</td><td class="n">${fmtOr(c.dice_micro, 'dice_micro')}</td>
          <td class="n">${fmtOr(c.iou_micro, 'iou')}</td><td class="n">${fmtOr(c.precision, 'precision')}</td>
          <td class="n">${fmtOr(c.recall, 'recall')}</td></tr>`).join('')}</tbody></table></div>`;

    /* probability distributions */
    mount.querySelector('#c-hist').innerHTML = histogram({
      bins: dist.centers,
      series: [{c: 'var(--fn)', counts: dist.pos}, {c: 'var(--tn)', counts: dist.neg}],
      counts: dist.pos, logy: true, xlabel: 'predicted probability', ylabel: 'pixels',
      W: 880, H: 300, aria: 'Probability distribution for plume and background pixels',
    });
    mount.querySelector('#l-hist').innerHTML = legend([
      {c: 'var(--fn)', label: 'pixels that are truly plume'},
      {c: 'var(--tn)', label: 'pixels that are truly background'},
    ]);
    const totPos = dist.pos.reduce((a, b) => a + b, 0), totNeg = dist.neg.reduce((a, b) => a + b, 0);
    const idxT = dist.centers.findIndex(c => c >= T);
    const posBelow = dist.pos.slice(0, idxT).reduce((a, b) => a + b, 0);
    const negAbove = dist.neg.slice(idxT).reduce((a, b) => a + b, 0);
    mount.querySelector('#cap-hist').innerHTML =
      `At threshold ${T}: <b>${pct(posBelow / totPos, 1)}</b> of true plume pixels fall below it and are missed,
       while <b>${pct(negAbove / totNeg, 2)}</b> of background pixels sit above it and become false positives.
       Because background pixels outnumber plume pixels ${(totNeg / totPos).toFixed(0)} to 1, that small
       background percentage still produces a large absolute count of false positives — this is the core
       difficulty of the task.`;

    /* calibration */
    const rel = dist.reliability.filter(r => r.n > 500);
    mount.querySelector('#c-cal').innerHTML = lineChart({
      series: [
        {label: 'perfect calibration', c: 'var(--muted)', points: [[0, 0], [1, 1]], dots: false, dash: '5 4'},
        {label: 'observed', c: 'var(--accent2)', points: rel.map(r => [r.p, r.y]), dots: true},
      ], xlo: 0, xhi: 1, ylo: 0, yhi: 1,
      xlabel: 'mean predicted probability in bin', ylabel: 'observed fraction that is plume',
      W: 560, H: 340, marks: [{x: T, label: `threshold ${T}`}], aria: 'Reliability diagram',
    });
    mount.querySelector('#l-cal').innerHTML = legend([
      {c: 'var(--muted)', label: 'Perfect calibration (diagonal)'},
      {c: 'var(--accent2)', label: 'Observed frequency'},
    ]);
    const below = rel.filter(r => r.y < r.p).length;
    mount.querySelector('#cap-cal').innerHTML =
      `${rel.length} probability bins with more than 500 pixels each. ${below} of them fall below the
       diagonal, meaning the model is <b>over-confident</b> there: pixels it scores at p are plume less
       often than p. This is expected for a model trained with Focal Tversky loss, which deliberately
       distorts probabilities to chase recall, and it is the reason the calibrated threshold is far
       below 0.5. Probability values should therefore be treated as a ranking, not as a true likelihood.`;

    /* per-scene oracle threshold gap */
    const rows = sm.samples.filter(s => s.split === split && s.label === 1);
    const dice = rows.map(r => r.dice).filter(v => v != null);
    mount.querySelector('#oracle').innerHTML = `
      <div class="note warn"><span class="tag">not available</span><div class="bd">
        A <b>per-scene</b> optimal threshold is not exported: the pipeline stores one probability sweep
        pooled over scenes, not a full sweep per scene. What is available is the global sweep above, and
        the spread of per-scene Dice at the fixed threshold
        (median ${fmtOr(quantile(dice, .5), 'dice')}, interquartile range
        ${fmtOr(quantile(dice, .25), 'dice')} – ${fmtOr(quantile(dice, .75), 'dice')}, n=${dice.length}).
        <br><b>To support it:</b> extend <code>stage_predict</code> in
        <code>scripts/export_dashboard_data.py</code> to record the best threshold per scene, which costs
        one extra sweep pass and about 200 KB.
      </div></div>`;
  }

  mount.querySelector('#sp').addEventListener('change', e => { split = e.target.value; draw(); });
  draw();
}

