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

/* Viridis colormap (matplotlib), used to colour the reflectivity base so it
   matches the report's radar figures (which plot reflectivity with viridis)
   instead of a plain greyscale ramp. */
const VIRIDIS = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [223, 227, 41], [253, 231, 37]];
function viridis(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = t * (VIRIDIS.length - 1), i = Math.floor(x), f = x - i;
  const a = VIRIDIS[i], b = VIRIDIS[Math.min(i + 1, VIRIDIS.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
const VIRIDIS_CSS = 'linear-gradient(90deg,rgb(68,1,84),rgb(38,130,142),rgb(94,201,98),rgb(253,231,37))';

export async function render(mount, query) {
  const sm = await load('samples');
  const all = sm.samples;
  // Splits whose pixel layers were exported by stage `images`. Scenes outside
  // these splits still list their metrics but open without imagery.
  const IMG_SPLITS = new Set(sm.image_splits || ['test', 'val']);
  const withImg = new Set(all.filter(s => IMG_SPLITS.has(s.split)).map(s => s.ts));
  const YEARS = [...new Set(all.map(s => s.year))].sort();
  // 'sel' = the selected model (Attention UNet, s.dice); 'cmp' = the UNet++
  // comparison (s.dice_cmp). Only Dice exists for the comparison model, so the
  // toggle re-ranks and re-labels by Dice; full metrics and images stay selected-model.
  const MODELS = {sel: sm.model_name_sel || 'Attention UNet', cmp: sm.model_name_cmp || 'UNet++ (9 elev)'};
  const state = {split: 'test', type: 'pos', year: 'all', night: 'all', model: 'sel',
    sort: 'dice', dir: 1, q: '', view: 'grid', preset: 'all'};
  // Dice of the currently selected model, used for sorting, presets and display.
  const dcol = s => state.model === 'cmp' ? s.dice_cmp : s.dice;
  const bgcol = s => state.model === 'cmp' ? s.bg_fp_rate_cmp : s.bg_fp_rate;

  mount.innerHTML = `
  <h1>Sample explorer</h1>
  <p class="lede">Every evaluated scene, searchable and sortable. Open one to inspect the reflectivity
  input, the label, the probability map and the errors, and to move the decision threshold yourself.</p>

  <div class="note"><span class="tag">how to read the previews</span><div class="bd">
    Pixel layers are stored for <b>${withImg.size} scenes</b> across the
    ${[...IMG_SPLITS].join(' and ')} split${IMG_SPLITS.size > 1 ? 's' : ''}.
    Previews are ${PREVIEW}×${PREVIEW}, downsampled from 960×960 by taking the maximum of each
    2×2 block so thin swarms stay visible. That thickens both masks, so the
    <b>interactive readout is systematically optimistic</b>, typically by a few hundredths of Dice.
    Use it to judge <i>shape and where the errors are</i>, not to quote a score. Every number in the
    side panel and in all other sections is computed at full 960×960 resolution.
  </div></div>

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
  mk('Model', 'model', [['sel', MODELS.sel + ' (selected)'], ['cmp', MODELS.cmp]]);
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
          ${has ? `<img class="im" loading="lazy" decoding="async" width="120" height="120"
             src="${IMG(s.ts)}_thumb.png" alt="Predicted mask for scene ${tsLabel(s.ts)}">`
            : `<span class="im" style="display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--muted)">no image</span>`}
          <span class="cap"><b>${hhmm(s.ts)}</b> <span class="m">${String(s.ts).slice(0, 8)}</span><br>
          ${s.label === 1
            ? `<span class="m">Dice ${fmtOr(dcol(s), 'dice')} · ${int(s.gt_area)} px</span>`
            : `<span class="m">no swarm · FP ${fmtOr(bgcol(s), 'bg_fp_rate')}</span>`}</span>
        </button>`;
      }).join('') + `</div>
        <p class="small" style="margin-top:10px">
          <span class="swk" style="background:#fff;vertical-align:-3px"></span> <b>white</b> = predicted swarm,
          <span class="swk" style="background:#000;vertical-align:-3px"></span> <b>black</b> = background,
          at the project threshold ${sm.threshold}. Open a scene for the labelled error view.
          ${state.model === 'cmp' ? `<b style="color:var(--warn)">Dice shown is ${esc(MODELS.cmp)}; the thumbnail is still the selected model (only it has stored images).</b>` : ''}</p>` +
        (r.length > 120 ? `<p class="small">Showing the first 120 of ${r.length}. Narrow the filters or switch to the table view to see the rest.</p>` : '');
      body.querySelectorAll('.scell').forEach(b =>
        b.addEventListener('click', () => open(+b.dataset.ts)));
    } else {
      body.innerHTML = `<div id="tbl"></div>`;
      table = new DataTable(body.querySelector('#tbl'), {
        columns: [
          {key: 'ts', label: 'Scene', cls: '', fmt: v => `<code>${v}</code>`},
          {key: 'night', label: 'Night', cls: '', fmt: v => esc(v || '—')},
          {key: 'split', label: 'Split', cls: ''},
          {key: 'dice', label: 'Dice (Att.UNet)', tip: M.dice.def + ' Selected model.', fmt: v => fmtOr(v, 'dice')},
          {key: 'iou', label: 'IoU', fmt: v => fmtOr(v, 'iou')},
          {key: 'precision', label: 'Prec', fmt: v => fmtOr(v, 'precision')},
          {key: 'recall', label: 'Rec', fmt: v => fmtOr(v, 'recall')},
          {key: 'boundary_iou', label: 'bIoU', fmt: v => fmtOr(v, 'boundary_iou')},
          {key: 'gt_area', label: 'Truth px', fmt: v => int(v)},
          {key: 'pred_area', label: 'Pred px', fmt: v => int(v)},
          {key: 'n_gt_regions', label: 'GT reg', fmt: v => v ?? '—'},
          {key: 'n_pred_regions', label: 'Pred reg', fmt: v => v ?? '—'},
          {key: 'dice_cmp', label: 'Dice (UNet++)', tip: 'Same scene scored by the comparison model.', fmt: v => fmtOr(v, 'dice')},
        ],
        rows: r, sort: state.sort, dir: +state.dir, pageSize: 20,
        onRow: s => open(s.ts),
      });
    }
  }

  /* ---------------- viewer ---------------- */
  const modalEl = mount.querySelector('#modal');
  const modal = new Modal(modalEl);
  const close = () => modal.close();

  async function open(ts) {
    const s = all.find(x => x.ts === ts);
    if (!s) return;
    const list = rows();
    const idx = list.findIndex(x => x.ts === ts);
    const has = withImg.has(ts);
    const html = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="Scene ${tsLabel(ts)}">
        <div class="box">
          <div class="hd">
            <h2 style="flex:1">${tsLabel(ts)}</h2>
            <button id="prev" ${idx <= 0 ? 'disabled' : ''} aria-label="Previous scene">←</button>
            <button id="next" ${idx >= list.length - 1 ? 'disabled' : ''} aria-label="Next scene">→</button>
            <button id="x" aria-label="Close">✕ Close</button>
          </div>
          <div class="viewer">
            <div>
              <div class="stage" id="stage" style="position:relative">
                ${has ? `<canvas id="cv" width="${PREVIEW}" height="${PREVIEW}" style="display:block"
                          aria-label="Segmentation overlay for ${tsLabel(ts)}"></canvas>
                         <div id="leg2" style="position:absolute;top:8px;left:8px;display:flex;flex-direction:column;gap:3px;background:rgba(15,17,21,.66);color:#fff;padding:7px 9px;border-radius:8px;font:500 11px/1.5 var(--sans);pointer-events:none;box-shadow:0 1px 6px rgba(0,0,0,.45)"></div>`
                      : `<div class="state" style="height:100%;border:0;background:var(--panel)">
                           <div class="big">No imagery exported</div>
                           <div class="small">Pixel layers were not exported for the ${esc(s.split)} split. Metrics on the right are still full resolution.</div></div>`}
              </div>
              ${has ? `
              <div class="ctrls" style="margin-top:12px">
                <div class="f" style="align-items:flex-start"><label>Layers</label>
                  <div class="chips" id="lays" style="gap:6px 12px">
                    <label class="chk"><input type="checkbox" id="l_refl" checked> Reflectivity (base)</label>
                    <label class="chk"><input type="checkbox" id="l_prob"> Probability</label>
                    <label class="chk"><input type="checkbox" id="l_gt" checked> Ground truth</label>
                    <label class="chk"><input type="checkbox" id="l_pred" checked> Prediction</label>
                  </div></div>
                <div class="f"><label for="thr">Threshold <b id="thv">${s.thr}</b></label>
                  <input type="range" id="thr" min="0.02" max="0.9" step="0.01" value="${s.thr}"></div>
                <div class="f"><label for="op">Overlay opacity</label>
                  <input type="range" id="op" min="0" max="1" step="0.05" value="0.75"></div>
                <button id="rst" class="ghost">Reset to ${s.thr}</button>
              </div>
              <p class="small" id="live"></p>` : ''}
            </div>
            <div>
              <h3 style="margin-top:0">Scene</h3>
              <div class="kv">
                <span class="k">Timestamp</span><span class="v">${ts}</span>
                <span class="k">Night</span><span class="v">${esc(s.night || '—')}</span>
                <span class="k">Split</span><span class="v">${esc(s.split)}</span>
                <span class="k">Type</span><span class="v">${s.label ? 'has swarm' : 'swarm free'}</span>
                <span class="k">Hour (UTC)</span><span class="v">${String(s.hour).padStart(2, '0')}:00</span>
              </div>
              <h3>Metrics at threshold ${s.thr}</h3>
              <div class="kv">${
                s.label === 1 ? [
                  ['Dice', fmtOr(s.dice, 'dice')], ['IoU', fmtOr(s.iou, 'iou')],
                  ['Precision', fmtOr(s.precision, 'precision')], ['Recall', fmtOr(s.recall, 'recall')],
                  ['Boundary IoU', fmtOr(s.boundary_iou, 'boundary_iou')], ['NSD', fmtOr(s.nsd, 'nsd')],
                  ['HD95', fmtOr(s.hd95, 'hd95')], ['ASSD', fmtOr(s.assd, 'assd')],
                  ['Truth area', int(s.gt_area)], ['Predicted area', int(s.pred_area)],
                  ['TP', int(s.tp)], ['FP', int(s.fp)], ['FN', int(s.fn)],
                  ['Truth regions', s.n_gt_regions ?? '—'], ['Pred regions', s.n_pred_regions ?? '—'],
                  ['Truth mean range', s.gt_dist_km != null ? s.gt_dist_km + ' km' : '—'],
                ].map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${v}</span>`).join('')
                : [['Predicted area', int(s.pred_area)], ['False-positive rate', fmtOr(s.bg_fp_rate, 'bg_fp_rate')],
                   ['Max probability', fmtOr(s.prob_max, 'dice')]]
                  .map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${v}</span>`).join('')}
              </div>
              <h3>Model comparison</h3>
              <div class="kv">
                <span class="k">Attention UNet</span><span class="v">${s.label ? fmtOr(s.dice, 'dice') : fmtOr(s.bg_fp_rate, 'bg_fp_rate')}</span>
                <span class="k">UNet++ (9 elev)</span><span class="v">${s.label ? fmtOr(s.dice_cmp, 'dice') : fmtOr(s.bg_fp_rate_cmp, 'bg_fp_rate')}</span>
                <span class="k">Difference</span><span class="v">${
                  s.label && s.dice != null && s.dice_cmp != null
                    ? ((s.dice - s.dice_cmp >= 0 ? '+' : '') + (s.dice - s.dice_cmp).toFixed(3)) : '—'}</span>
              </div>
              <p class="small">Only the selected model's pixel layers are stored, so the comparison is
              numeric rather than visual.</p>
              <h3>Same night</h3>
              <div id="night"></div>
            </div>
          </div>
        </div>
      </div>`;

    // Modal owns focus, the key handler and the scroll lock, so re-rendering the
    // body for the next scene cannot stack listeners or strand the page locked.
    const nav = d => { const t = list[idx + d]; if (t) open(t.ts); };
    modal.open(html, {onPrev: () => nav(-1), onNext: () => nav(1)});

    modalEl.querySelector('#x').addEventListener('click', close);
    modalEl.querySelector('#prev').addEventListener('click', () => nav(-1));
    modalEl.querySelector('#next').addEventListener('click', () => nav(1));

    // sibling scans from the same night
    const sib = all.filter(x => x.night && x.night === s.night).sort((a, b) => a.ts - b.ts);
    modalEl.querySelector('#night').innerHTML = sib.length > 1
      ? `<div class="chips">` + sib.map(x =>
          `<button class="chip${x.ts === ts ? ' on' : ''}" data-ts="${x.ts}" title="${x.split} split">
            ${hhmm(x.ts)} ${x.label ? `· ${fmtOr(x.dice, 'dice')}` : '· empty'}</button>`).join('') + `</div>
         <p class="small">${sib.length} scans on ${esc(s.night)} across ${[...new Set(sib.map(x => x.split))].join(' / ')}.</p>`
      : `<p class="small">No other scans from this night.</p>`;
    modalEl.querySelectorAll('#night .chip').forEach(b =>
      b.addEventListener('click', () => open(+b.dataset.ts)));

    if (has) await setupCanvas(s);
  }

  /* ---------------- canvas compositing ---------------- */
  async function setupCanvas(s) {
    const cv = modalEl.querySelector('#cv');
    const ctx = cv.getContext('2d', {willReadFrequently: true});
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, PREVIEW, PREVIEW);
    const px = (im) => {
      const c = document.createElement('canvas');
      c.width = c.height = PREVIEW;
      const x = c.getContext('2d', {willReadFrequently: true});
      x.drawImage(im, 0, 0, PREVIEW, PREVIEW);
      return x.getImageData(0, 0, PREVIEW, PREVIEW).data;
    };
    const loadImg = src => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('missing ' + src));
      i.src = src;
    });

    let P, G, TH;
    try {
      const [ip, ig, it] = await Promise.all([
        loadImg(`${IMG(s.ts)}_prob.png`), loadImg(`${IMG(s.ts)}_gt.png`), loadImg(`${IMG(s.ts)}_th.png`)]);
      P = px(ip); G = px(ig); TH = px(it);
    } catch (e) {
      modalEl.querySelector('#stage').innerHTML =
        `<div class="state" style="height:100%;border:0"><div class="big">Image failed to load</div>
         <div class="small">${esc(e.message)}</div></div>`;
      return;
    }

    const out = ctx.createImageData(PREVIEW, PREVIEW);
    const q = sel => modalEl.querySelector(sel);
    const thrEl = q('#thr'), opEl = q('#op'), thv = q('#thv'), live = q('#live'), leg2 = q('#leg2');
    const reflEl = q('#l_refl'), probEl = q('#l_prob'), gtEl = q('#l_gt'), predEl = q('#l_pred');
    // canvas overlay colours, kept in sync with the legend swatches
    const C_GT = [106, 62, 161], C_PRED = [47, 125, 209];

    const rgb = v => {
      // perceptually ordered heat ramp for probability
      const t = v / 255;
      return [Math.round(255 * Math.min(1, t * 1.6)),
              Math.round(255 * Math.max(0, Math.min(1, t * 1.6 - 0.5))),
              Math.round(255 * Math.max(0, t * 1.2 - 0.75))];
    };

    function paint() {
      const t = +thrEl.value, op = +opEl.value;
      const L = {refl: reflEl.checked, prob: probEl.checked, gt: gtEl.checked, pred: predEl.checked};
      const cut = t * 255;
      let tp = 0, fp = 0, fn = 0;
      const d = out.data;
      // Layers are alpha-blended bottom to top over the reflectivity base (viridis,
      // matching the report's radar figures), so the base shows through wherever an
      // overlay is absent. Where prediction and ground truth overlap you see the
      // correct hits; prediction-only is a false alarm, ground-truth-only is a miss.
      for (let i = 0, p = 0; i < P.length; i += 4, p += 4) {
        const prob = P[i], gt = G[i] > 127, pred = prob > cut;
        if (gt && pred) tp++; else if (pred) fp++; else if (gt) fn++;
        let r = 0, g = 0, b = 0;
        if (L.refl) { const c = viridis(TH[i] / 255); r = c[0]; g = c[1]; b = c[2]; }
        const over = c => { r = r * (1 - op) + c[0] * op; g = g * (1 - op) + c[1] * op; b = b * (1 - op) + c[2] * op; };
        if (L.prob) over(rgb(prob));
        if (L.gt && gt) over(C_GT);
        if (L.pred && pred) over(C_PRED);
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      const dice = tp ? 2 * tp / (2 * tp + fp + fn) : 0;
      const prec = (tp + fp) ? tp / (tp + fp) : 0, rec = (tp + fn) ? tp / (tp + fn) : 0;
      thv.textContent = t.toFixed(2);
      drawLegend(L, {tp, fp, fn});
      live.innerHTML = s.label === 1
        ? `On this ${PREVIEW}px preview at threshold ${t.toFixed(2)}:
           Dice <b>${dice.toFixed(3)}</b>, precision ${prec.toFixed(3)}, recall ${rec.toFixed(3)}
           (TP ${int(tp)}, FP ${int(fp)}, FN ${int(fn)} preview pixels).
           <span style="color:var(--muted)">The authoritative full-resolution Dice at the project
           threshold ${s.thr} is ${fmtOr(s.dice, 'dice')}.</span>`
        : `Swarm-free scene. ${int(fp)} preview pixels predicted as swarm at threshold ${t.toFixed(2)}.`;
    }

    /** Compact colour key overlaid in the corner of the image. Only the layers
        that are currently on are listed; prediction and ground truth carry their
        live share of the frame so each colour is both named and quantified. */
    function drawLegend(L, counts) {
      const total = PREVIEW * PREVIEW;
      const sw = bg => `<span style="display:inline-block;width:13px;height:11px;border-radius:2px;flex:none;background:${bg}"></span>`;
      const row = (bg, name, n) => `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
        ${sw(bg)}<span>${esc(name)}</span>${n == null ? '' :
          `<span style="margin-left:auto;padding-left:12px;opacity:.75">${((n / total) * 100).toFixed(n / total < 0.01 ? 2 : 1)}%</span>`}</div>`;
      const rows = [];
      if (L.pred) rows.push(row('rgb(47,125,209)', 'Prediction', counts.tp + counts.fp));
      if (L.gt) rows.push(row('rgb(106,62,161)', 'Ground truth', counts.tp + counts.fn));
      if (L.prob) rows.push(row('linear-gradient(90deg,#000,#f00,#ff0,#fff)', 'Probability 0 → 1', null));
      if (L.refl) rows.push(row(VIRIDIS_CSS, 'Reflectivity weak → strong', null));
      leg2.innerHTML = rows.join('');
      leg2.style.display = rows.length ? 'flex' : 'none';
    }

    const inputs = [thrEl, opEl, reflEl, probEl, gtEl, predEl];
    inputs.forEach(el => { el.addEventListener('input', paint); el.addEventListener('change', paint); });
    modalEl.querySelector('#rst').addEventListener('click', () => { thrEl.value = s.thr; paint(); });
    paint();
  }

  draw();
  if (query && query.get('ts')) open(+query.get('ts'));
  return {
    onQuery: q => { if (q.get('ts')) open(+q.get('ts')); },
    destroy: () => modal.destroy(),
  };
}
