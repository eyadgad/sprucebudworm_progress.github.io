# Spruce Budworm Radar Segmentation — Evaluation Dashboard

Interactive evaluation of deep-learning models that segment spruce budworm moth
dispersal swarms in XAM weather-radar scans.

Live page: <https://eyadgad.github.io/sprucebudworm_progress.github.io/>

The site is **static**: plain HTML, CSS and ES modules, no build step and no
server code. All analysis is pre-computed by a Python script into JSON, and the
browser does the summarising and plotting. It is served by GitHub Pages directly
from this folder.

---

## Running it

```bash
python -m http.server 8899
```

Then open <http://127.0.0.1:8899>.

Opening `index.html` from the filesystem will **not** work: ES modules and
`fetch()` require an HTTP origin.

## Rebuilding the data

Everything under `data/` is generated. From the project root:

```bash
.venv\Scripts\python.exe scripts\export_dashboard_data.py --only experiments,dataset
.venv\Scripts\python.exe scripts\export_dashboard_data.py --only predict
.venv\Scripts\python.exe scripts\export_dashboard_data.py --only presence
.venv\Scripts\python.exe scripts\export_dashboard_data.py --only packs --data-root ..\Data --site-dir ..\sprucebudworm_progress.github.io
```

| Stage | Needs GPU | Time | Produces |
|---|---|---|---|
| `experiments` | no | seconds | `experiments.json`, `histories.json` |
| `dataset` | no | ~90 s | `dataset.json`, `summary.json` |
| `predict` | yes | ~40 min | `samples.json`, `threshold.json` |
| `presence` | no | seconds | `presence.json` with scan/night detection metrics, ROC curves and exact night records |
| `packs` | no | ~2 min | one `.sbw.gz` pack and one `.webp` thumbnail per test/validation scene |

Verify a rebuild with:

```bash
.venv\Scripts\python.exe scripts\test_dashboard.py
node assets/js/lib/metrics.test.js
node assets/js/lib/presence.test.js
node assets/js/lib/charts.test.js
node assets/js/lib/scan-coverage.test.js
```

The Python suite cross-checks every generated file against
`outputs/experiments/*_result.json` and asserts per-scene arithmetic. The Node
suites test the shared statistics helpers and the exact scan-coverage chart.

---

## Structure

```
index.html                     shell: sidebar, topbar, empty <main>
assets/css/app.css             all styling; design tokens, light/dark
assets/js/main.js              hash router, lazy-loads one section module per route
assets/js/lib/
  metrics.js                   metric registry (names, definitions, formulas,
                               direction), colour semantics, statistics helpers
  charts.js                    SVG chart primitives (bar, line, scatter, box,
                               histogram, confusion, parallel coordinates)
  presence.js                  validates/adapts precomputed scan/night presence data
  table.js                     sortable / paginated DataTable component
  ui.js                        card, labelled select, and the accessible Modal
                               (owns focus, key handling and the scroll lock)
  data.js                      cached fetch + loading / error / empty / N-A states
  metrics.test.js, ui.test.js  node tests for the helpers and the modal
  presence.test.js             presence schema, selectors, outcomes and unit conversions
  sample-pack.js               strict SBW1 decoder and three-scene LRU cache
  sample-pack.test.js          browser/Node tests for packed sample assets
  scan-coverage.js             exact date × half-hour split-assignment chart
  scan-coverage.test.js        coverage cadence, count, and accessibility tests
assets/js/sections/*.js        one module per dashboard section
data/*.json                    generated analysis
data/samples/*.sbw.gz          generated per-scene packed pixel layers
data/samples/*.webp            generated lazy grid thumbnails
```

### Sections

| # | Route | What it answers |
|---|---|---|
| 01 | `#/overview` | What was built, how well it works, what to distrust |
| 02 | `#/data` | Exact scan assignments, date/time coverage, target sizes, split integrity |
| 03 | `#/experiments` | All 57 runs, and why one was selected |
| 04 | `#/training` | Convergence, over/under-fitting, stability |
| 05 | `#/aggregate` | Validation vs test metrics, confusion matrices, intervals |
| 06 | `#/presence` | Scan-level SBW detection and night-level migration detection |
| 07 | `#/segments` | Performance by year, size, fragmentation, distance, difficulty |
| 08 | `#/samples` | Every scene; open one to inspect layers and move the threshold |
| 09 | `#/errors` | Failure taxonomy, size driver, model disagreement, clustering |
| 10 | `#/stats` | Distributions, bootstrap intervals, paired tests, correlations |
| 11 | `#/about` | Metric glossary, provenance, unsupported analyses |

---

## Data files

