/* Sample explorer.

   Thumbnails are lazy (loading="lazy") and the full-resolution layers for a
   scene are fetched only when that scene is opened. The viewer re-thresholds
   the stored probability map in a canvas, so moving the slider costs no network
   traffic at all. */

import { load } from '../lib/data.js';
import { M, fmtOr, int, esc, tsLabel, hhmm, quantile } from '../lib/metrics.js';
import { DataTable } from '../lib/table.js';
import { Modal } from '../lib/ui.js';

const IMG = ts => `data/samples/${ts}`;
const PREVIEW = 480;   // stored preview resolution; metrics come from full 960

/* Six discrete reflectivity bands requested for the radar display. The stored
   preview byte spans the displayed -10..25 dBZ range. */
const REFL_BANDS = [
  {max:-1, color:[190, 222, 230], label:'-10 – -1 dBZ'},
  {max: 2, color:[117, 231, 137], label:'-1.1 – 2 dBZ'},
  {max: 7, color:[ 42, 220,  18], label:'2.1 – 7 dBZ'},
  {max:12, color:[247, 235,  39], label:'7.1 – 12 dBZ'},
  {max:19, color:[247, 139,  20], label:'12.1 – 19 dBZ'},
  {max:25, color:[242,  31,  23], label:'19.1 – 25 dBZ'},
];
const reflectivityColor = byte => {
  const dbz = -10 + (byte / 255) * 35;
  return (REFL_BANDS.find(b => dbz <= b.max) || REFL_BANDS.at(-1)).color;
};
const REFL_CSS = `linear-gradient(90deg,
  rgb(190,222,230) 0 25.7%, rgb(117,231,137) 25.7% 34.3%,
  rgb(42,220,18) 34.3% 48.6%, rgb(247,235,39) 48.6% 62.9%,
  rgb(247,139,20) 62.9% 82.9%, rgb(242,31,23) 82.9% 100%)`;

