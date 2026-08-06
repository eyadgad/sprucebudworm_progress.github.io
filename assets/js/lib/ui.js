/* Small UI building blocks shared by the sections.

   These were previously copy-pasted: `card` existed in five sections and the
   filter <select> builder in three, which meant a styling or accessibility fix
   had to be made in several places to take effect. */

import { esc, tip } from './metrics.js';

/** Metric card. `key` links the label to the metric registry tooltip. */
export const card = (label, value, sub = '', key = null, highlight = false) => `
  <div class="card${highlight ? ' hl' : ''}">
    <div class="k">${key ? tip(key, label) : esc(label)}</div>
    <div class="v">${value ?? '—'}</div>
    ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
  </div>`;

export const cards = (items) => `<div class="cards">${items.join('')}</div>`;

/**
 * Labelled <select>, appended to `parent`.
 * @param {HTMLElement} parent
 * @param {object} o {label, id, options:[[value,text]], value, onChange}
 * @returns {HTMLSelectElement}
 */
export function select(parent, {label, id, options, value, onChange}) {
  const w = document.createElement('div');
  w.className = 'f';
  w.innerHTML = `<label for="${esc(id)}">${esc(label)}</label>
    <select id="${esc(id)}">${options.map(([v, t]) =>
      `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`
    ).join('')}</select>`;
  const el = w.querySelector('select');
  el.addEventListener('change', e => onChange(e.target.value));
  parent.appendChild(w);
  return el;
}

/** The split picker used by six sections, so its wording stays consistent. */
export function splitSelect(parent, value, onChange, {both = false} = {}) {
  return select(parent, {
    label: 'Split', id: 'sp', value, onChange,
    options: [['test', 'Test (held out)'], ['val', 'Validation'],
      ...(both ? [['both', 'Both (shown separately)']] : [])],
  });
}

/**
 * A Split + Year + Night filter bar shared by the per-model sections, so the
 * same filters apply to every chart AND table in a section. The Night list is
 * scoped to the current split/year, so it never lists nights that can't match.
 *
 * @param {HTMLElement} parent
 * @param {object} o {samples, splits?, onChange, extra?}
 *   extra: optional [{label,id,options,value}] controls appended after the
 *   filters (e.g. a Metric selector); their values are exposed on state.
 * @returns {{state, predicate:(row)=>boolean, values:()=>object}}
 */
export function sceneFilters(parent, {samples, splits = ['test', 'val'], onChange, extra = []}) {
  const pos = samples.filter(s => s.label === 1);
  const yearsAll = [...new Set(pos.map(s => s.year))].sort();
  const splitLabel = sp => sp === 'both' ? 'Both (pooled)'
    : sp === 'test' ? 'Test (held out)' : 'Validation';
  const state = {split: splits[0], year: 'all', night: 'all'};
  extra.forEach(e => { state[e.id] = e.value ?? (e.options[0] && e.options[0][0]); });

  const bar = document.createElement('div');
  bar.className = 'ctrls';
  parent.appendChild(bar);

  const nightsFor = () => [...new Set(pos.filter(s => s.night &&
    (state.split === 'both' || s.split === state.split) &&
    (state.year === 'all' || String(s.year) === state.year)).map(s => s.night))].sort();

  function rebuild() {
    bar.innerHTML = '';
    select(bar, {label: 'Split', id: 'f-split', value: state.split,
      options: splits.map(sp => [sp, splitLabel(sp)]),
      onChange: v => { state.split = v; state.night = 'all'; rebuild(); onChange(); }});
    select(bar, {label: 'Year', id: 'f-year', value: state.year,
      options: [['all', 'All years'], ...yearsAll.map(y => [y, String(y)])],
      onChange: v => { state.year = v; state.night = 'all'; rebuild(); onChange(); }});
    const nights = nightsFor();
    select(bar, {label: 'Night', id: 'f-night', value: state.night,
      options: [['all', `All nights (${nights.length})`], ...nights.map(n => [n, n])],
      onChange: v => { state.night = v; onChange(); }});
    extra.forEach(e => select(bar, {label: e.label, id: 'f-' + e.id, value: state[e.id],
      options: e.options, onChange: v => { state[e.id] = v; onChange(); }}));
    const rb = document.createElement('button');
    rb.className = 'ghost'; rb.textContent = 'Reset';
    rb.addEventListener('click', () => {
      state.split = splits[0]; state.year = 'all'; state.night = 'all'; rebuild(); onChange();
    });
    bar.appendChild(rb);
  }
  rebuild();

  const predicate = row =>
    (state.split === 'both' || row.split === state.split) &&
    (state.year === 'all' || String(row.year) === state.year) &&
    (state.night === 'all' || row.night === state.night);
  return {state, predicate, values: () => ({...state})};
}

/**
 * Accessible modal dialog.
 *
 * Owns the whole lifecycle so callers cannot leak it: focus is moved in on
 * open, trapped while open, and restored to the trigger on close; the page
 * scroll lock and the key handler are always released, including when the
 * caller is torn down by a route change.
 */
export class Modal {
  constructor(mount) {
    this.mount = mount;
    this.prevFocus = null;
    this.onKey = null;
    this.handlers = {};
  }

  /** @param {string} html  @param {object} handlers {onPrev,onNext,onClose} */
  open(html, handlers = {}) {
    const firstOpen = !this.isOpen;
    if (firstOpen) this.prevFocus = document.activeElement;
    this.handlers = handlers;
    this.mount.innerHTML = html;
    document.body.style.overflow = 'hidden';

    const box = this.mount.querySelector('.modal');
    if (!box) return;
    box.addEventListener('click', e => { if (e.target === box) this.close(); });

    if (!this.onKey) {
      // Bound once per open sequence, not once per rendered scene: re-rendering
      // the body while navigating must not stack another handler.
      this.onKey = e => {
        if (!this.isOpen) return;
        if (e.key === 'Escape') { e.preventDefault(); this.close(); }
        else if (e.key === 'ArrowLeft') this.handlers.onPrev?.();
        else if (e.key === 'ArrowRight') this.handlers.onNext?.();
        else if (e.key === 'Tab') this.trapFocus(e);
      };
      document.addEventListener('keydown', this.onKey);
    }
    // Move focus into the dialog so keyboard and screen-reader users follow it.
    // Must skip disabled controls: the prev/next buttons are disabled at the
    // ends of the list, and a disabled element silently refuses focus.
    const target = box.querySelector('[autofocus]:not([disabled])') || this.focusables()[0];
    if (target) target.focus();
    else { box.setAttribute('tabindex', '-1'); box.focus(); }
  }

  focusables() {
    return [...this.mount.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null);
  }

  get isOpen() { return !!this.mount.querySelector('.modal'); }

  trapFocus(e) {
    const f = this.focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  close() {
    this.mount.innerHTML = '';
    document.body.style.overflow = '';
    if (this.onKey) { document.removeEventListener('keydown', this.onKey); this.onKey = null; }
    this.handlers.onClose?.();
    this.handlers = {};
    if (this.prevFocus && document.contains(this.prevFocus)) this.prevFocus.focus();
    this.prevFocus = null;
  }

  /** Called by the router when the section is replaced. */
  destroy() { if (this.isOpen || this.onKey) this.close(); }
}
