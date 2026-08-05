/* Experiment comparison: all 57 completed runs, with the reasoning behind the
   selection made explicit rather than implied by a single sorted column. */

import { load } from '../lib/data.js';
import { M, fmtOr, tip, esc, MODEL_NAME, LOSS_NAME, targetName, mean } from '../lib/metrics.js';
import { DataTable } from '../lib/table.js';
import { scatter, parallel, legend, hBarChart } from '../lib/charts.js';

const MODEL_C = {
  unet:'#98a6b6', attention_unet:'#2f9d8c', nnunet:'#b07aa1',
  smp_unetpp:'#3a6fce', smp_deeplabv3p:'#e2a33d', smp_segformer:'#cf6a5c',
};
const RANKABLE = ['dice','dice_micro','iou','precision','recall','boundary_iou','nsd','best_val_dice_patch','hd95','assd','bg_fp_rate'];

export async function render(mount) {
  const ex = await load('experiments');
  const rows = ex.experiments;
  const sel = rows.find(r => r.selected);
  const state = {model:'all', loss:'all', target:'all', elev:'all', rank:'dice'};

  const models = [...new Set(rows.map(r => r.model))];
  const losses = [...new Set(rows.map(r => r.loss))];

  mount.innerHTML = `
  <h1>Experiment comparison</h1>
  <p class="lede">${rows.length} completed training runs spanning ${models.length} architectures,
  ${losses.length} loss functions, three label definitions, four channel sets and ten elevation counts.
  Every row is a real run with its own checkpoint and logs.</p>

  <div class="note sel"><span class="tag">selected</span><div class="bd">
    <b>${MODEL_NAME[sel.model]} · ${LOSS_NAME[sel.loss]} · ${sel.n_elev} elevations · ${targetName(sel.target_mode, sel.dbz_threshold)}</b>
    — test Dice ${fmtOr(sel.dice,'dice')}, boundary IoU ${fmtOr(sel.boundary_iou,'boundary_iou')}.
    The reasoning is spelled out under “Why this run” below.
  </div></div>

  <h2>Filters and ranking</h2>
  <div class="ctrls" id="ctrls"></div>
  <div class="small" id="count"></div>
  <div id="table"></div>

  <h2>Why this run, and not simply the top of one column</h2>
  <div id="why"></div>

  <h2>Precision and recall trade-off</h2>
  <figure><div class="viz" id="c-pr"></div>
    <figcaption>Each point is one run at its own calibrated threshold. Runs towards the upper right are
    better on both axes. Colour encodes architecture; the selected run is ringed. Dashed lines mark the
    selected run's position.</figcaption></figure>
  <div id="l-pr"></div>

  <h2>Score against training cost</h2>
  <figure><div class="viz" id="c-cost"></div>
    <figcaption>Test Dice against wall-clock training time. Longer training does not buy a better score:
    the cheapest and most expensive runs land within the same narrow band.</figcaption></figure>

  <h2>Multi-metric comparison</h2>
  <p class="small">Each line is one run crossing five axes. A run that is genuinely better is high on all
  of them; the selected run is drawn solid. Only runs matching the filters above are shown.</p>
  <figure><div class="viz" id="c-par"></div>
    <figcaption>Parallel coordinates over region quality, boundary quality, precision, recall and false
    alarms. Axes are oriented so that up is always better, including the inverted false-alarm axis.</figcaption></figure>

  <h2>What actually moved the score</h2>
  <div class="two">
    <figure><div class="viz" id="c-axis"></div>
      <figcaption>Mean test Dice grouped by each design choice, over all runs that vary it. Bars show
      how much each axis matters relative to the others.</figcaption></figure>
    <figure><div class="viz" id="c-arch"></div>
      <figcaption>Best test Dice achieved by each architecture. The gap between the best and worst
      architecture is smaller than the gap created by the label definition.</figcaption></figure>
  </div>`;

  /* ---------------- filters ---------------- */
  const ctrls = mount.querySelector('#ctrls');
  const mk = (label, key, opts) => {
    const w = document.createElement('div'); w.className = 'f';
    const id = 'x_' + key;
    w.innerHTML = `<label for="${id}">${label}</label><select id="${id}">` +
      opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('') + '</select>';
    w.querySelector('select').addEventListener('change', e => { state[key] = e.target.value; draw(); });
    ctrls.appendChild(w);
  };
  mk('Architecture','model',[['all','All architectures'],...models.map(m=>[m, MODEL_NAME[m]||m])]);
  mk('Loss','loss',[['all','All losses'],...losses.map(l=>[l, LOSS_NAME[l]||l])]);
  mk('Label','target',[['all','All labels'],['isfinite','any echo'],['dbz0','dBZ ≥ 0'],['dbz5','dBZ ≥ 5']]);
  mk('Elevations','elev',[['all','Any count'],['1','1'],['3','3'],['6','6'],['9','9'],['10','10']]);
  mk('Rank by','rank',RANKABLE.map(k=>[k, M[k]?.label || k]));
  const rst = document.createElement('button');
  rst.textContent='Reset'; rst.className='ghost';
  rst.addEventListener('click',()=>{Object.assign(state,{model:'all',loss:'all',target:'all',elev:'all'});
    ctrls.querySelectorAll('select').forEach(s=>{ if(s.id!=='x_rank') s.value='all';}); draw();});
  ctrls.appendChild(rst);

  const tgtKey = r => r.target_mode==='isfinite' ? 'isfinite' : (r.dbz_threshold>=5?'dbz5':'dbz0');
  const filtered = () => rows.filter(r =>
    (state.model==='all'||r.model===state.model) &&
    (state.loss==='all'||r.loss===state.loss) &&
    (state.target==='all'||tgtKey(r)===state.target) &&
    (state.elev==='all'||String(r.n_elev)===state.elev));

  /* ---------------- table ---------------- */
  const cols = [
    {key:'label', label:'Configuration', cls:'', sortable:false, fmt:(_,r)=>
      `<span style="font-weight:600">${esc(MODEL_NAME[r.model]||r.model)}</span>`+
      `<span class="pill">${esc(LOSS_NAME[r.loss]||r.loss)}</span>`+
      `<span class="pill">${esc(targetName(r.target_mode,r.dbz_threshold))}</span>`+
      `<span class="pill">${r.n_elev} elev</span>`+
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
    const near = withD.filter(r=>r.name!==sel.name && Math.abs(r.dice-sel.dice)<0.005)
      .sort((a,b)=>b.dice-a.dice);
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
      (${selWins.map(x=>M[x.k]?.label||x.k).join(', ') || 'none'}). It does <b>not</b> lead on the others:
      ${leaders.filter(x=>x.lead.name!==sel.name).slice(0,4).map(x=>
        `${M[x.k]?.label||x.k} belongs to ${esc(MODEL_NAME[x.lead.model]||x.lead.model)} at ${x.lead.n_elev} elevations`).join('; ')}.</p>
      ${near.length ? `<p><b>${near.length}</b> other run${near.length>1?'s are':' is'} within 0.005 Dice of it
        (${near.slice(0,3).map(r=>`${esc(MODEL_NAME[r.model]||r.model)} ${r.n_elev} elev`).join(', ')}). Dice alone therefore
        does not separate the leaders.</p>` : ''}
      <div class="note bad"><span class="tag">selection is weakly supported</span><div class="bd">
        The evidence for this specific run is <b>thinner than a single sorted column suggests</b>.
        It wins on test Dice by ${near.length ? (sel.dice - near[0].dice).toFixed(4) : 'a small margin'},
        while a sibling run (Attention UNet at 7 elevations) has better boundary placement, and
        another (6 elevations) has the better validation score that selection was supposed to be based on.
        With ${rows.length} runs against a ${sel.n_pos_scenes}-scene test set, choosing the maximum test
        Dice risks fitting the test set. The scene-to-scene spread in
        <a href="#/stats">statistical analysis</a> is far wider than the gaps between these top runs.
        <br><b>Fair statement of the result:</b> this configuration is <b>among the best few</b>, and the
        family (Attention UNet / UNet++, dBZ ≥ 0, Focal Tversky, 7–9 elevations) is what the evidence
        actually supports — not this one run over its siblings.
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
    });
    mount.querySelector('#l-pr').innerHTML = legend(
      models.map(m=>({c:MODEL_C[m]||'var(--accent2)', label:MODEL_NAME[m]||m})));

    mount.querySelector('#c-cost').innerHTML = scatter({
      points: f.filter(r=>r.train_seconds&&r.dice!=null).map(r=>({
        x:r.train_seconds/3600, y:r.dice, c:MODEL_C[r.model]||'var(--accent2)',
        r:r.selected?7:3.6, o:r.selected?1:.62,
        t:`${MODEL_NAME[r.model]||r.model} ${r.n_elev} elev — ${(r.train_seconds/3600).toFixed(1)} h, Dice ${r.dice}`})),
      xlo:0, xhi:Math.max(...rows.map(r=>(r.train_seconds||0)/3600))*1.05,
      ylo:.48, yhi:.66, xlabel:'training wall-clock time (hours)', ylabel:'test Dice (macro)',
      W:560, H:340, aria:'Test Dice against training time',
    });

    const dims = [
      {key:'dice', label:'Dice', lo:.48, hi:.65, inv:false},
      {key:'boundary_iou', label:'Boundary IoU', lo:.24, hi:.45, inv:false},
      {key:'precision', label:'Precision', lo:.40, hi:.70, inv:false},
      {key:'recall', label:'Recall', lo:.40, hi:.90, inv:false},
      {key:'bg_fp_rate', label:'Few false alarms', lo:0, hi:.013, inv:true},
    ];
    mount.querySelector('#c-par').innerHTML = parallel({
      dims: dims.map(d=>({label:d.label, lo:d.inv?d.hi:d.lo, hi:d.inv?d.lo:d.hi})),
      rows: f.filter(r=>dims.every(d=>r[d.key]!=null)).map(r=>({
        label:`${MODEL_NAME[r.model]||r.model} ${r.n_elev} elev — Dice ${r.dice}`,
        c:r.selected?'var(--best)':(MODEL_C[r.model]||'var(--accent2)'),
        hl:r.selected, values:dims.map(d=>r[d.key]),
      })), W:880, H:340, aria:'Parallel coordinates across five metrics',
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
      fmtV:v=>v.toFixed(3), aria:'Spread of mean test Dice caused by each design axis',
    });

    const byArch = models.map(m=>{
      const v = rows.filter(r=>r.model===m&&r.dice!=null).map(r=>r.dice);
      return {label:MODEL_NAME[m]||m, value:v.length?Math.max(...v):null,
              c:MODEL_C[m]||'var(--accent2)', hl:m===sel.model};
    }).sort((a,b)=>(b.value??0)-(a.value??0));
    mount.querySelector('#c-arch').innerHTML = hBarChart({
      items:byArch, lo:.55, hi:.65, labelW:150, W:520,
      aria:'Best test Dice per architecture',
    });
  }
  draw();
}