export async function render(mount, query) {
  const sm = await load('samples');
  const all = sm.samples;
  // Splits whose pixel layers were exported by stage `images`. Scenes outside
  // these splits still list their metrics but open without imagery.
  const IMG_SPLITS = new Set(sm.image_splits || ['test', 'val']);
  const withImg = new Set(all.filter(s => IMG_SPLITS.has(s.split)).map(s => s.ts));
  const YEARS = [...new Set(all.map(s => s.year))].sort();
  // The best four models, each scored per scene in `s.models[key]` ({dice} for
  // scenes with a swarm, {bg_fp_rate} for swarm-free scenes). Full per-scene
  // metrics and the pixel layers exist only for the first (selected) model, so
  // switching model re-ranks and re-labels by that model's Dice while the imagery
  // stays the selected model's.
  const MLIST = sm.models || [{key: 'sel', disp: sm.model_name_sel || 'Attention UNet'}];
  const MKEY0 = MLIST[0].key;
  const mname = k => (MLIST.find(m => m.key === k) || {}).disp || k;
  const state = {split: 'test', type: 'pos', year: 'all', night: 'all',
    sort: 'dice', dir: 1, q: '', view: 'grid', preset: 'all'};
  // The list shows the selected model; model choice for a single scene lives in
  // the viewer, not in these filters.
  const dcol = s => { const m = s.models && s.models[MKEY0]; return m ? m.dice : s.dice; };
  const bgcol = s => { const m = s.models && s.models[MKEY0]; return m ? m.bg_fp_rate : s.bg_fp_rate; };

  mount.innerHTML = `
  <h1>Sample explorer</h1>
  <p class="lede">Every evaluated scene. Open one to inspect the layers and move the threshold.</p>
  <p class="small">Previews are ${PREVIEW}px (block-max downsampled from 960), so the interactive readout
  runs a few hundredths of Dice optimistic; the side-panel and full-section numbers are 960×960.</p>

  <div class="ctrls" id="ctrls"></div>
  <div class="chips" id="presets"></div>
  <div class="small" id="count" style="margin-top:8px"></div>
  <div id="body"></div>
  <div id="modal"></div>`;

  /* ---------------- controls ---------------- */
  const ctrls = mount.querySelector('#ctrls');
  const mk = (label, key, opts) => {
    const w = document.createElement('div'); w.className = 'f';
    const id = 's_' + key;
    w.innerHTML = `<label for="${id}">${label}</label><select id="${id}">` +
      opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('') + '</select>';
    w.querySelector('select').addEventListener('change', e => { state[key] = e.target.value; draw(); });
    ctrls.appendChild(w); return w.querySelector('select');
  };
  const splitSel = mk('Split', 'split', [['test', 'Test (held out)'], ['val', 'Validation'], ['all', 'All']]);
  mk('Scene type', 'type', [['pos', 'With swarm'], ['neg', 'Swarm free'], ['all', 'All']]);
  const yearSel = mk('Year', 'year', [['all', 'All years'], ...YEARS.map(y => [y, String(y)])]);
  // Night list is scoped to the current split + year so it never offers a night
  // that cannot match. Rebuilt whenever split or year changes.
  const nightWrap = document.createElement('div'); nightWrap.className = 'f';
  const nightId = 's_night';
  const rebuildNights = () => {
    const ns = [...new Set(all.filter(s => s.label === 1 && s.night &&
      (state.split === 'all' || s.split === state.split) &&
      (state.year === 'all' || String(s.year) === state.year)).map(s => s.night))].sort();
    if (!ns.includes(state.night)) state.night = 'all';
    nightWrap.innerHTML = `<label for="${nightId}">Night</label><select id="${nightId}">` +
      `<option value="all">All nights (${ns.length})</option>` +
      ns.map(n => `<option value="${esc(n)}"${n === state.night ? ' selected' : ''}>${esc(n)}</option>`).join('') +
      '</select>';
    nightWrap.querySelector('select').addEventListener('change', e => { state.night = e.target.value; draw(); });
  };
  ctrls.appendChild(nightWrap); rebuildNights();   // Night sits right after Year
  mk('Sort by', 'sort', [['dice', 'Dice'], ['iou', 'IoU'], ['precision', 'Precision'], ['recall', 'Recall'],
    ['gt_area', 'Truth area'], ['pred_area', 'Predicted area'], ['boundary_iou', 'Boundary IoU'],
    ['n_pred_regions', 'Predicted regions'], ['ts', 'Time']]);
  mk('Order', 'dir', [['1', 'Worst first'], ['-1', 'Best first']]);
  mk('View', 'view', [['grid', 'Thumbnails'], ['table', 'Table']]);
  // After a split/year change (mk already updated state + redrew) reset the night
  // to 'all', rebuild its scoped list, and redraw so the view is never left empty.
  const onScopeChange = () => { state.night = 'all'; rebuildNights(); draw(); };
  splitSel.addEventListener('change', onScopeChange);
  yearSel.addEventListener('change', onScopeChange);

  const sw = document.createElement('div'); sw.className = 'f';
  sw.innerHTML = `<label for="s_q">Find a scene</label>
    <input type="search" id="s_q" placeholder="e.g. 201907240000 or 2019 Jul" style="min-width:210px">`;
  sw.querySelector('input').addEventListener('input', e => { state.q = e.target.value.trim(); draw(); });
  ctrls.appendChild(sw);

  const PRESETS = [
    ['all', 'All scenes'],
    ['fail', 'Failures (Dice < 0.3)'],
    ['zero', 'Zero overlap (Dice = 0)'],
    ['lowrec', 'Missed signal (recall < 0.4)'],
    ['lowprec', 'False alarms (precision < 0.4)'],
    ['frag', 'Fragmented (> 3× truth regions)'],
    ['best', 'Best 20'],
    ['median', 'Around the median'],
  ];
  const presetsEl = mount.querySelector('#presets');
  presetsEl.innerHTML = PRESETS.map(([k, l]) =>
    `<button class="chip${k === 'all' ? ' on' : ''}" data-p="${k}">${esc(l)}</button>`).join('');
  presetsEl.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    state.preset = b.dataset.p;
    presetsEl.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
    draw();
  }));

  /* ---------------- image helpers (shared by thumbnails and the viewer) ------- */
  const loadImg = src => new Promise((res, rej) => {
    const i = new Image(); i.decoding = 'async';
    i.onload = () => res(i); i.onerror = () => rej(new Error('missing ' + src)); i.src = src;
  });
  // one reusable offscreen per resolution; each read is synchronous so sharing is safe
  const _big = document.createElement('canvas'); _big.width = _big.height = PREVIEW;
  const _bigx = _big.getContext('2d', {willReadFrequently: true});
  const px = im => { _bigx.clearRect(0, 0, PREVIEW, PREVIEW); _bigx.drawImage(im, 0, 0, PREVIEW, PREVIEW); return _bigx.getImageData(0, 0, PREVIEW, PREVIEW).data; };
  const T = 120;
  const _thb = document.createElement('canvas'); _thb.width = _thb.height = T;
  const _thbx = _thb.getContext('2d', {willReadFrequently: true});
  // Thumbnail: banded reflectivity with the model's prediction tinted over it,
  // so the grid shows the radar returns in colour rather than a white/black mask.
  function renderThumb(canvas, ts) {
    const c2 = canvas.getContext('2d');
    Promise.all([loadImg(`${IMG(ts)}_th.png`), loadImg(`${IMG(ts)}_thumb.png`)]).then(([th, pr]) => {
      _thbx.clearRect(0, 0, T, T); _thbx.drawImage(th, 0, 0, T, T); const R = _thbx.getImageData(0, 0, T, T).data;
      _thbx.clearRect(0, 0, T, T); _thbx.drawImage(pr, 0, 0, T, T); const PR = _thbx.getImageData(0, 0, T, T).data;
      const o = c2.createImageData(T, T), d = o.data;
      for (let i = 0; i < R.length; i += 4) {
        const c = reflectivityColor(R[i]); let r = c[0], g = c[1], b = c[2];
        if (PR[i] > 127) { r = r * 0.25 + 47 * 0.75; g = g * 0.25 + 125 * 0.75; b = b * 0.25 + 209 * 0.75; }
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
      c2.putImageData(o, 0, 0);
    }).catch(() => {});
  }

  /* ---------------- filtering ---------------- */
  function rows() {
    let r = all.filter(s =>
      (state.split === 'all' || s.split === state.split) &&
      (state.type === 'all' || (state.type === 'pos' ? s.label === 1 : s.label === 0)) &&
      (state.year === 'all' || String(s.year) === state.year) &&
      (state.night === 'all' || s.night === state.night));
    if (state.q) {
      const q = state.q.toLowerCase();
      r = r.filter(s => String(s.ts).includes(q) || (s.night || '').toLowerCase().includes(q));
    }
    const P = state.preset;
    if (P === 'fail') r = r.filter(s => dcol(s) != null && dcol(s) < 0.3);
    else if (P === 'zero') r = r.filter(s => dcol(s) != null && dcol(s) === 0);
    else if (P === 'lowrec') r = r.filter(s => s.recall != null && s.recall < 0.4);
    else if (P === 'lowprec') r = r.filter(s => s.precision != null && s.precision < 0.4);
    else if (P === 'frag') r = r.filter(s => s.n_gt_regions > 0 && s.n_pred_regions > 3 * s.n_gt_regions);
    else if (P === 'best') {
      r = [...r].filter(s => dcol(s) != null).sort((a, b) => dcol(b) - dcol(a)).slice(0, 20);
    } else if (P === 'median') {
      const d = r.map(s => dcol(s)).filter(v => v != null);
      const med = quantile(d, .5);
      r = [...r].filter(s => dcol(s) != null).sort((a, b) =>
        Math.abs(dcol(a) - med) - Math.abs(dcol(b) - med)).slice(0, 20);
    }
    // sorting by "dice" follows the active model; every other key is model-agnostic
    const k = state.sort, dir = +state.dir;
    const val = (s) => k === 'dice' ? dcol(s) : s[k];
    return [...r].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return dir * (x - y);
    });
  }

  /* ---------------- render list ---------------- */
  let table = null;
  function draw() {
    const r = rows();
    const missingImg = r.filter(s => !withImg.has(s.ts)).length;
    mount.querySelector('#count').innerHTML =
      `<b>${r.length}</b> scene${r.length === 1 ? '' : 's'} match. ` +
      (missingImg ? `<span style="color:var(--warn)">${missingImg} of them have no stored imagery.</span>` : 'Click any scene to open it.');
    const body = mount.querySelector('#body');
    if (!r.length) {
      body.innerHTML = `<div class="state"><div class="big">No scenes match</div>
        <div class="small">Clear the search box or choose the “All scenes” preset.</div></div>`;
      return;
    }
    if (state.view === 'grid') {
      body.innerHTML = `<div class="sgrid">` + r.slice(0, 120).map(s => {
        const has = withImg.has(s.ts);
        return `<button class="scell" data-ts="${s.ts}">
          ${has ? `<canvas class="im" width="120" height="120" data-ts="${s.ts}" style="display:block"
             aria-label="Reflectivity with prediction for scene ${tsLabel(s.ts)}"></canvas>`
            : `<span class="im" style="display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--muted)">no image</span>`}
          <span class="cap"><b>${hhmm(s.ts)}</b> <span class="m">${String(s.ts).slice(0, 8)}</span><br>
          ${s.label === 1
            ? `<span class="m">Dice ${fmtOr(dcol(s), 'dice')} · ${int(s.gt_area)} px</span>`
            : `<span class="m">no swarm · FP ${fmtOr(bgcol(s), 'bg_fp_rate')}</span>`}</span>
        </button>`;
      }).join('') + `</div>
        <p class="small" style="margin-top:10px">
          Thumbnails show <span class="swk" style="vertical-align:-2px;background:${REFL_CSS}"></span>
          <b>reflectivity</b> (-10 to 25 dBZ) with the model's
          <span class="swk" style="vertical-align:-2px;background:rgb(47,125,209)"></span> <b>prediction</b>
          at threshold ${sm.threshold}. Open a scene for the labelled error view and the layer controls.</p>` +
        (r.length > 120 ? `<p class="small">Showing the first 120 of ${r.length}. Narrow the filters or switch to the table view to see the rest.</p>` : '');
      body.querySelectorAll('.scell').forEach(b =>
        b.addEventListener('click', () => open(+b.dataset.ts)));
      body.querySelectorAll('canvas.im[data-ts]').forEach(c => renderThumb(c, +c.dataset.ts));
    } else {
      body.innerHTML = `<div id="tbl"></div>`;
      // flatten each model's per-scene Dice onto the row so the table can show
      // and sort a column per model (DataTable reads/sorts by a top-level key)
      r.forEach(s => MLIST.forEach(m => { s['d_' + m.key] = ((s.models && s.models[m.key]) || {}).dice ?? null; }));
      const shortM = d => d.replace('Attention UNet', 'AttUNet').replace(' (', ' ').replace(' elev)', 'e').replace(')', '');
      table = new DataTable(body.querySelector('#tbl'), {
        columns: [
          {key: 'ts', label: 'Scene', cls: '', fmt: v => `<code>${v}</code>`},
          {key: 'night', label: 'Night', cls: '', fmt: v => esc(v || '—')},
          {key: 'split', label: 'Split', cls: ''},
          ...MLIST.map((m, i) => ({key: 'd_' + m.key, label: 'Dice ' + shortM(m.disp),
            tip: i === 0 ? M.dice.def + ' Selected model.' : 'Same scene scored by ' + m.disp + '.',
            fmt: v => fmtOr(v, 'dice')})),
          {key: 'iou', label: 'IoU', tip: 'Selected model.', fmt: v => fmtOr(v, 'iou')},
          {key: 'precision', label: 'Prec', tip: 'Selected model.', fmt: v => fmtOr(v, 'precision')},
          {key: 'recall', label: 'Rec', tip: 'Selected model.', fmt: v => fmtOr(v, 'recall')},
          {key: 'boundary_iou', label: 'bIoU', tip: 'Selected model.', fmt: v => fmtOr(v, 'boundary_iou')},
          {key: 'gt_area', label: 'Truth px', fmt: v => int(v)},
          {key: 'pred_area', label: 'Pred px', fmt: v => int(v)},
        ],
        rows: r, sort: state.sort === 'dice' ? 'd_' + MKEY0 : state.sort, dir: +state.dir, pageSize: 20,
        onRow: s => open(s.ts),
      });
    }
  }

  /* ---------------- viewer ----------------
     The modal shell (title, arrows, top controls, panels) is built once per open.
     Same-night chips and the prev/next arrows then call loadScene(), which swaps
     the scene image and analysis in place — the window is not rebuilt, so the
     layer/threshold/model controls keep their state. */
  const modalEl = mount.querySelector('#modal');
  const modal = new Modal(modalEl);
  const q = sel => modalEl.querySelector(sel);
  const modelKey = () => q('input[name="v_model"]:checked')?.value || MKEY0;
  const C_GT = [106, 62, 161], C_PRED = [47, 125, 209];

  // per-open viewer state, reused across in-place scene changes
  let curS = null, P = null, G = null, TH = null, out = null, ctx = null;
  let vlist = [], vidx = 0, imgToken = 0;

  const SHELL = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Scene viewer">
      <div class="box">
        <div class="hd">
          <h2 id="v-title" style="flex:1"></h2>
          <button id="prev" aria-label="Previous scene">←</button>
          <button id="next" aria-label="Next scene">→</button>
          <button id="x" aria-label="Close">✕ Close</button>
        </div>
        <div class="viewer-controls" id="v-ctrls">
          <div class="viewer-control-row">
            <span class="viewer-control-label">Model</span>
            <div class="model-choices" role="radiogroup" aria-label="Model">
              ${MLIST.map((m, i) => `<label class="model-choice">
                <input type="radio" name="v_model" value="${esc(m.key)}"${i === 0 ? ' checked' : ''}>
                <span>${esc(m.disp)}</span>${i === 0 ? '<small>selected</small>' : ''}
              </label>`).join('')}
            </div>
          </div>
          <div class="viewer-control-row">
            <span class="viewer-control-label">Layers</span>
            <div class="layer-choices" id="lays">
              <label class="chk"><input type="checkbox" id="l_refl" checked> Reflectivity</label>
              <label class="chk"><input type="checkbox" id="l_gt" checked> Ground truth</label>
              <label class="chk"><input type="checkbox" id="l_pred" checked> Prediction</label>
            </div>
          </div>
          <div class="viewer-control-row viewer-range-row">
            <span class="viewer-control-label">Display</span>
            <div class="viewer-slider"><label for="thr">Threshold <b id="thv">—</b></label>
              <input type="range" id="thr" min="0.02" max="0.9" step="0.01" value="0.15"></div>
            <div class="viewer-slider"><label for="op">Overlay opacity</label>
              <input type="range" id="op" min="0" max="1" step="0.05" value="0.75"></div>
            <button id="rst" class="ghost compact">Reset threshold</button>
          </div>
          <div class="viewer-control-row viewer-night-row">
            <span class="viewer-control-label">Same night</span>
            <div id="night"></div>
          </div>
        </div>
        <div class="viewer">
          <div>
            <div class="stage" id="stage" style="position:relative">
              <canvas id="cv" width="${PREVIEW}" height="${PREVIEW}" style="display:block" aria-label="Segmentation overlay"></canvas>
              <div id="leg2" style="position:absolute;top:8px;left:8px;display:none;flex-direction:column;gap:3px;background:rgba(15,17,21,.66);color:#fff;padding:7px 9px;border-radius:8px;font:500 11px/1.5 var(--sans);pointer-events:none;box-shadow:0 1px 6px rgba(0,0,0,.45)"></div>
              <div id="noimg" class="state" style="display:none;position:absolute;inset:0;border:0;background:var(--panel)"></div>
            </div>
            <p class="small" id="live"></p>
          </div>
          <div>
            <h3 style="margin-top:0">Scene</h3><div class="kv" id="v-scene"></div>
            <h3 id="v-metrics-h">Metrics</h3><div class="kv" id="v-metrics"></div>
            <p class="small" id="v-metrics-note" style="display:none"></p>
            <h3>Model comparison</h3><div class="kv" id="v-cmp"></div>
            <p class="small" id="v-cmp-note"></p>
          </div>
        </div>
      </div>
    </div>`;

  function drawLegend(L, counts) {
    const leg2 = q('#leg2'), total = PREVIEW * PREVIEW;
    const sw = bg => `<span style="display:inline-block;width:13px;height:11px;border-radius:2px;flex:none;background:${bg}"></span>`;
    const row = (bg, name, n) => `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
      ${sw(bg)}<span>${esc(name)}</span>${n == null ? '' : `<span style="margin-left:auto;padding-left:12px;opacity:.75">${((n / total) * 100).toFixed(n / total < 0.01 ? 2 : 1)}%</span>`}</div>`;
    const rows = [];
    if (L.pred) rows.push(row('rgb(47,125,209)', 'Prediction', counts.tp + counts.fp));
    if (L.gt) rows.push(row('rgb(106,62,161)', 'Ground truth', counts.tp + counts.fn));
    if (L.refl) REFL_BANDS.forEach(b => rows.push(row(`rgb(${b.color.join(',')})`, b.label, null)));
    leg2.innerHTML = rows.join('');
    leg2.style.display = rows.length ? 'flex' : 'none';
  }

  function paint() {
    if (!curS || !P || !ctx) return;
    const t = +q('#thr').value, op = +q('#op').value;
    const L = {refl: q('#l_refl').checked, gt: q('#l_gt').checked, pred: q('#l_pred').checked};
    const cut = t * 255, d = out.data;
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0, p = 0; i < P.length; i += 4, p += 4) {
      const prob = P[i], gt = G[i] > 127, pred = prob > cut;
      if (gt && pred) tp++; else if (pred) fp++; else if (gt) fn++;
      let r = 0, g = 0, b = 0;
      if (L.refl) { const c = reflectivityColor(TH[i]); r = c[0]; g = c[1]; b = c[2]; }
      const over = c => { r = r * (1 - op) + c[0] * op; g = g * (1 - op) + c[1] * op; b = b * (1 - op) + c[2] * op; };
      if (L.gt && gt) over(C_GT);
      if (L.pred && pred) over(C_PRED);
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    const s = curS;
    const dice = tp ? 2 * tp / (2 * tp + fp + fn) : 0;
    const prec = (tp + fp) ? tp / (tp + fp) : 0, rec = (tp + fn) ? tp / (tp + fn) : 0;
    const authDice = (s.models && s.models[modelKey()] || {}).dice ?? s.dice;
    q('#thv').textContent = t.toFixed(2);
    drawLegend(L, {tp, fp, fn});
    q('#live').innerHTML = s.label === 1
      ? `On this ${PREVIEW}px preview at threshold ${t.toFixed(2)}: Dice <b>${dice.toFixed(3)}</b>,
         precision ${prec.toFixed(3)}, recall ${rec.toFixed(3)} (TP ${int(tp)}, FP ${int(fp)}, FN ${int(fn)} preview px).
         <span style="color:var(--muted)">Full-resolution Dice at threshold ${s.thr} is ${fmtOr(authDice, 'dice')}.</span>`
      : `Swarm-free scene. ${int(fp)} preview px predicted as swarm at threshold ${t.toFixed(2)}.`;
  }

  function renderPanels() {
    const s = curS, vm = modelKey();
    q('#v-scene').innerHTML = [
      ['Timestamp', s.ts], ['Night', esc(s.night || '—')], ['Split', esc(s.split)],
      ['Type', s.label ? 'has swarm' : 'swarm free'], ['Hour (UTC)', String(s.hour).padStart(2, '0') + ':00'],
    ].map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${v}</span>`).join('');

    q('#v-metrics-h').textContent = `Metrics — ${mname(vm)}`;
    q('#v-metrics-note').style.display = 'none';
    const m = (s.models && s.models[vm]) || {};
    let rowsM;
    if (s.label === 1) {
      rowsM = [['Dice', fmtOr(m.dice, 'dice')], ['IoU', fmtOr(m.iou, 'iou')],
        ['Precision', fmtOr(m.precision, 'precision')], ['Recall', fmtOr(m.recall, 'recall')],
        ['Boundary IoU', fmtOr(m.boundary_iou, 'boundary_iou')], ['NSD', fmtOr(m.nsd, 'nsd')],
        ['HD95', fmtOr(m.hd95, 'hd95')], ['ASSD', fmtOr(m.assd, 'assd')],
        ['Truth area', int(s.gt_area)], ['Predicted area', m.pred_area != null ? int(m.pred_area) : '—'],
        ['TP', m.tp != null ? int(m.tp) : '—'], ['FP', m.fp != null ? int(m.fp) : '—'], ['FN', m.fn != null ? int(m.fn) : '—'],
        ['Truth regions', s.n_gt_regions ?? '—'], ['Pred regions', m.n_pred_regions ?? '—']];
    } else {
      rowsM = [['Predicted area', m.pred_area != null ? int(m.pred_area) : '—'],
        ['False-positive rate', fmtOr(m.bg_fp_rate, 'bg_fp_rate')], ['Max probability', fmtOr(s.prob_max, 'dice')]];
    }
    q('#v-metrics').innerHTML = rowsM.map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${v}</span>`).join('');

    q('#v-cmp').innerHTML = MLIST.map(m2 => {
      const mm = (s.models && s.models[m2.key]) || {};
      const v = s.label ? fmtOr(mm.dice, 'dice') : fmtOr(mm.bg_fp_rate, 'bg_fp_rate');
      const hl = m2.key === vm ? ' style="color:var(--accent2);font-weight:600"' : '';
      return `<span class="k"${hl}>${esc(m2.disp)}${m2.key === MKEY0 ? ' ★' : ''}</span><span class="v"${hl}>${v}</span>`;
    }).join('');
    q('#v-cmp-note').innerHTML = `${s.label ? 'Per-scene Dice' : 'False-alarm rate'} for all four best models.
      ★ is the selected model; the image and metrics above follow the model chosen at the top.`;
  }

  function renderNight() {
    const s = curS, ts = s.ts, el = q('#night');
    const sib = all.filter(x => x.night && x.night === s.night).sort((a, b) => a.ts - b.ts);
    el.innerHTML = sib.length > 1
      ? `<div class="chips">` + sib.map(x =>
          `<button class="chip${x.ts === ts ? ' on' : ''}" data-ts="${x.ts}" title="${x.split} split">
            ${hhmm(x.ts)} ${x.label ? `· ${fmtOr((x.models && x.models[MKEY0] || {}).dice ?? x.dice, 'dice')}` : '· empty'}</button>`).join('') + `</div>
         <p class="small">${sib.length} scans on ${esc(s.night)} across ${[...new Set(sib.map(x => x.split))].join(' / ')}. Selecting one updates the view in place.</p>`
      : `<p class="small">No other scans from this night.</p>`;
    el.querySelectorAll('.chip[data-ts]').forEach(b => b.addEventListener('click', () => loadScene(+b.dataset.ts)));
  }

  async function loadScene(ts) {
    const s = all.find(x => x.ts === ts); if (!s) return;
    curS = s; vidx = vlist.findIndex(x => x.ts === ts);
    q('#v-title').textContent = tsLabel(ts);
    q('#prev').disabled = vidx <= 0;
    q('#next').disabled = vidx >= vlist.length - 1;
    renderPanels(); renderNight();
    const has = withImg.has(ts), cv = q('#cv'), noimg = q('#noimg'), leg2 = q('#leg2');
    if (!has) {
      cv.style.display = 'none'; leg2.style.display = 'none'; noimg.style.display = 'flex';
      noimg.innerHTML = `<div><div class="big">No imagery exported</div>
        <div class="small">Pixel layers were not exported for the ${esc(s.split)} split. Metrics are still full resolution.</div></div>`;
      q('#live').textContent = ''; P = G = TH = null;
      return;
    }
    cv.style.display = 'block'; noimg.style.display = 'none';
    const my = ++imgToken;
    try {
      const [ip, ig, it] = await Promise.all([
        loadImg(`${IMG(ts)}_prob_${modelKey()}.png`), loadImg(`${IMG(ts)}_gt.png`), loadImg(`${IMG(ts)}_th.png`)]);
      if (my !== imgToken) return;   // a newer navigation superseded this load
      P = px(ip); G = px(ig); TH = px(it);
      paint();
    } catch (e) {
      if (my !== imgToken) return;
      cv.style.display = 'none'; noimg.style.display = 'flex';
      noimg.innerHTML = `<div><div class="big">Image failed to load</div><div class="small">${esc(e.message)}</div></div>`;
    }
  }

  // Model change: reload the current scene with the chosen model's prediction.
  // Going through loadScene fetches the three layers atomically (ground truth and
  // reflectivity come straight from cache), so P, G and TH always belong to the
  // same scene — a model switch mid-load can never leave a mismatched overlay.
  function applyModel() { if (curS) loadScene(curS.ts); }

  function step(dir) { const t = vlist[vidx + dir]; if (t) loadScene(t.ts); }

  function open(ts) {
    vlist = rows();
    modal.open(SHELL, {onPrev: () => step(-1), onNext: () => step(1)});
    ctx = q('#cv').getContext('2d', {willReadFrequently: true});
    out = ctx.createImageData(PREVIEW, PREVIEW);
    q('#x').addEventListener('click', () => modal.close());
    q('#prev').addEventListener('click', () => step(-1));
    q('#next').addEventListener('click', () => step(1));
    ['#l_refl', '#l_gt', '#l_pred', '#thr', '#op'].forEach(sel => q(sel).addEventListener('input', paint));
    modalEl.querySelectorAll('input[name="v_model"]').forEach(el => el.addEventListener('change', applyModel));
    q('#rst').addEventListener('click', () => { q('#thr').value = curS ? curS.thr : 0.15; paint(); });
    loadScene(ts);
  }

  draw();
  if (query && query.get('ts')) open(+query.get('ts'));
  return {
    onQuery: qy => { if (qy.get('ts')) open(+qy.get('ts')); },
    destroy: () => modal.destroy(),
  };
}
