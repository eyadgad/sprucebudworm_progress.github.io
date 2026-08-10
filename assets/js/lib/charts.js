/* Reusable SVG chart primitives.

   Hand-written SVG rather than a charting library: the site must work offline
   from a static host with no bundler and no third-party network requests.
   Every chart returns a string, so callers can insert it lazily and cheaply.
   All charts carry role="img" + aria-label; series are labelled in text
   legends so colour is never the only cue. */

import { esc } from './metrics.js';

const N = v => (v === null || v === undefined || Number.isNaN(v)) ? null : +v;
export const clamp = (x,a=0,b=1) => Math.max(a, Math.min(b, x));

/** Nice axis ticks covering [lo,hi]. */
export function ticks(lo, hi, count = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let t = Math.ceil(lo/step)*step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(10));
  return out;
}
const fmtTick = v => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v/1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (v/1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  if (a >= 10) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
};

function frame({W, H, padL=52, padR=16, padT=14, padB=44}) {
  return {W, H, x0:padL, x1:W-padR, y0:H-padB, y1:padT};
}
function yAxis(f, lo, hi, label, tk) {
  let g = '';
  (tk || ticks(lo, hi)).forEach(t => {
    const Y = f.y0 - ((t-lo)/(hi-lo))*(f.y0-f.y1);
    if (!Number.isFinite(Y)) return;
    g += `<line x1="${f.x0}" y1="${Y}" x2="${f.x1}" y2="${Y}" stroke="var(--grid)"/>`
       + `<text x="${f.x0-7}" y="${Y}" text-anchor="end" dominant-baseline="middle" class="ax">${fmtTick(t)}</text>`;
  });
  if (label) g += `<text transform="translate(12,${(f.y0+f.y1)/2}) rotate(-90)" text-anchor="middle" class="axlab">${esc(label)}</text>`;
  return g;
}
const wrap = (f, g, aria) =>
  `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;

export function legend(items) {
  return `<div class="legend">` + items.map(i =>
    `<span><span class="sw" style="background:${i.c}"></span>${esc(i.label)}</span>`).join('') + `</div>`;
}

/* In-figure legend: a horizontal key drawn inside the SVG as a reserved band at
   the top of the chart, so the series labels sit in the plot itself rather than
   in a separate strip below it. Wraps to more rows when the items are wider than
   the plot. Returns the SVG fragment and the vertical space it needs, so the
   caller can reserve room above the data (extra top padding). */
function inlineTopLegend(items, x0, x1) {
  if (!items || !items.length) return {g: '', height: 0};
  const rowH = 15, sw = 11;
  const wOf = it => sw + 6 + String(it.label).length * 6.1 + 16;
  const rows = [[]];
  let used = 0;
  items.forEach(it => {
    const w = wOf(it);
    if (used + w > (x1 - x0) && rows[rows.length - 1].length) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(it); used += w;
  });
  let g = '';
  rows.forEach((row, ri) => {
    let lx = x0; const y = 9 + ri * rowH;
    row.forEach(it => {
      g += `<rect x="${lx}" y="${y - 9}" width="${sw}" height="${sw}" rx="2" fill="${it.c}"/>`
         + `<text x="${lx + sw + 6}" y="${y}" class="ax" style="font-family:var(--sans)">${esc(it.label)}</text>`;
      lx += wOf(it);
    });
  });
  return {g, height: rows.length * rowH + 4};
}

/* ---------------- grouped / stacked bars ---------------- */
export function barChart({cats, series, lo=0, hi=null, ylabel='', xlabel='', W=860, H=320, stacked=false, valueLabels=false, aria='bar chart', inlineLegend=false, legend=null}) {
  // The y-axis must clear the tallest thing actually drawn. For a stacked chart
  // that is each category's COLUMN TOTAL, not the largest single segment — using
  // the segment max lets the tallest stack overshoot the axis and (because the
  // SVG is overflow:visible) spill up into the heading above it.
  const peak = stacked
    ? Math.max(...cats.map((_, ci) => series.reduce((a, s) => a + (N(s.values[ci]) ?? 0), 0)), 0)
    : Math.max(...series.flatMap(s => s.values.map(v => N(v) ?? 0)), 0);
  const rawMax = peak * 1.08;
  // Guard the degenerate all-zero case, which would collapse the scale to NaN.
  const maxV = hi ?? (rawMax > lo ? rawMax : lo + 1);
  // room for the axis title and, when asked, an in-figure key
  const lg = inlineTopLegend(legend, 52, W - 16);
  const f = frame({W, H, padT: 14 + lg.height, padB: 56 + (xlabel ? 20 : 0) + (inlineLegend ? 22 : 0)});
  let g = lg.g + yAxis(f, lo, maxV, ylabel);
  const gw = (f.x1-f.x0)/cats.length;
  const sy = v => f.y0 - ((v-lo)/(maxV-lo))*(f.y0-f.y1);
  cats.forEach((c, ci) => {
    const cx = f.x0 + ci*gw + gw/2;
    if (stacked) {
      const bw = Math.min(46, gw*0.6);
      let base = 0;
      series.forEach(s => {
        const v = N(s.values[ci]) ?? 0;
        g += `<rect x="${cx-bw/2}" y="${sy(base+v)}" width="${bw}" height="${Math.max(sy(base)-sy(base+v),0)}" fill="${s.c}"><title>${esc(c)} ${esc(s.label)}: ${v.toLocaleString()}</title></rect>`;
        base += v;
      });
      if (valueLabels) g += `<text x="${cx}" y="${sy(base)-5}" text-anchor="middle" class="val">${fmtTick(base)}</text>`;
    } else {
      const bw = Math.min(42, (gw*0.74)/series.length);
      let bx = cx - (series.length*bw + (series.length-1)*4)/2;
      series.forEach(s => {
        const v = N(s.values[ci]);
        if (v !== null) {
          g += `<rect x="${bx}" y="${sy(v)}" width="${bw}" height="${Math.max(f.y0-sy(v),0)}" rx="2" fill="${s.c}"${s.stroke?` stroke="${s.stroke}" stroke-width="2.5"`:''}><title>${esc(c)} ${esc(s.label)}: ${v}</title></rect>`;
          if (valueLabels) g += `<text x="${bx+bw/2}" y="${sy(v)-4}" text-anchor="middle" class="ax" style="font-size:9px">${fmtTick(v)}</text>`;
        }
        bx += bw + 4;
      });
    }
    g += `<text x="${cx}" y="${f.y0+16}" text-anchor="middle" class="ax">${esc(c)}</text>`;
  });
  g += `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x1}" y2="${f.y0}" stroke="var(--ink)"/>`;
  if (xlabel) g += `<text x="${(f.x0+f.x1)/2}" y="${f.y0+36}" text-anchor="middle" class="axlab">${esc(xlabel)}</text>`;
  if (inlineLegend && series.length > 1) {
    const y = f.y0 + (xlabel ? 52 : 34);
    let lx = f.x0;
    series.forEach(s => {
      g += `<rect x="${lx}" y="${y-9}" width="11" height="11" rx="2" fill="${s.c}"/>`
         + `<text x="${lx+16}" y="${y}" class="ax" style="font-family:var(--sans)">${esc(s.label)}</text>`;
      lx += 22 + String(s.label).length * 6.6 + 14;
    });
  }
  return wrap(f, g, aria);
}

