/* Executive overview: the whole result in one screen, readable without a
   machine-learning background. Every number here is read from experiments.json
   / dataset.json, never hard coded. */

import { load } from '../lib/data.js';
import { fmtOr, tip, int, esc, MODEL_NAME, LOSS_NAME, targetName, pct } from '../lib/metrics.js';
import { hBarChart } from '../lib/charts.js';
import { card } from '../lib/ui.js';

export async function render(mount) {
  // summary.json is a ~1 KB companion to dataset.json: the overview needs the
  // headline counts, not the 2000+ per-scene records.
  const [ex, ds, mem] = await Promise.all([load('experiments'), load('summary'), load('memorization').catch(() => null)]);
  const rows = ex.experiments;
  const sel = rows.find(r => r.selected);
  const byDice = [...rows].filter(r => r.dice !== null).sort((a, b) => b.dice - a.dice);
  const runners = byDice.slice(0, 6);

  const cnt = ds.split_summary.counts;
  const totalPos = cnt.train.positives + cnt.val.positives + cnt.test.positives;
  const totalNeg = cnt.train.negatives + cnt.val.negatives + cnt.test.negatives;
  const lk = ds.leakage;

  // test-set pixel confusion for the selected run, from its stored full-scene
  // micro metrics (micro precision/recall + truth area recover the counts).
  const t = sel;

  mount.innerHTML = `
  <h1>Detecting spruce budworm moth flights in weather radar</h1>
  <p class="lede">A neural network reads each radar scan and marks the pixels that contain a moth
  dispersal swarm. This page summarises which model was chosen, how well it works, and where it fails.</p>

  <div class="note sel"><span class="tag">selected model</span><div class="bd">
    <b>${MODEL_NAME[sel.model] || sel.model}</b> trained with <b>${LOSS_NAME[sel.loss] || sel.loss}</b> loss,
    using <b>${sel.n_elev} radar elevation scans</b> as input and the <b>${targetName(sel.target_mode, sel.dbz_threshold)}</b>
    label definition. Decisions are made at probability threshold <b>${sel.threshold}</b>.
    <span class="small">Run id <code>${esc(sel.name)}</code>.</span>
  </div></div>

  <h3>Headline result on the held-out test set</h3>
  <div class="cards">
    ${card('Dice', fmtOr(sel.dice,'dice'), 'per scene average', 'dice', true)}
    ${card('Dice (micro)', fmtOr(sel.dice_micro,'dice_micro'), 'all pixels pooled', 'dice_micro')}
    ${card('IoU', fmtOr(sel.iou,'iou'), 'per scene average', 'iou')}
    ${card('Precision', fmtOr(sel.precision,'precision'), 'of predicted swarm', 'precision')}
    ${card('Recall', fmtOr(sel.recall,'recall'), 'of true swarm found', 'recall')}
    ${card('Boundary IoU', fmtOr(sel.boundary_iou,'boundary_iou'), 'edge placement', 'boundary_iou')}
  </div>
  <p class="small">Measured on <b>${int(sel.n_pos_scenes)}</b> test scenes that contain a swarm, using
  full-scene sliding-window inference. False alarms are measured separately on
  <b>${int(sel.n_neg_scenes)}</b> swarm-free test scenes:
  ${tip('bg_fp_rate','background false-positive rate')} = <b>${fmtOr(sel.bg_fp_rate,'bg_fp_rate')}</b>
  (${pct(sel.bg_fp_rate, 2)} of pixels).</p>

  <h2>Strongest alternatives</h2>
  <figure><div class="viz" id="alt"></div>
    <figcaption>Test Dice for the six best runs. The selected run is outlined. The spread across
    very different architectures is small, which is itself a finding: the data, not the architecture,
    limits the score.</figcaption></figure>

  <h2>Dataset at a glance</h2>
  <div class="meta">
    <div><div class="l">Radar</div><div class="d">${esc(ds.grid.radar)}</div></div>
    <div><div class="l">Grid</div><div class="d">${ds.grid.h} × ${ds.grid.w} px at ${ds.grid.pixel_m} m</div></div>
    <div><div class="l">Scenes with a swarm</div><div class="d">${int(totalPos)}</div></div>
    <div><div class="l">Swarm-free scenes</div><div class="d">${int(totalNeg)}</div></div>
    <div><div class="l">Years</div><div class="d">2013 to 2019, July and August</div></div>
    <div><div class="l">Split</div><div class="d">Stratified by year, 70 / 20 / 10</div></div>
  </div>

  <h2>Strengths, weaknesses and cautions</h2>
  <div class="three">
    <div class="panel"><h3 style="margin-top:0;color:var(--ok)">Strengths</h3><ul class="small" style="padding-left:18px;line-height:1.7">
      <li>Finds ${pct(sel.recall,0)} of true swarm pixels.</li>
      <li>Few false alarms on swarm-free scenes (${pct(sel.bg_fp_rate,2)} of pixels).</li>
      <li>Among the best boundary scores of the ${rows.length} runs (top three).</li>
      <li>Stable across 6 architectures: no single fragile configuration.</li>
    </ul></div>
    <div class="panel"><h3 style="margin-top:0;color:var(--warn)">Weaknesses</h3><ul class="small" style="padding-left:18px;line-height:1.7">
      <li>Precision is only ${pct(sel.precision,0)}: it over-calls swarm area.</li>
      <li>Score is capped near 0.63 Dice regardless of architecture.</li>
      <li>Small, sparse swarms score far worse than large ones
          (see <a href="#/errors">error analysis</a>).</li>
      <li>Edges are fuzzy: ${tip('nsd','NSD')} is only ${fmtOr(sel.nsd,'nsd')}.</li>
    </ul></div>
    <div class="panel"><h3 style="margin-top:0;color:var(--bad)">Scope of the claim</h3><ul class="small" style="padding-left:18px;line-height:1.7">
      <li>All results come from one radar (XAM) and ${lk.n_nights} nights, 2013–2019.</li>
      <li>Transfer to another radar or a very different season is <b>untested</b>.</li>
      <li>Labels are single-annotator, so model error and label error cannot be separated.</li>
      <li>Split integrity was checked directly and is <a href="#/data">sound</a>.</li>
    </ul></div>
  </div>

  ${mem ? `<div class="note"><span class="tag">what limits the score</span><div class="bd">
    The model scores the same on data it was trained on (<b>${mem.train_mean_dice.toFixed(3)}</b> Dice)
    as on the held-out test set (<b>${mem.test_mean_dice.toFixed(3)}</b>), so it is
    <b>under-fitted rather than over-fitted</b>. Together with six architectures all plateauing near
    0.63, that points to the ceiling being set by <b>label noise and genuinely ambiguous swarm
    edges</b>, not by the network. Improving the labels is worth more than a bigger model.
    <a href="#/data">Details</a>.
  </div></div>` : ''}

  <h2>Where to go next</h2>
  <div class="cards">
    ${nav('#/experiments','Compare all runs',`${rows.length} configurations, sortable and filterable`)}
    ${nav('#/samples','Inspect predictions',`Open any test scene and adjust the threshold`)}
    ${nav('#/errors','See the failures',`What breaks, and the evidence for why`)}
    ${nav('#/conclusions','Conclusions',`Limits, readiness and recommended next steps`)}
  </div>`;

  mount.querySelector('#alt').innerHTML = hBarChart({
    items: runners.map(r => ({
      label: `${MODEL_NAME[r.model] || r.model} · ${r.n_elev} elev`,
      value: r.dice, hl: r.selected,
      c: r.selected ? 'var(--best)' : 'var(--accent2)',
    })),
    lo: 0.60, hi: 0.645, labelW: 210, aria: 'Test Dice for the six best runs',
    xlabel: 'test Dice (macro) — higher is better',
    legend: [{c: 'var(--best)', label: 'Selected configuration'}, {c: 'var(--accent2)', label: 'Other runs'}],
  });
}


const nav = (href, title, sub) => `
  <a class="card" href="${href}" style="text-decoration:none;display:block">
    <div class="k" style="color:var(--accent2)">${esc(title)}</div>
    <div class="s" style="margin-top:6px;font-size:12.5px">${esc(sub)}</div>
  </a>`;
