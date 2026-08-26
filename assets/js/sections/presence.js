/* Scan- and night-level SBW presence detection.

   All thresholds, curves, inferential tests and summaries come from the
   versioned presence.json export.  The browser only selects a precomputed view
   and renders it; in particular, it never optimises a cutoff on test data. */

import { load } from '../lib/data.js';
import { esc, int, tip } from '../lib/metrics.js';
import { card } from '../lib/ui.js';
import { lineChart, boxPlot, confusion } from '../lib/charts.js';
import { DataTable } from '../lib/table.js';
import {
  validatePresence, findModel, scanAnalysis, nightAnalysis, operatingPoint,
  rocPoints, distributionGroups, cellsToKm2, nightTableRows, scoreCeiling,
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
const COHORT = 'combined';   // validation and test pooled
const aggLabel = aggregation => aggregation === 'max' ? 'biggest' : 'average';
const SLIDER_STEPS = 1000;
const toSlider = (cells, ceiling) =>
  Math.round(SLIDER_STEPS * Math.log10(cells + 1) / Math.log10(ceiling + 1));
const fromSlider = (position, ceiling) =>
  Math.round(10 ** (position / SLIDER_STEPS * Math.log10(ceiling + 1)) - 1);

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function metricCards(analysis, metrics) {
  const c = metrics.confusion;
  return [
    card('ROC-AUC', rate(analysis.roc.auc), `n = ${int(metrics.n)}`),
    card('Sensitivity', rate(metrics.sensitivity), `${int(c.tp)} / ${int(metrics.n_positive)}`, 'recall'),
    card('Specificity', rate(metrics.specificity), `${int(c.tn)} / ${int(metrics.n_negative)}`, 'specificity'),
    card('Precision', rate(metrics.precision), `${int(c.tp)} / ${int(c.tp + c.fp)}`, 'precision'),
    card('F1', rate(metrics.f1), '', 'f1'),
    card('Accuracy', rate(metrics.accuracy), `${int(c.tp + c.tn)} / ${int(metrics.n)}`, 'accuracy'),
  ].join('');
}

/* Parameter strip: every setting this page's numbers depend on. */
function paramList(pairs) {
  return pairs.map(([term, value]) =>
    `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('');
}

/* Two balanced columns of statistic/value rows. Definitions come from the
   shared metric registry as hover tips rather than as text on the page. */
const STAT_TIP = {
  TP: 'tp', FP: 'fp', FN: 'fn', TN: 'tn', Accuracy: 'accuracy',
  'Balanced acc.': 'balanced_acc', Sensitivity: 'recall',
  Specificity: 'specificity', Precision: 'precision', F1: 'f1',
};
function statList(rows) {
  const half = Math.ceil(rows.length / 2);
  const column = list => `<table><tbody>${list.map(([term, value]) =>
    `<tr><td>${STAT_TIP[term] ? tip(STAT_TIP[term], term) : esc(term)}</td>
      <td class="n">${value}</td></tr>`).join('')}</tbody></table>`;
  return column(rows.slice(0, half)) + column(rows.slice(half));
}

function confusionRows(metrics) {
  const c = metrics.confusion;
  return [['TP', int(c.tp)], ['FP', int(c.fp)], ['FN', int(c.fn)], ['TN', int(c.tn)]];
}

function metricRows(analysis, metrics) {
  return [
    ['ROC-AUC', rate(analysis.roc.auc)],
    ['Accuracy', rate(metrics.accuracy)],
    ['Balanced acc.', rate(metrics.balanced_accuracy)],
    ['Sensitivity', rate(metrics.sensitivity)],
    ['Specificity', rate(metrics.specificity)],
    ['Precision', rate(metrics.precision)],
    ['NPV', rate(metrics.negative_predictive_value)],
    ['F1', rate(metrics.f1)],
    ['MCC', rate(metrics.mcc)],
    ['Youden J', rate(metrics.youden_j)],
  ];
}

function rocSvg(analysis, metrics, label, W = 520) {
  const marker = (metrics.specificity == null || metrics.sensitivity == null) ? [] : [{
    label: 'cut-off in use', c: 'var(--best)', w: 0,
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
      {c: 'var(--best)', label: 'cut-off in use'},
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
  const defaultOperating = doc.defaults?.scan_operating_point === 'any_cell' ? 'any' : 'selected';
  const defaultAggregation = doc.defaults?.night_aggregation === 'mean' ? 'mean' : 'max';
  const state = {level: 'scan', model: selectedKey,
    scanOperating: defaultOperating, nightAggregation: defaultAggregation,
    nightOperating: 'selected', scanCustom: null, nightCustom: null};

  mount.innerHTML = `
  <div class="presence-intro">
    <h1>Finding budworm: present or absent</h1>
  </div>

  <div class="presence-task-tabs" role="tablist" aria-label="Presence evaluation level">
    <button type="button" class="presence-task-tab" id="presence-tab-scan" data-level="scan"
      role="tab" aria-selected="true" aria-controls="presence-panel-scan" tabindex="0">
      <span class="presence-task-number" aria-hidden="true">01</span>
      <span><b>One scan</b></span>
    </button>
    <button type="button" class="presence-task-tab" id="presence-tab-night" data-level="night"
      role="tab" aria-selected="false" aria-controls="presence-panel-night" tabindex="-1">
      <span class="presence-task-number" aria-hidden="true">02</span>
      <span><b>One night</b></span>
    </button>
  </div>

  <div class="presence-toolbar" role="group" aria-label="Shared analysis controls">
    <fieldset class="presence-compact-control presence-model-control"><legend>Model</legend>
      <div class="model-choices" role="radiogroup" aria-label="Presence model">
        ${doc.models.map(model => `<label class="model-choice">
          <input type="radio" name="presence-model" value="${esc(model.key)}"${model.key === selectedKey ? ' checked' : ''}>
          <span>${esc(model.display_name)}</span>${model.selected || model.key === selectedKey ? '<small>selected</small>' : ''}
        </label>`).join('')}
      </div>
    </fieldset>
  </div>

  <section class="presence-level" id="presence-panel-scan" role="tabpanel"
    aria-labelledby="presence-tab-scan" tabindex="0">
    <div class="presence-level-head">
      <div><h2>Scan presence</h2></div>
      <fieldset class="presence-level-control"><legend>Area cut-off</legend>
        <div class="model-choices" role="radiogroup" aria-label="Scan operating point">
          <label class="model-choice"><input type="radio" name="scan-operating" value="any"${defaultOperating === 'any' ? ' checked' : ''}>
            <span>&ge; 1 cell</span></label>
          <label class="model-choice"><input type="radio" name="scan-operating" value="selected"${defaultOperating === 'selected' ? ' checked' : ''}>
            <span id="scan-cutoff-option"></span></label>
          <label class="model-choice"><input type="radio" name="scan-operating" value="custom">
            <span>Custom<span class="presence-option-note">set below</span></span></label>
        </div>
        <div class="presence-slider" id="scan-slider" hidden>
          <input type="range" id="scan-range" min="0" max="${SLIDER_STEPS}" step="1"
            aria-label="Custom scan area cut-off in cells">
          <output id="scan-range-out"></output>
        </div>
      </fieldset>
    </div>
    <dl class="presence-params" id="scan-params"></dl>
    <div class="cards presence-metric-cards" id="scan-cards"></div>
    <div class="presence-stats" id="scan-stats"></div>
    <p class="presence-cohort-note" id="scan-caveat"></p>
    <div class="two presence-chart-grid">
      <figure><div class="viz" id="scan-roc"></div><figcaption id="scan-roc-cap"></figcaption></figure>
      <figure><div class="viz" id="scan-confusion"></div><figcaption id="scan-confusion-cap"></figcaption></figure>
    </div>

    <details class="presence-disclosure presence-results-detail">
      <summary>Both cut-offs</summary>
      <div class="presence-details-body">
        <div id="scan-comparison"></div>
      </div>
    </details>
  </section>

  <section class="presence-level" id="presence-panel-night" role="tabpanel"
    aria-labelledby="presence-tab-night" tabindex="0" hidden>
    <div class="presence-level-head">
      <div><h2>Night migration</h2></div>
      <fieldset class="presence-level-control"><legend>Night score</legend>
        <div class="model-choices" role="radiogroup" aria-label="Night score summary">
          <label class="model-choice"><input type="radio" name="night-aggregation" value="max"${defaultAggregation === 'max' ? ' checked' : ''}> Biggest scan</label>
          <label class="model-choice"><input type="radio" name="night-aggregation" value="mean"${defaultAggregation === 'mean' ? ' checked' : ''}> Mean of scans</label>
        </div>
      </fieldset>
      <fieldset class="presence-level-control"><legend>Area cut-off</legend>
        <div class="model-choices" role="radiogroup" aria-label="Night operating point">
          <label class="model-choice"><input type="radio" name="night-operating" value="selected" checked>
            <span id="night-cutoff-option"></span></label>
          <label class="model-choice"><input type="radio" name="night-operating" value="custom">
            <span>Custom<span class="presence-option-note">set below</span></span></label>
        </div>
        <div class="presence-slider" id="night-slider" hidden>
          <input type="range" id="night-range" min="0" max="${SLIDER_STEPS}" step="1"
            aria-label="Custom night area cut-off in cells">
          <output id="night-range-out"></output>
        </div>
      </fieldset>
    </div>

    <dl class="presence-params" id="night-params"></dl>
    <p class="presence-cohort-note" id="night-caveat"></p>
    <div class="cards presence-metric-cards" id="night-cards"></div>
    <div class="presence-stats" id="night-stats"></div>
    <div class="two presence-chart-grid">
      <figure><div class="viz" id="night-dist"></div><figcaption id="night-dist-cap"></figcaption></figure>
      <figure><div class="viz" id="night-roc"></div><figcaption id="night-roc-cap"></figcaption></figure>
    </div>

    <div class="two presence-night-decision">
      <figure><div class="viz" id="night-confusion"></div><figcaption id="night-confusion-cap"></figcaption></figure>
      <div class="panel" id="night-cutoff"></div>
    </div>

    <details class="presence-disclosure presence-results-detail">
      <summary>All nights</summary>
      <div class="presence-details-body">
        <div id="night-table"></div>
      </div>
    </details>
  </section>`;

  function comparisonTable(analysis) {
    const entries = [
      ['≥ 1 cell', analysis.operating_points.any_cell],
      ['Validation-tuned', analysis.operating_points.validation_selected],
    ];
    return `<p class="presence-scroll-hint">Scroll sideways to see every column.</p>
      <div class="tscroll" tabindex="0" role="region" aria-label="Scan cutoff comparison table"><table><thead><tr><th>Rule</th><th>Cut-off (cells)</th>
      <th>Cut-off (km&sup2;)</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th>
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
    const scanView = state.level === 'scan';
    mount.querySelector('#presence-panel-scan').hidden = !scanView;
    mount.querySelector('#presence-panel-night').hidden = scanView;
    mount.querySelectorAll('.presence-task-tab').forEach(tab => {
      const active = tab.dataset.level === state.level;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    const model = findModel(doc, state.model);
    const scans = scanAnalysis(model, COHORT);
    const nights = nightAnalysis(model, state.nightAggregation, COHORT);
    const selectedScanCutoff = model.scan.combined_cutoff;
    const selectedNightCutoff = model.night[state.nightAggregation].combined_cutoff;

    const scanCeiling = scoreCeiling(scans);
    const nightCeiling = scoreCeiling(nights);
    if (state.scanCustom == null) state.scanCustom = selectedScanCutoff.cells;
    if (state.nightCustom == null) state.nightCustom = selectedNightCutoff.cells;
    state.scanCustom = Math.min(Math.max(0, state.scanCustom), scanCeiling);
    state.nightCustom = Math.min(Math.max(0, state.nightCustom), nightCeiling);

    const scanMetrics = operatingPoint(scans, state.scanOperating, state.scanCustom);
    const nightMetrics = operatingPoint(nights, state.nightOperating, state.nightCustom);

    const syncSlider = (id, custom, value, ceiling) => {
      const box = mount.querySelector(`#${id}-slider`);
      box.hidden = !custom;
      const range = mount.querySelector(`#${id}-range`);
      range.value = String(toSlider(value, ceiling));
      mount.querySelector(`#${id}-range-out`).textContent =
        `${area(value)} cells · ${km2(cellsToKm2(doc, value))} km²`;
    };
    syncSlider('scan', state.scanOperating === 'custom', state.scanCustom, scanCeiling);
    syncSlider('night', state.nightOperating === 'custom', state.nightCustom, nightCeiling);
    const exposure = doc.cohort.training_exposure[COHORT];
    const partialNights = nights.records.filter(record =>
      record.evaluated_scan_count < record.manifest_scan_count).length;
    const medianCoverage = median(nights.records.map(record => record.coverage_fraction));
    const valTestOverlap = doc.cohort.night_overlap.validation_test;

    const scanRule = `≥ ${area(scanMetrics.cutoff)} cell${scanMetrics.cutoff === 1 ? '' : 's'}`;
    mount.querySelector('#scan-cutoff-option').innerHTML =
      `&ge; ${area(selectedScanCutoff.cells)} cells<span class="presence-option-note">in-sample</span>`;
    mount.querySelector('#scan-params').innerHTML = paramList([
      ['Model', esc(model.display_name)],
      ['Cohort', 'validation + test'],
      ['Pixel threshold', model.pixel_probability_threshold],
      ['Grid cell', `${int(doc.definitions.pixel_size_m)} m · ${km2(doc.definitions.pixel_area_km2)} km²`],
      ['Truth rule', `≥ ${int(doc.definitions.ground_truth_min_cells)} labelled cell`],
      ['Area cut-off', `${scanRule} · ${km2(cellsToKm2(doc, scanMetrics.cutoff))} km²`],
      ['Cut-off from', state.scanOperating === 'any' ? 'fixed'
        : state.scanOperating === 'custom' ? 'you (not fitted)' : 'this cohort (in-sample)'],
      ['Scans', `${int(scanMetrics.n)} · ${int(scanMetrics.n_positive)} budworm / ${int(scanMetrics.n_negative)} none`],
    ]);
    mount.querySelector('#scan-cards').innerHTML = metricCards(scans, scanMetrics);
    mount.querySelector('#scan-stats').innerHTML = statList([
      ...confusionRows(scanMetrics), ...metricRows(scans, scanMetrics),
    ]);
    mount.querySelector('#scan-roc').innerHTML = rocSvg(scans, scanMetrics, 'Scan-level presence');
    mount.querySelector('#scan-roc-cap').textContent = `All area cut-offs · n = ${int(scans.n)} scans.`;
    mount.querySelector('#scan-caveat').textContent = state.scanOperating === 'any'
      ? 'Curated cohort: budworm-free scans over-represented.'
      : state.scanOperating === 'custom'
      ? 'Curated cohort. Cut-off set by hand on this cohort, so it carries no selection guarantee.'
      : 'Curated cohort. Cut-off fitted on these same scans, so rates below are optimistic.';
    mount.querySelector('#scan-confusion').innerHTML = confusion({
      ...scanMetrics.confusion, unit: 'scans', positiveLabel: 'budworm', negativeLabel: 'none',
      title: 'Scan presence, validation + test',
    });
    mount.querySelector('#scan-confusion-cap').textContent = `Cut-off ${scanRule}.`;
    mount.querySelector('#scan-comparison').innerHTML = comparisonTable(scans);

    const mwStat = nights.mann_whitney;
    mount.querySelector('#night-params').innerHTML = paramList([
      ['Model', esc(model.display_name)],
      ['Cohort', 'validation + test'],
      ['Night window', 'noon → noon UTC'],
      ['Night score', `${aggLabel(state.nightAggregation)} predicted cells`],
      ['Truth rule', '≥ 1 labelled scan with budworm'],
      ['Area cut-off', `≥ ${area(nightMetrics.cutoff)} cells · ${km2(cellsToKm2(doc, nightMetrics.cutoff))} km²`],
      ['Nights', `${int(nights.n)} · ${int(nights.n_positive)} migration / ${int(nights.n_negative)} quiet`],
      ['Scans per night', `median ${int(median(nights.records.map(r => r.evaluated_scan_count)))} of
        ${int(median(nights.records.map(r => r.manifest_scan_count)))} · ${(100 * medianCoverage).toFixed(0)}%`],
      ['Incomplete nights', `${int(partialNights)} / ${int(nights.n)}`],
      ['Cut-off from', state.nightOperating === 'custom' ? 'you (not fitted)' : 'this cohort (in-sample)'],
      ['Also in training', `${int(exposure.nights_seen_in_train)} / ${int(exposure.nights_total)}`],
      ['In both splits', `${int(valTestOverlap)} nights merged`],
    ]);
    mount.querySelector('#night-caveat').textContent = state.nightOperating === 'custom'
      ? 'Exploratory: cut-off set by hand on this cohort, and most nights were seen in training.'
      : 'Exploratory: cut-off fitted on these same nights, and most were seen in training.';
    mount.querySelector('#night-cards').innerHTML = metricCards(nights, nightMetrics);

    const groups = distributionGroups(nights).map((group, i) => ({
      ...group, c: i === 0 ? 'var(--tn)' : 'var(--accent2)',
    }));
    const yhi = Math.max(1, ...groups.flatMap(group => [group.hi ?? 0, group.mean ?? 0])) * 1.05;
    mount.querySelector('#night-dist').innerHTML = boxPlot({
      groups, ylo: 0, yhi, logy: true,
      ylabel: 'predicted swarm (cells)',
      xlabel: 'night truth', W: 520, H: 330,
      aria: `${aggLabel(state.nightAggregation)} predicted swarm size for quiet and migration nights, on a logarithmic scale`,
    });
    const neg = nights.score_summary.negative, pos = nights.score_summary.positive;
    mount.querySelector('#night-stats').innerHTML = statList([
      ...confusionRows(nightMetrics), ...metricRows(nights, nightMetrics),
      ['Mann–Whitney U', area(mwStat.u)],
      ['Mann–Whitney p', pValue(mwStat.p_value)],
      ['Common-language effect', rate(mwStat.common_language_auc)],
      ['Rank-biserial', rate(mwStat.rank_biserial)],
      ['Median, migration', area(pos.median)],
      ['Median, quiet', area(neg.median)],
      ['IQR, migration', `${area(pos.q1)} – ${area(pos.q3)}`],
      ['IQR, quiet', `${area(neg.q1)} – ${area(neg.q3)}`],
    ]);
    mount.querySelector('#night-dist-cap').innerHTML =
      `log<sub>10</sub>(cells + 1) &middot; box = quartiles &middot; whiskers = 5th/95th percentile.`;
    mount.querySelector('#night-roc').innerHTML = rocSvg(nights, nightMetrics, 'Night-level migration presence');
    mount.querySelector('#night-roc-cap').textContent = `All area cut-offs · n = ${int(nights.n)} nights.`;

    mount.querySelector('#night-confusion').innerHTML = confusion({
      ...nightMetrics.confusion, unit: 'nights', positiveLabel: 'migration', negativeLabel: 'quiet',
      title: 'Night migration, validation + test',
    });
    mount.querySelector('#night-confusion-cap').innerHTML =
      `${int(nightMetrics.n)} nights &middot; cut-off &ge; ${area(nightMetrics.cutoff)} cells.`;
    mount.querySelector('#night-cutoff-option').innerHTML =
      `&ge; ${area(selectedNightCutoff.cells)} cells<span class="presence-option-note">in-sample fit</span>`;
    mount.querySelector('#night-cutoff').innerHTML = `<h3 style="margin-top:0">Cut-off in use</h3>
      <div class="presence-cutoff"><b>${area(nightMetrics.cutoff)}</b> cells
        <span>${km2(cellsToKm2(doc, nightMetrics.cutoff))} km&sup2;</span></div>
      <div class="presence-stats">${statList([
        ['Source', state.nightOperating === 'custom' ? 'set by hand' : 'max Youden J, in-sample'],
        ['Sensitivity', rate(nightMetrics.sensitivity)],
        ['Specificity', rate(nightMetrics.specificity)],
        ['Youden J', rate(nightMetrics.youden_j)],
      ])}</div>`;

    const rows = nightTableRows(nights, nightMetrics.cutoff).map(row => ({
      ...row, score_km2: cellsToKm2(doc, row.score),
    }));
    new DataTable(mount.querySelector('#night-table'), {
      rows, pageSize: 25, sort: 'night_id', dir: -1,
      rowClass: row => row.outcome === 'FP' || row.outcome === 'FN' ? 'presence-error' : '',
      columns: [
        {key: 'night_id', label: 'Night (UTC)', fmt: value => `<code>${esc(nightRange(value))}</code>`},
        {key: 'truth', label: 'Truth', fmt: value => value ? 'migration' : 'quiet'},
        {key: 'coverage_fraction', label: 'Scans', fmt: (value, row) =>
          `${int(row.evaluated_scan_count)} / ${int(row.manifest_scan_count)} <span class="small">(${(100 * value).toFixed(0)}%)</span>`},
        {key: 'score', label: 'Score', fmt: (value, row) =>
          `${area(value)} <span class="small">cells · ${km2(row.score_km2)} km&sup2;</span>`},
        {key: 'predicted', label: 'Predicted', fmt: value => value ? 'migration' : 'quiet'},
        {key: 'outcome', label: 'Outcome', fmt: value =>
          `<span class="presence-outcome ${value.toLowerCase()}">${esc(value)}</span>`},
        {key: 'seen_in_train', label: 'In training', fmt: value => value
          ? '<span style="color:var(--warn)">yes</span>' : 'no'},
      ],
    });
    const nightScroll = mount.querySelector('#night-table .tscroll');
    if (nightScroll) {
      nightScroll.tabIndex = 0;
      nightScroll.setAttribute('role', 'region');
      nightScroll.setAttribute('aria-label', 'Results for every night');
    }
  }

  const taskTabs = [...mount.querySelectorAll('.presence-task-tab')];
  const chooseLevel = (level, focus = false) => {
    state.level = level;
    draw();
    if (focus) mount.querySelector(`.presence-task-tab[data-level="${level}"]`)?.focus();
  };
  taskTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => chooseLevel(tab.dataset.level));
    tab.addEventListener('keydown', event => {
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % taskTabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + taskTabs.length) % taskTabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = taskTabs.length - 1;
      if (next == null) return;
      event.preventDefault();
      chooseLevel(taskTabs[next].dataset.level, true);
    });
  });

  mount.querySelectorAll('input[name="presence-model"]').forEach(input =>
    input.addEventListener('change', event => { state.model = event.target.value; draw(); }));
  mount.querySelectorAll('input[name="scan-operating"]').forEach(input =>
    input.addEventListener('change', event => { state.scanOperating = event.target.value; draw(); }));
  mount.querySelectorAll('input[name="night-aggregation"]').forEach(input =>
    input.addEventListener('change', event => { state.nightAggregation = event.target.value; draw(); }));
  mount.querySelectorAll('input[name="night-operating"]').forEach(input =>
    input.addEventListener('change', event => { state.nightOperating = event.target.value; draw(); }));
  mount.querySelector('#scan-range').addEventListener('input', event => {
    state.scanCustom = fromSlider(Number(event.target.value), scoreCeiling(
      scanAnalysis(findModel(doc, state.model), COHORT)));
    draw();
  });
  mount.querySelector('#night-range').addEventListener('input', event => {
    state.nightCustom = fromSlider(Number(event.target.value), scoreCeiling(
      nightAnalysis(findModel(doc, state.model), state.nightAggregation, COHORT)));
    draw();
  });

  draw();
}
