/* Central registry of metric names, definitions, formulas and display rules.
   Every section imports from here so a metric is never labelled or explained
   two different ways. */

export const M = {
  dice:        {label:'Dice',        unit:'',   hi:true, dp:3, def:'Overlap of prediction and truth, counted twice for the intersection.', formula:'2·TP / (2·TP + FP + FN)'},
  dice_micro:  {label:'Dice (micro)',unit:'',   hi:true, dp:3, def:'Same formula with all pixels of all scenes pooled together. Dominated by large swarms.', formula:'2·ΣTP / (2·ΣTP + ΣFP + ΣFN)'},
  iou:         {label:'IoU',         unit:'',   hi:true, dp:3, def:'Intersection over union. Always lower than Dice for the same masks.', formula:'TP / (TP + FP + FN)'},
  iou_micro:   {label:'IoU (micro)', unit:'',   hi:true, dp:3, def:'Pixel pooled intersection over union.', formula:'ΣTP / (ΣTP + ΣFP + ΣFN)'},
  precision:   {label:'Precision',   unit:'',   hi:true, dp:3, def:'Share of predicted swarm pixels that are correct. Low precision means false alarms.', formula:'TP / (TP + FP)'},
  recall:      {label:'Recall',      unit:'',   hi:true, dp:3, def:'Share of true swarm pixels that were found. Low recall means missed signal.', formula:'TP / (TP + FN)'},
  f1:          {label:'F1',          unit:'',   hi:true, dp:3, def:'Harmonic mean of precision and recall. For binary masks it equals Dice.', formula:'2·P·R / (P + R)'},
  accuracy:    {label:'Accuracy',    unit:'',   hi:true, dp:4, def:'Share of all pixels classified correctly. Near 1 for any model here because most pixels are background, so it is a weak metric for this task.', formula:'(TP + TN) / (TP + TN + FP + FN)'},
  specificity: {label:'Specificity', unit:'',   hi:true, dp:4, def:'Share of true background pixels correctly left out.', formula:'TN / (TN + FP)'},
  balanced_acc:{label:'Balanced acc',unit:'',   hi:true, dp:3, def:'Mean of recall and specificity. Unlike accuracy it does not reward predicting all background.', formula:'(Recall + Specificity) / 2'},
  boundary_iou:{label:'Boundary IoU',unit:'',   hi:true, dp:3, def:'IoU restricted to a band along the mask boundary. Measures edge placement rather than area.', formula:'|∂G ∩ ∂P| / |∂G ∪ ∂P|'},
  nsd:         {label:'NSD @2px',    unit:'',   hi:true, dp:3, def:'Normalized surface Dice: share of each boundary lying within 2 pixels of the other boundary.', formula:'(|∂P within τ of ∂G| + |∂G within τ of ∂P|) / (|∂P| + |∂G|)'},
  hd95:        {label:'HD95',        unit:'px', hi:false,dp:1, def:'95th percentile of boundary to boundary distance. Lower is better. Sensitive to far outlying blobs.', formula:'P95( d(∂P,∂G) ∪ d(∂G,∂P) )'},
  assd:        {label:'ASSD',        unit:'px', hi:false,dp:1, def:'Average symmetric surface distance. Lower is better.', formula:'mean( d(∂P,∂G) ∪ d(∂G,∂P) )'},
  bg_fp_rate:  {label:'Background FP',unit:'',  hi:false,dp:5, def:'On scenes with no swarm at all, the fraction of pixels wrongly predicted as swarm. Lower is better.', formula:'FP / (all pixels)'},
  gt_area:     {label:'Truth area',  unit:'px', hi:null, dp:0, def:'Number of ground-truth positive pixels in the scene.', formula:'Σ G'},
  pred_area:   {label:'Predicted area',unit:'px',hi:null,dp:0, def:'Number of predicted positive pixels in the scene.', formula:'Σ P'},
  tp:{label:'TP',unit:'px',hi:true,dp:0,def:'True positives: pixels correctly predicted as swarm.',formula:'|P ∩ G|'},
  fp:{label:'FP',unit:'px',hi:false,dp:0,def:'False positives: predicted swarm where there is none.',formula:'|P \\ G|'},
  fn:{label:'FN',unit:'px',hi:false,dp:0,def:'False negatives: true swarm the model missed.',formula:'|G \\ P|'},
  tn:{label:'TN',unit:'px',hi:true,dp:0,def:'True negatives: background correctly left out.',formula:'|¬P ∩ ¬G|'},
  n_gt_regions:{label:'Truth regions',unit:'',hi:null,dp:0,def:'Connected components of at least 10 pixels in the ground truth.',formula:'count(components ≥ 10 px)'},
  n_pred_regions:{label:'Predicted regions',unit:'',hi:null,dp:0,def:'Connected components of at least 10 pixels in the prediction. Many more than the truth indicates a fragmented prediction.',formula:'count(components ≥ 10 px)'},
  best_val_dice_patch:{label:'Val Dice (patch)',unit:'',hi:true,dp:4,def:'Best validation Dice measured on patches during training. This is the model selection signal, not a full scene score.',formula:'2·TP / (2·TP + FP + FN) on val patches'},
};

/* Colour semantics for segmentation outcomes. Kept identical to the baseline
   report so figures are directly comparable. Every use is paired with a text
   label or shape so colour is never the only cue. */
