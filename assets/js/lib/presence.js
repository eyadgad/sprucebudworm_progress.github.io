/* View-model helpers for the precomputed scan/night presence analysis.

   The statistical work lives in the segmentation export pipeline and is
   delivered as data/presence.json.  This module deliberately limits itself to
   validating that contract and adapting it for controls, charts and tables;
   it does not silently re-fit thresholds or recompute inferential statistics
   in the browser. */

const fail = message => { throw new Error(`presence.json: ${message}`); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function requireAnalysis(value, path, {records = false, mannWhitney = false} = {}) {
  if (!object(value)) fail(`${path} is missing`);
  for (const key of ['n', 'n_positive', 'n_negative']) {
    if (!Number.isInteger(value[key]) || value[key] < 0) fail(`${path}.${key} must be a non-negative integer`);
  }
  if (value.n_positive + value.n_negative !== value.n) fail(`${path} class counts do not sum to n`);
  if (!object(value.roc) || !Array.isArray(value.roc.points)) fail(`${path}.roc.points is missing`);
  if (mannWhitney && !object(value.mann_whitney)) fail(`${path}.mann_whitney is missing`);
  if (!object(value.score_summary?.positive) || !object(value.score_summary?.negative))
    fail(`${path}.score_summary is missing`);
  for (const op of ['any_cell', 'validation_selected']) {
    const metrics = value.operating_points?.[op];
    if (!object(metrics) || !object(metrics.confusion) || !finite(metrics.cutoff))
      fail(`${path}.operating_points.${op} is invalid`);
  }
  if (records && !Array.isArray(value.records)) fail(`${path}.records is missing`);
}

/** Validate and return a supported presence document. */
export function validatePresence(doc) {
  if (!object(doc)) fail('root must be an object');
  if (doc.schema_version !== 1) fail(`unsupported schema_version ${doc.schema_version ?? 'missing'}`);
  if (!object(doc.definitions) || !finite(doc.definitions.pixel_size_m) || doc.definitions.pixel_size_m <= 0 ||
      !finite(doc.definitions.pixel_area_km2) ||
      doc.definitions.pixel_area_km2 <= 0) fail('pixel dimensions are invalid');
  if (!object(doc.cohort) || !object(doc.cohort.training_exposure) ||
      !object(doc.cohort.training_exposure.val) || !object(doc.cohort.training_exposure.test) ||
      !Number.isInteger(doc.cohort.night_overlap?.validation_test) ||
      doc.cohort.night_overlap.validation_test < 0) fail('cohort metadata is missing');
  if (!Array.isArray(doc.caveats) || !doc.caveats.length) fail('caveats are missing');
  if (!Array.isArray(doc.models) || !doc.models.length) fail('models are missing');
  if (!doc.selected_model_key) fail('selected_model_key is missing');
  if (!object(doc.defaults) || !['test', 'val'].includes(doc.defaults.split) ||
      !['max', 'mean'].includes(doc.defaults.night_aggregation) ||
      !['any_cell', 'validation_selected'].includes(doc.defaults.scan_operating_point) ||
      doc.defaults.night_operating_point !== 'validation_selected')
    fail('defaults are missing or unsupported');

  const seen = new Set();
  doc.models.forEach((model, index) => {
    const path = `models[${index}]`;
    if (!model.key || seen.has(model.key)) fail(`${path}.key is missing or duplicated`);
    seen.add(model.key);
    if (!model.display_name || !finite(model.pixel_probability_threshold))
      fail(`${path} display name or pixel threshold is invalid`);
    if (!object(model.scan?.selected_cutoff) || !finite(model.scan.selected_cutoff.cells))
      fail(`${path}.scan.selected_cutoff is invalid`);
    for (const split of ['validation', 'test'])
      requireAnalysis(model.scan?.splits?.[split], `${path}.scan.splits.${split}`);
    for (const aggregation of ['max', 'mean']) {
      const night = model.night?.[aggregation];
      if (!object(night?.selected_cutoff) || !finite(night.selected_cutoff.cells))
        fail(`${path}.night.${aggregation}.selected_cutoff is invalid`);
      for (const split of ['validation', 'test'])
        requireAnalysis(night.splits?.[split], `${path}.night.${aggregation}.splits.${split}`,
          {records: true, mannWhitney: true});
    }
  });
  if (!seen.has(doc.selected_model_key)) fail('selected_model_key does not match a model');
  if (doc.defaults?.model_key && doc.defaults.model_key !== doc.selected_model_key)
    fail('defaults.model_key does not match selected_model_key');
  return doc;
}

export const splitKey = value => value === 'val' ? 'validation' : value;

export function findModel(doc, key) {
  const model = doc.models.find(item => item.key === key);
  if (!model) fail(`model ${key} is not present`);
  return model;
}

export function scanAnalysis(model, split) {
  return model.scan.splits[splitKey(split)];
}

export function nightAnalysis(model, aggregation, split) {
  const value = model.night?.[aggregation]?.splits?.[splitKey(split)];
  if (!value) fail(`night analysis ${aggregation}/${split} is not present`);
  return value;
}

export function operatingPoint(analysis, mode) {
  const key = mode === 'any' ? 'any_cell' : 'validation_selected';
  const value = analysis.operating_points[key];
  if (!value) fail(`operating point ${key} is not present`);
  return value;
}

/** Points are already tie-collapsed and ordered by the exporter. */
export function rocPoints(analysis) {
  return analysis.roc.points
    .filter(point => finite(point.false_positive_rate) && finite(point.true_positive_rate))
    .map(point => [point.false_positive_rate, point.true_positive_rate]);
}

/** Adapt the exporter's real-unit five-number summaries to charts.boxPlot. */
export function distributionGroups(analysis) {
  const build = (key, label) => {
    const s = analysis.score_summary[key];
    return {
      label, n: s.n,
      lo: s.p05 ?? s.lo ?? s.min,
      q1: s.q1,
      med: s.median,
      q3: s.q3,
      hi: s.p95 ?? s.hi ?? s.max,
      mean: s.mean,
    };
  };
  return [build('negative', 'SBW free'), build('positive', 'SBW present')];
}

export function cellsToKm2(doc, cells) {
  return finite(cells) ? cells * doc.definitions.pixel_area_km2 : null;
}

export function outcome(truth, score, cutoff) {
  const predicted = score >= cutoff;
  if (truth) return predicted ? 'TP' : 'FN';
  return predicted ? 'FP' : 'TN';
}

export function nightTableRows(analysis, cutoff) {
  return analysis.records.map(record => ({
    ...record,
    predicted: record.score >= cutoff ? 1 : 0,
    outcome: outcome(Boolean(record.truth), record.score, cutoff),
  }));
}
