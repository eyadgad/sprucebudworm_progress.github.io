/* Sample explorer.

   Thumbnails are lazy (loading="lazy") and the full-resolution layers for a
   scene are fetched only when that scene is opened. The viewer re-thresholds
   the stored probability map in a canvas, so moving the slider costs no network
   traffic at all. */

import { load } from '../lib/data.js';
import { M, fmtOr, int, esc, tsLabel, hhmm, SEG, quantile } from '../lib/metrics.js';
import { DataTable } from '../lib/table.js';
import { Modal } from '../lib/ui.js';

const IMG = ts => `data/samples/${ts}`;
const PREVIEW = 480;   // stored preview resolution; metrics come from full 960

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
    2×2 block so thin plumes stay visible. That thickens both masks, so the
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
  mk('Scene type', 'type', [['pos', 'With plume'], ['neg', 'Plume free'], ['all', 'All']]);
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
            : `<span class="m">no plume · FP ${fmtOr(bgcol(s), 'bg_fp_rate')}</span>`}</span>
        </button>`;
      }).join('') + `</div>
        <p class="small" style="margin-top:10px">
          <span class="swk" style="background:#fff;vertical-align:-3px"></span> <b>white</b> = predicted plume,
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
              <div class="stage" id="stage">
                ${has ? `<canvas id="cv" width="${PREVIEW}" height="${PREVIEW}"
                          aria-label="Segmentation overlay for ${tsLabel(ts)}"></canvas>`
                      : `<div class="state" style="height:100%;border:0;background:var(--panel)">
                           <div class="big">No imagery exported</div>
                           <div class="small">Pixel layers were not exported for the ${esc(s.split)} split. Metrics on the right are still full resolution.</div></div>`}
              </div>
              ${has ? `
              <div class="ctrls" style="margin-top:12px">
                <div class="f"><label for="lay">Layer</label>
                  <select id="lay">
                    <option value="err">Errors (TP / FP / FN)</option>
                    <option value="prob">Probability heatmap</option>
                    <option value="th">Reflectivity input</option>
                    <option value="gt">Ground truth only</option>
                    <option value="pred">Prediction only</option>
                  </select></div>
                <div class="f"><label for="thr">Threshold <b id="thv">${s.thr}</b></label>
                  <input type="range" id="thr" min="0.02" max="0.9" step="0.01" value="${s.thr}"></div>
                <div class="f"><label for="op">Overlay opacity</label>
                  <input type="range" id="op" min="0" max="1" step="0.05" value="0.75"></div>
                <div class="f"><label for="pat">Accessibility</label>
                  <label class="chk"><input type="checkbox" id="pat"> Hatch the error types</label></div>
                <button id="rst" class="ghost">Reset to ${s.thr}</button>
              </div>
              <div id="leg2"></div>
              <p class="small" id="live"></p>` : ''}
            </div>
            <div>
              <h3 style="margin-top:0">Scene</h3>
              <div class="kv">
                <span class="k">Timestamp</span><span class="v">${ts}</span>
                <span class="k">Night</span><span class="v">${esc(s.night || '—')}</span>
                <span class="k">Split</span><span class="v">${esc(s.split)}</span>
                <span class="k">Type</span><span class="v">${s.label ? 'has plume' : 'plume free'}</span>
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
    const thrEl = modalEl.querySelector('#thr'), opEl = modalEl.querySelector('#op'),
          layEl = modalEl.querySelector('#lay'), thv = modalEl.querySelector('#thv'),
          live = modalEl.querySelector('#live'), patEl = modalEl.querySelector('#pat');

    const rgb = v => {
      // perceptually ordered heat ramp for probability
      const t = v / 255;
      return [Math.round(255 * Math.min(1, t * 1.6)),
              Math.round(255 * Math.max(0, Math.min(1, t * 1.6 - 0.5))),
              Math.round(255 * Math.max(0, t * 1.2 - 0.75))];
    };

    function paint() {
      const t = +thrEl.value, op = +opEl.value, mode = layEl.value;
      const patterns = patEl.checked;
      const cut = t * 255;
      let tp = 0, fp = 0, fn = 0;
      const d = out.data;
      // Each class gets its own hatch direction so the three error types stay
      // distinguishable in greyscale or with colour-vision deficiency:
      //   TP solid, FP "\" stripes, FN "/" stripes.
      for (let i = 0, p = 0, n = 0; i < P.length; i += 4, p += 4, n++) {
        const x = n % PREVIEW, y = (n / PREVIEW) | 0;
        const prob = P[i], gt = G[i] > 127, pred = prob > cut;
        if (gt && pred) tp++; else if (pred) fp++; else if (gt) fn++;
        const base = TH[i];                       // reflectivity as grey backdrop
        let r = base, g = base, b = base;
        if (mode === 'prob') { const c = rgb(prob); r = c[0]; g = c[1]; b = c[2]; }
        else if (mode === 'gt') { if (gt) { r = 106; g = 62; b = 161; } }
        else if (mode === 'pred') { if (pred) { r = 47; g = 125; b = 209; } }
        else if (mode === 'err') {
          if (gt && pred) { r = 106 + .35 * base; g = 62; b = 161; }
          else if (pred) { r = 201; g = 64; b = 58; }
          else if (gt) { r = 47; g = 125; b = 209; }
        }
        if (mode !== 'th' && mode !== 'prob') {
          const on = (mode === 'err' && (gt || pred)) || (mode === 'gt' && gt) || (mode === 'pred' && pred);
          if (on) {
            if (patterns && mode === 'err' && !(gt && pred)) {
              // brighten every 3rd of 7 rows along the class's diagonal
              const stripe = pred ? ((x + y) % 7 < 3) : ((x - y + PREVIEW * 2) % 7 < 3);
              if (stripe) { r = Math.min(255, r * 1.55 + 40); g = Math.min(255, g * 1.55 + 40); b = Math.min(255, b * 1.55 + 40); }
            }
            r = base * (1 - op) + r * op; g = base * (1 - op) + g * op; b = base * (1 - op) + b * op;
          }
        }
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      const dice = tp ? 2 * tp / (2 * tp + fp + fn) : 0;
      const prec = (tp + fp) ? tp / (tp + fp) : 0, rec = (tp + fn) ? tp / (tp + fn) : 0;
      thv.textContent = t.toFixed(2);
      drawLegend(mode, {tp, fp, fn}, patterns);
      live.innerHTML = s.label === 1
        ? `On this ${PREVIEW}px preview at threshold ${t.toFixed(2)}:
           Dice <b>${dice.toFixed(3)}</b>, precision ${prec.toFixed(3)}, recall ${rec.toFixed(3)}
           (TP ${int(tp)}, FP ${int(fp)}, FN ${int(fn)} preview pixels).
           <span style="color:var(--muted)">The authoritative full-resolution Dice at the project
           threshold ${s.thr} is ${fmtOr(s.dice, 'dice')}.</span>`
        : `Plume-free scene. ${int(fp)} preview pixels predicted as plume at threshold ${t.toFixed(2)}.`;
    }

    /** Legend describing exactly what is on screen for the current layer, with a
        live pixel count per class so each colour is named and quantified. */
    function drawLegend(mode, counts, patterns) {
      const total = PREVIEW * PREVIEW;
      const swatch = (col, pat) => {
        const stripes = pat === 'fp' ? 'repeating-linear-gradient(45deg,rgba(255,255,255,.85) 0 2px,transparent 2px 5px)'
                      : pat === 'fn' ? 'repeating-linear-gradient(-45deg,rgba(255,255,255,.85) 0 2px,transparent 2px 5px)' : '';
        return `<span class="swk" style="background:${col}${patterns && stripes ? `;background-image:${stripes}` : ''}"></span>`;
      };
      const row = (col, name, what, n, pat) => `
        <div class="lgrow">
          ${swatch(col, pat)}
          <span class="lgname">${esc(name)}</span>
          <span class="lgwhat">${what}</span>
          <span class="lgn">${n == null ? '' : `${int(n)} px · ${((n / total) * 100).toFixed(n / total < 0.01 ? 2 : 1)}%`}</span>
        </div>`;

      let rows;
      if (mode === 'err') {
        rows = [
          row(SEG.tp.c, 'TP — correct', 'model and label both say plume', counts.tp),
          row(SEG.fp.c, 'FP — false alarm', 'model says plume, label does not', counts.fp, 'fp'),
          row(SEG.fn.c, 'FN — missed', 'label says plume, model missed it', counts.fn, 'fn'),
          row('#3f3f3f', 'Background', 'neither: shaded by radar reflectivity', null),
        ];
      } else if (mode === 'prob') {
        rows = [`<div class="lgrow"><span class="swk" style="background:linear-gradient(90deg,#000,#f00,#ff0,#fff)"></span>
          <span class="lgname">Probability</span>
          <span class="lgwhat">model confidence that a pixel is plume</span>
          <span class="lgn">0.0 → 1.0</span></div>
          <div class="lgscale"><span>0.0 none</span><span>0.25</span><span>0.5</span><span>0.75</span><span>1.0 certain</span></div>`];
      } else if (mode === 'th') {
        rows = [`<div class="lgrow"><span class="swk" style="background:linear-gradient(90deg,#000,#fff)"></span>
          <span class="lgname">Reflectivity</span>
          <span class="lgwhat">raw radar return, lowest elevation (input channel)</span>
          <span class="lgn">weak → strong</span></div>`];
      } else if (mode === 'gt') {
        rows = [
          row(SEG.tp.c, 'Ground truth', 'pixels a human annotator marked as plume', counts.tp + counts.fn),
          row('#3f3f3f', 'Background', 'everything else', null),
        ];
      } else {
        rows = [
          row('#2f7dd1', 'Prediction', `pixels the model calls plume at this threshold`, counts.tp + counts.fp),
          row('#3f3f3f', 'Background', 'everything else', null),
        ];
      }
      modalEl.querySelector('#leg2').innerHTML =
        `<div class="lgbox">${rows.join('')}</div>` +
        (mode === 'err' && patterns
          ? `<p class="small" style="margin:6px 0 0">Hatching distinguishes the two error types without colour:
             <b>“\\” stripes = false alarm</b>, <b>“/” stripes = missed</b>. Correct overlap is solid.</p>`
          : '');
    }

    [thrEl, opEl, layEl, patEl].forEach(el => el.addEventListener('input', paint));
    layEl.addEventListener('change', paint);
    patEl.addEventListener('change', paint);
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