/* ---------------- horizontal ranked bars ---------------- */
export function hBarChart({items, lo, hi, W=860, labelW=250, aria='ranked bars', fmtV=(v)=>v.toFixed(3), xlabel='', legend=null}) {
  const lg = inlineTopLegend(legend, 8, W - 8);
  const barH=17, gap=7, padT=22 + lg.height;
  const H = padT + items.length*(barH+gap) + 6 + (xlabel ? 22 : 0);
  const x0=labelW, x1=W-58;
  const sx = v => x0 + clamp((v-lo)/(hi-lo))*(x1-x0);
  let g = lg.g;
  const axisBottom = H - (xlabel ? 22 : 0) - 4;
  ticks(lo, hi, 5).forEach(t => {
    const X = sx(t);
    g += `<line x1="${X}" y1="${padT-5}" x2="${X}" y2="${axisBottom}" stroke="var(--grid)"/>`
       + `<text x="${X}" y="${padT-9}" text-anchor="middle" class="ax">${fmtTick(t)}</text>`;
  });
  if (xlabel) g += `<text x="${(x0+x1)/2}" y="${H-5}" text-anchor="middle" class="axlab">${esc(xlabel)}</text>`;
  items.forEach((it, i) => {
    const y = padT + i*(barH+gap);
    g += `<text x="${x0-9}" y="${y+barH/2}" text-anchor="end" dominant-baseline="middle" class="lab" style="font-size:11.5px">${esc(it.label)}</text>`;
    const v = N(it.value);
    if (v === null) { g += `<text x="${x0+6}" y="${y+barH/2}" dominant-baseline="middle" class="ax">not available</text>`; return; }
    g += `<rect x="${x0}" y="${y}" width="${Math.max(sx(v)-x0,1)}" height="${barH}" rx="2" fill="${it.c||'var(--accent2)'}"${it.hl?' stroke="var(--best)" stroke-width="2"':''}><title>${esc(it.label)}: ${fmtV(v)}</title></rect>`;
    g += `<text x="${sx(v)+6}" y="${y+barH/2}" dominant-baseline="middle" class="val"${it.hl?' style="fill:var(--best)"':''}>${fmtV(v)}</text>`;
  });
  return wrap({W,H}, g, aria);
}

