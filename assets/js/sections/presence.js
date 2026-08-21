/* Scan- and night-level SBW presence detection.

   All thresholds, curves, inferential tests and summaries come from the
   versioned presence.json export.  The browser only selects a precomputed view
   and renders it; in particular, it never optimises a cutoff on test data. */

import { load } from '../lib/data.js';
import { esc, int } from '../lib/metrics.js';
import { card } from '../lib/ui.js';
import { lineChart, boxPlot, confusion } from '../lib/charts.js';
import { DataTable } from '../lib/table.js';
import {
  validatePresence, findModel, scanAnalysis, nightAnalysis, operatingPoint,
  rocPoints, distributionGroups, cellsToKm2, nightTableRows,
} from '../lib/presence.js';

const rate = value => value == null ? '&mdash;' : Number(value).toFixed(3);
const area = value => value == null ? '&mdash;' : Number(value).toLocaleString('en-US', {
  maximumFractionDigits: Number.isInteger(Number(value)) ? 0 : 1,
});
const km2 = value => value == null ? '&mdash;' : Number(value).toLocaleString('en-US', {
  minimumFractionDigits: Number(value) < 10 ? 2 : 1,
  maximumFractionDigits: Number(value) < 10 ? 2 : 1,
});
const pValue = value => value == null ? '&mdash;' : value < .001 ? '&lt; 0.001' : value.toFixed(3);
const splitLabel = split => split === 'test' ? 'Test (held out)' : 'Validation';
const aggLabel = aggregation => aggregation === 'max' ? 'maximum' : 'mean';
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function metricCards(analysis, metrics, unit) {
  return [
    card('ROC-AUC', rate(analysis.roc.auc), 'ranking across all area cutoffs'),
    card('Sensitivity', rate(metrics.sensitivity), `${metrics.confusion.tp}/${metrics.n_positive} present ${unit} found`),
    card('Specificity', rate(metrics.specificity), `${metrics.confusion.tn}/${metrics.n_negative} free ${unit} rejected`),
    card('Precision', rate(metrics.precision), 'share of presence calls correct'),
    card('F1 score', rate(metrics.f1), 'presence precision-recall balance'),
    card('Accuracy', rate(metrics.accuracy), `${metrics.n} ${unit} total`),
  ].join('');
}

function rocSvg(analysis, metrics, label, W = 520) {
  const marker = (metrics.specificity == null || metrics.sensitivity == null) ? [] : [{
    label: 'Displayed operating point', c: 'var(--best)', w: 0,
    points: [[1 - metrics.specificity, metrics.sensitivity]],
  }];
  return lineChart({
    series: [
      {label: 'Chance', c: 'var(--muted)', dash: '5 4', dots: false, points: [[0, 0], [1, 1]]},
      {label: 'ROC', c: 'var(--accent2)', w: 2.5, dots: false, points: rocPoints(analysis)},
      ...marker,
    ],
    xlo: 0, xhi: 1, ylo: 0, yhi: 1,
    xlabel: 'false-positive rate (1 − specificity)', ylabel: 'sensitivity',
    W, H: 330, aria: `${label} ROC curve, AUC ${analysis.roc.auc?.toFixed(3) ?? 'not available'}`,
    legend: [
      {c: 'var(--accent2)', label: `ROC · AUC ${analysis.roc.auc?.toFixed(3) ?? '—'}`},
      {c: 'var(--best)', label: 'Displayed operating point'},
      {c: 'var(--muted)', label: 'Chance'},
    ],
  });
}

function nightRange(id) {
  const start = new Date(`${id}T00:00:00Z`);
  if (Number.isNaN(+start)) return id;
  const end = new Date(+start + 86400000);
  return `${id} → ${end.toISOString().slice(0, 10)}`;
}

