/* Methods, metric glossary, data provenance and colour conventions. */

import { load } from '../lib/data.js';
import { M, esc, int, MODEL_NAME, LOSS_NAME, targetName } from '../lib/metrics.js';

export async function render(mount) {
  const [ex, ds, sm] = await Promise.all([load('experiments'), load('summary'), load('samples')]);
  const sel = ex.experiments.find(r => r.selected);

  mount.innerHTML = `
  <h1>Methods and glossary</h1>
  <p class="lede">How every number on this site is produced, what each metric means, and which analyses
  the current outputs cannot support.</p>

  <h2>Metric definitions</h2>
  <div class="tscroll"><table>
    <thead><tr><th>Metric</th><th style="text-align:left">What it measures</th>
    <th style="text-align:left">Formula</th><th>Range</th><th>Better</th></tr></thead><tbody>
    ${Object.entries(M).map(([k, m]) => `<tr>
      <td><b>${esc(m.label)}</b>${m.unit ? ` <span class="pill">${esc(m.unit)}</span>` : ''}</td>
      <td style="text-align:left" class="small">${esc(m.def)}</td>
      <td class="frm" style="text-align:left;font-family:var(--mono);font-size:11.5px">${esc(m.formula)}</td>
      <td class="n">${m.unit === 'px' ? '≥ 0' : '0 – 1'}</td>
      <td>${m.hi === null ? '—' : (m.hi ? 'higher' : 'lower')}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="small">TP, FP, FN and TN are counts of true-positive, false-positive, false-negative and
  true-negative pixels. P and G are the predicted and ground-truth masks, ∂P and ∂G their boundaries,
  and τ a tolerance in pixels. Σ sums over all pixels of all scenes.</p>

  <h3>Presence-detection metrics</h3>
  <div class="tscroll"><table>
    <thead><tr><th>Term</th><th style="text-align:left">Definition for scans and nights</th></tr></thead><tbody>
      <tr><td>SBW-present scan</td><td style="text-align:left" class="small">Ground-truth area is at least one full-resolution 500 m grid cell; exactly zero cells is SBW-free.</td></tr>
      <tr><td>Scan score</td><td style="text-align:left" class="small">Count of cells predicted as SBW at the model's locked pixel-probability threshold.</td></tr>
      <tr><td>Night truth</td><td style="text-align:left" class="small">Present when any labelled manifest scan in the noon-to-noon UTC operational night contains SBW.</td></tr>
      <tr><td>Night score</td><td style="text-align:left" class="small">Maximum or mean predicted SBW-cell count over evaluated scans from that night and split.</td></tr>
      <tr><td>ROC-AUC</td><td style="text-align:left" class="small">Probability that a randomly selected present unit ranks above a randomly selected free unit, with ties shared; 0.5 is chance and 1 is perfect ranking.</td></tr>
      <tr><td>Mann–Whitney U</td><td style="text-align:left" class="small">Two-sided rank test comparing predicted night scores for truly present and truly free nights.</td></tr>
      <tr><td>Area cutoff</td><td style="text-align:left" class="small">Selected on validation by maximum Youden J (sensitivity + specificity − 1), then applied unchanged to test.</td></tr>
    </tbody></table></div>
  <p class="small">Swarm-free scans are a sampled cohort rather than an operational-prevalence sample.
  Their ground-truth masks are synthesized as all-zero arrays by dataset construction, not independently
  annotated pixel by pixel. Presence accuracy and precision must be interpreted within that sampling design.</p>

  <h2>How the numbers are produced</h2>
  <ol class="small" style="padding-left:20px;line-height:1.85;max-width:82ch">
    <li><b>Training.</b> Each run is a YAML config resolved against <code>configs/base_config.yaml</code>,
      trained by <code>src/experiment.py</code>. Results, per-epoch history and a timestamped log are
      written to <code>outputs/experiments/</code>.</li>
    <li><b>Export.</b> <code>scripts/export_dashboard_data.py</code> reads those outputs, reloads the
      selected checkpoint, and runs full-scene sliding-window inference over every validation and test
      scene at 960×960. Its GPU-free <code>presence</code> stage then derives scan/night curves,
      validation-selected cutoffs and statistical tests from those stored predictions.</li>
    <li><b>Display.</b> The site loads only the JSON a section needs. Pixel summaries are derived in the
      browser from per-scene records; presence statistics are read from versioned
      <code>data/presence.json</code> so the browser cannot accidentally tune a cutoff on test.</li>
  </ol>

  <h2>Data files</h2>
  <div class="tscroll"><table>
    <thead><tr><th>File</th><th>Contents</th><th>Rows</th><th>Produced by</th></tr></thead><tbody>
    <tr><td><code>experiments.json</code></td><td style="text-align:left">Config, metrics, best epoch and timing for every run</td>
      <td class="n">${ex.experiments.length}</td><td class="small">stage <code>experiments</code></td></tr>
    <tr><td><code>histories.json</code></td><td style="text-align:left">Per-epoch loss, learning rate and validation metrics</td>
      <td class="n">${ex.experiments.length}</td><td class="small">stage <code>experiments</code></td></tr>
    <tr><td><code>dataset.json</code></td><td style="text-align:left">Scene metadata, target areas under three label definitions, night/split overlap audit</td>
      <td class="n">${int(ds.n_scenes)}</td><td class="small">stage <code>dataset</code></td></tr>
    <tr><td><code>samples.json</code></td><td style="text-align:left">Per-scene metrics for four viewer models, region counts, radial statistics and packed-asset metadata</td>
      <td class="n">${int(sm.samples.length)}</td><td class="small">stage <code>predict</code></td></tr>
    <tr><td><code>threshold.json</code></td><td style="text-align:left">Threshold sweeps, probability histograms, reliability bins, radial error profile</td>
      <td class="n">—</td><td class="small">stage <code>predict</code></td></tr>
    <tr><td><code>presence.json</code></td><td style="text-align:left">Precomputed scan/night binary metrics, ROC curves, area cutoffs, distribution tests and exact night records for four viewer models</td>
      <td class="n">4 models</td><td class="small">stage <code>presence</code></td></tr>
    <tr><td><code>samples/*.{sbw.gz,webp}</code></td><td style="text-align:left">One packed four-model/ground-truth/max-six-reflectivity asset and one thumbnail per evaluated scene</td>
      <td class="n">1,230</td><td class="small">stage <code>packs</code></td></tr>
  </tbody></table></div>

  <h2>Rebuilding the data</h2>
  <pre style="background:var(--panel);border:1px solid var(--hair);border-radius:9px;padding:13px;overflow-x:auto;font-size:12.5px"><code>. venv\\Scripts\\python.exe scripts/export_dashboard_data.py --only experiments,dataset
.venv\\Scripts\\python.exe scripts/export_dashboard_data.py --only predict
.venv\\Scripts\\python.exe scripts/export_dashboard_data.py --only presence
.venv\\Scripts\\python.exe scripts/export_dashboard_data.py --only packs --data-root ..\\Data --site-dir ..\\sprucebudworm_progress.github.io</code></pre>
  <p class="small">The <code>predict</code> stage needs a GPU and takes roughly 40 minutes for 615 scenes
  with four models. <code>experiments</code> and <code>dataset</code> need no GPU and take under two minutes.
  To serve the site locally: <code>python -m http.server 8899</code> from this folder, then open
  <code>http://127.0.0.1:8899</code>. Opening <code>index.html</code> directly from disk will not work,
  because ES modules and <code>fetch</code> require an HTTP origin.</p>

  <h2>Selected configuration in full</h2>
  <div class="tscroll"><table>
    <thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>
    ${[
      ['Run id', sel.name], ['Architecture', MODEL_NAME[sel.model] || sel.model],
      ['Loss', LOSS_NAME[sel.loss] || sel.loss],
      ['Label definition', targetName(sel.target_mode, sel.dbz_threshold)],
      ['Input channels', `${sel.n_channels} (${sel.n_elev} reflectivity elevations + valid mask)`],
      ['Channel list', (sel.channels || []).join(', ')],
      ['Parameters', sel.n_params ? sel.n_params.toLocaleString() : '—'],
      ['Patch size', sel.patch_size], ['Patches per image', sel.patches_per_image],
      ['Batch size', sel.batch_size], ['Learning rate', sel.lr],
      ['Epoch budget', sel.epochs_budget], ['Best epoch', sel.best_epoch],
      ['Training time', sel.train_seconds ? `${(sel.train_seconds / 3600).toFixed(1)} hours` : '—'],
      ['Decision threshold', sel.threshold],
      ['Evaluation', 'full-scene sliding window, 256 px patches, 50% overlap, Gaussian weighting'],
    ].map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:left"><code>${esc(String(v ?? '—'))}</code></td></tr>`).join('')}
  </tbody></table></div>

  <h2>Relationship to the baseline report</h2>
  <div class="note"><span class="tag">different model</span><div class="bd">
    The project's earlier PDF report evaluates a <b>different</b> model on a <b>different</b> dataset:
    a plain U-Net with Focal loss on six channels including an ETA intensity channel, over 341 scans from
    2013–2016, split by night, with a 0.5 threshold. This dashboard covers the current pipeline:
    ${MODEL_NAME[sel.model]}, ${sel.n_elev} reflectivity elevations, no ETA channel (it does not exist in
    the local files), ${int(ds.n_scenes)} scenes from 2013–2019, stratified by year, threshold
    ${sel.threshold}. <b>The two sets of numbers are not comparable</b> and are never mixed here. The
    report's structure is used as the baseline this dashboard extends, and one of its findings —
    performance rising with target area — is independently reproduced in
    <a href="#/errors">error analysis</a>.
  </div></div>

  <h2>Analyses this dashboard does not support</h2>
  <div class="tscroll"><table>
    <thead><tr><th>Analysis</th><th>Why not</th><th>What would be needed</th></tr></thead><tbody>
    ${[
      ['Per-channel input distributions', 'The export does not read raw netCDF pixel values.',
       'A pass over the source files recording per-channel histograms.'],
      ['Per-scene optimal threshold', 'Only a pooled threshold sweep is stored.',
       'An extra sweep pass per scene in stage predict (~200 KB).'],
      ['Weather-conditioned performance', 'No meteorological variables are joined to the scenes.',
       'A weather table keyed by night.'],
      ['Training scene imagery', 'Layers are exported for the evaluated splits (test and validation) only; training scenes are not browsable.',
       'Extending stage images to the train split (~90 MB more).'],
      ['Annotator agreement / label noise', 'Each scene has exactly one annotation.',
       'A second independent annotation of a scene subset.'],
      ['Generalisation to an unseen night',
       'The presence page groups nights, but splits are assigned per scene, so most nights contribute to more than one split. Performance on a wholly unseen night has not been measured.',
       'A night-disjoint split and a retrain.'],
    ].map(([a, w, n]) => `<tr><td style="text-align:left"><b>${esc(a)}</b></td>
      <td style="text-align:left" class="small">${esc(w)}</td>
      <td style="text-align:left" class="small">${n}</td></tr>`).join('')}
  </tbody></table></div>

  <h2>Reproducibility</h2>
  <p class="small">Bootstrap intervals use a fixed-seed linear congruential generator (seed 12345,
  2000 resamples), so every interval on this site is deterministic and reproduces exactly on reload.
  Statistical helpers live in <code>assets/js/lib/metrics.js</code> and are shared by every section, so a
  statistic cannot be computed two different ways in two places. Data generated
  ${esc(ex.generated || 'unknown')}.</p>`;
}
