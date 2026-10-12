/* Scan classification: Swin-Tiny (frozen, val+test), unregistered candidates
   and the frozen S0 head (validation only), plus the two-model cascade. */

import { load } from '../lib/data.js';
import { esc, int } from '../lib/metrics.js';
import { card } from '../lib/ui.js';
import { lineChart, confusion } from '../lib/charts.js';
import { DataTable } from '../lib/table.js';

const rate = v => v == null ? '—' : Number(v).toFixed(3);
const pct = v => v == null ? '—' : (100 * Number(v)).toFixed(1) + '%';
const C = ['#14479a', '#c2680c', '#1f7a54', '#b07aa1', '#2f7dd1'];

function splitBlock(model, split) {
  return model.splits?.[split] || null;
}

function rocSeries(models, split) {
  const series = [{label: 'chance', c: 'var(--muted)', dash: '4 3', dots: false, w: 1,
                   points: [[0, 0], [1, 1]]}];
  models.forEach((m, i) => {
    const b = splitBlock(m, split);
    if (!b?.roc?.length) return;
    series.push({label: m.display, c: C[i % C.length], dots: false, w: 2,
                 points: b.roc.map(p => [p.fpr, p.tpr])});
  });
  return series;
}

function prSeries(models, split) {
  return models.map((m, i) => {
    const b = splitBlock(m, split);
    if (!b?.pr?.length) return null;
    return {label: m.display, c: C[i % C.length], dots: false, w: 2,
            points: b.pr.map(p => [p.recall, p.precision])};
  }).filter(Boolean);
}

function metricStrip(b, label) {
  if (!b) return `<p class="small">${esc(label)} is not shown (not pre-registered).</p>`;
  const c = b.confusion || {};
  return [
    card('ROC-AUC', rate(b.auroc), label),
    card('AP', rate(b.ap), `prevalence ${rate(b.baseline_precision)}`),
    card('Sensitivity', rate(b.sensitivity), `${int(c.tp)} / ${int(b.n_positive)}`),
    card('Specificity', rate(b.specificity), `${int(c.tn)} / ${int(b.n_negative)}`),
    card('Precision', rate(b.precision), ''),
    card('F1', rate(b.f1), `t = ${rate(b.threshold)}`),
  ].join('');
}

