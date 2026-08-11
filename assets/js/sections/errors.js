/* Error and failure analysis.

   Observations (measured) are kept visually and textually separate from
   hypotheses (explanations that the data is consistent with but does not
   prove). */

import { load } from '../lib/data.js';
import { fmtOr, int, pct, esc, mean, quantile, spearman, tsLabel } from '../lib/metrics.js';
import { scatter } from '../lib/charts.js';
import { card, sceneFilters } from '../lib/ui.js';
import { DataTable } from '../lib/table.js';

export async function render(mount) {
  const sm = await load('samples');

  mount.innerHTML = `
  <h1>Error and failure analysis</h1>
  <p class="lede">What the model gets wrong, how often, and what those cases have in common.</p>

  <div id="filters"></div>

  <div id="cards"></div>

  <h2>Failure taxonomy</h2>
  <p class="small">Each swarm-bearing scene is placed in exactly one bucket by rule. A scene can be poor
  for more than one reason; the first matching rule wins, in the order shown.</p>
  <div id="tax"></div>

  <h2>The dominant driver: target size</h2>
  <figure><div class="viz" id="c-area"></div><figcaption id="cap-area"></figcaption></figure>
  <div id="areastats"></div>

  <h2>Which failures are recoverable?</h2>
  <p class="small">A scene where the model produced no confident pixels anywhere is different from one
  where it produced confident pixels in the wrong place. The maximum probability reached in the scene
  separates the two.</p>
  <figure><div class="viz" id="c-conf"></div><figcaption id="cap-conf"></figcaption></figure>

  <h2>False alarms on swarm-free scenes</h2>
  <div id="fa"></div>

  <h2>Do the two models fail on the same scenes?</h2>
  <div id="cmptable"></div>

  <h2>Do failures cluster in time?</h2>
  <div id="clusters"></div>

  <h2>Worst scenes</h2>
  <p class="small">Sorted by Dice, worst first. Click any row to open it in the sample explorer.</p>
  <div id="worst"></div>`;

  function draw() {
    const S = sm.samples.filter(s => s.label === 1 && filt.predicate(s));
    const NEG = sm.samples.filter(s => s.label === 0 && filt.predicate(s));
    const split = filt.state.split;
    const zero = S.filter(s => s.dice === 0);
    const bad = S.filter(s => s.dice < 0.3);
    const lowRec = S.filter(s => s.recall < 0.4);
    const lowPrec = S.filter(s => s.precision < 0.4);

    mount.querySelector('#cards').innerHTML = `<div class="cards">
      ${card('Scenes evaluated', S.length, `${split} split, with a swarm`)}
      ${card('Zero overlap', `${zero.length}`, `${pct(zero.length / S.length, 1)} of scenes`)}
      ${card('Dice below 0.3', `${bad.length}`, `${pct(bad.length / S.length, 1)} of scenes`)}
      ${card('Recall below 0.4', `${lowRec.length}`, 'missed most of the swarm')}
      ${card('Precision below 0.4', `${lowPrec.length}`, 'mostly false alarm')}
      ${card('Worst Dice', fmtOr(Math.min(...S.map(s => s.dice)), 'dice'), 'single scene')}
    </div>`;

    /* ---- taxonomy ---- */
    const RULES = [
      ['Complete miss', s => s.dice === 0 && s.pred_area < 0.05 * s.gt_area,
       'Dice 0 and predicted area under 5% of the label', 'The model produced essentially nothing.'],
      ['Confident but misplaced', s => s.dice === 0,
       'Dice 0 but a substantial predicted area', 'It fired, but nowhere near the label.'],
      ['Mostly missed', s => s.recall < 0.4,
       'recall below 0.4', 'Found under 40% of the labelled pixels.'],
      ['Mostly false alarm', s => s.precision < 0.4,
       'precision below 0.4', 'Over 60% of what it marked is not labelled.'],
      ['Weak overlap', s => s.dice < 0.5,
       'Dice below 0.5', 'Right area, poor agreement.'],
      ['Acceptable', () => true, 'Dice at or above 0.5', 'Usable segmentation.'],
    ];
    const bucket = s => RULES.find(([, f]) => f(s))[0];
    const groups = {};
    S.forEach(s => { (groups[bucket(s)] ||= []).push(s); });
    mount.querySelector('#tax').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Failure mode</th><th>Rule</th><th>Scenes</th><th>Share</th><th>Median labelled area</th>
        <th>Median regions</th><th>Mean max probability</th><th>Example</th></tr></thead><tbody>
        ${RULES.map(([k, , rule]) => {
          const v = groups[k] || [];
          if (!v.length) return `<tr><td>${esc(k)}</td><td class="small" style="text-align:left">${esc(rule)}</td>
            <td class="n">0</td><td class="n">—</td><td colspan="4" class="na">none in this split</td></tr>`;
          const ex = [...v].sort((a, b) => a.dice - b.dice)[0];
          return `<tr><td><b>${esc(k)}</b></td><td class="small" style="text-align:left">${esc(rule)}</td>
            <td class="n">${v.length}</td><td class="n">${pct(v.length / S.length, 1)}</td>
            <td class="n">${int(quantile(v.map(x => x.gt_area), .5))}</td>
            <td class="n">${int(quantile(v.map(x => x.n_gt_regions ?? 0), .5))}</td>
            <td class="n">${fmtOr(mean(v.map(x => x.prob_max)), 'dice')}</td>
            <td class="n"><a href="#/samples?ts=${ex.ts}"><code>${ex.ts}</code></a></td></tr>`;
        }).join('')}</tbody></table></div>`;

    /* ---- area relationship ---- */
    const A = S.filter(s => s.gt_area > 0);
    const rho = spearman(A.map(s => Math.log10(s.gt_area)), A.map(s => s.dice));
    mount.querySelector('#c-area').innerHTML = scatter({
      points: A.map(s => ({
        x: s.gt_area, y: s.dice,
        c: s.dice < 0.3 ? 'var(--fp)' : (s.dice < 0.6 ? 'var(--warn)' : 'var(--ok)'),
        r: 3.6, o: .68,
        t: `${tsLabel(s.ts)} — ${int(s.gt_area)} labelled px, Dice ${s.dice}`})),
      xlo: 100, xhi: 1e6, ylo: 0, yhi: 1, logx: true,
      xlabel: 'labelled swarm area (pixels, log scale)', ylabel: 'per-scene Dice',
      W: 880, H: 380, aria: 'Dice against labelled swarm area',
      legend: [
        {c: 'var(--ok)', label: 'good scene (Dice ≥ 0.6)'},
        {c: 'var(--warn)', label: 'weak (0.3 ≤ Dice < 0.6)'},
        {c: 'var(--fp)', label: 'failure (Dice < 0.3)'},
      ],
    });
    const bands = [['< 1k', 0, 1000], ['1k–5k', 1000, 5000], ['5k–20k', 5000, 20000],
                   ['20k–100k', 20000, 100000], ['> 100k', 100000, Infinity]];
    mount.querySelector('#cap-area').innerHTML =
      `Spearman rank correlation between labelled area and Dice is <b>${rho == null ? '—' : rho.toFixed(3)}</b>
       over ${A.length} scenes.`;
    mount.querySelector('#areastats').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Labelled area</th><th>Scenes</th><th>Mean Dice</th><th>Mean recall</th>
        <th>Mean precision</th><th>Zero-overlap scenes</th></tr></thead><tbody>
        ${bands.map(([k, lo, hi]) => {
          const v = A.filter(s => s.gt_area >= lo && s.gt_area < hi);
          if (!v.length) return `<tr><td>${k}</td><td class="n">0</td><td colspan="4" class="na">none</td></tr>`;
          return `<tr><td>${k} px</td><td class="n">${v.length}</td>
            <td class="n">${fmtOr(mean(v.map(s => s.dice)), 'dice')}</td>
            <td class="n">${fmtOr(mean(v.map(s => s.recall)), 'recall')}</td>
            <td class="n">${fmtOr(mean(v.map(s => s.precision)), 'precision')}</td>
            <td class="n">${v.filter(s => s.dice === 0).length}</td></tr>`;
        }).join('')}</tbody></table></div>`;

    /* ---- confidence of failures ---- */
    mount.querySelector('#c-conf').innerHTML = scatter({
      points: S.map(s => ({
        x: s.prob_max, y: s.dice,
        c: s.dice === 0 ? 'var(--fp)' : 'var(--accent2)', r: 3.5, o: .65,
        t: `${tsLabel(s.ts)} — max prob ${s.prob_max}, Dice ${s.dice}`})),
      xlo: 0, xhi: 1, ylo: 0, yhi: 1,
      xlabel: 'maximum probability anywhere in the scene', ylabel: 'per-scene Dice',
      W: 880, H: 340, aria: 'Dice against maximum predicted probability',
      legend: [
        {c: 'var(--fp)', label: 'zero-overlap scene (Dice = 0)'},
        {c: 'var(--accent2)', label: 'some overlap (Dice > 0)'},
      ],
    });
    const confidentFail = bad.filter(s => s.prob_max > 0.8).length;
    mount.querySelector('#cap-conf').innerHTML =
      `${confidentFail} of the ${bad.length} scenes scoring below 0.3 still reach a probability above 0.8
       somewhere in the scene — <b>confident mistakes</b> rather than abstentions.`;

    /* ---- false alarms ---- */
    if (NEG.length) {
      const rates = NEG.map(s => s.bg_fp_rate).filter(v => v != null);
      const worst = [...NEG].sort((a, b) => b.bg_fp_rate - a.bg_fp_rate).slice(0, 8);
      mount.querySelector('#fa').innerHTML = `
        <div class="cards">
          ${card('Swarm-free scenes', NEG.length, `${split} split`)}
          ${card('Mean FP rate', fmtOr(mean(rates), 'bg_fp_rate'), 'of all pixels', 'bg_fp_rate')}
          ${card('Median FP rate', fmtOr(quantile(rates, .5), 'bg_fp_rate'), 'half score below this')}
          ${card('Worst scene', fmtOr(Math.max(...rates), 'bg_fp_rate'), 'highest false-alarm rate')}
          ${card('Completely clean', rates.filter(v => v === 0).length, 'zero false pixels')}
        </div>
        <div class="tscroll"><table>
          <thead><tr><th>Scene</th><th>Year</th><th>FP rate</th><th>Predicted px</th>
          <th>Max probability</th><th>UNet++ FP rate</th></tr></thead><tbody>
          ${worst.map(s => `<tr><td><code>${s.ts}</code></td><td class="n">${s.year}</td>
            <td class="n">${fmtOr(s.bg_fp_rate, 'bg_fp_rate')}</td><td class="n">${int(s.pred_area)}</td>
            <td class="n">${fmtOr(s.prob_max, 'dice')}</td>
            <td class="n">${fmtOr(s.bg_fp_rate_cmp, 'bg_fp_rate')}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="small">Even the worst swarm-free scene puts under
        ${pct(Math.max(...rates), 1)} of its pixels into the swarm class. False alarms on empty skies are
        not a significant failure mode for this model.</p>`;
    } else {
      mount.querySelector('#fa').innerHTML = `<div class="state"><div class="big">No swarm-free scenes in this split</div></div>`;
    }

    /* ---- model disagreement ---- */
    const both = S.filter(s => s.dice != null && s.dice_cmp != null);
    const bothZero = both.filter(s => s.dice === 0 && s.dice_cmp === 0).length;
    const disagree = both.filter(s => Math.abs(s.dice - s.dice_cmp) > 0.2).length;
    const rhoM = spearman(both.map(s => s.dice), both.map(s => s.dice_cmp));
    mount.querySelector('#cmptable').innerHTML = `
      <p class="small">Scored on the same ${both.length} scenes, the selected Attention UNet and the
      UNet++ comparison agree at rank correlation <b>${rhoM == null ? '—' : rhoM.toFixed(3)}</b>: only
      <b>${disagree}</b> scenes differ by more than 0.2 Dice, and <b>${bothZero}</b> score zero for both.</p>`;

    /* ---- temporal clustering ---- */
    const nights = {};
    S.forEach(s => { if (s.night) (nights[s.night] ||= []).push(s); });
    const nightStats = Object.entries(nights).map(([k, v]) => ({
      night: k, n: v.length, mean: mean(v.map(s => s.dice)),
      bad: v.filter(s => s.dice < 0.3).length,
    })).filter(x => x.n >= 2).sort((a, b) => a.mean - b.mean);
    const badNights = nightStats.filter(x => x.bad === x.n);
    mount.querySelector('#clusters').innerHTML = `
      <p class="small">Grouping the ${bad.length} poor scenes by night shows whether failures are isolated
      scans or whole bad nights.</p>
      <div class="tscroll"><table>
        <thead><tr><th>Night</th><th>Scans</th><th>Mean Dice</th><th>Scans below 0.3</th><th>Pattern</th></tr></thead>
        <tbody>${nightStats.slice(0, 10).map(x => `<tr>
          <td>${esc(x.night)}</td><td class="n">${x.n}</td><td class="n">${fmtOr(x.mean, 'dice')}</td>
          <td class="n">${x.bad}</td>
          <td style="text-align:left">${x.bad === x.n ? 'entire night fails' : (x.bad ? 'mixed' : 'no failures')}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small"><b>${badNights.length}</b> night${badNights.length === 1 ? '' : 's'} in this split
      fail on every scan.</p>`;

    /* ---- worst table ---- */
    new DataTable(mount.querySelector('#worst'), {
      columns: [
        {key: 'ts', label: 'Scene', cls: '', fmt: v => `<code>${v}</code>`},
        {key: 'night', label: 'Night', cls: '', fmt: v => esc(v || '—')},
        {key: 'dice', label: 'Dice', fmt: v => fmtOr(v, 'dice')},
        {key: 'precision', label: 'Prec', fmt: v => fmtOr(v, 'precision')},
        {key: 'recall', label: 'Rec', fmt: v => fmtOr(v, 'recall')},
        {key: 'gt_area', label: 'Truth px', fmt: v => int(v)},
        {key: 'pred_area', label: 'Pred px', fmt: v => int(v)},
        {key: 'prob_max', label: 'Max prob', fmt: v => fmtOr(v, 'dice')},
        {key: 'dice_cmp', label: 'UNet++ Dice', fmt: v => fmtOr(v, 'dice')},
      ],
      rows: [...S].sort((a, b) => a.dice - b.dice).slice(0, 40),
      sort: 'dice', dir: 1, pageSize: 12,
      onRow: s => { location.hash = `#/samples?ts=${s.ts}`; },
    });

  }

  const filt = sceneFilters(mount.querySelector('#filters'), {samples: sm.samples, onChange: draw});
  draw();
}

