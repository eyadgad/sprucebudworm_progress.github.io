/* Experiment comparison: all 57 completed runs, with the reasoning behind the
   selection made explicit rather than implied by a single sorted column. */

import { load } from '../lib/data.js';
import { M, fmtOr, tip, esc, MODEL_NAME, LOSS_NAME, targetName, mean } from '../lib/metrics.js';
import { DataTable } from '../lib/table.js';
import { scatter, hBarChart } from '../lib/charts.js';

const MODEL_C = {
  unet:'#98a6b6', attention_unet:'#2f9d8c', nnunet:'#b07aa1',
  smp_unetpp:'#3a6fce', smp_deeplabv3p:'#e2a33d', smp_segformer:'#cf6a5c',
};
const RANKABLE = ['dice','dice_micro','iou','precision','recall','boundary_iou','nsd','best_val_dice_patch','hd95','assd','bg_fp_rate'];
const defaultState = () => ({
  study:new Set(['elevation']), model:new Set(), loss:new Set(), target:new Set(),
  channels:new Set(), epochs:new Set(), rank:'dice',
});

// The most recent campaign varies only the number of radar elevations for the
// two finalist architectures. Keep the rule tied to the run id rather than the
// current row order: experiments.json is sorted by filename during export.
const studyKey = r => /^sweep_(attunet|unetpp)_dbz0_e\d+_focaltv$/.test(r.name)
  ? 'elevation'
  : Number(r.epochs_budget) === 50 ? 'sweep50' : 'baseline';

