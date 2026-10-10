/* Experiment comparison: every segmentation run on the frozen night split, with
   the pre-specified confirmatory pair kept apart from single-seed exploration. */

import { load } from '../lib/data.js';
import { M, fmtOr, tip, esc, MODEL_NAME, mean } from '../lib/metrics.js';
import { DataTable } from '../lib/table.js';
import { scatter, hBarChart } from '../lib/charts.js';

const MODEL_C = {
  unet:'#98a6b6', attention_unet:'#2f9d8c', transunet:'#b07aa1',
  swin_unet:'#3a6fce', gated_swin_attn:'#e2a33d',
};
const RANKABLE = ['dice','dice_micro','iou','precision','recall','boundary_iou','nsd','best_val_dice_patch','hd95','assd','bg_fp_rate'];
const GROUPS = [
  ['main', 'Pre-specified five-seed families'],
  ['ablation', 'Cumulative ablation S1–S3b (seed 42)'],
  ['other', 'Other decoders (seed 42)'],
];
const ABLATION = {
  night_bal_attunet9_cur: 'S1 night-balanced sampling',
  night_mtl_attunet9_cur: 'S2 + presence head',
  night_tstack_attunet9_cur: 'S3a + temporal stack',
  night_ltae_attunet9_cur: 'S3b + L-TAE temporal attention',
};
const groupOf = r => /^(night_base_attunet9|unet_night)_s\d+$/.test(r.name) ? 'main'
  : ABLATION[r.name] ? 'ablation' : 'other';
const seedOf = r => (r.name.match(/_s(\d+)$/) || [])[1];
const defaultState = () => ({group: new Set(), model: new Set(), rank: 'dice'});

