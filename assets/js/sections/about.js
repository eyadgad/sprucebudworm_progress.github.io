/* Methods, metric glossary, data provenance and colour conventions. */

import { load } from '../lib/data.js';
import { M, SEG, esc, int, MODEL_NAME, LOSS_NAME, targetName } from '../lib/metrics.js';
import { legend } from '../lib/charts.js';

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

  <h2>Macro versus micro</h2>
  <div class="note"><span class="tag">important</span><div class="bd">
    <b>Macro</b> averages a per-scene score over scenes: every scene counts equally, so scenes with tiny
    plumes pull the average down. <b>Micro</b> pools all pixels first: scenes with large plumes dominate.
    Macro is the headline here because it matches the baseline report and treats each observation
    equally; micro is always reported alongside it. Mixing the two, or quoting whichever is higher,
    would be misleading, so both are shown everywhere.
  </div></div>

  <h2>Colour conventions</h2>
  <p class="small">These colours mean the same thing on every figure in the dashboard, and match the
  baseline report so the two can be compared directly. Colour is always paired with a text label or a
  position, never used alone to carry meaning.</p>
  <div class="panel">${legend([
    {c: SEG.tp.c, label: 'TP — model and label agree this is plume'},
    {c: SEG.fp.c, label: 'FP — model says plume, label says background'},
    {c: SEG.fn.c, label: 'FN — label says plume, model missed it'},
    {c: SEG.tn.c, label: 'TN / background'},
  ])}
  <div style="margin-top:10px">${legend([
    {c: '#3a6fce', label: 'train split'}, {c: '#2f9d8c', label: 'validation split'},
    {c: '#e2a33d', label: 'test split'}, {c: 'var(--best)', label: 'selected configuration'},
  ])}</div></div>

  <h2>How the numbers are produced</h2>
  <ol class="small" style="padding-left:20px;line-height:1.85;max-width:82ch">
    <li><b>Training.</b> Each run is a YAML config resolved against <code>configs/base_config.yaml</code>,
      trained by <code>src/experiment.py</code>. Results, per-epoch history and a timestamped log are
      written to <code>outputs/experiments/</code>.</li>
    <li><b>Export.</b> <code>scripts/export_dashboard_data.py</code> reads those outputs, reloads the
      selected checkpoint, and runs full-scene sliding-window inference over every validation and test
      scene at 960×960. It writes the JSON files this site reads.</li>
    <li><b>Display.</b> The site loads only the JSON a section needs and computes summaries in the
      browser from the per-scene records, so any table can be re-derived from
      <code>data/samples.json</code>.</li>
    <li><b>Cross-check.</b> <a href="#/aggregate">Aggregate evaluation</a> compares the recomputed
      metrics against the values stored at training time. They currently agree to four decimal places.</li>
  </ol>

  <h2>Data files</h2>
  <div class="tscroll"><table>
    <thead><tr><th>File</th><th>Contents</th><th>Rows</th><th>Produced by</th></tr></thead><tbody>
    <tr><td><code>experiments.json</code></td><td style="text-align:left">Config, metrics, best epoch and timing for every run</td>
      <td class="n">${ex.experiments.length}</td><td class="small">stage <code>experiments</code></td></tr>
    <tr><td><code>histories.json</code></td><td style="text-align:left">Per-epoch loss, learning rate and validation metrics</td>
      <td class="n">${ex.experiments.length}</td><td class="small">stage <code>experiments</code></td></tr>
    <tr><td><code>dataset.json</code></td><td style="text-align:left">Scene metadata, target areas under three label definitions, split leakage audit</td>
      <td class="n">${int(ds.n_scenes)}</td><td class="small">stage <code>dataset</code></td></tr>
    <tr><td><code>samples.json</code></td><td style="text-align:left">Per-scene metrics for both models, region counts, radial statistics</td>
      <td class="n">${int(sm.samples.length)}</td><td class="small">stage <code>predict</code></td></tr>
    <tr><td><code>threshold.json</code></td><td style="text-align:left">Threshold sweeps, probability histograms, reliability bins, radial error profile</td>
      <td class="n">—</td><td class="small">stage <code>predict</code></td></tr>
    <tr><td><code>samples/*.png</code></td><td style="text-align:left">Probability, ground-truth, reflectivity and thumbnail layers per test scene</td>
      <td class="n">816</td><td class="small">stage <code>images</code></td></tr>
  </tbody></table></div>

  <h2>Rebuilding the data</h2>
  <pre style="background:var(--panel);border:1px solid var(--hair);border-radius:9px;padding:13px;overflow-x:auto;font-size:12.5px"><code>. venv\\Scripts\\python.exe scripts/export_dashboard_data.py --only experiments,dataset
.venv\\Scripts\\python.exe scripts/export_dashboard_data.py --only predict
.venv\\Scripts\\python.exe scripts/export_dashboard_data.py --only images --img-splits test</code></pre>
  <p class="small">The <code>predict</code> stage needs a GPU and takes roughly 40 minutes for 615 scenes
  with two models. <code>experiments</code> and <code>dataset</code> need no GPU and take under two minutes.
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
      ['Visual model-vs-model comparison', 'Pixel layers are stored for the selected model only.',
       'Running stage images for the comparison checkpoint as well (~13 MB more).'],
      ['Validation scene imagery', 'Images were exported for the test split only, to keep the repo small.',
       '<code>--only images --img-splits test,val</code> (~40 MB total).'],
      ['Annotator agreement / label noise', 'Each scene has exactly one annotation.',
       'A second independent annotation of a scene subset.'],
      ['True generalisation to unseen nights', 'All test nights also appear in training.',
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
