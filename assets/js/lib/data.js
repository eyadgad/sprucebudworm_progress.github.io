/* Cached JSON loading.

   Each dataset file is fetched at most once per page load and shared between
   sections. Sections request only what they need, so opening the overview does
   not download the per-sample results or the training histories. */

const cache = new Map();
const inflight = new Map();

export async function load(name) {
  if (cache.has(name)) return cache.get(name);
  if (inflight.has(name)) return inflight.get(name);
  const p = fetch(`data/${name}.json`, {cache: 'force-cache'})
    .then(r => {
      if (!r.ok) throw new Error(`${name}.json — HTTP ${r.status}`);
      return r.json();
    })
    .then(j => { cache.set(name, j); inflight.delete(name); return j; })
    .catch(e => { inflight.delete(name); throw e; });
  inflight.set(name, p);
  return p;
}

/** True when a data file exists; used to show honest "not available" states. */
export async function has(name) {
  try { await load(name); return true; } catch { return false; }
}

export const loading = (msg = 'Loading…') =>
  `<div class="state"><div class="spin" role="status" aria-live="polite"></div><div>${msg}</div></div>`;

export const errorState = (e, what = 'this section') =>
  `<div class="state"><div class="big">Could not load ${what}</div>
   <div class="small">${String(e.message || e)}</div>
   <div class="small">Run <code>python scripts/export_dashboard_data.py</code> to regenerate the data files.</div></div>`;

export const emptyState = (msg = 'No rows match these filters.', hint = 'Try widening or clearing a filter.') =>
  `<div class="state"><div class="big">${msg}</div><div class="small">${hint}</div></div>`;

/** Marks an analysis that the current outputs cannot support. */
export const naState = (what, needs) =>
  `<div class="note warn"><span class="tag">not available</span><div class="bd">
   <b>${what}</b> is not shown because the required data is not produced by this project's outputs.
   ${needs ? `To support it: ${needs}` : ''}</div></div>`;