| File | Size | Contents |
|---|---|---|
| `experiments.json` | 43 KB | Config, metrics, best epoch, timing for all 57 runs |
| `histories.json` | 248 KB | Per-epoch loss / LR / validation metrics per run |
| `dataset.json` | 415 KB | 2,052 scene records, target areas under 3 label definitions, leakage audit |
| `summary.json` | <1 KB | Headline counts only — keeps the first page load small |
| `samples.json` | 296 KB | Per-scene metrics for 615 evaluated scenes and all four viewer models |
| `threshold.json` | 9 KB | Threshold sweeps, probability histograms, reliability bins, radial profile |
| `presence.json` | ~1.2 MB | Four-model scan/night metrics, ROC curves, Mann–Whitney tests, validation cutoffs and night records |
| `data/samples/*.{sbw.gz,webp}` | ~20 MB | Four probability maps, bit-packed truth and categorical max-six reflectivity in 615 packs, plus 615 thumbnails |

Each scene stores four 8-bit probability maps, bit-packed ground truth and the
categorical maximum reflectivity across elevations 0-5 in one gzip-compressed
SBW1 pack. Metadata also records full-scene and thumbnail dimensions plus
content/model versions. The browser can re-threshold or switch models with no
further request.

---

## Performance decisions

- **Route-level code splitting.** Each section is a dynamic `import()`. A cold
  load of the overview fetches 8 files totalling ~97 KB and reaches
  DOMContentLoaded in ~330 ms; `samples.json`, `histories.json` and the
  sample-explorer code are never touched until needed.
- **A small companion summary.** The overview, stats and about sections need only
  headline counts, so they read the ~1 KB `summary.json` instead of the 415 KB
  `dataset.json`.
- **Lazy thumbnails and packed scenes.** Lossless WebP thumbnails use
  `loading="lazy"`; one gzip pack loads only when a scene is opened. The grid
  caps at 120 tiles and a three-scene LRU limits decoded memory.
- **Paginated tables.** `DataTable` renders one page at a time, so a 600-row
  sample table puts ~20 rows in the DOM.
- **Client-side re-thresholding and model switching.** Both use typed-array views
  from the already-loaded pack; no request is made.
- **Cached fetches.** `data.js` de-duplicates concurrent and repeat requests, so
  revisiting a section costs nothing.
- **Hand-written SVG.** No charting library, so there is no third-party payload
  and nothing to fetch from a CDN.

---

## Conventions

Colour meanings are fixed across every figure and match the project's earlier
PDF report so the two can be compared:

| Colour | Meaning |
|---|---|
| purple | TP — model and label agree |
| red | FP — predicted swarm, no label |
| blue | FN — labelled swarm, missed |
| grey | TN / background |

Colour is always paired with a text label or position; it never carries meaning
on its own.

**Macro vs micro** is stated everywhere. Macro averages per-scene scores (every
scene counts equally); micro pools all pixels (large swarms dominate). Both are
always shown, and validation and test results are never pooled.

---

## Known limitations

1. **Night leakage.** All 170 positive test scenes come from nights that also
   appear in training, and 77 of 117 nights appear in all three splits. Every
   score on this site is therefore optimistic as a measure of generalisation to
   an unseen night. This is surfaced on the overview, in data exploration, on the
   presence page, and in the statistics section — it is the dominant caveat.
2. **Selection is weakly separated.** The selected run leads on test Dice only;
   sibling runs lead on boundary IoU, NSD, precision, recall and validation
   Dice. The defensible claim is "among the best few".
3. **Preview images are optimistic.** Layers are downsampled 960 → 480 with a
   block maximum, which thickens masks. The interactive readout in the sample
   explorer is labelled as approximate; all reported metrics are full resolution.
4. **Imagery covers the test and validation splits** (all 615 evaluated scenes).
   Training scenes have no stored layers; `samples.json` declares which splits are
   covered so the UI never advertises imagery it cannot load.
5. **Probabilities are not calibrated** — usable as a ranking, not as likelihoods.
6. **No per-channel input statistics, weather variables, per-scene optimal
   thresholds, or second annotation.** Each is listed with what it would take in
   the "Methods and glossary" section.
7. **Presence negatives are a curated sample.** Swarm-free scans do not reflect
   operational prevalence, and their all-zero masks are synthesized by dataset
   construction rather than independently annotated pixel by pixel. Presence
   accuracy and precision therefore describe this cohort, not continuous operation.

## Relationship to the earlier PDF report

The project's earlier report evaluates a **different** model (plain U-Net, Focal
loss, six channels including an ETA intensity channel, 341 scans from 2013–2016,
night-based split, threshold 0.5). This dashboard covers the current pipeline
(Attention UNet, nine reflectivity elevations, no ETA channel, 2,052 scenes from
2013–2019, year-stratified split, threshold 0.15). The two sets of numbers are
not comparable and are never mixed. The report's structure is the baseline this
dashboard extends, and one of its findings — performance rising with target
area — is independently reproduced here.
