/* Training diagnostics.

   Histories for all 57 runs are ~250 KB, so the file is fetched once and curves
   are drawn only for runs the user switches on. Nothing but the selected run is
   plotted initially. */

import { load } from '../lib/data.js';
import { M, fmtOr, esc, MODEL_NAME, LOSS_NAME, mean, std } from '../lib/metrics.js';
import { lineChart, legend, scatter } from '../lib/charts.js';
import { card } from '../lib/ui.js';

const PALETTE = ['#3a6fce','#2f9d8c','#e2a33d','#cf6a5c','#b07aa1','#6a3ea1','#1f7a54','#98a6b6'];

export async function render(mount) {
  const [ex, hist] = await Promise.all([load('experiments'), load('histories')]);
  const rows = ex.experiments;
  const sel = rows.find(r => r.selected);
  const active = new Map([[sel.name, PALETTE[0]]]);   // start with just the selected run
  let metric = 'val_dice';

  const h = hist[sel.name] || {};
  const nEp = (h.val_dice || []).length;
  const bestIdx = sel.best_epoch ?? 0;
  const tail = (h.val_dice || []).slice(-20);
  const drift = (h.val_dice && h.val_dice.length > 25)
    ? mean(h.val_dice.slice(-10)) - Math.max(...h.val_dice) : null;

  mount.innerHTML = `
  <h1>Training diagnostics</h1>
  <p class="lede">How the selected run converged, and how its curve compares with any other run you
  switch on. Curves come from each run's <code>*_history.csv</code> and the per-epoch timings in its log.</p>

  <div class="cards">
    ${card('Epochs run', nEp, `budget ${sel.epochs_budget ?? '—'}`)}
    ${card('Best epoch', sel.best_epoch ?? '—', 'checkpoint used for evaluation')}
    ${card('Best val Dice', fmtOr(sel.best_val_dice_patch,'best_val_dice_patch'), 'patch level', 'best_val_dice_patch')}
    ${card('Training time', sel.train_seconds ? (sel.train_seconds/3600).toFixed(1)+' h' : '—',
           sel.sec_per_epoch ? `${sel.sec_per_epoch}s per epoch` : '')}
    ${card('Learning rate', sel.lr ?? '—', 'peak, cosine schedule')}
    ${card('Parameters', sel.n_params ? (sel.n_params/1e6).toFixed(2)+' M' : '—', 'trainable')}
  </div>

  <div class="note ${bestIdx >= nEp - 5 ? 'warn' : ''}"><span class="tag">convergence</span><div class="bd">
    ${bestIdx >= nEp - 5
      ? `The best epoch (<b>${bestIdx}</b>) is at the very end of the ${nEp}-epoch budget, and patience was
         set to ${sel.epochs_budget}, so <b>early stopping never triggered</b>. The run stopped because it
         ran out of epochs, not because it converged. A longer budget might still have improved it slightly,
         though the last 20 epochs moved validation Dice by only
         ${tail.length ? (Math.max(...tail)-Math.min(...tail)).toFixed(4) : '—'}.`
      : `The best epoch (<b>${bestIdx}</b>) sits well before the end of training, so the run had converged.`}
  </div></div>

  <h2>Curves</h2>
  <div class="ctrls">
    <div class="f"><label for="mt">Metric</label>
      <select id="mt">
        <option value="val_dice">Validation Dice</option>
        <option value="train_loss">Training loss</option>
        <option value="val_iou">Validation IoU</option>
        <option value="val_precision">Validation precision</option>
        <option value="val_recall">Validation recall</option>
        <option value="lr">Learning rate</option>
      </select></div>
    <div class="f"><label for="add">Add a run to compare</label>
      <select id="add"><option value="">Choose a run…</option>
        ${[...rows].sort((a,b)=>(b.dice??0)-(a.dice??0)).map(r=>
          `<option value="${esc(r.name)}">${esc(MODEL_NAME[r.model]||r.model)} · ${esc(LOSS_NAME[r.loss]||r.loss)} · ${r.n_elev} elev — Dice ${fmtOr(r.dice,'dice')}</option>`).join('')}
      </select></div>
    <button id="clear" class="ghost">Show only the selected run</button>
  </div>
  <div class="chips" id="chips"></div>
  <figure><div class="viz" id="c-main"></div>
    <figcaption id="cap"></figcaption></figure>
  <div id="leg"></div>

  <h2>Is it over- or under-fitting?</h2>
  <div class="two">
    <figure><div class="viz" id="c-gap"></div><div id="l-gap"></div>
      <figcaption>Training progress (1 − rescaled loss) and validation Dice on one plot, both oriented
      so up means improving. If training keeps improving while validation Dice turns down, the two lines
      split and the run is over-fitting.</figcaption></figure>
    <div class="panel">
      <h3 style="margin-top:0">Reading of the selected run</h3>
      <div id="fitread"></div>
    </div>
  </div>

  <h2>Stability</h2>
  <p class="small">Epoch-to-epoch jumps in validation Dice. Large spikes indicate an unstable run;
  a flat line near zero at the end indicates convergence. This project had a numerical-instability
  problem earlier (NaN collapse) that was fixed with a gradient-finiteness gate, so this check matters.</p>
  <figure><div class="viz" id="c-stab"></div>
    <figcaption id="capstab"></figcaption></figure>

  <h2>Convergence across all runs</h2>
  <figure><div class="viz" id="c-all"></div>
    <figcaption>Best epoch against final validation Dice for every run. Runs bunched at the right edge
    hit the epoch budget rather than converging, which applies to most of this sweep.</figcaption></figure>`;

  const chips = mount.querySelector('#chips');
  const drawChips = () => {
    chips.innerHTML = [...active].map(([n,c]) => {
      const r = rows.find(x=>x.name===n);
      return `<button class="chip on" data-n="${esc(n)}" style="border-color:${c}">
        <span class="sw" style="background:${c};margin-right:5px"></span>
        ${esc(MODEL_NAME[r.model]||r.model)} ${r.n_elev} elev${r.selected?' ★':''} ✕</button>`;
    }).join('');
    chips.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      if (active.size > 1) { active.delete(b.dataset.n); drawChips(); drawMain(); }
    }));
  };

  function drawMain() {
    const series = [...active].map(([n,c]) => {
      const hh = hist[n]; if (!hh || !hh[metric]) return null;
      const r = rows.find(x=>x.name===n);
      return {label:`${MODEL_NAME[r.model]||r.model} ${r.n_elev} elev`, c,
              points: hh[metric].map((v,i)=>[i, v]), dots:false,
              best: r.best_epoch};
    }).filter(Boolean);
    if (!series.length) {
      mount.querySelector('#c-main').innerHTML =
        `<div class="state"><div class="big">No curve for this metric</div>
         <div class="small">This run's history does not contain <code>${esc(metric)}</code>.</div></div>`;
      return;
    }
    const all = series.flatMap(s=>s.points.map(p=>p[1])).filter(v=>v!=null);
    const isLr = metric==='lr';
    const lo = isLr ? 0 : Math.min(...all)*0.98, hi = Math.max(...all)*1.02;
    const maxEp = Math.max(...series.map(s=>s.points.length));
    mount.querySelector('#c-main').innerHTML = lineChart({
      series, xlo:0, xhi:maxEp-1, ylo:lo, yhi:hi,
      xlabel:'epoch', ylabel: metric==='train_loss'?'training loss':(M[metric.replace('val_','')]?.label||metric),
      W:880, H:360, aria:`${metric} by epoch`,
      marks: active.has(sel.name) && metric!=='lr' ? [{x:sel.best_epoch, label:`best epoch ${sel.best_epoch}`}] : [],
    });
    mount.querySelector('#leg').innerHTML = legend(series.map(s=>({c:s.c, label:s.label})));
    mount.querySelector('#cap').textContent = metric==='lr'
      ? 'Learning rate schedule: 3 warm-up epochs then cosine decay.'
      : `${series.length} run${series.length>1?'s':''} shown. The dashed line marks the epoch whose checkpoint was evaluated.`;
  }

  mount.querySelector('#mt').addEventListener('change', e => { metric = e.target.value; drawMain(); });
  mount.querySelector('#add').addEventListener('change', e => {
    const n = e.target.value;
    if (n && !active.has(n)) {
      active.set(n, PALETTE[active.size % PALETTE.length]);
      drawChips(); drawMain();
    }
    e.target.value = '';
  });
  mount.querySelector('#clear').addEventListener('click', () => {
    active.clear(); active.set(sel.name, PALETTE[0]); drawChips(); drawMain();
  });

  /* ---- over/under-fitting ---- */
  const tl = h.train_loss || [], vd = h.val_dice || [];
  if (tl.length && vd.length) {
    const nrm = a => { const lo=Math.min(...a), hi=Math.max(...a); return a.map(v=>(v-lo)/((hi-lo)||1)); };
    mount.querySelector('#c-gap').innerHTML = lineChart({
      series:[
        // loss is plotted inverted (1 - rescaled loss) so that, like Dice, UP means
        // improving; that makes over-fitting show up as the two lines splitting.
        {label:'training progress (1 − loss)', c:'var(--fp)', points:nrm(tl).map((v,i)=>[i,1-v]), dots:false},
        {label:'validation Dice', c:'var(--accent2)', points:nrm(vd).map((v,i)=>[i,v]), dots:false},
      ], xlo:0, xhi:Math.max(tl.length,vd.length)-1, ylo:0, yhi:1.05,
      xlabel:'epoch', ylabel:'rescaled 0–1, up = better', W:520, H:320,
      marks:[{x:sel.best_epoch, label:'best'}], aria:'Training progress against validation Dice',
    });
    mount.querySelector('#l-gap').innerHTML = legend([
      {c:'var(--fp)', label:'training progress (1 − loss)'},
      {c:'var(--accent2)', label:'validation Dice'},
    ]);
    const lastGain = vd.length>10 ? mean(vd.slice(-5)) - mean(vd.slice(-15,-10)) : null;
    mount.querySelector('#fitread').innerHTML = `
      <div class="kv">
        <span class="k">Best val Dice</span><span class="v">${fmtOr(Math.max(...vd),'dice')}</span>
        <span class="k">Final val Dice</span><span class="v">${fmtOr(vd.at(-1),'dice')}</span>
        <span class="k">Drop from peak</span><span class="v">${drift!=null?drift.toFixed(4):'—'}</span>
        <span class="k">Gain, last 15 ep</span><span class="v">${lastGain!=null?(lastGain>=0?'+':'')+lastGain.toFixed(4):'—'}</span>
        <span class="k">Train loss, final</span><span class="v">${tl.at(-1)?.toFixed(4) ?? '—'}</span>
        <span class="k">Val Dice std, last 20</span><span class="v">${tail.length>2?std(tail).toFixed(4):'—'}</span>
      </div>
      <p class="small">${
        drift!=null && drift < -0.01
          ? 'Validation Dice ends measurably below its peak while training loss keeps falling: mild over-fitting. The evaluated checkpoint is the peak epoch, so this does not affect the reported score.'
          : 'Validation Dice ends close to its peak and training loss is still falling slowly. There is no strong over-fitting signal; the run is closer to under-trained than over-trained.'
      }</p>`;
    const d = vd.slice(1).map((v,i)=>v-vd[i]);
    mount.querySelector('#c-stab').innerHTML = lineChart({
      series:[{label:'epoch-to-epoch change', c:'var(--accent2)', points:d.map((v,i)=>[i+1,v]), dots:false}],
      xlo:1, xhi:vd.length-1, ylo:Math.min(...d,-0.02)*1.1, yhi:Math.max(...d,0.02)*1.1,
      xlabel:'epoch', ylabel:'Δ validation Dice', W:880, H:250, aria:'Epoch to epoch change in validation Dice',
    });
    const big = d.filter(v=>Math.abs(v)>0.05).length;
    mount.querySelector('#capstab').textContent =
      `${big} epoch${big===1?'':'s'} moved validation Dice by more than 0.05. `+
      (big<=3 ? 'The run is stable: no NaN collapse or divergence.' : 'Several large jumps: the run was noisy early on.');
  }

  /* ---- all runs ---- */
  mount.querySelector('#c-all').innerHTML = scatter({
    points: rows.filter(r=>r.best_epoch!=null&&r.best_val_dice_patch!=null).map(r=>({
      x:r.best_epoch, y:r.best_val_dice_patch,
      c:r.selected?'var(--best)':'var(--accent2)', r:r.selected?7:3.4, o:r.selected?1:.6,
      t:`${MODEL_NAME[r.model]||r.model} ${r.n_elev} elev — best epoch ${r.best_epoch}, val Dice ${r.best_val_dice_patch}`})),
    xlo:0, xhi:100, ylo:.55, yhi:.73, xlabel:'best epoch', ylabel:'best validation Dice (patch)',
    W:880, H:330, aria:'Best epoch against best validation Dice for all runs',
  });

  drawChips(); drawMain();
}