/* ---------------- multi-series line chart ---------------- */
export function lineChart({series, xlo, xhi, ylo, yhi, xlabel='', ylabel='', W=560, H=320, aria='line chart', marks=[], xticks=null, logx=false, legend=null}) {
  const lg = inlineTopLegend(legend, 52, W - 16);
  const f = frame({W, H, padB:52, padT: 14 + lg.height});
  const tx = v => logx ? Math.log10(Math.max(v,1e-9)) : v;
  const X0 = tx(xlo), X1 = tx(xhi);
  const sx = v => f.x0 + ((tx(v)-X0)/(X1-X0))*(f.x1-f.x0);
  const sy = v => f.y0 - ((v-ylo)/(yhi-ylo))*(f.y0-f.y1);
  let g = lg.g + yAxis(f, ylo, yhi, ylabel);
  (xticks || ticks(xlo, xhi, 6)).forEach(t => {
    const X = sx(t);
    if (X < f.x0-1 || X > f.x1+1) return;
    g += `<line x1="${X}" y1="${f.y0}" x2="${X}" y2="${f.y0+4}" stroke="var(--ink)"/>`
       + `<text x="${X}" y="${f.y0+17}" text-anchor="middle" class="ax">${fmtTick(t)}</text>`;
  });
  marks.forEach(m => {
    const X = sx(m.x);
    g += `<line x1="${X}" y1="${f.y1}" x2="${X}" y2="${f.y0}" stroke="${m.c||'var(--best)'}" stroke-width="1.4" stroke-dasharray="4 3"/>`
       + `<text x="${X+4}" y="${f.y1+11}" class="ax" style="fill:${m.c||'var(--best)'}">${esc(m.label)}</text>`;
  });
  series.forEach(s => {
    const pts = s.points.filter(p => N(p[1]) !== null);
    if (!pts.length) return;
    g += `<polyline points="${pts.map(p=>`${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.c}" stroke-width="${s.w||2}"${s.dash?` stroke-dasharray="${s.dash}"`:''} stroke-linejoin="round"/>`;
    if (s.dots !== false && pts.length <= 40) {
      pts.forEach(p => {
        const hl = s.best && Math.abs(p[0]-s.best) < 1e-9;
        g += `<circle cx="${sx(p[0])}" cy="${sy(p[1])}" r="${hl?5:3}" fill="${hl?'var(--best)':s.c}" stroke="var(--panel)" stroke-width="1"><title>${esc(s.label)} — x=${p[0]}, y=${(+p[1]).toFixed(4)}</title></circle>`;
      });
    }
  });
  g += `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x1}" y2="${f.y0}" stroke="var(--ink)"/>`;
  if (xlabel) g += `<text x="${(f.x0+f.x1)/2}" y="${f.y0+36}" text-anchor="middle" class="axlab">${esc(xlabel)}</text>`;
  return wrap(f, g, aria);
}

