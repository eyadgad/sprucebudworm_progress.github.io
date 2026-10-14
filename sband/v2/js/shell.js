/* Shared chrome: full site nav, theme, and the corrections banner. */

import { getState, onChange, renderBanner, renderCorrectionList } from "./state.js";

const C = "../../index.html";

const LINKS = [
  ["Summary", [
    ["01", "Executive overview", `${C}#/overview`],
    ["02", "Data exploration", `${C}#/data`],
  ]],
  ["Model selection", [
    ["03", "Experiment comparison", `${C}#/experiments`],
    ["04", "Scan classification", `${C}#/classification`],
    ["05", "Training diagnostics", `${C}#/training`],
  ]],
  ["Selected model", [
    ["06", "Aggregate evaluation", `${C}#/aggregate`],
    ["07", "Present or absent", `${C}#/presence`],
    ["08", "Performance breakdown", `${C}#/segments`],
  ]],
  ["Detail", [
    ["09", "Sample explorer", `${C}#/samples`],
    ["10", "Error & failure analysis", `${C}#/errors`],
    ["11", "Statistical analysis", `${C}#/stats`],
    ["12", "Methods & glossary", `${C}#/about`],
    ["13", "Publication results", "../../publication.html"],
  ]],
  ["S-band 2021–2022", [
    ["14", "Overview", "overview.html", "overview"],
    ["15", "Explore", "explore.html", "explore"],
    ["16", "Analysis", "analysis.html", "analysis"],
  ]],
];

function navHtml(page) {
  const groups = LINKS.map(([title, links]) => {
    const items = links.map(([n, label, href, id]) => {
      const current = id === page ? ` aria-current="page"` : "";
      const data = id ? ` data-page="${id}"` : "";
      return `<a class="nav" href="${href}"${data}${current}><span class="n">${n}</span> ${label}</a>`;
    }).join("");
    return `<div class="navgrp">${title}</div>${items}`;
  }).join("");
  return `
    <div class="brand">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="var(--accent)" stroke-width="1.5"/><circle cx="20" cy="20" r="10" fill="none" stroke="var(--accent)" stroke-width="1" opacity=".6"/><line x1="20" y1="20" x2="34" y2="9" stroke="var(--accent)" stroke-width="1.5"/></svg>
      <b>Radar Segmentation<br>Evaluation</b>
    </div>
    ${groups}`;
}

export function initShell(page) {
  const side = document.getElementById("side");
  if (side) side.innerHTML = navHtml(page);
  const menu = document.getElementById("menu");
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
  const paint = () => {
    if (!getState()) return;
    renderBanner(document.getElementById("corrections-banner"));
    renderCorrectionList(document.getElementById("active-corrections"));
  };
  onChange(paint);
  paint();
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
