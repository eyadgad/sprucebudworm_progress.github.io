/* Tests for the chart primitives.
   Run:  node assets/js/lib/charts.test.js     (from the site folder)

   Two classes of problem are covered, both found in review:
     1. charts rendered without an axis label, so the reader could not tell what
        a bar length or a box position meant;
     2. degenerate inputs (all-zero, empty, single category) collapsing the
        scale to NaN and silently blanking the figure.
   Labels are also checked to stay inside the viewBox, since the SVG is set to
   overflow:visible and a too-long title would spill over the panel edge. */

import { barChart, boxPlot, hBarChart, lineChart, scatter, histogram,
         confusion, parallel, legend, ticks, BOXPLOT_KEY } from './charts.js';

let fails = 0, ran = 0;
const ok = (name, cond, detail = '') => {
  ran++;
  if (!cond) { fails++; console.log(`  FAIL  ${name}  ${detail}`); }
  else console.log(`  PASS  ${name}`);
};

const CHAR_W = 6.2;                       // ~11px mono/sans in these figures
const clean = s => !/NaN|Infinity|undefined/.test(s);
const hasXLabel = s => /class="axlab"(?![^>]*rotate)/.test(s) ||
  /<text[^>]*class="axlab"[^>]*>/.test(s.replace(/<text[^>]*transform="[^"]*rotate[^"]*"[^>]*>.*?<\/text>/g, ''));
const hasYLabel = s => /transform="translate\([^)]*\) rotate\(-90\)"[^>]*class="axlab"/.test(s);

/** Every non-rotated label must sit inside the viewBox. */
function overflow(svg) {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb) return ['no viewBox'];
  const W = +vb[1], H = +vb[2], bad = [];
  const re = /<text([^>]*)>([^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const at = m[1], txt = m[2];
    if (!txt.trim() || /rotate/.test(at)) continue;
    const x = +(at.match(/ x="([-\d.]+)"/)?.[1] ?? NaN);
    const y = +(at.match(/ y="([-\d.]+)"/)?.[1] ?? NaN);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    const anchor = (at.match(/text-anchor="(\w+)"/) || [])[1] || 'start';
    const w = txt.length * CHAR_W;
    const l = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    if (l < -1) bad.push(`"${txt.slice(0, 20)}" off left`);
    if (l + w > W + 1) bad.push(`"${txt.slice(0, 20)}" off right`);
    if (y > H + 1) bad.push(`"${txt.slice(0, 20)}" below`);
  }
  return bad;
}

console.log('chart primitives');

/* ---------------- axis labelling ---------------- */
console.log('\n[axis labels]');
const bar = barChart({cats: ['train', 'val', 'test'],
  series: [{label: 'with plume', c: '#1', values: [1092, 317, 170]},
           {label: 'plume free', c: '#2', values: [345, 94, 34]}],
  stacked: true, ylabel: 'scenes', xlabel: 'data split', W: 420, H: 300, inlineLegend: true});
ok('barChart renders the x-axis label', bar.includes('data split'));
ok('barChart renders the y-axis label', bar.includes('scenes') && hasYLabel(bar));
ok('barChart inline legend names every series',
   bar.includes('with plume') && bar.includes('plume free'));

const box = boxPlot({groups: [{label: '5k–20k', n: 54, lo: .2, q1: .4, med: .53, q3: .66, hi: .8, mean: .53, c: '#1'}],
  ylo: 0, yhi: 1, ylabel: 'per-scene Dice', xlabel: 'plume area', W: 880, H: 340});
ok('boxPlot renders the x-axis label', box.includes('plume area'));
ok('boxPlot renders the y-axis label', hasYLabel(box));
ok('boxPlot prints the group size', box.includes('n=54'));
ok('a shared box-plot key exists', BOXPLOT_KEY.includes('interquartile') && BOXPLOT_KEY.includes('median'));

// a "\n" in a group label must become two <text> lines, never a literal newline
const box2 = boxPlot({groups: [{label: 'Dice\nval', n: 317, lo: .2, q1: .5, med: .71, q3: .79, hi: .9, mean: .63, c: '#1'},
                                {label: 'Dice\ntest', n: 170, lo: .2, q1: .5, med: .71, q3: .79, hi: .9, mean: .63, c: '#2'}],
  ylo: 0, yhi: 1, ylabel: 'per-scene value', xlabel: 'metric and split', W: 880, H: 350});
ok('multi-line box label has no literal newline in any text node',
   ![...box2.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].some(m => m[1].includes('\n')));
ok('multi-line box label renders both lines', /<text[^>]*>Dice<\/text>/.test(box2) &&
   /<text[^>]*>val<\/text>/.test(box2) && /<text[^>]*>test<\/text>/.test(box2));
ok('multi-line box: n= line does not collide with the x-axis title', (() => {
  const ys = t => [...box2.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g)]
    .filter(m => t.test(m[2])).map(m => +m[1]);
  const nY = Math.max(...ys(/^n=/)), xlY = ys(/metric and split/)[0];
  return xlY > nY;
})());

const hbar = hBarChart({items: [{label: 'Attention UNet · 9 elev', value: .6347, hl: true}],
  lo: .6, hi: .645, labelW: 210, xlabel: 'test Dice (macro)'});
ok('hBarChart renders an axis label', hbar.includes('test Dice (macro)'));

