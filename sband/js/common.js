/* Shared helpers for the S-band pages. Fetches stay relative to this file. */

export const MODEL_COLOR = ["#1f66c9", "#c2680c", "#6a3ea1"];
export const MODEL_NAME = ["e1  −0.3°", "e4  0.4°", "e1e4  both"];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function num(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return (Number(v) * 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) + "%";
}

export async function load(name) {
  const url = new URL(`../data/${name}`, import.meta.url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${name} (${r.status})`);
  return r.json();
}

export async function loadOptional(name) {
  try {
    const url = new URL(`../data/${name}`, import.meta.url);
    const r = await fetch(url);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export function table(headers, rows) {
  const head = "<tr>" + headers.map(h => `<th>${esc(h)}</th>`).join("") + "</tr>";
  const body = rows.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("");
  return `<div class="tscroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

export function td(v) {
  return esc(v);
}

export function initShell() {
  const page = document.body.dataset.page;
  document.querySelectorAll(".side a.nav").forEach(a => {
    if (a.dataset.page === page) a.setAttribute("aria-current", "page");
  });
  const menu = document.getElementById("menu");
  const side = document.getElementById("side");
  menu?.addEventListener("click", e => {
    const open = side.classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  document.getElementById("theme")?.addEventListener("click", () => {
    const root = document.documentElement;
    const cur = root.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch { /* private mode */ }
  });
}

/** Grouped bars. values[series][category], y from 0 to yMax. */
export function groupedBars({ labels, series, yMax, aria }) {
  const W = 760, H = 280, padL = 44, padR = 12, padT = 16, padB = 36;
  const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;
  const n = labels.length;
  const k = series.length;
  const slot = (x1 - x0) / n;
  const bw = Math.min(14, (slot - 8) / k);
  let g = "";
  for (let t = 0; t <= 4; t++) {
    const v = yMax * t / 4;
    const Y = y0 - (v / yMax) * (y0 - y1);
    g += `<line x1="${x0}" y1="${Y}" x2="${x1}" y2="${Y}" stroke="var(--grid)"/>`;
    g += `<text x="${x0 - 6}" y="${Y}" text-anchor="end" dominant-baseline="middle" class="ax">${esc(v.toFixed(v >= 10 ? 0 : 2))}</text>`;
  }
  labels.forEach((lab, i) => {
    const cx = x0 + slot * i + slot / 2;
    series.forEach((s, j) => {
      const val = Math.max(0, Math.min(yMax, Number(s.values[i]) || 0));
      const h = (val / yMax) * (y0 - y1);
      const x = cx - (k * bw) / 2 + j * bw;
      g += `<rect x="${x.toFixed(1)}" y="${(y0 - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"><title>${esc(s.label)} ${esc(lab)}: ${val.toFixed(3)}</title></rect>`;
    });
    if (n <= 16 || i % 2 === 0) {
      g += `<text x="${cx}" y="${y0 + 16}" text-anchor="middle" class="ax">${esc(lab)}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${g}</svg>`;
}

export const NAV = ""; // nav is in the HTML of each page