export async function render(mount) {
  const ex = await load('experiments');
  const rows = ex.experiments.filter(r => r.dice !== null);
  const sel = rows.find(r => r.selected);
  const state = defaultState();
  const models = [...new Set(rows.map(r => r.model))];
  const splits = [...new Set(rows.map(r => r.eval_split))];
  const n = g => rows.filter(r => groupOf(r) === g).length;

  mount.innerHTML = `
  <h1>Experiment comparison</h1>
  <p class="lede">${rows.length} segmentation runs on the frozen night split: ${n('main')} runs in two
  pre-specified five-seed families, ${n('ablation')} cumulative ablation stages and ${n('other')} alternative
  decoders. All use the same nine reflectivity elevations, validity mask and dBZ ≥ 0 label.
  ${splits.length === 1 && splits[0] === 'test'
    ? 'Every number is on the held-out test set at the run’s validation-locked threshold.'
    : '<b>Rows mix splits; see the “Scored on” column.</b>'}</p>

  <div class="note sel"><span class="tag">selected</span><div class="bd">
    <b>${esc(sel.name)}</b> (${MODEL_NAME[sel.model] || sel.model}, seed ${seedOf(sel)}) — test Dice
    ${fmtOr(sel.dice,'dice')}, boundary IoU ${fmtOr(sel.boundary_iou,'boundary_iou')}. It is the confirmatory
    model named in the freeze note before the test set was opened, paired with U-Net seed 42.
  </div></div>

  <h2>Filters and ranking</h2>
  <div class="ctrls" id="ctrls"></div>
  <div class="small" id="count"></div>
  <div id="table"></div>

  <h2>Who leads each metric</h2>
  <div id="why"></div>

  <h2>Precision and recall trade-off</h2>
  <figure><div class="viz" id="c-pr"></div>
    <figcaption>One point per run, coloured by architecture; the selected run is ringed. Upper right is
    better on both axes.</figcaption></figure>

  <h2>Seeds versus architecture</h2>
  <figure><div class="viz" id="c-axis"></div>
    <figcaption id="axis-cap"></figcaption></figure>`;

  /* ---------------- filters ---------------- */
  const ctrls = mount.querySelector('#ctrls');
  const menus = new Map();
  const checkMenu = (label, key, opts) => {
    const d = document.createElement('details');
    d.className = 'check-menu'; d.id = 'x_' + key;
    d.innerHTML = `<summary></summary><div class="check-menu-pop">${opts.map(([v, t]) =>
      `<label><input type="checkbox" value="${esc(v)}"${state[key].has(v)?' checked':''}> <span>${esc(t)}</span></label>`
    ).join('')}</div>`;
    const refresh = () => {
      const chosen = opts.filter(([v]) => state[key].has(v)).map(([,t]) => t);
      d.querySelector('summary').textContent = chosen.length
        ? `${label}: ${chosen.length === 1 ? chosen[0] : chosen.length + ' selected'}`
        : `${label}: All`;
      d.querySelectorAll('input').forEach(i => { i.checked = state[key].has(i.value); });
    };
    d.querySelectorAll('input').forEach(i => i.addEventListener('change', () => {
      i.checked ? state[key].add(i.value) : state[key].delete(i.value);
      refresh(); draw();
    }));
    d.addEventListener('toggle', () => {
      if (d.open) menus.forEach((m, k) => { if (k !== key) m.el.open = false; });
    });
    menus.set(key, {el:d, refresh});
    refresh(); ctrls.appendChild(d);
  };
  checkMenu('Run set', 'group', GROUPS);
  checkMenu('Architecture', 'model', models.map(m => [m, MODEL_NAME[m] || m]));
  const rank = document.createElement('div'); rank.className = 'f';
  rank.innerHTML = `<label for="x_rank">Rank by</label><select id="x_rank">${RANKABLE.map(k=>
    `<option value="${esc(k)}">${esc(M[k]?.label || k)}</option>`).join('')}</select>`;
  rank.querySelector('select').addEventListener('change', e => { state.rank = e.target.value; draw(); });
  ctrls.appendChild(rank);
  const rst = document.createElement('button');
  rst.textContent = 'Reset'; rst.className = 'ghost';
  rst.addEventListener('click', () => {
    Object.assign(state, defaultState());
    rank.querySelector('select').value = state.rank;
    menus.forEach(m => { m.el.open = false; m.refresh(); });
    draw();
  });
  ctrls.appendChild(rst);

  const filtered = () => rows.filter(r =>
    (!state.group.size || state.group.has(groupOf(r))) &&
    (!state.model.size || state.model.has(r.model)));

  /* ---------------- table ---------------- */
  const cols = [
    {key:'name', label:'Run', cls:'', fmt:(_, r) =>
      `<span style="font-weight:600">${esc(MODEL_NAME[r.model] || r.model)}</span>` +
      (seedOf(r) ? `<span class="pill">seed ${seedOf(r)}</span>` : '') +
      (ABLATION[r.name] ? `<span class="pill">${esc(ABLATION[r.name])}</span>` : '') +
      (r.selected ? '<span class="pill" style="color:var(--best);border-color:var(--best)">selected</span>' : '') +
      `<div class="small"><code>${esc(r.name)}</code></div>`},
    {key:'eval_split', label:'Scored on', tip:'Split behind the metric columns. Test is read once, after the freeze note.', fmt:v=>esc(v || '—')},
    {key:'threshold', label:'Thr', tip:'Pixel probability threshold calibrated on validation and locked before test.', fmt:v=>v ?? '—'},
    {key:'best_val_dice_patch', label:'Val Dice', tip:M.best_val_dice_patch.def, fmt:v=>fmtOr(v,'best_val_dice_patch')},
    {key:'dice', label:'Dice', tip:M.dice.def+' Formula: '+M.dice.formula, fmt:v=>fmtOr(v,'dice')},
    {key:'dice_micro', label:'Dice µ', tip:M.dice_micro.def, fmt:v=>fmtOr(v,'dice_micro')},
    {key:'iou', label:'IoU', tip:M.iou.def, fmt:v=>fmtOr(v,'iou')},
    {key:'precision', label:'Prec', tip:M.precision.def, fmt:v=>fmtOr(v,'precision')},
    {key:'recall', label:'Rec', tip:M.recall.def, fmt:v=>fmtOr(v,'recall')},
    {key:'boundary_iou', label:'bIoU', tip:M.boundary_iou.def, fmt:v=>fmtOr(v,'boundary_iou')},
    {key:'nsd', label:'NSD', tip:M.nsd.def, fmt:v=>fmtOr(v,'nsd')},
    {key:'hd95', label:'HD95', tip:M.hd95.def, fmt:v=>fmtOr(v,'hd95')},
    {key:'bg_fp_rate', label:'bg FP', tip:M.bg_fp_rate.def, fmt:v=>fmtOr(v,'bg_fp_rate')},
    {key:'best_epoch', label:'Best ep', tip:'Epoch with the best validation Dice; the checkpoint used for evaluation.', fmt:v=>v??'—'},
    {key:'train_seconds', label:'Train', tip:'Wall-clock training time from the run log.', fmt:v=>v?`${(v/3600).toFixed(1)} h`:'—'},
    {key:'n_params', label:'Params', tip:'Trainable parameters.', fmt:v=>v?`${(v/1e6).toFixed(1)} M`:'—'},
  ];
  const table = new DataTable(mount.querySelector('#table'), {
    columns: cols, rows: rows, sort: 'dice', dir: -1, pageSize: 20,
    rowClass: r => r.selected ? 'best' : '',
    empty: 'No runs match these filters.',
  });

  /* ---------------- metric leaders (computed, not asserted) ---------------- */
  function why(list) {
    const top = k => [...list].filter(r => r[k] != null)
      .sort((a, b) => (M[k]?.hi === false ? a[k] - b[k] : b[k] - a[k]))[0];
    const leaders = ['dice','best_val_dice_patch','boundary_iou','nsd','precision','recall','bg_fp_rate','hd95']
      .map(k => ({k, lead: top(k)})).filter(x => x.lead);
    const selWins = leaders.filter(x => x.lead.name === sel.name);
    const exploratory = leaders.filter(x => groupOf(x.lead) !== 'main').length;
    return `
      <div class="tscroll"><table>
        <thead><tr><th>Metric</th><th>Best run</th><th>Its value</th><th>Selected run</th><th>Gap</th></tr></thead>
        <tbody>${leaders.map(({k, lead}) => {
          const isSel = lead.name === sel.name;
          const gap = (sel[k] != null && lead[k] != null) ? (sel[k] - lead[k]) : null;
          return `<tr class="${isSel?'best':''}"><td>${tip(k)}</td>
            <td style="text-align:left"><code>${esc(lead.name)}</code>${isSel?' <span class="pill" style="color:var(--best);border-color:var(--best)">this is the selected run</span>':''}</td>
            <td class="n">${fmtOr(lead[k],k)}</td><td class="n">${fmtOr(sel[k],k)}</td>
            <td class="n">${gap===null?'—':(gap===0?'—':(gap>0?'+':'')+gap.toFixed(k==='hd95'?1:4))}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p>The selected run leads on <b>${selWins.length} of ${leaders.length}</b> reported metrics
      (${selWins.map(x => M[x.k]?.label || x.k).join(', ') || 'none'}). ${exploratory} of the leaders are
      single-seed runs outside the two five-seed families.</p>
      <div class="note"><span class="tag">how to read this</span><div class="bd">
        Leading a metric on the test set is not a reason to re-select a model: the confirmatory pair and every
        threshold were fixed on validation before the test set was read. A single-seed lead should be compared
        with the seed range of the five-seed families below before it is taken as an architecture effect.
      </div></div>`;
  }

  /* ---------------- draw ---------------- */
  function draw() {
    const f = filtered();
    table.setRows(f);
    if (state.rank && table.sortKey !== state.rank) {
      table.sortKey = state.rank;
      table.dir = M[state.rank]?.hi === false ? 1 : -1;
      table.render();
    }
    mount.querySelector('#count').innerHTML =
      `Showing <b>${f.length}</b> of ${rows.length} runs, ranked by ${esc(M[state.rank]?.label||state.rank)}.`;
    mount.querySelector('#why').innerHTML = why(rows);

    const pts = f.filter(r => r.precision != null && r.recall != null).map(r => ({
      x:r.precision, y:r.recall, c:MODEL_C[r.model] || 'var(--accent2)',
      r:r.selected ? 7 : 3.6, o:r.selected ? 1 : .62,
      t:`${r.name} — precision ${r.precision}, recall ${r.recall}, Dice ${r.dice}`,
    }));
    mount.querySelector('#c-pr').innerHTML = scatter({
      points: pts, xlo:.40, xhi:.70, ylo:.40, yhi:.80,
      xlabel:`precision (${sel.eval_split})`, ylabel:`recall (${sel.eval_split})`, W:560, H:340,
      aria:'Precision versus recall for every run',
      trend:{x0:sel.precision, y0:.40, x1:sel.precision, y1:.80},
      legend: models.map(m => ({c:MODEL_C[m] || 'var(--accent2)', label:MODEL_NAME[m] || m})),
    });
  }
  draw();

  /* ---------------- seed range versus the architecture gap ---------------- */
  const fam = re => rows.filter(r => re.test(r.name)).map(r => r.dice);
  const att = fam(/^night_base_attunet9_s\d+$/), un = fam(/^unet_night_s\d+$/);
  const range = v => Math.max(...v) - Math.min(...v);
  const gap = mean(att) - mean(un);
  const items = [
    {label: `Attention UNet seed range (n=${att.length})`, value: range(att), c: 'var(--accent2)'},
    {label: `UNet seed range (n=${un.length})`, value: range(un), c: 'var(--accent2)'},
    {label: 'Family means, Attention − UNet', value: Math.abs(gap), c: 'var(--best)'},
  ];
  mount.querySelector('#c-axis').innerHTML = hBarChart({
    items, lo: 0, hi: Math.max(...items.map(i => i.value)) * 1.15, labelW: 250, W: 820,
    fmtV: v => v.toFixed(3), xlabel: `test Dice (macro), range or difference`,
    aria: 'Seed range of each family compared with the difference between family means',
  });
  mount.querySelector('#axis-cap').textContent =
    `Spread of test Dice across five seeds of each family, against the difference between the two family means ` +
    `(${gap >= 0 ? '+' : ''}${gap.toFixed(4)}). The architecture gap is ` +
    `${Math.abs(gap) < Math.min(range(att), range(un)) ? 'smaller than' : 'not smaller than'} either seed range.`;
}
