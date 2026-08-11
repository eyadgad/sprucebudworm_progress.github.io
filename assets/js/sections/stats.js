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
  <p class="lede">Distributions, intervals and paired comparisons behind the headline numbers.</p>

  <div class="note warn"><span class="tag">assumption violated</span><div class="bd">
    Scenes within a night are correlated (~30 min cadence), so scene-level intervals are narrower than the
    truth and p-values optimistic; the night-level summaries are the more trustworthy view.
  </div></div>

  <div id="filters"></div>

  <h2>Descriptive statistics</h2>
  <div id="desc"></div>

  <h2>Distribution of per-scene Dice</h2>
  <figure><div class="viz" id="c-hist"></div><figcaption id="cap-hist"></figcaption></figure>

  <h2>Paired model comparison</h2>
  <p class="small">Wilcoxon signed-rank on the same scenes (per-scene Dice is skewed with a zero spike).</p>
  <div id="paired"></div>

  <h2>Scene-level versus night-level uncertainty</h2>
  <p class="small">Bootstrapping over night means rather than scenes respects the clustering.</p>
  <div id="cluster"></div>

  <h2>What predicts a good score?</h2>
  <p class="small">Rank correlations between per-scene metadata and Dice.</p>
  <div id="corr"></div>
  <figure><div class="viz" id="c-corr"></div><figcaption id="cap-corr"></figcaption></figure>

  <h2>Comparison across years</h2>
  <div id="years"></div>`;

  // year/night match with an explicit split (so the val-vs-test table can apply
  // the same year/night to the other split)
  const yn = (s) => (filt.state.year === 'all' || String(s.year) === filt.state.year) &&
                    (filt.state.night === 'all' || s.night === filt.state.night);

  function draw() {
    const split = filt.state.split;
    const S = sm.samples.filter(s => s.split === split && s.label === 1 && yn(s));

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
      `n = ${d.length}. Left-skewed with a spike at zero (${zeros} scenes); mean
       ${fmtOr(mean(d), 'dice')} sits below the median ${fmtOr(quantile(d, .5), 'dice')}.`;

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
        ${w ? `${ciD && ciD[0] <= 0 && ciD[1] >= 0
            ? '<b>The 95% interval of the difference includes zero, so the two models are not distinguishable on this evidence.</b>'
            : `The interval excludes zero, but the difference (${Math.abs(mean(diffs)).toFixed(4)} Dice) is far below the scene-to-scene standard deviation of ${std(a).toFixed(3)}.`}
          Because scenes within a night are correlated, the true p-value is larger than the one in the table.`
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
      (large swarms tend to have more regions). No multivariate model is fitted here, so these are
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
  }

  const filt = sceneFilters(mount.querySelector('#filters'), {samples: sm.samples, onChange: draw});
  draw();
}