export async function render(mount) {
  const doc = validatePresence(await load('presence'));
  const selectedKey = doc.selected_model_key;
  const defaultSplit = doc.defaults?.split === 'val' ? 'val' : 'test';
  const defaultOperating = doc.defaults?.scan_operating_point === 'any_cell' ? 'any' : 'selected';
  const defaultAggregation = doc.defaults?.night_aggregation === 'mean' ? 'mean' : 'max';
  const state = {model: selectedKey, split: defaultSplit,
    scanOperating: defaultOperating, nightAggregation: defaultAggregation};

  mount.innerHTML = `
  <h1>SBW presence detection</h1>
  <p class="lede">Beyond pixel overlap, can the model tell whether spruce budworm is present in an
  individual radar scan or across a night? Pixel-level segmentation remains in
  <a href="#/aggregate">Aggregate evaluation</a>.</p>

  <div class="note"><span class="tag">presence rule</span><div class="bd">
    A scan is <b>SBW-present</b> when its ground-truth mask contains at least one full-resolution
    ${int(doc.definitions.pixel_size_m)} m grid cell (${km2(doc.definitions.pixel_area_km2)} km&sup2;).
    The model score is its predicted SBW-cell count at the locked pixel-probability threshold.
    Calling a score present requires a separate area cutoff; equality counts as present.
  </div></div>

  <div class="presence-controls" aria-label="Presence analysis controls">
    <fieldset class="presence-control-row"><legend>Model</legend>
      <div class="model-choices" role="radiogroup" aria-label="Presence model">
        ${doc.models.map(model => `<label class="model-choice">
          <input type="radio" name="presence-model" value="${esc(model.key)}"${model.key === selectedKey ? ' checked' : ''}>
          <span>${esc(model.display_name)}</span>${model.selected || model.key === selectedKey ? '<small>selected</small>' : ''}
        </label>`).join('')}
      </div>
    </fieldset>
    <fieldset class="presence-control-row"><legend>Evaluation split</legend>
      <div class="model-choices" role="radiogroup" aria-label="Evaluation split">
        <label class="model-choice"><input type="radio" name="presence-split" value="test"${defaultSplit === 'test' ? ' checked' : ''}> Test (held out)</label>
        <label class="model-choice"><input type="radio" name="presence-split" value="val"${defaultSplit === 'val' ? ' checked' : ''}> Validation</label>
      </div>
    </fieldset>
    <fieldset class="presence-control-row"><legend>Scan operating point</legend>
      <div class="model-choices" role="radiogroup" aria-label="Scan operating point">
        <label class="model-choice"><input type="radio" name="scan-operating" value="any"${defaultOperating === 'any' ? ' checked' : ''}> Any predicted cell</label>
        <label class="model-choice"><input type="radio" name="scan-operating" value="selected"${defaultOperating === 'selected' ? ' checked' : ''}> Validation-selected area</label>
      </div>
    </fieldset>
    <fieldset class="presence-control-row"><legend>Night summary</legend>
      <div class="model-choices" role="radiogroup" aria-label="Night score summary">
        <label class="model-choice"><input type="radio" name="night-aggregation" value="max"${defaultAggregation === 'max' ? ' checked' : ''}> Maximum area</label>
        <label class="model-choice"><input type="radio" name="night-aggregation" value="mean"${defaultAggregation === 'mean' ? ' checked' : ''}> Mean area</label>
      </div>
    </fieldset>
  </div>
  <p class="small" id="presence-status" role="status" aria-live="polite"></p>

  <div class="note warn" id="leakage-note"></div>
  <div class="note warn"><span class="tag">sampled negatives</span><div class="bd">
    Swarm-free scans were sampled for this machine-learning cohort rather than collected at their
    operational prevalence. <b>Accuracy and precision therefore describe this curated cohort, not the
    false-alarm burden in continuous radar operation.</b> Sensitivity, specificity and ROC-AUC remain
    useful conditional diagnostics, but should still be confirmed on a prospectively sampled season.
    Negative-scene masks are constructed as all-zero arrays by dataset design, not independently
    annotated pixel by pixel.
  </div></div>

  <h2>Scan-level presence</h2>
  <p class="small" id="scan-method"></p>
  <div class="cards presence-metric-cards" id="scan-cards"></div>
  <div class="two">
    <figure><div class="viz" id="scan-roc"></div><figcaption id="scan-roc-cap"></figcaption></figure>
    <figure><div class="viz" id="scan-confusion"></div><figcaption id="scan-confusion-cap"></figcaption></figure>
  </div>

  <h3>Operating-point comparison</h3>
  <p class="small">The one-cell row is the prespecified baseline. The alternative cutoff was fitted on
  validation by maximum Youden J and then applied unchanged to test; it is never selected on test.</p>
  <div id="scan-comparison"></div>

  <h2>Exploratory night-level migration presence</h2>
  <p class="small" id="night-method"></p>
  <div class="cards presence-metric-cards" id="night-cards"></div>
  <div class="two">
    <figure><div class="viz" id="night-dist"></div><figcaption id="night-dist-cap"></figcaption></figure>
    <figure><div class="viz" id="night-roc"></div><figcaption id="night-roc-cap"></figcaption></figure>
  </div>

  <h3>Distribution comparison</h3>
  <div id="night-mw"></div>

  <h3>Night decision at the validation-selected cutoff</h3>
  <div class="two presence-night-decision">
    <figure><div class="viz" id="night-confusion"></div><figcaption id="night-confusion-cap"></figcaption></figure>
    <div class="panel" id="night-cutoff"></div>
  </div>

  <h3>Exact night results</h3>
  <p class="small">Coverage reports evaluated scans in the selected split divided by all labelled
  manifest scans assigned to that operational night.</p>
  <div id="night-table"></div>`;

  function comparisonTable(analysis) {
    const entries = [
      ['Any predicted cell', analysis.operating_points.any_cell],
      ['Validation-selected area', analysis.operating_points.validation_selected],
    ];
    return `<div class="tscroll"><table><thead><tr><th>Presence rule</th><th>Cutoff (cells)</th>
      <th>Cutoff (km&sup2;)</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th>
      <th>Accuracy</th><th>Sensitivity</th><th>Specificity</th><th>Precision</th><th>F1</th></tr></thead><tbody>
      ${entries.map(([label, metrics], i) => {
        const active = (state.scanOperating === 'any' ? i === 0 : i === 1);
        return `<tr${active ? ' class="pick"' : ''}><td>${esc(label)}${active ? ' <span class="pill">displayed</span>' : ''}</td>
          <td class="n">${area(metrics.cutoff)}</td><td class="n">${km2(cellsToKm2(doc, metrics.cutoff))}</td>
          <td class="n">${int(metrics.confusion.tp)}</td><td class="n">${int(metrics.confusion.fp)}</td>
          <td class="n">${int(metrics.confusion.fn)}</td><td class="n">${int(metrics.confusion.tn)}</td>
          <td class="n">${rate(metrics.accuracy)}</td><td class="n">${rate(metrics.sensitivity)}</td>
          <td class="n">${rate(metrics.specificity)}</td><td class="n">${rate(metrics.precision)}</td>
          <td class="n">${rate(metrics.f1)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function draw() {
    const model = findModel(doc, state.model);
    const scans = scanAnalysis(model, state.split);
    const scanMetrics = operatingPoint(scans, state.scanOperating);
    const nights = nightAnalysis(model, state.nightAggregation, state.split);
    const nightMetrics = operatingPoint(nights, 'selected');
    const selectedScanCutoff = model.scan.selected_cutoff;
    const selectedNightCutoff = model.night[state.nightAggregation].selected_cutoff;
    const exposure = doc.cohort.training_exposure[state.split];
    const partialNights = nights.records.filter(record =>
      record.evaluated_scan_count < record.manifest_scan_count).length;
    const medianCoverage = median(nights.records.map(record => record.coverage_fraction));
    const valTestOverlap = doc.cohort.night_overlap.validation_test;
    const splitWord = state.split === 'test' ? 'test' : 'validation';

    mount.querySelector('#presence-status').textContent =
      `${model.display_name}; ${splitLabel(state.split)}; pixel threshold ${model.pixel_probability_threshold}; ` +
      `${aggLabel(state.nightAggregation)} nightly score.`;
    mount.querySelector('#leakage-note').innerHTML = `<span class="tag">partial and non-independent nights</span><div class="bd">
      Maximum/mean scores use only scans assigned to the displayed split: <b>${int(partialNights)} of
      ${int(nights.n)} ${splitWord} nights are partial</b>, with median
      coverage <b>${(100 * medianCoverage).toFixed(0)}%</b> of their labelled manifest scans.
      Maximum scores are especially sensitive to unequal evaluated scan counts; mean scores still
      reflect incomplete temporal coverage.
      ${state.split === 'test'
        ? `<b>${int(valTestOverlap)} of ${int(nights.n)} test nights also occur in validation</b>, so the
           validation-selected cutoff and test night metrics are not independent.`
        : `This displayed cohort is also the cohort used to select the area cutoff; ${int(valTestOverlap)}
           validation nights also occur in test.`}
      In addition, ${int(exposure.nights_seen_in_train)} of ${int(exposure.nights_total)} occur in training.
      <b>This does not satisfy an all-scans or unseen-night evaluation.</b> That requires a night-disjoint
      retrain and predictions at a fixed cadence for every held-out night.
    </div>`;

    const scanRule = state.scanOperating === 'any'
      ? `the prespecified any-cell cutoff (score ≥ 1 cell)`
      : `the validation-selected cutoff (score ≥ ${area(selectedScanCutoff.cells)} cells; ${km2(selectedScanCutoff.km2)} km²)`;
    mount.querySelector('#scan-method').innerHTML = `${esc(model.display_name)} converts probabilities to
      predicted area at pixel threshold <b>${model.pixel_probability_threshold}</b>. Metrics below use ${scanRule}.`;
    mount.querySelector('#scan-cards').innerHTML = metricCards(scans, scanMetrics, 'scans');
    mount.querySelector('#scan-roc').innerHTML = rocSvg(scans, scanMetrics, 'Scan-level presence');
    mount.querySelector('#scan-roc-cap').innerHTML = `Varying the required predicted area gives ROC-AUC
      <b>${rate(scans.roc.auc)}</b> across ${int(scans.n)} ${splitWord} scans. AUC measures ranking and
      does not choose an operating cutoff.`;
    mount.querySelector('#scan-confusion').innerHTML = confusion({
      ...scanMetrics.confusion, unit: 'scans', positiveLabel: 'present', negativeLabel: 'free',
      title: `${splitLabel(state.split)} scan presence confusion matrix`,
    });
    mount.querySelector('#scan-confusion-cap').innerHTML = `${splitLabel(state.split)} at ${scanRule}:
      ${int(scanMetrics.n_positive)} SBW-present and ${int(scanMetrics.n_negative)} SBW-free scans.`;
    mount.querySelector('#scan-comparison').innerHTML = comparisonTable(scans);

    mount.querySelector('#night-method').innerHTML = `A night is truly present if <b>any full-manifest scan</b>
      in its noon-to-noon UTC window contains SBW. Its model score is the <b>${aggLabel(state.nightAggregation)}</b>
      predicted area across evaluated ${splitWord} scans. The decision cutoff was selected on validation only.`;
    mount.querySelector('#night-cards').innerHTML = metricCards(nights, nightMetrics, 'nights');

    const groups = distributionGroups(nights).map((group, i) => ({
      ...group, c: i === 0 ? 'var(--tn)' : 'var(--accent2)',
    }));
    const yhi = Math.max(1, ...groups.flatMap(group => [group.hi ?? 0, group.mean ?? 0])) * 1.05;
    mount.querySelector('#night-dist').innerHTML = boxPlot({
      groups, ylo: 0, yhi, logy: true,
      ylabel: `${aggLabel(state.nightAggregation)} predicted area (cells)`,
      xlabel: 'full-manifest night truth', W: 520, H: 330,
      aria: `${aggLabel(state.nightAggregation)} predicted area for SBW-free and SBW-present nights on a logarithmic scale`,
    });
    const neg = nights.score_summary.negative, pos = nights.score_summary.positive;
    mount.querySelector('#night-dist-cap').innerHTML = `Real-unit medians: SBW-free
      <b>${area(neg.median)} cells (${km2(cellsToKm2(doc, neg.median))} km&sup2;)</b>; SBW-present
      <b>${area(pos.median)} cells (${km2(cellsToKm2(doc, pos.median))} km&sup2;)</b>.
      Axis spacing is log<sub>10</sub>(cells + 1), so exact zeros remain visible.`;
    mount.querySelector('#night-roc').innerHTML = rocSvg(nights, nightMetrics, 'Night-level migration presence');
    mount.querySelector('#night-roc-cap').innerHTML = `Night ROC-AUC <b>${rate(nights.roc.auc)}</b>
      (${int(nights.n_positive)} present, ${int(nights.n_negative)} free ${splitWord} nights).
      The orange point uses the unchanged validation-selected cutoff.`;

    const mw = nights.mann_whitney;
    mount.querySelector('#night-mw').innerHTML = `<div class="tscroll"><table><thead><tr>
      <th>Night score</th><th>Present nights</th><th>Free nights</th><th>Present median (cells)</th>
      <th>Free median (cells)</th><th>Mann&ndash;Whitney U</th><th>Two-sided p</th>
      <th>Common-language effect</th></tr></thead><tbody><tr>
      <td>${esc(aggLabel(state.nightAggregation))} predicted area</td>
      <td class="n">${int(mw.n_positive)}</td><td class="n">${int(mw.n_negative)}</td>
      <td class="n">${area(pos.median)}</td><td class="n">${area(neg.median)}</td>
      <td class="n">${area(mw.u)}</td><td class="n">${pValue(mw.p_value)}</td>
      <td class="n">${rate(mw.common_language_auc)}</td></tr></tbody></table></div>
      <p class="small">Two-sided Mann&ndash;Whitney compares the score distributions without assuming normality.
      The common-language effect is the probability that a randomly chosen present night has a larger score
      than a randomly chosen free night (ties share credit). Correlated and partial nights limit inference.</p>`;

    mount.querySelector('#night-confusion').innerHTML = confusion({
      ...nightMetrics.confusion, unit: 'nights', positiveLabel: 'present', negativeLabel: 'free',
      title: `${splitLabel(state.split)} night presence confusion matrix`,
    });
    mount.querySelector('#night-confusion-cap').innerHTML = `${splitLabel(state.split)} classification of
      ${int(nightMetrics.n)} operational nights at the validation-selected ${aggLabel(state.nightAggregation)}-area cutoff.`;
    mount.querySelector('#night-cutoff').innerHTML = `<h3 style="margin-top:0">Locked night cutoff</h3>
      <div class="presence-cutoff"><b>${area(selectedNightCutoff.cells)}</b> cells
        <span>${km2(selectedNightCutoff.km2)} km&sup2;</span></div>
      <p class="small">Selected by maximum validation Youden J
      (sensitivity ${rate(selectedNightCutoff.validation_sensitivity)}, specificity
      ${rate(selectedNightCutoff.validation_specificity)}). Ties prefer higher specificity, then the higher cutoff.</p>
      <p class="small">This area cutoff is separate from the model's pixel-probability threshold
      ${model.pixel_probability_threshold}.</p>`;

    const rows = nightTableRows(nights, nightMetrics.cutoff).map(row => ({
      ...row, score_km2: cellsToKm2(doc, row.score),
    }));
    new DataTable(mount.querySelector('#night-table'), {
      rows, pageSize: 25, sort: 'night_id', dir: -1,
      rowClass: row => row.outcome === 'FP' || row.outcome === 'FN' ? 'presence-error' : '',
      columns: [
        {key: 'night_id', label: 'Operational night (UTC)', fmt: value => `<code>${esc(nightRange(value))}</code>`},
        {key: 'truth', label: 'True class', fmt: value => value ? 'SBW present' : 'SBW free'},
        {key: 'coverage_fraction', label: 'Evaluated / manifest coverage', fmt: (value, row) =>
          `${int(row.evaluated_scan_count)} / ${int(row.manifest_scan_count)} <span class="small">(${(100 * value).toFixed(0)}%)</span>`},
        {key: 'score', label: `${aggLabel(state.nightAggregation)} score`, fmt: (value, row) =>
          `${area(value)} <span class="small">cells · ${km2(row.score_km2)} km&sup2;</span>`},
        {key: 'predicted', label: 'Predicted class', fmt: value => value ? 'SBW present' : 'SBW free'},
        {key: 'outcome', label: 'Outcome', fmt: value =>
          `<span class="presence-outcome ${value.toLowerCase()}">${esc(value)}</span>`},
        {key: 'seen_in_train', label: 'Night seen in train', fmt: value => value
          ? '<span style="color:var(--warn)">yes</span>' : 'no'},
      ],
    });
  }

  mount.querySelectorAll('input[name="presence-model"]').forEach(input =>
    input.addEventListener('change', event => { state.model = event.target.value; draw(); }));
  mount.querySelectorAll('input[name="presence-split"]').forEach(input =>
    input.addEventListener('change', event => { state.split = event.target.value; draw(); }));
  mount.querySelectorAll('input[name="scan-operating"]').forEach(input =>
    input.addEventListener('change', event => { state.scanOperating = event.target.value; draw(); }));
  mount.querySelectorAll('input[name="night-aggregation"]').forEach(input =>
    input.addEventListener('change', event => { state.nightAggregation = event.target.value; draw(); }));

  draw();
}