export const SEG = {
  tp:{c:'var(--tp)', label:'Correct overlap (TP)', short:'TP'},
  fp:{c:'var(--fp)', label:'False positive (FP)',  short:'FP'},
  fn:{c:'var(--fn)', label:'Missed / false negative (FN)', short:'FN'},
  tn:{c:'var(--tn)', label:'Background (TN)', short:'TN'},
};
export const SPLIT_COLOR = {train:'#3a6fce', val:'#2f9d8c', test:'#e2a33d'};

export const fmt = (v, key) => {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  const m = M[key];
  const dp = m ? m.dp : 3;
  if (dp === 0) return Math.round(v).toLocaleString('en-US');
  return Number(v).toFixed(dp);
};
export const fmtOr = (v, key, dash = '—') => fmt(v, key) ?? dash;
export const pct = (v, dp = 1) => (v === null || v === undefined ? '—' : (v * 100).toFixed(dp) + '%');
export const int = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US'));

/** `<abbr>`-style label carrying the definition as an accessible tooltip. */
export const tip = (key, text) => {
  const m = M[key];
  if (!m) return text || key;
  const t = `${m.def} Formula: ${m.formula}`;
  return `<span class="tip" tabindex="0" data-tip="${esc(t)}">${text || m.label}</span>`;
};
export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* Human names for the model identifiers used in the experiment configs. */
export const MODEL_NAME = {
  unet:'UNet', attention_unet:'Attention UNet', nnunet:'nnUNet',
  smp_unetpp:'UNet++', smp_deeplabv3p:'DeepLabV3+', smp_segformer:'SegFormer',
};
export const LOSS_NAME = {
  dice_bce:'Dice + BCE', focal:'Focal', tversky:'Tversky',
  focal_tversky:'Focal Tversky', dice_boundary:'Dice + Boundary',
};
export const targetName = (mode, thr) =>
  mode === 'isfinite' ? 'any echo' : (thr >= 5 ? 'dBZ ≥ 5' : 'dBZ ≥ 0');

/** "2013 Jul 13_14" + 0030 -> readable timestamp label. */
export const tsLabel = (ts) => {
  const s = String(ts);
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)} ${s.slice(8,10)}:${s.slice(10,12)}`;
};
export const hhmm = (ts) => `${String(ts).slice(8,10)}:${String(ts).slice(10,12)}`;

/* ---- small statistics helpers (shared so numbers are reproducible) ---- */
export const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
export const quantile = (arr, q) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x,y)=>x-y);
  const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return lo === hi ? a[lo] : a[lo] + (a[hi]-a[lo])*(p-lo);
};
export const std = a => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));
};
/** Percentile bootstrap CI of the mean. Deterministic: fixed seed LCG. */
export const bootCI = (arr, n = 2000, alpha = 0.05, seed = 12345) => {
  if (arr.length < 3) return null;
  let s = seed >>> 0;
  const rnd = () => ((s = (1664525*s + 1013904223) >>> 0) / 4294967296);
  const N = arr.length, means = new Array(n);
  for (let b = 0; b < n; b++) {
    let acc = 0;
    for (let i = 0; i < N; i++) acc += arr[(rnd()*N)|0];
    means[b] = acc/N;
  }
  means.sort((a,b)=>a-b);
  return [means[Math.floor(alpha/2*n)], means[Math.floor((1-alpha/2)*n)]];
};
/** Two-sided Wilcoxon signed-rank test via normal approximation (paired). */
export const wilcoxon = (a, b) => {
  const d = a.map((v,i)=>v-b[i]).filter(v=>v!==0);
  const n = d.length;
  if (n < 6) return null;
  const idx = d.map((v,i)=>[Math.abs(v),i]).sort((x,y)=>x[0]-y[0]);
  const rank = new Array(n);
  for (let i=0;i<n;){
    let j=i; while(j+1<n && idx[j+1][0]===idx[i][0]) j++;
    const r=(i+j+2)/2;
    for(let k=i;k<=j;k++) rank[idx[k][1]]=r;
    i=j+1;
  }
  let W=0; d.forEach((v,i)=>{ if(v>0) W+=rank[i]; });
  const mu=n*(n+1)/4, sd=Math.sqrt(n*(n+1)*(2*n+1)/24);
  const z=(W-mu)/sd;
  const p=2*(1-normCdf(Math.abs(z)));
  return {n, z:+z.toFixed(3), p:Math.max(p,1e-12)};
};
const normCdf = z => {
  const t = 1/(1+0.2316419*Math.abs(z));
  const d = 0.3989423*Math.exp(-z*z/2);
  const p = d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  return z > 0 ? 1-p : p;
};
export const pearson = (x, y) => {
  const n = x.length; if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  let sxy=0, sxx=0, syy=0;
  for (let i=0;i<n;i++){ const a=x[i]-mx, b=y[i]-my; sxy+=a*b; sxx+=a*a; syy+=b*b; }
  return (sxx && syy) ? sxy/Math.sqrt(sxx*syy) : null;
};
export const spearman = (x, y) => {
  const rk = v => {
    const s = v.map((val,i)=>[val,i]).sort((a,b)=>a[0]-b[0]);
    const r = new Array(v.length);
    for (let i=0;i<s.length;){
      let j=i; while(j+1<s.length && s[j+1][0]===s[i][0]) j++;
      const avg=(i+j+2)/2;
      for(let k=i;k<=j;k++) r[s[k][1]]=avg;
      i=j+1;
    }
    return r;
  };
  return pearson(rk(x), rk(y));
};