/* ---------------- scatter ---------------- */
export function scatter({points, xlo, xhi, ylo, yhi, xlabel='', ylabel='', W=560, H=340, aria='scatter plot', logx=false, trend=null, xticks=null, legend=null}) {
  const lg = inlineTopLegend(legend, 52, W - 16);
  const f = frame({W, H, padB:52, padT: 14 + lg.height});
  const tx = v => logx ? Math.log10(Math.max(v,1)) : v;
  const X0=tx(xlo), X1=tx(xhi);
  const sx = v => f.x0 + ((tx(v)-X0)/(X1-X0))*(f.x1-f.x0);
  const sy = v => f.y0 - ((v-ylo)/(yhi-ylo))*(f.y0-f.y1);
  let g = lg.g + yAxis(f, ylo, yhi, ylabel);
  const xt = xticks || (logx
    ? [1,10,100,1e3,1e4,1e5,1e6].filter(v=>v>=xlo&&v<=xhi)
    : ticks(xlo,xhi,6));
  xt.forEach(t => {
    const X = sx(t);
    if (X < f.x0-1 || X > f.x1+1) return;
    g += `<line x1="${X}" y1="${f.y1}" x2="${X}" y2="${f.y0}" stroke="var(--grid)"/>`
       + `<text x="${X}" y="${f.y0+17}" text-anchor="middle" class="ax">${fmtTick(t)}</text>`;
  });
  points.forEach(p => {
    if (N(p.x)===null || N(p.y)===null) return;
    g += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.r||3.2}" fill="${p.c||'var(--accent2)'}" fill-opacity="${p.o??0.68}" stroke="${p.c||'var(--accent2)'}" stroke-opacity=".5" stroke-width=".6">`
       + `<title>${esc(p.t||'')}</title></circle>`;
  });
  if (trend) {
    const a = sx(trend.x0), b = sy(trend.y0), c = sx(trend.x1), d = sy(trend.y1);
    g += `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="var(--best)" stroke-width="2" stroke-dasharray="6 4"/>`;
  }
  g += `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x1}" y2="${f.y0}" stroke="var(--ink)"/>`;
  if (xlabel) g += `<text x="${(f.x0+f.x1)/2}" y="${f.y0+36}" text-anchor="middle" class="axlab">${esc(xlabel)}</text>`;
  return wrap(f, g, aria);
}

/* ---------------- histogram ---------------- */
export function histogram({bins, counts, xlabel='', ylabel='count', W=560, H=280, c='var(--accent2)', logy=false, aria='histogram', series=null, legend=null}) {
  const lg = inlineTopLegend(legend, 52, W - 16);
  const f = frame({W, H, padB:50, padT: 14 + lg.height});
  const all = series ? series.flatMap(s=>s.counts) : counts;
  const maxC = Math.max(...all, 1);
  const ty = v => logy ? Math.log10(v+1) : v;
  const hiY = ty(maxC)*1.05;
  const sy = v => f.y0 - (ty(v)/hiY)*(f.y0-f.y1);
  let g = lg.g;
  ticks(0, hiY, 4).forEach(t => {
    const Y = f.y0 - (t/hiY)*(f.y0-f.y1);
    const lbl = logy ? fmtTick(Math.pow(10,t)-1) : fmtTick(t);
    g += `<line x1="${f.x0}" y1="${Y}" x2="${f.x1}" y2="${Y}" stroke="var(--grid)"/>`
       + `<text x="${f.x0-7}" y="${Y}" text-anchor="end" dominant-baseline="middle" class="ax">${lbl}</text>`;
  });
  g += `<text transform="translate(12,${(f.y0+f.y1)/2}) rotate(-90)" text-anchor="middle" class="axlab">${esc(ylabel)}${logy?' (log)':''}</text>`;
  const n = bins.length;
  const bw = (f.x1-f.x0)/n;
  const draw = (cnts, col, op) => cnts.forEach((v,i) => {
    if (!v) return;
    g += `<rect x="${f.x0+i*bw}" y="${sy(v)}" width="${Math.max(bw-0.6,0.8)}" height="${Math.max(f.y0-sy(v),0)}" fill="${col}" fill-opacity="${op}"><title>${fmtTick(bins[i])}: ${v.toLocaleString()}</title></rect>`;
  });
  if (series) series.forEach(s => draw(s.counts, s.c, 0.62));
  else draw(counts, c, 0.85);
  ticks(bins[0], bins[n-1], 6).forEach(t => {
    const X = f.x0 + ((t-bins[0])/(bins[n-1]-bins[0]))*(f.x1-f.x0);
    g += `<text x="${X}" y="${f.y0+17}" text-anchor="middle" class="ax">${fmtTick(t)}</text>`;
  });
  g += `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x1}" y2="${f.y0}" stroke="var(--ink)"/>`;
  if (xlabel) g += `<text x="${(f.x0+f.x1)/2}" y="${f.y0+36}" text-anchor="middle" class="axlab">${esc(xlabel)}</text>`;
  return wrap(f, g, aria);
}

