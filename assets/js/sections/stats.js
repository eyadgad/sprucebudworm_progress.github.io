/* Statistical analysis.

   Only tests whose assumptions are defensible for this data are run. Sample
   sizes accompany every statistic, and the night-clustering problem is stated
   because it violates the independence assumption most tests rely on. */

import { load } from '../lib/data.js';
import { fmtOr, tip, esc, mean, std, quantile, bootCI, wilcoxon, pearson, spearman } from '../lib/metrics.js';
import { scatter, histogram } from '../lib/charts.js';
import { sceneFilters } from '../lib/ui.js';

export async function render(mount) {
  const [sm, ds] = await Promise.all([load('samples'), load('summary')]);

  mount.innerHTML = `
  <h1>Statistical analysis</h1>
  <p class="lede">Distributions, intervals and paired comparisons behind the headline numbers, with the
  sample size for every statistic and an explicit statement of what the tests cannot support.</p>

  <div class="note warn"><span class="tag">assumption violated</span><div class="bd">
    Most standard tests assume independent observations. These scenes are <b>not independent</b>:
    scans repeat every ~30 minutes within a night, so scenes from one night are correlated.
    Confidence intervals computed over scenes are therefore <b>narrower than the truth</b>, and p-values
    are optimistic. The night-level summaries below are the more trustworthy view.
  </div></div>

  <div id="filters"></div>

  <h2>Descriptive statistics</h2>
  <div id="desc"></div>

  <h2>Distribution of per-scene Dice</h2>
  <figure><div class="viz" id="c-hist"></div><figcaption id="cap-hist"></figcaption></figure>

  <h2>Paired model comparison</h2>
  <p class="small">The two models are evaluated on exactly the same scenes, so a paired test is
  appropriate. A Wilcoxon signed-rank test is used rather than a t-test because per-scene Dice is
  bounded, skewed and has a spike at zero.</p>
  <div id="paired"></div>

  <h2>Scene-level versus night-level uncertainty</h2>
  <p class="small">Averaging within a night first, then bootstrapping over nights, respects the clustering
  and gives a wider, more honest interval.</p>
  <div id="cluster"></div>

  <h2>What predicts a good score?</h2>
  <p class="small">Rank correlations between per-scene metadata and per-scene Dice. Rank correlation is
  used because these relationships are monotonic but not linear.</p>
  <div id="corr"></div>
  <figure><div class="viz" id="c-corr"></div><figcaption id="cap-corr"></figcaption></figure>

  <h2>Comparison across years</h2>
  <div id="years"></div>

  <h2>Validation versus test</h2>
  <div id="vt"></div>`;

  // year/night match with an explicit split (so the val-vs-test table can apply
  // the same year/night to the other split)
  const yn = (s) => (filt.state.year === 'all' || String(s.year) === filt.state.year) &&
                    (filt.state.night === 'all' || s.night === filt.state.night);

  function draw() {
    const split = filt.state.split;
    const S = sm.samples.filter(s => s.split === split && s.label === 1 && yn(s));
    const other = split === 'test' ? 'val' : 'test';
    const O = sm.samples.filter(s => s.split === other && s.label === 1 && yn(s));

    /* ---- descriptives ---- */
    const keys = ['dice', 'iou', 'precision', 'recall', 'boundary_iou', 'nsd', 'hd95', 'assd'];
    mount.querySelector('#desc').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Metric</th><th>n</th><th>Mean</th><th>Std dev</th><th>Min</th><th>Q1</th>
        <th>Median</th><th>Q3</th><th>Max</th><th>95% CI of mean</th></tr></thead><tbody>
        ${keys.map(k => {
          const v = S.map(s => s[k]).filter(x => x != null);
          if (!v.length) return `<tr><td>${tip(k)}</td><td colspan="9" class="na">not available</td></tr>`;
          const ci = bootCI(v);
          return `<tr><td>${tip(k)}</td><td class="n">${v.length}</td>
            <td class="n">${fmtOr(mean(v), k)}</td><td class="n">${v.length > 2 ? std(v).toFixed(3) : '—'}</td>
            <td class="n">${fmtOr(Math.min(...v), k)}</td><td class="n">${fmtOr(quantile(v, .25), k)}</td>
            <td class="n">${fmtOr(quantile(v, .5), k)}</td><td class="n">${fmtOr(quantile(v, .75), k)}</td>
            <td class="n">${fmtOr(Math.max(...v), k)}</td>
            <td class="n">${ci ? `${ci[0].toFixed(3)} – ${ci[1].toFixed(3)}` : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="small">Intervals are percentile bootstrap over scenes, 2000 resamples with a fixed seed,
      so re-running the page reproduces them exactly.</p>`;

    /* ---- histogram ---- */
    const d = S.map(s => s.dice).filter(v => v != null);
    const nb = 20, counts = new Array(nb).fill(0);
    d.forEach(v => counts[Math.min(nb - 1, Math.floor(v * nb))]++);
    mount.querySelector('#c-hist').innerHTML = histogram({
      bins: Array.from({length: nb}, (_, i) => i / nb),
      counts, xlabel: 'per-scene Dice', ylabel: 'scenes', W: 880, H: 300,
      aria: 'Distribution of per-scene Dice',
    });
    const zeros = d.filter(v => v === 0).length;
    mount.querySelector('#cap-hist').innerHTML =
      `n = ${d.length}. The distribution is left-skewed with a spike at zero (${zeros} scenes).
       Mean ${fmtOr(mean(d), 'dice')} sits below the median ${fmtOr(quantile(d, .5), 'dice')}, so the
       headline average is pulled down by a minority of failures rather than describing a typical scene.
       The <b>median is the better summary of typical behaviour</b>; the mean is reported for
       comparability with the training pipeline and the baseline report.`;

    /* ---- paired test ---- */
    const both = S.filter(s => s.dice != null && s.dice_cmp != null);
    const a = both.map(s => s.dice), b = both.map(s => s.dice_cmp);
    const w = wilcoxon(a, b);
    const diffs = both.map(s => s.dice - s.dice_cmp);
    const ciD = bootCI(diffs);
    mount.querySelector('#paired').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Comparison</th><th>n scenes</th><th>Mean Dice</th><th>Median Dice</th>
        <th>Mean difference</th><th>95% CI of difference</th><th>Wilcoxon p</th></tr></thead><tbody>
        <tr><td>Attention UNet (selected)</td><td class="n">${both.length}</td>
          <td class="n">${fmtOr(mean(a), 'dice')}</td><td class="n">${fmtOr(quantile(a, .5), 'dice')}</td>
          <td class="n" rowspan="2">${mean(diffs) >= 0 ? '+' : ''}${mean(diffs).toFixed(4)}</td>
          <td class="n" rowspan="2">${ciD ? `${ciD[0].toFixed(4)} – ${ciD[1].toFixed(4)}` : '—'}</td>
          <td class="n" rowspan="2">${w ? (w.p < 0.001 ? '&lt; 0.001' : w.p.toFixed(3)) : '—'}</td></tr>
        <tr><td>UNet++ (9 elevations)</td><td class="n">${both.length}</td>
          <td class="n">${fmtOr(mean(b), 'dice')}</td><td class="n">${fmtOr(quantile(b, .5), 'dice')}</td></tr>
      </tbody></table></div>
      <div class="note ${w && w.p < 0.05 ? '' : 'warn'}"><span class="tag">reading</span><div class="bd">
        ${w ? `The paired difference is <b>${mean(diffs) >= 0 ? '+' : ''}${mean(diffs).toFixed(4)}</b> Dice in favour of the
          selected model, with a 95% interval of ${ciD ? `${ciD[0].toFixed(4)} to ${ciD[1].toFixed(4)}` : '—'}
          and p = ${w.p < 0.001 ? '< 0.001' : w.p.toFixed(3)} (n = ${w.n} scenes where the two differ).
          ${ciD && ciD[0] <= 0 && ciD[1] >= 0
            ? '<b>The interval includes zero, so the two models are not distinguishable on this evidence.</b>'
            : `The interval excludes zero, so the ordering is consistent — but the effect is
               <b>${Math.abs(mean(diffs)) < 0.01 ? 'very small in practical terms' : 'modest'}</b>
               (${Math.abs(mean(diffs)).toFixed(4)} Dice), far below the scene-to-scene standard deviation of
               ${std(a).toFixed(3)}. Statistical detectability here reflects the paired design, not a
               meaningful quality gap.`}
          Because scenes within a night are correlated, the true p-value is larger than this one.`
          : 'Too few differing scenes for a signed-rank test.'}
      </div></div>`;

    /* ---- clustered bootstrap ---- */
    const nights = {};
    S.forEach(s => { if (s.night) (nights[s.night] ||= []).push(s.dice); });
    const nightMeans = Object.values(nights).map(v => mean(v));
    const ciScene = bootCI(d), ciNight = bootCI(nightMeans);
    mount.querySelector('#cluster').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Unit of analysis</th><th>n</th><th>Mean Dice</th><th>Std dev</th>
        <th>95% CI of the mean</th><th>CI width</th></tr></thead><tbody>
        <tr><td>Individual scenes</td><td class="n">${d.length}</td><td class="n">${fmtOr(mean(d), 'dice')}</td>
          <td class="n">${std(d).toFixed(3)}</td>
          <td class="n">${ciScene ? `${ciScene[0].toFixed(3)} – ${ciScene[1].toFixed(3)}` : '—'}</td>
          <td class="n">${ciScene ? (ciScene[1] - ciScene[0]).toFixed(3) : '—'}</td></tr>
        <tr><td>Night means</td><td class="n">${nightMeans.length}</td>
          <td class="n">${fmtOr(mean(nightMeans), 'dice')}</td>
          <td class="n">${nightMeans.length > 2 ? std(nightMeans).toFixed(3) : '—'}</td>
          <td class="n">${ciNight ? `${ciNight[0].toFixed(3)} – ${ciNight[1].toFixed(3)}` : '—'}</td>
          <td class="n">${ciNight ? (ciNight[1] - ciNight[0]).toFixed(3) : '—'}</td></tr>
      </tbody></table></div>
      <p class="small">${ciScene && ciNight
        ? `Treating nights as the unit widens the interval by
           <b>${(((ciNight[1] - ciNight[0]) / (ciScene[1] - ciScene[0]) - 1) * 100).toFixed(0)}%</b>
           (${d.length} scenes collapse to ${nightMeans.length} nights). The night-level interval is the one to quote.`
        : 'Not enough nights for a clustered interval.'}</p>`;

    /* ---- correlations ---- */
    const FEATS = [
      ['Labelled area (log)', s => s.gt_area > 0 ? Math.log10(s.gt_area) : null],
      ['Labelled regions', s => s.n_gt_regions],
      ['Mean range from radar', s => s.gt_dist_km],
      ['Hour of night', s => s.hour],
      ['Year', s => s.year],
      ['Max probability in scene', s => s.prob_max],
      ['Predicted ÷ labelled area', s => (s.gt_area > 0 && s.pred_area != null) ? s.pred_area / s.gt_area : null],
    ];
    const corrs = FEATS.map(([label, f]) => {
      const pairs = S.map(s => [f(s), s.dice]).filter(([x, y]) => x != null && y != null && Number.isFinite(x));
      if (pairs.length < 10) return {label, n: pairs.length, rho: null, r: null};
      return {label, n: pairs.length,
        rho: spearman(pairs.map(p => p[0]), pairs.map(p => p[1])),
        r: pearson(pairs.map(p => p[0]), pairs.map(p => p[1]))};
    }).sort((a, b) => Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0));
    mount.querySelector('#corr').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Scene property</th><th>n</th><th>Spearman ρ with Dice</th><th>Pearson r</th>
        <th>Strength</th></tr></thead><tbody>
        ${corrs.map(c => {
          const A = Math.abs(c.rho ?? 0);
          const lab = c.rho == null ? 'not enough data'
            : A > 0.6 ? 'strong' : A > 0.35 ? 'moderate' : A > 0.15 ? 'weak' : 'negligible';
          return `<tr><td>${esc(c.label)}</td><td class="n">${c.n}</td>
            <td class="n">${c.rho == null ? '—' : c.rho.toFixed(3)}</td>
            <td class="n">${c.r == null ? '—' : c.r.toFixed(3)}</td>
            <td>${lab}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="small">Correlation is not causation, and these features are themselves related
      (large plumes tend to have more regions). No multivariate model is fitted here, so these are
      marginal associations only.</p>`;

    const top = corrs[0];
    const f = FEATS.find(x => x[0] === top.label)[1];
    const pts = S.map(s => [f(s), s.dice]).filter(([x, y]) => x != null && y != null && Number.isFinite(x));
    mount.querySelector('#c-corr').innerHTML = scatter({
      points: pts.map(([x, y]) => ({x, y, c: 'var(--accent2)', r: 3.4, o: .6, t: `${x.toFixed(2)}, Dice ${y.toFixed(3)}`})),
      xlo: Math.min(...pts.map(p => p[0])), xhi: Math.max(...pts.map(p => p[0])), ylo: 0, yhi: 1,
      xlabel: top.label, ylabel: 'per-scene Dice', W: 880, H: 340,
      aria: `Dice against ${top.label}`,
    });
    mount.querySelector('#cap-corr').textContent =
      `Strongest association: ${top.label} (Spearman ρ = ${top.rho?.toFixed(3)}, n = ${top.n}).`;

    /* ---- years ---- */
    const years = [...new Set(S.map(s => s.year))].sort();
    mount.querySelector('#years').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Year</th><th>Scenes</th><th>Nights</th><th>Mean Dice</th><th>Median</th>
        <th>Std dev</th><th>95% CI</th><th>Reliable?</th></tr></thead><tbody>
        ${years.map(y => {
          const v = S.filter(s => s.year === y);
          const dv = v.map(s => s.dice).filter(x => x != null);
          const ci = bootCI(dv);
          const nights = new Set(v.map(s => s.night).filter(Boolean)).size;
          return `<tr><td>${y}</td><td class="n">${v.length}</td><td class="n">${nights}</td>
            <td class="n">${fmtOr(mean(dv), 'dice')}</td><td class="n">${fmtOr(quantile(dv, .5), 'dice')}</td>
            <td class="n">${dv.length > 2 ? std(dv).toFixed(3) : '—'}</td>
            <td class="n">${ci ? `${ci[0].toFixed(3)} – ${ci[1].toFixed(3)}` : '—'}</td>
            <td>${nights < 3 ? '<span class="pill" style="color:var(--warn);border-color:var(--warn)">few nights</span>' : 'yes'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="small">Years whose scenes come from fewer than three nights are flagged: their intervals
      are driven by a handful of weather situations, not by ${S.filter(s => s.year === years[0]).length}
      independent observations.</p>`;

    /* ---- val vs test ---- */
    const dv = O.map(s => s.dice).filter(x => x != null);
    const ciO = bootCI(dv);
    mount.querySelector('#vt').innerHTML = `
      <div class="tscroll"><table>
        <thead><tr><th>Split</th><th>Scenes</th><th>Mean Dice</th><th>Median</th><th>95% CI</th></tr></thead>
        <tbody>
        <tr><td>${split}</td><td class="n">${d.length}</td><td class="n">${fmtOr(mean(d), 'dice')}</td>
          <td class="n">${fmtOr(quantile(d, .5), 'dice')}</td>
          <td class="n">${ciScene ? `${ciScene[0].toFixed(3)} – ${ciScene[1].toFixed(3)}` : '—'}</td></tr>
        <tr><td>${other}</td><td class="n">${dv.length}</td><td class="n">${fmtOr(mean(dv), 'dice')}</td>
          <td class="n">${fmtOr(quantile(dv, .5), 'dice')}</td>
          <td class="n">${ciO ? `${ciO[0].toFixed(3)} – ${ciO[1].toFixed(3)}` : '—'}</td></tr>
      </tbody></table></div>
      <p class="small">${ciScene && ciO && (ciScene[0] < ciO[1] && ciO[0] < ciScene[1])
        ? 'The two intervals overlap, so there is no evidence that the model was over-tuned to validation. This is a weak check: it is an unpaired comparison of different scenes, and both splits share nights with training.'
        : 'The intervals do not overlap, which would suggest the splits differ systematically. Given the shared nights, investigate before drawing conclusions.'}</p>`;
  }

  const filt = sceneFilters(mount.querySelector('#filters'), {samples: sm.samples, onChange: draw});
  draw();
}
