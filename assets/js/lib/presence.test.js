/* Contract and view-helper tests for data/presence.json.
   Run: node assets/js/lib/presence.test.js */

import {
  validatePresence, splitKey, findModel, scanAnalysis, nightAnalysis,
  operatingPoint, rocPoints, distributionGroups, cellsToKm2, outcome,
  nightTableRows,
} from './presence.js';

let fails = 0, ran = 0;
const ok = (name, cond, detail = '') => {
  ran++;
  if (!cond) { fails++; console.log(`  FAIL  ${name}  ${detail}`); }
  else console.log(`  PASS  ${name}`);
};
const throws = fn => { try { fn(); return false; } catch { return true; } };

const metrics = cutoff => ({
  cutoff, n: 4, n_positive: 2, n_negative: 2,
  confusion: {tp: 1, fp: 1, fn: 1, tn: 1},
  accuracy: .5, sensitivity: .5, specificity: .5, precision: .5, f1: .5,
});
const analysis = (records = false) => ({
  n: 4, n_positive: 2, n_negative: 2,
  score_summary: {
    positive: {n: 2, min: 10, p05: 11, q1: 12, median: 15, q3: 18, p95: 19, max: 20, mean: 15},
    negative: {n: 2, min: 0, p05: 0, q1: 0, median: 1, q3: 2, p95: 3, max: 4, mean: 1},
  },
  distributions: {positive: [10, 20], negative: [0, 2]},
  roc: {auc: .75, points: [
    {false_positive_rate: 0, true_positive_rate: 0},
    {false_positive_rate: .5, true_positive_rate: .5},
    {false_positive_rate: 1, true_positive_rate: 1},
  ]},
  mann_whitney: {u: 4, p_value: .1},
  operating_points: {any_cell: metrics(1), validation_selected: metrics(7)},
  ...(records ? {records: [
    {night_id: '2019-07-01', split: 'test', truth: 1, score: 10,
     evaluated_scan_count: 2, manifest_scan_count: 8, coverage_fraction: .25, seen_in_train: true},
    {night_id: '2019-07-02', split: 'test', truth: 0, score: 0,
     evaluated_scan_count: 1, manifest_scan_count: 5, coverage_fraction: .2, seen_in_train: false},
  ]} : {}),
});
const cutoff = {cells: 7, km2: 1.75, criterion: 'maximum_youden_j_on_validation'};
const model = {
  key: 'm1', name: 'model-one', display_name: 'Model one', pixel_probability_threshold: .15,
  scan: {selected_cutoff: cutoff, splits: {validation: analysis(), test: analysis()}},
  night: {
    max: {selected_cutoff: cutoff, splits: {validation: analysis(true), test: analysis(true)}},
    mean: {selected_cutoff: cutoff, splits: {validation: analysis(true), test: analysis(true)}},
  },
};
const doc = {
  schema_version: 1,
  selected_model_key: 'm1', defaults: {model_key: 'm1', split: 'test', night_aggregation: 'max',
    scan_operating_point: 'any_cell', night_operating_point: 'validation_selected'},
  definitions: {pixel_size_m: 500, pixel_area_km2: .25},
  cohort: {
    training_exposure: {
      val: {nights_total: 2, nights_seen_in_train: 1},
      test: {nights_total: 2, nights_seen_in_train: 1},
    },
    night_overlap: {validation_test: 1},
  },
  caveats: ['scene split'], models: [model],
};

console.log('presence helpers');
ok('valid schema is accepted', validatePresence(doc) === doc);
ok('unsupported schema is rejected', throws(() => validatePresence({...doc, schema_version: 2})));
ok('unsupported defaults are rejected',
  throws(() => validatePresence({...doc, defaults: {...doc.defaults, scan_operating_point: 'test-tuned'}})));
ok('selected model must be explicit and valid',
  throws(() => validatePresence({...doc, selected_model_key: 'absent'})) &&
  throws(() => validatePresence({...doc, selected_model_key: undefined})));
ok('duplicate model keys are rejected', throws(() => validatePresence({...doc, models: [model, {...model}]})));
ok('cohort uses the val key consumed by the Validation control',
  validatePresence(doc).cohort.training_exposure.val.nights_total === 2 &&
  throws(() => validatePresence({...doc, cohort: {
    ...doc.cohort, training_exposure: {validation: {}, test: {}},
  }})));
ok('broken class counts are rejected', throws(() => validatePresence({...doc, models: [{...model,
  scan: {...model.scan, splits: {...model.scan.splits, test: {...analysis(), n_positive: 3}}}}]})));
const noScanMw = structuredClone(doc);
noScanMw.models[0].scan.splits.test.mann_whitney = null;
ok('scan Mann–Whitney may be omitted because scans cluster within nights',
  validatePresence(noScanMw) === noScanMw);
const noNightMw = structuredClone(doc);
noNightMw.models[0].night.max.splits.test.mann_whitney = null;
ok('night Mann–Whitney remains required', throws(() => validatePresence(noNightMw)));
ok('val maps to the exported validation key', splitKey('val') === 'validation');
ok('model lookup is explicit', findModel(doc, 'm1') === model && throws(() => findModel(doc, 'absent')));
ok('scan and night selectors return precomputed analyses',
  scanAnalysis(model, 'test') === model.scan.splits.test &&
  nightAnalysis(model, 'mean', 'val') === model.night.mean.splits.validation);
ok('operating mode maps to precomputed points',
  operatingPoint(analysis(), 'any').cutoff === 1 && operatingPoint(analysis(), 'selected').cutoff === 7);
ok('ROC adapter preserves ordered points', JSON.stringify(rocPoints(analysis())) === '[[0,0],[0.5,0.5],[1,1]]');
const groups = distributionGroups(analysis());
ok('distribution adapter uses exported 5th/95th percentiles',
  groups[0].lo === 0 && groups[0].hi === 3 && groups[1].med === 15);
ok('cell area conversion stays in real units', cellsToKm2(doc, 7) === 1.75);
ok('all four outcomes are labelled',
  outcome(true, 7, 7) === 'TP' && outcome(true, 6, 7) === 'FN' &&
  outcome(false, 7, 7) === 'FP' && outcome(false, 6, 7) === 'TN');
const rows = nightTableRows(analysis(true), 7);
ok('night rows expose prediction and outcome without changing coverage',
  rows[0].predicted === 1 && rows[0].outcome === 'TP' && rows[0].manifest_scan_count === 8 &&
  rows[1].predicted === 0 && rows[1].outcome === 'TN');

console.log('\n' + '-'.repeat(54));
console.log(fails ? `FAILED: ${fails} of ${ran}` : `all ${ran} checks passed`);
process.exit(fails ? 1 : 0);
