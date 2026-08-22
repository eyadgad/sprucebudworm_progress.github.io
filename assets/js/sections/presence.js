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
const splitLabel = split => split === 'test' ? 'Test (unseen data)' : 'Validation';
const aggLabel = aggregation => aggregation === 'max' ? 'biggest' : 'average';
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function metricCards(analysis, metrics, unit) {
  return [
    card('ROC-AUC', rate(analysis.roc.auc), '1.0 is perfect, 0.5 is guessing'),
    card('Sensitivity', rate(metrics.sensitivity), `found ${metrics.confusion.tp} of ${metrics.n_positive} ${unit} with budworm`),
    card('Specificity', rate(metrics.specificity), `cleared ${metrics.confusion.tn} of ${metrics.n_negative} ${unit} without budworm`),
    card('Precision', rate(metrics.precision), 'when it says budworm, how often it is right'),
    card('F1 score', rate(metrics.f1), 'one number balancing the two above'),
    card('Accuracy', rate(metrics.accuracy), `right answers out of ${metrics.n} ${unit}`),
  ].join('');
}

function rocSvg(analysis, metrics, label, W = 520) {
  const marker = (metrics.specificity == null || metrics.sensitivity == null) ? [] : [{
    label: 'The cut-off shown above', c: 'var(--best)', w: 0,
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
      {c: 'var(--best)', label: 'The cut-off shown above'},
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
  const state = {level: 'scan', model: selectedKey, split: defaultSplit,
    scanOperating: defaultOperating, nightAggregation: defaultAggregation};

  mount.innerHTML = `
  <div class="presence-intro">
    <h1>Finding budworm: present or absent</h1>
    <p class="lede">Two questions here: does a single radar scan contain budworm, and did a whole night
    have a migration? How closely the model traces the exact shape of a swarm is measured separately in
    <a href="#/aggregate">Aggregate evaluation</a>.</p>
  </div>

  <div class="presence-task-tabs" role="tablist" aria-label="Presence evaluation level">
    <button type="button" class="presence-task-tab" id="presence-tab-scan" data-level="scan"
      role="tab" aria-selected="true" aria-controls="presence-panel-scan" tabindex="0">
      <span class="presence-task-number" aria-hidden="true">01</span>
      <span><b>One scan</b><small>Does this radar scan contain budworm?</small></span>
    </button>
    <button type="button" class="presence-task-tab" id="presence-tab-night" data-level="night"
      role="tab" aria-selected="false" aria-controls="presence-panel-night" tabindex="-1">
      <span class="presence-task-number" aria-hidden="true">02</span>
      <span><b>One night</b><small>Was there a migration this night?</small></span>
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
    <fieldset class="presence-compact-control presence-split-control"><legend>Dataset</legend>
      <div class="model-choices" role="radiogroup" aria-label="Evaluation split">
        <label class="model-choice"><input type="radio" name="presence-split" value="test"${defaultSplit === 'test' ? ' checked' : ''}> Test (unseen data)</label>
        <label class="model-choice"><input type="radio" name="presence-split" value="val"${defaultSplit === 'val' ? ' checked' : ''}> Validation</label>
      </div>
    </fieldset>
  </div>
  <p class="presence-context" id="presence-status" role="status" aria-live="polite"></p>

  <details class="presence-disclosure presence-definition">
    <summary>What counts as budworm, and where these numbers come from</summary>
    <div class="presence-details-body presence-detail-grid">
      <div><h3>What counts as present</h3><p>A scan <b>has budworm</b> if the hand-drawn answer marks even
      one grid cell (${int(doc.definitions.pixel_size_m)} m across, or ${km2(doc.definitions.pixel_area_km2)} km&sup2;).
      The model's score for a scan is simply how many cells it predicts as budworm. To turn that count into
      a yes-or-no answer we pick a cut-off; a score sitting exactly on the cut-off counts as yes.</p></div>
      <div><h3>How the empty scans were chosen</h3><p>The budworm-free scans here were hand-picked to build
      this dataset, so they do not appear as often as they would on a normal radar night. <b>That means the
      accuracy and precision below describe this dataset, not how many false alarms you would get running the
      radar continuously.</b> Budworm-free scans were also stored as blank masks rather than labelled cell by
      cell.</p></div>
    </div>
  </details>

  <section class="presence-level" id="presence-panel-scan" role="tabpanel"
    aria-labelledby="presence-tab-scan" tabindex="0">
    <div class="presence-level-head">
      <div><p class="presence-eyebrow">A single radar scan</p><h2>Does this scan contain budworm?</h2>
        <p>Can the model tell scans that contain budworm apart from scans that do not?</p></div>
      <fieldset class="presence-level-control"><legend>How much is enough to say yes?</legend>
        <div class="model-choices" role="radiogroup" aria-label="Scan operating point">
          <label class="model-choice"><input type="radio" name="scan-operating" value="any"${defaultOperating === 'any' ? ' checked' : ''}>
            <span>Any cell at all <span class="presence-option-note">1 cell or more</span></span></label>
          <label class="model-choice"><input type="radio" name="scan-operating" value="selected"${defaultOperating === 'selected' ? ' checked' : ''}>
            <span>An amount tuned on validation <span class="presence-option-note" id="scan-cutoff-option"></span></span></label>
        </div>
      </fieldset>
    </div>
    <p class="presence-method" id="scan-method"></p>
    <p class="presence-glance" id="scan-glance" role="note"></p>
    <div class="cards presence-metric-cards" id="scan-cards"></div>
    <p class="presence-cohort-note"><b>Reading these numbers:</b> budworm-free scans are rarer in this
    dataset than on a real radar night, so accuracy and precision here do not tell you how often the model
    would raise a false alarm in real use. See the note above.</p>
    <div class="two presence-chart-grid">
      <figure><div class="viz" id="scan-roc"></div><figcaption id="scan-roc-cap"></figcaption></figure>
      <figure><div class="viz" id="scan-confusion"></div><figcaption id="scan-confusion-cap"></figcaption></figure>
    </div>

    <details class="presence-disclosure presence-results-detail">
      <summary>Compare the two cut-offs side by side</summary>
      <div class="presence-details-body">
        <p class="small">The one-cell row is the plain baseline, fixed in advance. The other cut-off was
        tuned on the validation data and then used on the test data without any further changes, so the test
        numbers were never tuned to themselves.</p>
        <div id="scan-comparison"></div>
      </div>
    </details>
  </section>

  <section class="presence-level" id="presence-panel-night" role="tabpanel"
    aria-labelledby="presence-tab-night" tabindex="0" hidden>
    <div class="presence-level-head">
      <div><p class="presence-eyebrow">One night, noon to noon UTC</p><h2>Was there a migration this night?</h2>
        <p>Each night is boiled down to one number: how big the predicted swarm was. Does that number tell
        migration nights apart from quiet ones?</p></div>
      <fieldset class="presence-level-control"><legend>Number to use for each night</legend>
        <div class="model-choices" role="radiogroup" aria-label="Night score summary">
          <label class="model-choice"><input type="radio" name="night-aggregation" value="max"${defaultAggregation === 'max' ? ' checked' : ''}> Biggest swarm that night</label>
          <label class="model-choice"><input type="radio" name="night-aggregation" value="mean"${defaultAggregation === 'mean' ? ' checked' : ''}> Average swarm that night</label>
        </div>
      </fieldset>
    </div>

    <details class="presence-limit" id="night-limitations">
      <summary><span class="presence-limit-tag">Rough guide</span><span>
        <b>Read the night results with care</b><small id="leakage-summary"></small>
        <small class="presence-limit-warning" id="leakage-score-warning"></small>
      </span></summary>
      <div id="leakage-note"></div>
    </details>

    <p class="presence-method" id="night-method"></p>
    <p class="presence-glance" id="night-glance" role="note"></p>
    <div class="cards presence-metric-cards" id="night-cards"></div>
    <div class="two presence-chart-grid">
      <figure><div class="viz" id="night-dist"></div><figcaption id="night-dist-cap"></figcaption></figure>
      <figure><div class="viz" id="night-roc"></div><figcaption id="night-roc-cap"></figcaption></figure>
    </div>

    <details class="presence-disclosure presence-results-detail">
      <summary>See the statistical test in full</summary>
      <div class="presence-details-body" id="night-mw"></div>
    </details>

    <div class="presence-section-heading"><h3>Yes-or-no answers at the tuned cut-off</h3>
      <p>The cut-off was chosen using the validation nights, then left untouched for the test nights.</p></div>
    <div class="two presence-night-decision">
      <figure><div class="viz" id="night-confusion"></div><figcaption id="night-confusion-cap"></figcaption></figure>
      <div class="panel" id="night-cutoff"></div>
    </div>

    <details class="presence-disclosure presence-results-detail">
      <summary>See every night, one by one</summary>
      <div class="presence-details-body">
        <p class="small">Coverage shows how many of a night's scans were actually available here, out of
        all the labelled scans belonging to that night.</p>
        <p class="presence-scroll-hint">Scroll sideways to see every column.</p>
        <div id="night-table"></div>
      </div>
    </details>
  </section>`;

  function comparisonTable(analysis) {
    const entries = [
      ['Any cell at all', analysis.operating_points.any_cell],
      ['Tuned on validation', analysis.operating_points.validation_selected],
    ];
    return `<p class="presence-scroll-hint">Scroll sideways to compare every number.</p>
      <div class="tscroll" tabindex="0" role="region" aria-label="Scan cutoff comparison table"><table><thead><tr><th>Rule for saying yes</th><th>Cut-off (cells)</th>
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

    mount.querySelector('#presence-status').textContent = scanView
      ? `Showing scan-by-scan results for ${model.display_name} on ${splitLabel(state.split)}.`
      : `Showing night-by-night results for ${model.display_name} on ${splitLabel(state.split)}, scoring each night by its ${aggLabel(state.nightAggregation)} predicted swarm.`;
    mount.querySelector('#leakage-summary').textContent =
      `${int(partialNights)} of ${int(nights.n)} nights are incomplete · usually ${(100 * medianCoverage).toFixed(0)}% of a night's scans are here · ` +
      `${int(exposure.nights_seen_in_train)} of ${int(exposure.nights_total)} nights were also used in training` +
      (state.split === 'test' ? ` · ${int(valTestOverlap)} of ${int(nights.n)} also appear in validation` : '');
    mount.querySelector('#leakage-score-warning').textContent = state.nightAggregation === 'max'
      ? 'Using the biggest swarm is especially unfair between nights, because some nights have far more scans than others.'
      : 'Using the average still depends on which scans happen to be missing.';
    mount.querySelector('#leakage-note').innerHTML = `<p>
      Each night's score only uses the scans that landed in the group you are viewing, and most nights are
      missing some: <b>${int(partialNights)} of ${int(nights.n)} ${splitWord} nights are incomplete</b>, with a
      typical night keeping <b>${(100 * medianCoverage).toFixed(0)}%</b> of its labelled scans. Taking the biggest
      swarm is especially unfair when nights have different numbers of scans; taking the average still depends
      on which scans are missing.
      ${state.split === 'test'
        ? `On top of that, <b>${int(valTestOverlap)} of ${int(nights.n)} test nights also show up in validation</b>,
           so the cut-off and the test results share the same nights.`
        : `These are also the nights the cut-off was chosen on, and ${int(valTestOverlap)} of them show up in the
           test group as well.`}
      And ${int(exposure.nights_seen_in_train)} of ${int(exposure.nights_total)} were seen during training.
      <b>So this is not a test on genuinely new nights.</b> To do that properly, the data would have to be
      re-split so no night appears in more than one group, the model retrained, and every held-out night
      predicted at a steady cadence.
    </p>`;

    const scanRule = state.scanOperating === 'any'
      ? `the simple rule "1 predicted cell or more"`
      : `the tuned rule "${area(selectedScanCutoff.cells)} predicted cells or more" (${km2(selectedScanCutoff.km2)} km²)`;
    mount.querySelector('#scan-cutoff-option').textContent = `${area(selectedScanCutoff.cells)} cells or more`;
    mount.querySelector('#scan-method').innerHTML = `${esc(model.display_name)} calls a cell budworm when it is
      at least <b>${model.pixel_probability_threshold}</b> sure, then counts those cells. The numbers below say
      yes using ${scanRule}.`;
    mount.querySelector('#scan-glance').innerHTML = `With that rule, the model catches
      <b>${int(scanMetrics.confusion.tp)} of the ${int(scanMetrics.n_positive)} scans that do have budworm</b>, and correctly
      clears <b>${int(scanMetrics.confusion.tn)} of the ${int(scanMetrics.n_negative)} that do not</b>.`;
    mount.querySelector('#scan-cards').innerHTML = metricCards(scans, scanMetrics, 'scans');
    mount.querySelector('#scan-roc').innerHTML = rocSvg(scans, scanMetrics, 'Scan-level presence');
    mount.querySelector('#scan-roc-cap').innerHTML = `Sliding the cut-off from strict to loose traces this
      curve; the area under it is <b>${rate(scans.roc.auc)}</b> over ${int(scans.n)} ${splitWord} scans. It shows how well
      the model ranks scans, not which cut-off to use.`;
    mount.querySelector('#scan-confusion').innerHTML = confusion({
      ...scanMetrics.confusion, unit: 'scans', positiveLabel: 'budworm', negativeLabel: 'none',
      title: `${splitLabel(state.split)} scans: what the model said vs. the truth`,
    });
    mount.querySelector('#scan-confusion-cap').innerHTML = `${splitLabel(state.split)}, using ${scanRule}:
      ${int(scanMetrics.n_positive)} scans with budworm and ${int(scanMetrics.n_negative)} without.`;
    mount.querySelector('#scan-comparison').innerHTML = comparisonTable(scans);

    mount.querySelector('#night-method').innerHTML = `A night really had budworm if <b>any</b> of its labelled
      scans, noon to noon UTC, contains some. The model's number for that night is its
      <b>${aggLabel(state.nightAggregation)}</b> predicted swarm across the ${splitWord} scans available. The night is
      called a migration when that number reaches
      <b>${area(selectedNightCutoff.cells)} cells (${km2(selectedNightCutoff.km2)} km&sup2;)</b>, a cut-off chosen on the
      validation nights.`;
    mount.querySelector('#night-glance').innerHTML = `With that cut-off, the model catches
      <b>${int(nightMetrics.confusion.tp)} of the ${int(nightMetrics.n_positive)} migration nights</b>, and correctly clears
      <b>${int(nightMetrics.confusion.tn)} of the ${int(nightMetrics.n_negative)} quiet nights</b>.`;
    mount.querySelector('#night-cards').innerHTML = metricCards(nights, nightMetrics, 'nights');

    const groups = distributionGroups(nights).map((group, i) => ({
      ...group, c: i === 0 ? 'var(--tn)' : 'var(--accent2)',
    }));
    const yhi = Math.max(1, ...groups.flatMap(group => [group.hi ?? 0, group.mean ?? 0])) * 1.05;
    mount.querySelector('#night-dist').innerHTML = boxPlot({
      groups, ylo: 0, yhi, logy: true,
      ylabel: `${aggLabel(state.nightAggregation)} predicted swarm (cells)`,
      xlabel: 'what actually happened that night', W: 520, H: 330,
      aria: `${aggLabel(state.nightAggregation)} predicted swarm size for quiet and migration nights, on a logarithmic scale`,
    });
    const neg = nights.score_summary.negative, pos = nights.score_summary.positive;
    mount.querySelector('#night-dist-cap').innerHTML = `A typical quiet night scores
      <b>${area(neg.median)} cells (${km2(cellsToKm2(doc, neg.median))} km&sup2;)</b>; a typical migration night scores
      <b>${area(pos.median)} cells (${km2(cellsToKm2(doc, pos.median))} km&sup2;)</b>. The further apart the two boxes sit,
      the easier the two kinds of night are to tell apart. The vertical axis is squashed logarithmically so
      that nights scoring zero still show up.`;
    mount.querySelector('#night-roc').innerHTML = rocSvg(nights, nightMetrics, 'Night-level migration presence');
    mount.querySelector('#night-roc-cap').innerHTML = `Area under the night curve is <b>${rate(nights.roc.auc)}</b>
      (${int(nights.n_positive)} migration and ${int(nights.n_negative)} quiet ${splitWord} nights). The orange dot marks where the
      tuned cut-off actually lands.`;

    const mw = nights.mann_whitney;
    mount.querySelector('#night-mw').innerHTML = `<p class="presence-scroll-hint">Scroll sideways to see every number.</p>
      <div class="tscroll" tabindex="0" role="region" aria-label="Night distribution test table"><table><thead><tr>
      <th>Night score</th><th>Migration nights</th><th>Quiet nights</th><th>Typical migration night (cells)</th>
      <th>Typical quiet night (cells)</th><th>Mann&ndash;Whitney U</th><th>p-value</th>
      <th>Chance of ranking correctly</th></tr></thead><tbody><tr>
      <td>${esc(aggLabel(state.nightAggregation))} predicted swarm</td>
      <td class="n">${int(mw.n_positive)}</td><td class="n">${int(mw.n_negative)}</td>
      <td class="n">${area(pos.median)}</td><td class="n">${area(neg.median)}</td>
      <td class="n">${area(mw.u)}</td><td class="n">${pValue(mw.p_value)}</td>
      <td class="n">${rate(mw.common_language_auc)}</td></tr></tbody></table></div>
      <p class="small">The Mann&ndash;Whitney test asks whether migration nights really score higher than quiet
      ones, without assuming the scores follow a bell curve. A small p-value means the gap is unlikely to be luck.
      The last column is the chance that a randomly picked migration night scores higher than a randomly picked
      quiet one. Because many nights overlap and are incomplete, treat this as a guide rather than proof.</p>`;

    mount.querySelector('#night-confusion').innerHTML = confusion({
      ...nightMetrics.confusion, unit: 'nights', positiveLabel: 'migration', negativeLabel: 'quiet',
      title: `${splitLabel(state.split)} nights: what the model said vs. the truth`,
    });
    mount.querySelector('#night-confusion-cap').innerHTML = `${splitLabel(state.split)}: how ${int(nightMetrics.n)} nights
      were called, scoring each by its ${aggLabel(state.nightAggregation)} predicted swarm and using the tuned cut-off.`;
    mount.querySelector('#night-cutoff').innerHTML = `<h3 style="margin-top:0">The cut-off being used</h3>
      <div class="presence-cutoff"><b>${area(selectedNightCutoff.cells)}</b> cells
        <span>${km2(selectedNightCutoff.km2)} km&sup2;</span></div>
      <p class="small">Score this much or more and the night is called a migration. This value was picked on the
      validation nights as the one that catches the most migrations while raising the fewest false alarms
      (it caught ${rate(selectedNightCutoff.validation_sensitivity)} of migration nights and cleared
      ${rate(selectedNightCutoff.validation_specificity)} of quiet ones there).</p>
      <p class="small">This is a different setting from how sure the model must be about a single cell,
      which stays at ${model.pixel_probability_threshold}.</p>`;

    const rows = nightTableRows(nights, nightMetrics.cutoff).map(row => ({
      ...row, score_km2: cellsToKm2(doc, row.score),
    }));
    new DataTable(mount.querySelector('#night-table'), {
      rows, pageSize: 25, sort: 'night_id', dir: -1,
      rowClass: row => row.outcome === 'FP' || row.outcome === 'FN' ? 'presence-error' : '',
      columns: [
        {key: 'night_id', label: 'Night (UTC, noon to noon)', fmt: value => `<code>${esc(nightRange(value))}</code>`},
        {key: 'truth', label: 'What really happened', fmt: value => value ? 'migration' : 'quiet'},
        {key: 'coverage_fraction', label: 'Scans available', fmt: (value, row) =>
          `${int(row.evaluated_scan_count)} of ${int(row.manifest_scan_count)} <span class="small">(${(100 * value).toFixed(0)}%)</span>`},
        {key: 'score', label: `${aggLabel(state.nightAggregation)} predicted swarm`, fmt: (value, row) =>
          `${area(value)} <span class="small">cells · ${km2(row.score_km2)} km&sup2;</span>`},
        {key: 'predicted', label: 'What the model said', fmt: value => value ? 'migration' : 'quiet'},
        {key: 'outcome', label: 'Right or wrong', fmt: value =>
          `<span class="presence-outcome ${value.toLowerCase()}">${esc(value)}</span>`},
        {key: 'seen_in_train', label: 'Also used in training', fmt: value => value
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
  mount.querySelectorAll('input[name="presence-split"]').forEach(input =>
    input.addEventListener('change', event => { state.split = event.target.value; draw(); }));
  mount.querySelectorAll('input[name="scan-operating"]').forEach(input =>
    input.addEventListener('change', event => { state.scanOperating = event.target.value; draw(); }));
  mount.querySelectorAll('input[name="night-aggregation"]').forEach(input =>
    input.addEventListener('change', event => { state.nightAggregation = event.target.value; draw(); }));

  draw();
}