export async function render(mount) {
  const ex = await load('experiments');
  const rows = ex.experiments;
  const sel = rows.find(r => r.selected);
  const state = defaultState();

  const models = [...new Set(rows.map(r => r.model))];
  const losses = [...new Set(rows.map(r => r.loss))];

  mount.innerHTML = `
  <h1>Experiment comparison</h1>
  <p class="lede">${rows.length} completed training runs across ${models.length} architectures,
  ${losses.length} loss functions, three label definitions, four channel sets and ten elevation counts.</p>

  <div class="note sel"><span class="tag">selected</span><div class="bd">
    <b>${MODEL_NAME[sel.model]} · ${LOSS_NAME[sel.loss]} · ${sel.n_elev} elevations · ${targetName(sel.target_mode, sel.dbz_threshold)}</b>
    — test Dice ${fmtOr(sel.dice,'dice')}, boundary IoU ${fmtOr(sel.boundary_iou,'boundary_iou')}.
    The reasoning is spelled out under “Why this run” below.
  </div></div>

  <h2>Filters and ranking</h2>
  <div class="ctrls" id="ctrls"></div>
  <div class="small" id="count"></div>
  <div id="table"></div>

  <h2>Why this run</h2>
  <div id="why"></div>

  <h2>Precision and recall trade-off</h2>
  <figure><div class="viz" id="c-pr"></div>
    <figcaption>One point per run, coloured by architecture; the selected run is ringed. Upper right is
    better on both axes.</figcaption></figure>

  <h2>What actually moved the score</h2>
  <figure><div class="viz" id="c-axis"></div>
    <figcaption>Spread in mean test Dice across the levels of each design choice: the label definition
    matters most, architecture least.</figcaption></figure>`;

  /* ---------------- filters ---------------- */
  const ctrls = mount.querySelector('#ctrls');
  const menus = new Map();
  const checkMenu = (label, key, opts, {releaseStudy=false} = {}) => {
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
      // The initial elevation-study view contains neither DEM nor 50-epoch
      // runs. A channel/epoch choice is a request to search the whole corpus.
      if (releaseStudy && state[key].size) {
        state.study.clear();
        menus.get('study')?.refresh();
      }
      refresh(); draw();
    }));
    d.addEventListener('toggle', () => {
      if (d.open) menus.forEach((m, k) => { if (k !== key) m.el.open = false; });
    });
    menus.set(key, {el:d, refresh});
    refresh(); ctrls.appendChild(d);
  };
  checkMenu('Experiment set','study',[
    ['elevation','Elevation sweep (latest)'],
    ['sweep50','50-epoch channel / label sweep'],
    ['baseline','Baseline experiments'],
  ]);
  checkMenu('Architecture','model',models.map(m=>[m, MODEL_NAME[m]||m]));
  checkMenu('Loss','loss',losses.map(l=>[l, LOSS_NAME[l]||l]));
  checkMenu('Label','target',[['isfinite','any echo'],['dbz0','dBZ ≥ 0'],['dbz5','dBZ ≥ 5']]);
  checkMenu('Channels','channels',[
    ['dem','DEM'], ['beam','Beam height'], ['valid_mask','Valid-pixel mask'],
    ...Array.from({length:10}, (_,i) => [`th_e${i}`, `Reflectivity elevation ${i}`]),
  ], {releaseStudy:true});
  checkMenu('Epoch budget','epochs',[['50','50 epochs'],['100','100 epochs']], {releaseStudy:true});
  const rank = document.createElement('div'); rank.className = 'f';
  rank.innerHTML = `<label for="x_rank">Rank by</label><select id="x_rank">${RANKABLE.map(k=>
    `<option value="${esc(k)}">${esc(M[k]?.label || k)}</option>`).join('')}</select>`;
  rank.querySelector('select').addEventListener('change', e => { state.rank=e.target.value; draw(); });
  ctrls.appendChild(rank);
  const rst = document.createElement('button');
  rst.textContent='Reset'; rst.className='ghost';
  rst.addEventListener('click',()=>{
    const fresh = defaultState();
    for (const k of ['study','model','loss','target','channels','epochs']) state[k] = fresh[k];
    state.rank = fresh.rank; rank.querySelector('select').value = state.rank;
    menus.forEach(m => { m.el.open=false; m.refresh(); });
    draw();
  });
  ctrls.appendChild(rst);

  const tgtKey = r => r.target_mode==='isfinite' ? 'isfinite' : (r.dbz_threshold>=5?'dbz5':'dbz0');
  const hasChannel = (r, c) => c === 'beam'
    ? r.channels.some(x => x.startsWith('bh_e') || x.startsWith('height_e'))
    : r.channels.includes(c);
  const filtered = () => rows.filter(r =>
    (!state.study.size||state.study.has(studyKey(r))) &&
    (!state.model.size||state.model.has(r.model)) &&
    (!state.loss.size||state.loss.has(r.loss)) &&
    (!state.target.size||state.target.has(tgtKey(r))) &&
    (!state.channels.size||[...state.channels].every(c => hasChannel(r,c))) &&
    (!state.epochs.size||state.epochs.has(String(r.epochs_budget))));

  /* ---------------- table ---------------- */
  const cols = [
    {key:'label', label:'Configuration', cls:'', sortable:false, fmt:(_,r)=>
      `<span style="font-weight:600">${esc(MODEL_NAME[r.model]||r.model)}</span>`+
      `<span class="pill">${esc(LOSS_NAME[r.loss]||r.loss)}</span>`+
      `<span class="pill">${esc(targetName(r.target_mode,r.dbz_threshold))}</span>`+
      `<span class="pill">${r.n_elev} elev</span>`+
      `<span class="pill">${r.epochs_budget} epochs</span>`+
      (r.has_dem?'<span class="pill">DEM</span>':'')+(r.has_beam?'<span class="pill">beam</span>':'')+
      (r.selected?'<span class="pill" style="color:var(--best);border-color:var(--best)">selected</span>':'')},
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
    columns: cols, rows: rows, sort: 'dice', dir: -1, pageSize: 15,
    rowClass: r => r.selected ? 'best' : '',
    empty: 'No runs match these filters.',
  });

  /* ---------------- selection rationale (computed, not asserted) ---------------- */
  function why(list) {
    const withD = list.filter(r=>r.dice!=null);
    const top = k => [...withD].filter(r=>r[k]!=null)
      .sort((a,b)=> (M[k]?.hi===false ? a[k]-b[k] : b[k]-a[k]))[0];
    const leaders = ['dice','best_val_dice_patch','boundary_iou','nsd','precision','recall','bg_fp_rate','hd95']
      .map(k => ({k, lead: top(k)})).filter(x=>x.lead);
    const selWins = leaders.filter(x=>x.lead.name===sel.name);
    return `
      <div class="tscroll"><table>
        <thead><tr><th>Metric</th><th>Best run</th><th>Its value</th><th>Selected run</th><th>Gap</th></tr></thead>
        <tbody>${leaders.map(({k,lead})=>{
          const isSel = lead.name===sel.name;
          const gap = (sel[k]!=null&&lead[k]!=null) ? (sel[k]-lead[k]) : null;
          return `<tr class="${isSel?'best':''}"><td>${tip(k)}</td>
            <td style="text-align:left">${esc(MODEL_NAME[lead.model]||lead.model)} · ${lead.n_elev} elev${isSel?' <span class="pill" style="color:var(--best);border-color:var(--best)">this is the selected run</span>':''}</td>
            <td class="n">${fmtOr(lead[k],k)}</td><td class="n">${fmtOr(sel[k],k)}</td>
            <td class="n">${gap===null?'—':(gap===0?'—':(gap>0?'+':'')+gap.toFixed(k==='hd95'?1:4))}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p>The selected run leads on <b>${selWins.length} of ${leaders.length}</b> reported metrics
      (${selWins.map(x=>M[x.k]?.label||x.k).join(', ') || 'none'}).</p>
      <div class="note bad"><span class="tag">selection is weakly supported</span><div class="bd">
        The top runs differ by less than the scene-to-scene spread, so this is <b>among the best few</b>
        rather than a clear winner: choosing the maximum test Dice over ${rows.length} runs risks fitting
        the ${sel.n_pos_scenes}-scene test set.
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

    const pts = f.filter(r=>r.precision!=null&&r.recall!=null).map(r=>({
      x:r.precision, y:r.recall, c:MODEL_C[r.model]||'var(--accent2)',
      r:r.selected?7:3.6, o:r.selected?1:.62,
      t:`${MODEL_NAME[r.model]||r.model} · ${LOSS_NAME[r.loss]} · ${r.n_elev} elev — precision ${r.precision}, recall ${r.recall}, Dice ${r.dice}`,
    }));
    mount.querySelector('#c-pr').innerHTML = scatter({
      points: pts, xlo:.40, xhi:.70, ylo:.40, yhi:.90,
      xlabel:'precision (test)', ylabel:'recall (test)', W:560, H:340,
      aria:'Precision versus recall for every run',
      trend:{x0:sel.precision,y0:.40,x1:sel.precision,y1:.90},
      legend: models.map(m=>({c:MODEL_C[m]||'var(--accent2)', label:MODEL_NAME[m]||m})),
    });

    // effect of each design axis, measured over the runs that vary it
    const axisEffect = (label, keyFn) => {
      const groups = {};
      rows.filter(r=>r.dice!=null).forEach(r=>{ const k=keyFn(r); (groups[k] ||= []).push(r.dice); });
      const entries = Object.entries(groups).filter(([,v])=>v.length>=2);
      if (entries.length<2) return null;
      const means = entries.map(([k,v])=>({k, m:mean(v), n:v.length}));
      const spread = Math.max(...means.map(x=>x.m)) - Math.min(...means.map(x=>x.m));
      return {label, spread, means};
    };
    const axes = [
      axisEffect('Label definition', r=>targetName(r.target_mode,r.dbz_threshold)),
      axisEffect('Architecture', r=>MODEL_NAME[r.model]||r.model),
      axisEffect('Loss function', r=>LOSS_NAME[r.loss]||r.loss),
      axisEffect('Elevation count', r=>`${r.n_elev} elev`),
    ].filter(Boolean).sort((a,b)=>b.spread-a.spread);
    mount.querySelector('#c-axis').innerHTML = hBarChart({
      items: axes.map(a=>({label:a.label, value:a.spread, c:'var(--accent2)'})),
      lo:0, hi:Math.max(...axes.map(a=>a.spread))*1.15, labelW:150, W:520,
      fmtV:v=>v.toFixed(3), xlabel:'spread in mean test Dice across that axis', W:820,
      aria:'Spread of mean test Dice caused by each design axis',
    });
  }
  draw();
}
