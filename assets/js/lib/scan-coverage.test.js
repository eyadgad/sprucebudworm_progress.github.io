/* Tests for the exact scan-assignment coverage chart.
   Run in Node: node assets/js/lib/scan-coverage.test.js
   Run in a browser: import this module and call runScanCoverageTests(). */

import { NIGHT_SLOTS, SCENE_TYPE_COLOR, SPLIT_MARKER_COLOR,
  scanCoverageChart, scanCoverageModel } from './scan-coverage.js';

export function runScanCoverageTests() {
  const results = [];
  const ok = (name, condition, detail = '') =>
    results.push({name, ok: Boolean(condition), detail});

  const scenes = [
    {ts: 201907022330, year: 2019, date: 20190702, hour: 23, split: 'train', label: 1},
    {ts: 201907030000, year: 2019, date: 20190703, hour: 0, split: 'val', label: 0},
    {ts: 201907030030, year: 2019, date: 20190703, hour: 0, split: 'test', label: 1},
    {ts: 201907050000, year: 2019, date: 20190705, hour: 0, split: 'train', label: 0},
    {ts: 201807030000, year: 2018, date: 20180703, hour: 0, split: 'train', label: 1},
  ];
  const model = scanCoverageModel(scenes, 2019);
  const {svg} = scanCoverageChart(scenes, 2019);
  const group = ts => svg.match(new RegExp(`<g class="coverage-scan" data-ts="${ts}"[\\s\\S]*?</g>`))?.[0] || '';
  const hasRectFill = (g, colour) => new RegExp(`<rect[^>]*fill="${colour}"`).test(g);
  const hasCircleFill = (g, colour) => new RegExp(`<circle[^>]*fill="${colour}"`).test(g);

  ok('night axis has every half-hour from 19:00 through 11:00',
    NIGHT_SLOTS.length === 33 && NIGHT_SLOTS[0].key === '1900' && NIGHT_SLOTS.at(-1).key === '1100');
  ok('midnight follows 23:30', NIGHT_SLOTS[9].key === '2330' && NIGHT_SLOTS[10].key === '0000');
  ok('calendar range includes dates with no assigned scans',
    model.dates.join(',') === '20190705,20190704,20190703,20190702');
  ok('preserves :00 and :30 as separate cells',
    model.cells.find(c => c.slot === '0000').col + 1 === model.cells.find(c => c.slot === '0030').col);
  ok('counts every split exactly',
    model.counts.train === 2 && model.counts.val === 1 && model.counts.test === 1);
  ok('renders exactly one SVG group per scan', (svg.match(/class="coverage-scan"/g) || []).length === 4);
  ok('renders one split circle inside every scan box',
    (svg.match(/class="coverage-split-marker"/g) || []).length === 4 &&
    [201907022330, 201907030000, 201907030030, 201907050000].every(ts =>
      (group(ts).match(/<rect /g) || []).length === 1 && (group(ts).match(/<circle /g) || []).length === 1));
  ok('with-swarm boxes are green and swarm-free boxes are blue',
    hasRectFill(group(201907022330), SCENE_TYPE_COLOR.positive) &&
    hasRectFill(group(201907030030), SCENE_TYPE_COLOR.positive) &&
    hasRectFill(group(201907030000), SCENE_TYPE_COLOR.negative) &&
    hasRectFill(group(201907050000), SCENE_TYPE_COLOR.negative));
  ok('circle colours encode train, validation, and test independently of box fill',
    hasCircleFill(group(201907022330), SPLIT_MARKER_COLOR.train) &&
    hasCircleFill(group(201907050000), SPLIT_MARKER_COLOR.train) &&
    hasCircleFill(group(201907030000), SPLIT_MARKER_COLOR.val) &&
    hasCircleFill(group(201907030030), SPLIT_MARKER_COLOR.test));
  ok('tooltips contain exact time, split, and type',
    svg.includes('2019-07-03 00:30 UTC — test — with swarm'));
  ok('chart has an accessible name and description',
    svg.includes('role="img" aria-labelledby=') &&
    svg.includes('Green boxes contain a spruce budworm swarm and blue boxes are swarm free.') &&
    svg.includes('Each box has a coloured circle giving its train, validation, or test assignment.'));
  ok('obsolete positive-only marker is absent', !svg.includes('coverage-positive'));
  ok('chart output has no invalid numbers', !/NaN|Infinity|undefined/.test(svg));

  let duplicateRejected = false;
  try { scanCoverageModel([...scenes, {...scenes[0], split: 'test'}], 2019); }
  catch (error) { duplicateRejected = /Duplicate scan cell/.test(error.message); }
  ok('duplicate date and half-hour cells are rejected', duplicateRejected);

  let invalidLabelRejected = false;
  try { scanCoverageModel(scenes.map((s, i) => i ? s : {...s, label: 2}), 2019); }
  catch (error) { invalidLabelRejected = /Invalid scene label/.test(error.message); }
  ok('invalid binary labels are rejected', invalidLabelRejected);

  let mismatchRejected = false;
  try { scanCoverageModel(scenes.map((s, i) => i ? s : {...s, date: 20190703}), 2019); }
  catch (error) { mismatchRejected = /metadata mismatch/.test(error.message); }
  ok('timestamp metadata mismatches are rejected', mismatchRejected);

  return {ran: results.length, failed: results.filter(r => !r.ok).length, results};
}

if (typeof process !== 'undefined' && process?.versions?.node) {
  const report = runScanCoverageTests();
  report.results.forEach(r =>
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ${r.detail}`}`));
  console.log(report.failed ? `FAILED: ${report.failed} of ${report.ran}` : `all ${report.ran} checks passed`);
  process.exit(report.failed ? 1 : 0);
}
