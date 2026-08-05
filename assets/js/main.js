/* Router + shell.

   Sections are separate ES modules loaded with dynamic import(), so visiting
   the overview never downloads the sample explorer or its charts. Each module
   exports `render(mount)` and is imported at most once (the browser caches the
   module registry). */

import { loading, errorState } from './lib/data.js';

const ROUTES = {
  overview:    {title: 'Executive overview',        mod: () => import('./sections/overview.js')},
  data:        {title: 'Data exploration',          mod: () => import('./sections/data.js')},
  experiments: {title: 'Experiment comparison',     mod: () => import('./sections/experiments.js')},
  training:    {title: 'Training diagnostics',      mod: () => import('./sections/training.js')},
  aggregate:   {title: 'Aggregate evaluation',      mod: () => import('./sections/aggregate.js')},
  segments:    {title: 'Performance breakdown',     mod: () => import('./sections/segments.js')},
  threshold:   {title: 'Threshold & calibration',   mod: () => import('./sections/threshold.js')},
  spatial:     {title: 'Spatial analysis',          mod: () => import('./sections/spatial.js')},
  samples:     {title: 'Sample explorer',           mod: () => import('./sections/samples.js')},
  errors:      {title: 'Error & failure analysis',  mod: () => import('./sections/errors.js')},
  stats:       {title: 'Statistical analysis',      mod: () => import('./sections/stats.js')},
  conclusions: {title: 'Conclusions',               mod: () => import('./sections/conclusions.js')},
  about:       {title: 'Methods & glossary',        mod: () => import('./sections/about.js')},
};

const main  = document.getElementById('main');
const crumb = document.getElementById('crumb');
const side  = document.getElementById('side');
let current = null;
let token = 0;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, query] = h.split('?');
  return {name: ROUTES[name] ? name : 'overview', query: new URLSearchParams(query || '')};
}

async function route() {
  const {name, query} = parseHash();
  const r = ROUTES[name];
  const my = ++token;

  document.querySelectorAll('.side a.nav').forEach(a =>
    a.setAttribute('aria-current', a.getAttribute('href') === `#/${name}` ? 'page' : 'false'));
  crumb.textContent = r.title;
  document.title = `${r.title} — Radar Segmentation Evaluation`;
  side.classList.remove('open');

  // Re-entering the same section (e.g. a deep link inside the sample explorer)
  // is handled by the section itself, not by a full re-render.
  if (current === name && ROUTES[name]._live?.onQuery) {
    ROUTES[name]._live.onQuery(query);
    return;
  }
  // Let the outgoing section release anything it owns outside its own subtree
  // (key handlers, the body scroll lock) before its DOM is discarded.
  if (current && ROUTES[current]?._live?.destroy) {
    try { ROUTES[current]._live.destroy(); }
    catch (e) { console.error(`[${current}] destroy failed`, e); }
    ROUTES[current]._live = null;
  }
  current = name;
  main.innerHTML = loading(`Loading ${r.title.toLowerCase()}…`);

  try {
    const mod = await r.mod();
    if (my !== token) return;              // a newer navigation won
    main.innerHTML = '';
    const live = await mod.render(main, query);
    ROUTES[name]._live = live || {};
    main.focus({preventScroll: true});
    window.scrollTo(0, 0);
  } catch (e) {
    if (my !== token) return;
    console.error(`[${name}]`, e);
    main.innerHTML = errorState(e, r.title.toLowerCase());
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
if (document.readyState !== 'loading') route();

document.getElementById('menu').addEventListener('click', e => {
  const open = side.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
document.getElementById('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const cur = root.getAttribute('data-theme') ||
    (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch {}
  window.dispatchEvent(new CustomEvent('themechange'));
});
try {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
} catch {}
