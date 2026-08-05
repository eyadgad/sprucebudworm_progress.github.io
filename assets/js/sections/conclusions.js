/* Conclusions and recommendations, each tied to the section that supports it. */

import { load } from '../lib/data.js';
import { fmtOr, int, pct, esc, mean, quantile, MODEL_NAME } from '../lib/metrics.js';

export async function render(mount) {
  const [ex, sm, ds] = await Promise.all([load('experiments'), load('samples'), load('summary')]);
  const sel = ex.experiments.find(r => r.selected);
  const T = sm.samples.filter(s => s.split === 'test' && s.label === 1);
  const d = T.map(s => s.dice);
  const lk = ds.leakage;
  const zero = T.filter(s => s.dice === 0).length;
  const small = T.filter(s => s.gt_area < 5000);
  const large = T.filter(s => s.gt_area >= 50000);

  mount.innerHTML = `
  <h1>Conclusions and recommendations</h1>
  <p class="lede">What this evaluation supports, what it does not, and what to do next. Each claim links
  to the section that carries its evidence.</p>

  <h2>What the evidence supports</h2>
  <div class="note ok"><span class="tag">well supported</span><div class="bd"><ul style="margin:0;padding-left:18px">
    <li><b>The task is learnable from radar reflectivity alone.</b> ${MODEL_NAME[sel.model]} reaches
      ${fmtOr(sel.dice, 'dice')} macro Dice and ${fmtOr(sel.dice_micro, 'dice_micro')} micro Dice on
      ${T.length} held-out scenes, with no ETA or dual-polarisation channels.
      <a href="#/aggregate">Aggregate evaluation</a></li>
    <li><b>The model rarely invents plumes.</b> On plume-free scenes it marks
      ${pct(sel.bg_fp_rate, 2)} of pixels. <a href="#/errors">Error analysis</a></li>
    <li><b>Performance is driven by target size, strongly and monotonically.</b> Spearman ρ ≈ 0.73
      between labelled area and Dice; mean Dice ${fmtOr(mean(small.map(s => s.dice)), 'dice')} for plumes
      under 5,000 px versus ${fmtOr(mean(large.map(s => s.dice)), 'dice')} above 50,000 px.
      <a href="#/segments">Performance breakdown</a></li>
    <li><b>Architecture is not the bottleneck.</b> Six architectures land within ~0.04 Dice, and the two
      best models agree scene-by-scene at ρ = 0.97, failing on the same scenes.
      <a href="#/experiments">Experiment comparison</a></li>
    <li><b>The operating threshold is not critical.</b> Dice is nearly flat between 0.15 and 0.6.
      <a href="#/threshold">Threshold and calibration</a></li>
  </ul></div></div>

  <h2>Major limitations</h2>
  <div class="note bad"><span class="tag">limits the conclusion</span><div class="bd"><ul style="margin:0;padding-left:18px">
    <li><b>Nights are shared across splits.</b> All ${lk.test_scenes_total} positive test scenes sit on a
      night that also appears in training, and ${lk.nights_all_three} of ${lk.n_nights} nights appear in
      all three splits. Scans 30 minutes apart are near duplicates, so the reported score measures
      interpolation within known nights. <b>This is the single biggest caveat on every number in this
      dashboard.</b> <a href="#/data">Data exploration</a></li>
    <li><b>The selected run is only weakly separated from its siblings.</b> It leads on test Dice alone;
      other runs lead on boundary IoU, NSD, precision, recall and validation Dice. Differences between the
      top runs are far smaller than scene-to-scene variability.
      <a href="#/experiments">Experiment comparison</a></li>
    <li><b>Scene-level intervals are too narrow.</b> Scenes within a night are correlated, so bootstrap
      intervals over scenes understate uncertainty; night-level intervals are wider.
      <a href="#/stats">Statistical analysis</a></li>
    <li><b>The mean is not a typical scene.</b> The Dice distribution is left-skewed with ${zero} zero-overlap
      scenes; the median (${fmtOr(quantile(d, .5), 'dice')}) exceeds the mean (${fmtOr(mean(d), 'dice')}).</li>
    <li><b>Probabilities are not calibrated.</b> They are usable as a ranking, not as likelihoods.
      <a href="#/threshold">Threshold and calibration</a></li>
    <li><b>Labels are single-annotator and unvalidated.</b> No second annotation exists, so label noise
      cannot be separated from model error.</li>
  </ul></div></div>

  <h2>When to trust this model, and when not to</h2>
  <div class="two">
    <div class="panel"><h3 style="margin-top:0;color:var(--ok)">Reasonable to rely on</h3>
      <ul class="small" style="padding-left:18px;line-height:1.75">
        <li>Plumes larger than about 20,000 px (5,000 km²): mean Dice
          ${fmtOr(mean(T.filter(s => s.gt_area >= 20000).map(s => s.dice)), 'dice')}.</li>
        <li>Deciding <i>whether</i> a scan contains a dispersal event.</li>
        <li>Estimating the coarse extent and location of a large plume.</li>
        <li>Nights and seasons resembling 2013–2019 at this radar.</li>
      </ul></div>
    <div class="panel"><h3 style="margin-top:0;color:var(--bad)">Do not rely on</h3>
      <ul class="small" style="padding-left:18px;line-height:1.75">
        <li>Small or faint plumes under ~5,000 px: mean Dice
          ${fmtOr(mean(small.map(s => s.dice)), 'dice')}, with ${small.filter(s => s.dice === 0).length}
          complete misses.</li>
        <li>Exact plume boundaries or area totals: the model over-predicts area.</li>
        <li>Pixel probabilities as calibrated confidence.</li>
        <li>A different radar, or nights unlike anything in training — untested.</li>
        <li>Any use where the quoted accuracy must hold on genuinely unseen nights.</li>
      </ul></div>
  </div>

  <h2>Deployment readiness</h2>
  <div class="tscroll"><table>
    <thead><tr><th>Requirement</th><th>Status</th><th>Evidence / gap</th></tr></thead><tbody>
    ${[
      ['Reproducible training', 'ready', 'Config-driven runs, fixed seed, checkpoints and logs retained for all 57 runs.'],
      ['Reproducible evaluation', 'ready', 'Dashboard numbers recomputed from checkpoints match the training pipeline exactly.'],
      ['Honest generalisation estimate', 'blocked', 'Requires a night-disjoint split; current test set shares nights with training.'],
      ['Calibrated probabilities', 'not ready', 'Reliability diagram shows over-confidence; needs temperature scaling or similar.'],
      ['Small-target performance', 'not ready', 'Mean Dice below 0.4 for plumes under 5,000 px.'],
      ['Robustness across radars', 'untested', 'Only XAM data exists in this project.'],
      ['Inference cost', 'ready', 'Sliding-window inference over 204 scenes runs in ~2 minutes on one RTX 4080 SUPER.'],
      ['Operational monitoring', 'not started', 'No drift detection or input validation is defined.'],
    ].map(([r, s, e]) => {
      const c = s === 'ready' ? 'var(--ok)' : (s === 'blocked' ? 'var(--bad)' : 'var(--warn)');
      return `<tr><td>${esc(r)}</td>
        <td><span class="pill" style="color:${c};border-color:${c}">${esc(s)}</span></td>
        <td style="text-align:left" class="small">${esc(e)}</td></tr>`;
    }).join('')}
  </tbody></table></div>
  <p class="small"><b>Overall:</b> suitable as a research tool and as a screening aid with a human in the
  loop. Not ready for unattended operational use, primarily because no unbiased generalisation estimate
  exists yet.</p>

  <h2>Recommended next experiments, ranked by information gained</h2>
  <div class="tscroll"><table>
    <thead><tr><th>#</th><th>Experiment</th><th>Why it matters</th><th>Cost</th><th>What it would settle</th></tr></thead><tbody>
    ${[
      ['1', 'Night-disjoint re-split and retrain',
       'Every current number is inflated by shared nights. Nothing else can be trusted until this is done.',
       '~12 GPU-h (retrain the selected config on a regrouped manifest)',
       'The real generalisation score, and how much of the 0.63 is memorised night context.'],
      ['2', 'Second annotation of 40–60 scenes, weighted to small plumes',
       'Separates label noise from model error, which currently cannot be told apart.',
       'Annotator time, no GPU',
       'Whether the small-target penalty is a model limit or a labelling limit; sets a realistic ceiling.'],
      ['3', 'Size-stratified loss or sampling',
       'Small plumes dominate the failures and are under-weighted by area-based losses.',
       '~12 GPU-h',
       'Whether small-target Dice can be raised without losing large-target performance.'],
      ['4', 'Probability calibration (temperature scaling on validation)',
       'Makes outputs interpretable as confidence and supports risk-based thresholds.',
       'Minutes, no retraining',
       'Whether calibrated confidence is achievable post hoc.'],
      ['5', 'Temporal context from consecutive scans',
       'Plumes evolve smoothly; a single frame discards that. The only remaining source of new signal.',
       '~20 GPU-h plus data-pipeline work',
       'Whether the ~0.63 ceiling is a single-frame limit.'],
      ['6', 'Per-scene threshold study',
       'One global threshold is a compromise; the gain from adapting it is currently unmeasured.',
       'One extra export pass',
       'The headroom an adaptive threshold could recover.'],
    ].map(([n, t, w, c, s]) => `<tr><td class="n">${n}</td><td style="text-align:left"><b>${esc(t)}</b></td>
      <td style="text-align:left" class="small">${esc(w)}</td><td style="text-align:left" class="small">${esc(c)}</td>
      <td style="text-align:left" class="small">${esc(s)}</td></tr>`).join('')}
  </tbody></table></div>

  <h2>Recommended improvements to the evaluation itself</h2>
  <ul class="small" style="padding-left:18px;line-height:1.8;max-width:80ch">
    <li>Report <b>night-level</b> means and intervals as the headline, with scene-level as a secondary view.</li>
    <li>Add a <b>size-stratified</b> summary to every headline table, since one average hides three regimes.</li>
    <li>Export per-scene optimal thresholds to quantify the adaptive-threshold headroom.</li>
    <li>Store pixel layers for validation scenes too, so failures there can be inspected visually.</li>
    <li>Record per-channel input statistics during data preparation to support input-drift checks.</li>
    <li>Keep the recomputation cross-check in <a href="#/aggregate">aggregate evaluation</a> as a
        regression test: it caught nothing this time, which is exactly its job.</li>
  </ul>

  <h2>Priority data collection</h2>
  <ul class="small" style="padding-left:18px;line-height:1.8;max-width:80ch">
    <li><b>More nights, not more scans per night.</b> ${lk.n_nights} nights produce
        ${int(ds.split_summary.counts.train.positives + ds.split_summary.counts.val.positives + ds.split_summary.counts.test.positives)}
        positive scenes; the effective sample size is closer to the night count.</li>
    <li><b>Weather metadata per night</b> (rain, temperature, wind) to test the meteorological hypothesis
        behind whole-night failures.</li>
    <li><b>Dual-polarisation variables</b> if the archive holds them: ZDR and RhoHV separate biological
        from meteorological scatterers directly, which reflectivity alone cannot.</li>
    <li><b>A second radar site</b> to test whether anything here transfers beyond XAM.</li>
  </ul>`;
}
