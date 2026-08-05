/* Tests for the shared statistics/formatting helpers.
   Run:  node assets/js/lib/metrics.test.js     (from the site folder)

   These functions produce numbers the dashboard presents as findings, so a
   silent regression here would mean publishing wrong statistics. */

import { mean, std, quantile, bootCI, wilcoxon, pearson, spearman,
         fmt, fmtOr, pct, int, esc, targetName, tsLabel, hhmm, M } from './metrics.js';

let fails = 0, ran = 0;
const ok = (name, cond, detail = '') => {
  ran++;
  if (!cond) { fails++; console.log(`  FAIL  ${name}  ${detail}`); }
  else console.log(`  PASS  ${name}`);
};
const near = (a, b, tol = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= tol;

console.log('metrics.js helpers');

/* ---- basic statistics against hand-computed values ---- */
console.log('\n[descriptive]');
ok('mean', near(mean([1, 2, 3, 4]), 2.5));
ok('mean of empty is null', mean([]) === null);
ok('std (sample, n-1)', near(std([2, 4, 4, 4, 5, 5, 7, 9]), 2.13808993529939, 1e-12));
ok('std needs 2 points', std([1]) === null);
ok('quantile median odd', near(quantile([3, 1, 2], 0.5), 2));
ok('quantile median even interpolates', near(quantile([1, 2, 3, 4], 0.5), 2.5));
ok('quantile q1', near(quantile([1, 2, 3, 4, 5], 0.25), 2));
ok('quantile does not mutate input', (() => {
  const a = [3, 1, 2]; quantile(a, 0.5); return a[0] === 3;
})());
ok('quantile of empty is null', quantile([], 0.5) === null);

/* ---- correlation ---- */
console.log('\n[correlation]');
ok('pearson perfect positive', near(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12));
ok('pearson perfect negative', near(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1, 1e-12));
ok('spearman handles monotone non-linear', near(spearman([1, 2, 3, 4], [1, 4, 9, 16]), 1, 1e-12));
ok('spearman < pearson on curved data',
   spearman([1, 2, 3, 4], [1, 4, 9, 16]) > pearson([1, 2, 3, 4], [1, 4, 9, 16]));
ok('correlation of constant is null-safe',
   pearson([1, 1, 1, 1], [1, 2, 3, 4]) === null);
ok('too few points -> null', pearson([1, 2], [1, 2]) === null);

/* ---- bootstrap ---- */
console.log('\n[bootstrap]');
const sample = Array.from({length: 60}, (_, i) => (i % 10) / 10);
const ci1 = bootCI(sample), ci2 = bootCI(sample);
ok('returns [lo, hi]', Array.isArray(ci1) && ci1.length === 2);
ok('is deterministic across calls', ci1[0] === ci2[0] && ci1[1] === ci2[1], `${ci1} vs ${ci2}`);
ok('brackets the sample mean', ci1[0] <= mean(sample) && mean(sample) <= ci1[1], `${ci1} vs ${mean(sample)}`);
ok('lo < hi', ci1[0] < ci1[1]);
ok('narrows as n grows', (() => {
  const small = bootCI(sample.slice(0, 10));
  const big = bootCI([...sample, ...sample, ...sample, ...sample]);
  return (big[1] - big[0]) < (small[1] - small[0]);
})());
ok('too few points -> null', bootCI([1, 2]) === null);
ok('constant data -> zero-width interval', (() => {
  const c = bootCI(new Array(30).fill(0.5));
  return near(c[0], 0.5) && near(c[1], 0.5);
})());

/* ---- wilcoxon ---- */
console.log('\n[wilcoxon signed-rank]');
const a = [0.5, 0.6, 0.7, 0.8, 0.9, 0.55, 0.65, 0.75, 0.85, 0.95];
ok('identical inputs -> null (no non-zero differences)', wilcoxon(a, [...a]) === null);
const shifted = a.map(v => v - 0.1);
const w = wilcoxon(a, shifted);
ok('detects a consistent shift', w !== null && w.p < 0.01, JSON.stringify(w));
ok('reports n of differing pairs', w && w.n === 10, w && w.n);
ok('p is bounded in (0,1]', w && w.p > 0 && w.p <= 1, w && w.p);
ok('symmetric magnitude of z', (() => {
  const w2 = wilcoxon(shifted, a);
  return near(Math.abs(w.z), Math.abs(w2.z), 1e-9);
})());
ok('too few pairs -> null', wilcoxon([1, 2, 3], [3, 2, 1]) === null);

/* ---- formatting ---- */
console.log('\n[formatting]');
ok('fmt uses the metric decimal places', fmt(0.63472, 'dice') === '0.635');
ok('fmt of pixel counts is grouped', fmt(1234567, 'tp') === '1,234,567');
ok('fmt null -> null', fmt(null, 'dice') === null);
ok('fmt NaN -> null', fmt(NaN, 'dice') === null);
ok('fmtOr falls back to a dash', fmtOr(null, 'dice') === '—');
ok('pct', pct(0.5885, 0) === '59%');
ok('pct null', pct(null) === '—');
ok('int', int(1579) === '1,579');
ok('esc neutralises HTML', esc('<img src=x onerror=1>') === '&lt;img src=x onerror=1&gt;');
ok('esc handles quotes', esc(`"a"&'b'`) === '&quot;a&quot;&amp;&#39;b&#39;');

/* ---- domain helpers ---- */
console.log('\n[domain]');
ok('targetName isfinite', targetName('isfinite', 0) === 'any echo');
ok('targetName dbz0', targetName('threshold', 0) === 'dBZ ≥ 0');
ok('targetName dbz5', targetName('threshold', 5) === 'dBZ ≥ 5');
ok('tsLabel formats a 12-digit stamp', tsLabel(201907240030) === '2019-07-24 00:30');
ok('hhmm extracts the time', hhmm(201907240030) === '00:30');

/* ---- registry integrity ---- */
console.log('\n[metric registry]');
ok('every metric has a definition', Object.values(M).every(m => m.def && m.def.length > 10));
ok('every metric has a formula', Object.values(M).every(m => m.formula && m.formula.length > 2));
ok('every metric has a label', Object.values(M).every(m => m.label));
ok('direction is set for scored metrics',
   ['dice', 'iou', 'precision', 'recall', 'hd95', 'assd', 'bg_fp_rate'].every(k => typeof M[k].hi === 'boolean'));
ok('lower-is-better flags are correct',
   M.hd95.hi === false && M.assd.hi === false && M.bg_fp_rate.hi === false && M.fp.hi === false);
ok('higher-is-better flags are correct',
   M.dice.hi === true && M.recall.hi === true && M.tp.hi === true);

console.log('\n' + '-'.repeat(56));
console.log(fails ? `FAILED: ${fails} of ${ran}` : `all ${ran} checks passed`);
process.exit(fails ? 1 : 0);
