/* Reusable sortable / paginated data table.

   Rows are rendered a page at a time rather than all at once: the experiment
   table (57 rows) and the sample table (600+ rows) share this component, and
   the sample table would otherwise put thousands of cells in the DOM. */

import { esc } from './metrics.js';

export class DataTable {
  /**
   * @param {HTMLElement} mount
   * @param {object} o  {columns, rows, pageSize, sort, dir, rowClass, onRow, empty}
   *   columns: [{key, label, tip, fmt, cls, sortable}]
   */
  constructor(mount, o) {
    this.el = mount;
    this.cols = o.columns;
    this.all = o.rows;
    this.pageSize = o.pageSize ?? 25;
    this.sortKey = o.sort ?? null;
    this.dir = o.dir ?? -1;              // -1 desc, 1 asc
    this.page = 0;
    this.rowClass = o.rowClass || (() => '');
    this.onRow = o.onRow || null;
    this.emptyMsg = o.empty || 'No rows match these filters.';
    this.render();
  }

  setRows(rows) { this.all = rows; this.page = 0; this.render(); }

  get sorted() {
    if (!this.sortKey) return this.all;
    const k = this.sortKey, d = this.dir;
    return [...this.all].sort((a, b) => {
      const x = a[k], y = b[k];
      const xn = x === null || x === undefined || Number.isNaN(x);
      const yn = y === null || y === undefined || Number.isNaN(y);
      if (xn && yn) return 0;
      if (xn) return 1;                 // missing values always sort last
      if (yn) return -1;
      if (typeof x === 'string' || typeof y === 'string')
        return d * String(x).localeCompare(String(y));
      return d * (x - y);
    });
  }

  render() {
    const rows = this.sorted;
    const nPages = Math.max(1, Math.ceil(rows.length / this.pageSize));
    this.page = Math.min(this.page, nPages - 1);
    const slice = rows.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);

    if (!rows.length) {
      this.el.innerHTML = `<div class="state"><div class="big">${esc(this.emptyMsg)}</div>
        <div class="small">Try widening or clearing a filter.</div></div>`;
      return;
    }

    const head = this.cols.map(c => {
      const active = this.sortKey === c.key;
      const arrow = active ? `<span class="dir">${this.dir === -1 ? '▾' : '▴'}</span>` : '';
      const lbl = c.tip
        ? `<span class="tip" tabindex="0" data-tip="${esc(c.tip)}">${esc(c.label)}</span>`
        : esc(c.label);
      const sortable = c.sortable !== false;
      return `<th${sortable ? ` class="sortable" data-k="${esc(c.key)}" tabindex="0" role="button"
        aria-label="Sort by ${esc(c.label)}"` : ''}>${lbl} ${arrow}</th>`;
    }).join('');

    const body = slice.map((r, i) => {
      const tds = this.cols.map(c => {
        const raw = r[c.key];
        const v = c.fmt ? c.fmt(raw, r) : (raw ?? '—');
        return `<td class="${c.cls || 'n'}">${v}</td>`;
      }).join('');
      return `<tr class="${this.rowClass(r)}${this.onRow ? ' clickable' : ''}" data-i="${this.page * this.pageSize + i}">${tds}</tr>`;
    }).join('');

    const from = this.page * this.pageSize + 1;
    const to = Math.min(rows.length, (this.page + 1) * this.pageSize);
    this.el.innerHTML =
      `<div class="tscroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
       <div class="tfoot">
         <span>Showing <b>${from}–${to}</b> of <b>${rows.length}</b> rows</span>
         <span style="display:flex;gap:6px;align-items:center">
           <button data-nav="prev"${this.page === 0 ? ' disabled' : ''}>← Prev</button>
           <span class="small">page ${this.page + 1} / ${nPages}</span>
           <button data-nav="next"${this.page >= nPages - 1 ? ' disabled' : ''}>Next →</button>
         </span>
       </div>`;

    this.el.querySelectorAll('th.sortable').forEach(th => {
      const go = () => {
        const k = th.dataset.k;
        if (this.sortKey === k) this.dir = -this.dir;
        else { this.sortKey = k; this.dir = -1; }
        this.page = 0; this.render();
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    this.el.querySelectorAll('[data-nav]').forEach(b =>
      b.addEventListener('click', () => {
        this.page += b.dataset.nav === 'next' ? 1 : -1;
        this.render();
        this.el.scrollIntoView({block: 'nearest'});
      }));
    if (this.onRow) {
      this.el.querySelectorAll('tbody tr').forEach(tr =>
        tr.addEventListener('click', () => this.onRow(this.sorted[+tr.dataset.i])));
    }
  }
}

/** Builds a labelled <select>; returns the wrapper element. */
export function selectField(label, options, value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'f';
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  wrap.innerHTML = `<label for="${id}">${esc(label)}</label>
    <select id="${id}">${options.map(o =>
      `<option value="${esc(o.v)}"${o.v === value ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
  wrap.querySelector('select').addEventListener('change', e => onChange(e.target.value));
  return wrap;
}