/* ---------------- box plots (distribution per group) ---------------- */
export function boxPlot({groups, ylo, yhi, ylabel='', xlabel='', W=860, H=330, aria='box plot'}) {
  // reserve room for multi-line tick labels ("Dice\nval") plus the n= line
  const maxLines = Math.max(1, ...groups.map(gr => String(gr.label).split('\n').length));
  const labelBlock = 15 + maxLines * 12;                 // matches the tick label layout below
  const f = frame({W, H, padB: 40 + labelBlock + (xlabel ? 20 : 0)});
  const xLabelY = f.y0 + labelBlock + 15;
  let g = yAxis(f, ylo, yhi, ylabel);
  const gw = (f.x1-f.x0)/groups.length;
  const sy = v => f.y0 - ((v-ylo)/(yhi-ylo))*(f.y0-f.y1);
  groups.forEach((gr, i) => {
    const cx = f.x0 + i*gw + gw/2;
    const bw = Math.min(38, gw*0.5);
    if (gr.n === 0 || gr.q1 === null) {
      g += `<text x="${cx}" y="${(f.y0+f.y1)/2}" text-anchor="middle" class="ax">no data</text>`;
    } else {
      g += `<line x1="${cx}" y1="${sy(gr.lo)}" x2="${cx}" y2="${sy(gr.hi)}" stroke="var(--muted)"/>`;
      g += `<line x1="${cx-bw/4}" y1="${sy(gr.lo)}" x2="${cx+bw/4}" y2="${sy(gr.lo)}" stroke="var(--muted)"/>`;
      g += `<line x1="${cx-bw/4}" y1="${sy(gr.hi)}" x2="${cx+bw/4}" y2="${sy(gr.hi)}" stroke="var(--muted)"/>`;
      g += `<rect x="${cx-bw/2}" y="${sy(gr.q3)}" width="${bw}" height="${Math.max(sy(gr.q1)-sy(gr.q3),1)}" fill="${gr.c||'var(--accent2)'}" fill-opacity=".38" stroke="${gr.c||'var(--accent2)'}"><title>${esc(String(gr.label).replace(/\n/g,' '))} n=${gr.n} median=${gr.med?.toFixed(3)}</title></rect>`;
      g += `<line x1="${cx-bw/2}" y1="${sy(gr.med)}" x2="${cx+bw/2}" y2="${sy(gr.med)}" stroke="${gr.c||'var(--accent2)'}" stroke-width="2.5"/>`;
      if (gr.mean !== null && gr.mean !== undefined)
        g += `<circle cx="${cx}" cy="${sy(gr.mean)}" r="2.6" fill="var(--ink)"><title>mean ${gr.mean.toFixed(3)}</title></circle>`;
    }
    // A "\n" in the label becomes a real second line — SVG <text> does not wrap.
    const parts = String(gr.label).split('\n');
    parts.forEach((p, li) => {
      g += `<text x="${cx}" y="${f.y0 + 15 + li * 12}" text-anchor="middle" class="ax">${esc(p)}</text>`;
    });
    g += `<text x="${cx}" y="${f.y0 + 15 + parts.length * 12 + 1}" text-anchor="middle" class="ax" style="font-size:9.5px">n=${gr.n}</text>`;
  });
  g += `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x1}" y2="${f.y0}" stroke="var(--ink)"/>`;
  if (xlabel) g += `<text x="${(f.x0+f.x1)/2}" y="${xLabelY}" text-anchor="middle" class="axlab">${esc(xlabel)}</text>`;
  return wrap(f, g, aria);
}