const par = parallel({dims: [{label: 'Dice', lo: .48, hi: .65}, {label: 'Recall', lo: .4, hi: .9},
                             {label: 'Few false alarms', lo: .013, hi: 0}],
  rows: [{label: 'r', c: '#1', hl: true, values: [.6, .7, .005]}]});
ok('parallel explains how to read it', par.includes('higher on every axis is better'));
ok('parallel anchors its outer axis titles inward',
   par.includes('text-anchor="start"') && par.includes('text-anchor="end"'));

for (const [name, svg] of [
  ['lineChart', lineChart({series: [{label: 'Dice', c: '#1', points: [[0, .5], [1, .6]]}],
    xlo: 0, xhi: 1, ylo: 0, yhi: 1, xlabel: 'threshold', ylabel: 'metric'})],
  ['scatter', scatter({points: [{x: 1, y: .5}], xlo: 0, xhi: 2, ylo: 0, yhi: 1,
    xlabel: 'plume area', ylabel: 'Dice'})],
  ['histogram', histogram({bins: [0, .5, 1], counts: [1, 2, 3], xlabel: 'probability', ylabel: 'pixels'})],
]) {
  ok(`${name} carries both axis labels`, svg.includes('axlab') && hasYLabel(svg));
}

/* ---------------- accessibility ---------------- */
console.log('\n[accessibility]');
for (const [name, svg] of [['barChart', bar], ['boxPlot', box], ['hBarChart', hbar], ['parallel', par],
  ['confusion', confusion({tp: 1, fp: 2, fn: 3, tn: 4})]]) {
  ok(`${name} has an aria-label`, /role="img" aria-label="[^"]+"/.test(svg));
}
ok('confusion labels every quadrant in text',
   ['TP', 'FP', 'FN', 'TN'].every(k => confusion({tp: 1, fp: 1, fn: 1, tn: 1}).includes(`>${k}<`)));
ok('legend pairs each colour with a text label',
   /class="sw"[^>]*background:#1[^>]*><\/span>only/.test(legend([{c: '#1', label: 'only'}]).replace(/\s+/g, '')));

/* ---------------- no overflow ---------------- */
console.log('\n[labels stay inside the viewBox]');
for (const [name, svg] of [['barChart', bar], ['boxPlot', box], ['hBarChart', hbar], ['parallel', par],
  ['barChart 24 categories', barChart({cats: Array.from({length: 24}, (_, i) => String(i).padStart(2, '0')),
    series: [{label: 's', c: '#1', values: Array(24).fill(50)}], ylabel: 'scenes',
    xlabel: 'hour of day (UTC)', W: 880, H: 280})]]) {
  const bad = overflow(svg);
  ok(`${name} keeps all labels inside`, bad.length === 0, bad.slice(0, 2).join('; '));
}

/* ---------------- degenerate inputs ---------------- */
console.log('\n[degenerate inputs do not blank the figure]');
const edge = [
  ['all-zero bars', barChart({cats: ['a', 'b'], series: [{label: 'x', c: '#1', values: [0, 0]}], ylabel: 'n', xlabel: 'g'})],
  ['all-null bars', barChart({cats: ['a', 'b'], series: [{label: 'x', c: '#1', values: [null, null]}], ylabel: 'n', xlabel: 'g'})],
  ['single category', barChart({cats: ['only'], series: [{label: 'x', c: '#1', values: [5]}], ylabel: 'n', xlabel: 'g'})],
  ['empty box group', boxPlot({groups: [{label: 'e', n: 0, q1: null, c: '#1'}], ylo: 0, yhi: 1, ylabel: 'y', xlabel: 'x'})],
  ['null bar value', hBarChart({items: [{label: 'a', value: null}], lo: 0, hi: 1, xlabel: 'v'})],
  ['empty line series', lineChart({series: [{label: 'a', c: '#1', points: []}], xlo: 0, xhi: 1, ylo: 0, yhi: 1, xlabel: 'x', ylabel: 'y'})],
  ['no scatter points', scatter({points: [], xlo: 0, xhi: 1, ylo: 0, yhi: 1, xlabel: 'x', ylabel: 'y'})],
  ['zero histogram', histogram({bins: [0, 1], counts: [0, 0], xlabel: 'x', ylabel: 'y'})],
  ['zero confusion', confusion({tp: 0, fp: 0, fn: 0, tn: 0})],
];
edge.forEach(([n, svg]) => ok(`${n}: no NaN in output`, clean(svg)));
ok('empty-bar chart still shows an axis line', edge[0][1].includes('<line'));
ok('null bar value is announced, not silently dropped',
   edge[4][1].includes('not available'));

/* ---------------- axis ticks ---------------- */
console.log('\n[tick generation]');
ok('ticks span the range', (() => { const t = ticks(0, 1, 5); return t[0] <= 0.001 && t.at(-1) >= 0.999; })());
ok('ticks are evenly spaced', (() => {
  const t = ticks(0, 100, 5), d = t.slice(1).map((v, i) => +(v - t[i]).toFixed(6));
  return new Set(d).size === 1;
})());
ok('degenerate range does not hang', ticks(5, 5).length >= 1);

console.log('\n' + '-'.repeat(54));
console.log(fails ? `FAILED: ${fails} of ${ran}` : `all ${ran} checks passed`);
process.exit(fails ? 1 : 0);