export async function render(mount) {
  const doc = await load('classifiers');
  const swin = doc.models.filter(m => m.family === 'swin');
  const cand = doc.models.filter(m => m.family === 'candidate');
  const frozen = doc.models.filter(m => m.family === 'frozen_head');
  const cas = doc.cascade || {};
  const youden = cas.youden || {};
  const rmin = cas.high_sensitivity || {};
  const ungated = cas.ungated || {};

  const rowsFor = (list, split) => list.map(m => {
    const b = splitBlock(m, split);
    const c = b?.confusion || {};
    return {
      name: m.display,
      seed: m.seed,
      registered: m.registered ? 'yes' : 'no',
      split,
      auroc: b?.auroc,
      ap: b?.ap,
      sensitivity: b?.sensitivity,
      specificity: b?.specificity,
      precision: b?.precision,
      f1: b?.f1,
      threshold: b?.threshold,
      tp: c.tp, fp: c.fp, fn: c.fn, tn: c.tn,
    };
  });

  const cols = [
    {key:'name', label:'Model'},
    {key:'seed', label:'Seed'},
    {key:'split', label:'Split'},
    {key:'auroc', label:'ROC-AUC', fmt: v => rate(v)},
    {key:'ap', label:'AP', fmt: v => rate(v)},
    {key:'sensitivity', label:'Sens.', fmt: v => rate(v)},
    {key:'specificity', label:'Spec.', fmt: v => rate(v)},
    {key:'precision', label:'Prec.', fmt: v => rate(v)},
    {key:'f1', label:'F1', fmt: v => rate(v)},
    {key:'threshold', label:'t', fmt: v => rate(v)},
  ];

  const cascadeRows = (cas.rows || []).map(r => ({
    name: r.name,
    family: r.family,
    dice: r.dice,
    recall: r.recall,
    bg_fp_rate: r.bg_fp_rate,
    scan_auroc: r.scan_auroc,
    scan_recall: r.scan_recall,
    cls_threshold: r.cls_threshold,
    note: r.note,
  }));

  mount.innerHTML = `
  <h1>Scan classification</h1>
  <p class="lede">Which scans contain a plume, scored as a binary decision on the frozen night split.
  Pixel maps are not used here except in the cascade table, where a classifier blanks quiet scans before the segmenter is scored.</p>

  <div class="note"><span class="tag">protocol</span><div class="bd">
    ${esc(doc.protocol?.note || '')}
    Thresholds are each run’s validation Youden J and are not refit on test.
  </div></div>

  <h2>Swin-Tiny (pre-registered, seeds 42–46)</h2>
  <p class="small">These five seeds are listed in FROZEN.md. Test uses the validation threshold unchanged.</p>
  <div class="two">
    <div>
      <h3>Validation ROC</h3>
      ${lineChart({series: rocSeries(swin, 'val'), xlo:0, xhi:1, ylo:0, yhi:1,
        xlabel:'False positive rate', ylabel:'True positive rate',
        aria:'Swin-Tiny validation ROC', legend: swin.map((m,i)=>({c:C[i%C.length], label:m.display})),
        marks:[{x:0, c:'var(--muted)', label:''}]})}
    </div>
    <div>
      <h3>Test ROC</h3>
      ${lineChart({series: rocSeries(swin, 'test'), xlo:0, xhi:1, ylo:0, yhi:1,
        xlabel:'False positive rate', ylabel:'True positive rate',
        aria:'Swin-Tiny test ROC', legend: swin.map((m,i)=>({c:C[i%C.length], label:m.display}))})}
    </div>
  </div>
  <div class="two">
    <div>
      <h3>Validation precision–recall</h3>
      ${lineChart({series: prSeries(swin, 'val'), xlo:0, xhi:1, ylo:0, yhi:1,
        xlabel:'Recall', ylabel:'Precision', aria:'Swin-Tiny validation PR'})}
    </div>
    <div>
      <h3>Test precision–recall</h3>
      ${lineChart({series: prSeries(swin, 'test'), xlo:0, xhi:1, ylo:0, yhi:1,
        xlabel:'Recall', ylabel:'Precision', aria:'Swin-Tiny test PR'})}
    </div>
  </div>
  <div id="swin-val-table"></div>
  <div id="swin-test-table"></div>
  <h3>Confusion at the validation threshold</h3>
  <div class="grid2" id="swin-cm"></div>

  <h2>Candidates and frozen scan head (validation only)</h2>
  <p class="small">Not listed in FROZEN.md before they were scored on test, so test is omitted here even though those JSON files exist.</p>
  <div class="two">
    <div>
      <h3>Validation ROC</h3>
      ${lineChart({series: rocSeries([...cand, ...frozen], 'val'), xlo:0, xhi:1, ylo:0, yhi:1,
        xlabel:'False positive rate', ylabel:'True positive rate',
        aria:'Unregistered classifiers validation ROC',
        legend: [...cand, ...frozen].map((m,i)=>({c:C[i%C.length], label:m.display}))})}
    </div>
    <div>
      <h3>Validation precision–recall</h3>
      ${lineChart({series: prSeries([...cand, ...frozen], 'val'), xlo:0, xhi:1, ylo:0, yhi:1,
        xlabel:'Recall', ylabel:'Precision', aria:'Unregistered classifiers validation PR'})}
    </div>
  </div>
  <div id="cand-table"></div>
  <div class="grid2" id="cand-cm"></div>

  <h2>Cascade on validation</h2>
  <p class="small">${esc(cas.note || '')} Hard gate: if the classifier score is below t the scan is all zeros, otherwise the Attention U-Net seed 42 map is left unscaled.</p>
  <div class="cards">
    ${card('Ungated S0 Dice', rate(ungated.dice), 'no classifier')}
    ${card('Youden cascade Dice', rate(youden.dice), `t = ${rate(youden.cls_threshold)}`)}
    ${card('High-sensitivity cascade Dice', rate(rmin.dice), `t = ${rate(rmin.cls_threshold)}`)}
    ${card('Youden scan recall', rate(youden.scan_recall), 'Swin-Tiny seed 42')}
  </div>
  <div id="cascade-table"></div>
  `;

  new DataTable(mount.querySelector('#swin-val-table'), {
    columns: cols, rows: rowsFor(swin, 'val'), caption: 'Swin-Tiny validation',
  });
  new DataTable(mount.querySelector('#swin-test-table'), {
    columns: cols, rows: rowsFor(swin, 'test'), caption: 'Swin-Tiny test',
  });
  new DataTable(mount.querySelector('#cand-table'), {
    columns: cols, rows: rowsFor([...cand, ...frozen], 'val'),
    caption: 'Unregistered models, validation only',
  });
  new DataTable(mount.querySelector('#cascade-table'), {
    columns: [
      {key:'name', label:'Row'},
      {key:'family', label:'Family'},
      {key:'dice', label:'Dice', fmt: v => rate(v)},
      {key:'recall', label:'Seg. recall', fmt: v => rate(v)},
      {key:'bg_fp_rate', label:'Quiet FP rate', fmt: v => rate(v)},
      {key:'scan_auroc', label:'Scan AUROC', fmt: v => rate(v)},
      {key:'scan_recall', label:'Scan recall', fmt: v => rate(v)},
      {key:'cls_threshold', label:'Cls t', fmt: v => rate(v)},
      {key:'note', label:'Note'},
    ],
    rows: cascadeRows,
    caption: 'Cascade comparison (validation)',
  });

  const swinCm = mount.querySelector('#swin-cm');
  swin.forEach(m => {
    const v = splitBlock(m, 'val')?.confusion;
    const t = splitBlock(m, 'test')?.confusion;
    const box = document.createElement('div');
    box.innerHTML = `<h3>${esc(m.display)}</h3>
      <p class="small">Validation (left) and test (right) at t = ${rate(m.threshold)}.</p>
      <div class="two">
        ${v ? confusion({...v, title: m.display + ' val', unit: 'scans',
            positiveLabel: 'plume', negativeLabel: 'quiet'}) : ''}
        ${t ? confusion({...t, title: m.display + ' test', unit: 'scans',
            positiveLabel: 'plume', negativeLabel: 'quiet'}) : ''}
      </div>`;
    swinCm.appendChild(box);
  });

  const candCm = mount.querySelector('#cand-cm');
  [...cand, ...frozen].forEach(m => {
    const v = splitBlock(m, 'val')?.confusion;
    const box = document.createElement('div');
    box.innerHTML = `<h3>${esc(m.display)}</h3>
      ${v ? confusion({...v, title: m.display + ' val', unit: 'scans',
          positiveLabel: 'plume', negativeLabel: 'quiet'}) : ''}`;
    candCm.appendChild(box);
  });
}