/** Shared reading note for box plots, so the encoding is explained once. */
export const BOXPLOT_KEY =
  'Box spans the interquartile range (25th to 75th percentile), the thick line is the median, ' +
  'the dot is the mean, and the whiskers reach the 5th and 95th percentiles. ' +
  'n under each box is the number of scenes it summarises.';

/* ---------------- confusion matrix ---------------- */
export function confusion({tp, fp, fn, tn, W=430, title=''}) {
  const total = tp+fp+fn+tn;
  const cell = (x,y,v,lab,col,note) => {
    const share = total ? v/total : 0;
    return `<g><rect x="${x}" y="${y}" width="150" height="76" rx="8" fill="${col}" fill-opacity="${0.12+0.5*Math.min(share*2,1)}" stroke="${col}"/>`
      + `<text x="${x+10}" y="${y+19}" class="ax" style="fill:${col};font-weight:600">${esc(lab)}</text>`
      + `<text x="${x+10}" y="${y+45}" class="val" style="font-size:15px">${v.toLocaleString()}</text>`
      + `<text x="${x+10}" y="${y+63}" class="ax">${(share*100).toFixed(share<0.1?2:1)}% of pixels</text>`
      + (note?`<title>${esc(note)}</title>`:'') + `</g>`;
  };
  const H = 210;
  let g = `<text x="14" y="14" class="ax">predicted →</text>`;
  g += `<text transform="translate(12,${H/2}) rotate(-90)" text-anchor="middle" class="ax">truth →</text>`;
  g += `<text x="96" y="34" text-anchor="middle" class="ax">swarm</text>`;
  g += `<text x="255" y="34" text-anchor="middle" class="ax">background</text>`;
  g += `<text x="22" y="82" class="ax">swarm</text>`;
  g += `<text x="22" y="162" class="ax">bg</text>`;
  g += cell(56, 44, tp, 'TP', 'var(--tp)', 'correctly predicted swarm pixels');
  g += cell(214, 44, fn, 'FN', 'var(--fn)', 'missed swarm pixels');
  g += cell(56, 126, fp, 'FP', 'var(--fp)', 'false alarms');
  g += cell(214, 126, tn, 'TN', 'var(--tn)', 'correctly ignored background');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title||'confusion matrix')}: TP ${tp}, FP ${fp}, FN ${fn}, TN ${tn}">${g}</svg>`;
}

/* ---------------- parallel coordinates ---------------- */
export function parallel({rows, dims, W=880, H=360, aria='parallel coordinates'}) {
  const f = frame({W, H, padL:40, padR:40, padT:26, padB:52});
  const n = dims.length;
  const ax = i => f.x0 + (i/(n-1))*(f.x1-f.x0);
  let g = '';
  dims.forEach((d,i) => {
    const X = ax(i);
    // The outermost axis titles are anchored inward: centred text on the first
    // and last axis would run past the edge of the figure.
    const anchor = i === 0 ? 'start' : (i === n-1 ? 'end' : 'middle');
    g += `<line x1="${X}" y1="${f.y1}" x2="${X}" y2="${f.y0}" stroke="var(--hair)"/>`;
    g += `<text x="${X}" y="${f.y1-9}" text-anchor="${anchor}" class="ax" style="font-weight:600">${esc(d.label)}</text>`;
    g += `<text x="${X}" y="${f.y0+15}" text-anchor="${anchor}" class="ax">${fmtTick(d.lo)}</text>`;
    g += `<text x="${X}" y="${f.y1+2}" text-anchor="${anchor}" class="ax">${fmtTick(d.hi)}</text>`;
  });
  g += `<text x="${(f.x0+f.x1)/2}" y="${f.y0+38}" text-anchor="middle" class="axlab">each line is one run — higher on every axis is better</text>`;
  rows.forEach(r => {
    const pts = dims.map((d,i) => {
      const v = N(r.values[i]);
      if (v === null) return null;
      const Y = f.y0 - (clamp((v-d.lo)/(d.hi-d.lo)))*(f.y0-f.y1);
      return `${ax(i).toFixed(1)},${Y.toFixed(1)}`;
    });
    if (pts.some(p=>p===null)) return;
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${r.c}" stroke-width="${r.hl?2.6:1.1}" stroke-opacity="${r.hl?1:0.42}"><title>${esc(r.label)}</title></polyline>`;
  });
  return wrap(f, g, aria);
}
