/* Shared dashboard state for the three S-band v2 pages.

   Priority, field by field: URL hash, then localStorage, then models.json.
   A hash that only names a night does not wipe the other fields.
   Corrections never change the JSON files. */

const STORAGE_KEY = "sband-v2-state";

let models = null;
let order = [];
let state = null;
const listeners = new Set();

export function modelIds() {
  return order.slice();
}

export function getState() {
  return state;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

function defaultsFrom(doc) {
  const ids = [...doc.classifiers, ...doc.segmenters].map(m => m.id);
  const thresholds = {};
  const included = {};
  for (const m of [...doc.classifiers, ...doc.segmenters]) {
    thresholds[m.id] = m.family === "classifier" ? Number(m.default_threshold) : Number(m.threshold_km2);
    included[m.id] = true;
  }
  return {
    thresholds,
    included,
    nightRule: { mode: "every", fraction: 0.5, minScans: 10, hourStart: 0, hourEnd: 8 },
    filters: { qualifies: false, status: "all", month: "all", annotation: false, minModels: 0 },
    corrections: [],
    selection: { year: "2021", night: "", scan: "" },
    ids,
  };
}

function blankCopy(base) {
  return {
    thresholds: { ...base.thresholds },
    included: { ...base.included },
    nightRule: { ...base.nightRule },
    filters: { ...base.filters },
    corrections: base.corrections.map(c => ({ ...c })),
    selection: { ...base.selection },
    ids: base.ids,
  };
}

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStorage() {
  try {
    const { ids, ...rest } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch { /* private mode */ }
}

function hashParams() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return null;
  const q = new URLSearchParams(raw);
  const known = ["y", "n", "night", "s", "th", "inc", "rule", "fq", "fs", "fm", "fa", "fk", "cx"];
  return known.some(k => q.has(k)) ? q : null;
}

function decodeCorrections(text) {
  if (!text) return [];
  const out = [];
  for (const part of text.split(";")) {
    const [op, a, b] = part.split("~");
    if (op === "exclude-night" && /^\d{4}-\d{2}-\d{2}$/.test(a || "")) out.push({ op, night: a });
    else if (op === "exclude-scan" && /^\d{12}$/.test(a || "")) out.push({ op, scan: a });
    else if (op === "move-scan" && /^\d{12}$/.test(a || "") && /^\d{4}-\d{2}-\d{2}$/.test(b || "")) {
      out.push({ op, scan: a, to: b });
    }
  }
  return out;
}

function encodeCorrections(list) {
  return list.map(c => {
    if (c.op === "exclude-night") return `exclude-night~${c.night}`;
    if (c.op === "exclude-scan") return `exclude-scan~${c.scan}`;
    return `move-scan~${c.scan}~${c.to}`;
  }).join(";");
}

function applyStored(base, stored) {
  const next = blankCopy(base);
  if (!stored) return next;
  if (stored.thresholds) {
    for (const id of base.ids) {
      const v = Number(stored.thresholds[id]);
      if (Number.isFinite(v)) next.thresholds[id] = v;
    }
  }
  if (stored.included) {
    for (const id of base.ids) {
      if (typeof stored.included[id] === "boolean") next.included[id] = stored.included[id];
    }
  }
  if (stored.nightRule) {
    const r = stored.nightRule;
    if (r.mode === "every" || r.mode === "allpass") next.nightRule.mode = r.mode;
    for (const key of ["fraction", "minScans", "hourStart", "hourEnd"]) {
      const v = Number(r[key]);
      if (Number.isFinite(v)) next.nightRule[key] = v;
    }
  }
  if (stored.filters) {
    const f = stored.filters;
    if (typeof f.qualifies === "boolean") next.filters.qualifies = f.qualifies;
    if (typeof f.annotation === "boolean") next.filters.annotation = f.annotation;
    if (typeof f.status === "string") next.filters.status = f.status;
    if (typeof f.month === "string") next.filters.month = f.month;
    const k = Number(f.minModels);
    if (Number.isFinite(k)) next.filters.minModels = k;
  }
  if (Array.isArray(stored.corrections)) next.corrections = decodeCorrections(encodeCorrections(stored.corrections));
  if (stored.selection) {
    for (const key of ["year", "night", "scan"]) {
      if (typeof stored.selection[key] === "string") next.selection[key] = stored.selection[key];
    }
  }
  return next;
}

function applyHash(base, q) {
  const next = blankCopy(base);
  if (q.has("y")) next.selection.year = q.get("y") || "";
  if (q.has("n")) next.selection.night = q.get("n") || "";
  if (q.has("night")) next.selection.night = q.get("night") || "";
  if (q.has("s")) next.selection.scan = q.get("s") || "";
  if (q.has("th")) {
    for (const part of q.get("th").split(",")) {
      const i = part.indexOf(":");
      if (i < 0) continue;
      const id = part.slice(0, i);
      const v = Number(part.slice(i + 1));
      if (id in next.thresholds && Number.isFinite(v)) next.thresholds[id] = v;
    }
  }
  if (q.has("inc")) {
    const on = new Set(q.get("inc").split(",").filter(Boolean));
    for (const id of next.ids) next.included[id] = on.has(id);
  }
  if (q.has("rule")) {
    const [mode, fraction, minScans, hourStart, hourEnd] = q.get("rule").split(",");
    if (mode === "every" || mode === "allpass") next.nightRule.mode = mode;
    const nums = { fraction, minScans, hourStart, hourEnd };
    for (const key of Object.keys(nums)) {
      const v = Number(nums[key]);
      if (Number.isFinite(v)) next.nightRule[key] = v;
    }
  }
  if (q.has("fq")) next.filters.qualifies = q.get("fq") === "1";
  if (q.has("fs")) next.filters.status = q.get("fs") || "all";
  if (q.has("fm")) next.filters.month = q.get("fm") || "all";
  if (q.has("fa")) next.filters.annotation = q.get("fa") === "1";
  if (q.has("fk")) {
    const v = Number(q.get("fk"));
    if (Number.isFinite(v)) next.filters.minModels = v;
  }
  if (q.has("cx")) next.corrections = decodeCorrections(q.get("cx"));
  return next;
}

function writeHash() {
  const q = new URLSearchParams();
  q.set("y", state.selection.year || "");
  q.set("n", state.selection.night || "");
  q.set("s", state.selection.scan || "");
  q.set("th", state.ids.map(id => `${id}:${state.thresholds[id]}`).join(","));
  q.set("inc", state.ids.filter(id => state.included[id]).join(","));
  const r = state.nightRule;
  q.set("rule", [r.mode, r.fraction, r.minScans, r.hourStart, r.hourEnd].join(","));
  q.set("fq", state.filters.qualifies ? "1" : "0");
  q.set("fs", state.filters.status);
  q.set("fm", state.filters.month);
  q.set("fa", state.filters.annotation ? "1" : "0");
  q.set("fk", String(state.filters.minModels));
  q.set("cx", encodeCorrections(state.corrections));
  const url = `${location.pathname}${location.search}#${q.toString()}`;
  history.replaceState(null, "", url);
}

function persist() {
  writeStorage();
  writeHash();
  emit();
}

export function boot(doc) {
  models = doc;
  const base = defaultsFrom(doc);
  order = base.ids;
  let next = applyStored(base, readStorage());
  const q = hashParams();
  if (q) next = applyHash(next, q);
  state = next;
  writeStorage();
  writeHash();
  emit();
  return state;
}

export function patch(mutator) {
  mutator(state);
  persist();
}

export function addCorrection(entry) {
  const key = JSON.stringify(entry);
  if (state.corrections.some(c => JSON.stringify(c) === key)) return;
  state.corrections = state.corrections.concat(entry);
  persist();
}

export function resetCorrections() {
  state.corrections = [];
  persist();
}

export function exportCorrections() {
  return JSON.stringify(state.corrections, null, 2);
}

export function correctionSummary(c) {
  if (c.op === "exclude-night") return `Exclude night ${c.night}`;
  if (c.op === "exclude-scan") return `Exclude scan ${c.scan}`;
  return `Move scan ${c.scan} to night ${c.to}`;
}

export function renderCorrectionList(el) {
  if (!el) return;
  const items = state.corrections.map(c => {
    const attrs = [`data-op="${c.op}"`];
    if (c.night) attrs.push(`data-night="${c.night}"`);
    if (c.scan) attrs.push(`data-scan="${c.scan}"`);
    if (c.to) attrs.push(`data-to="${c.to}"`);
    return `<li ${attrs.join(" ")}>${correctionSummary(c)}</li>`;
  });
  el.innerHTML = items.join("") || `<li class="small">No corrections.</li>`;
}

export function renderBanner(el) {
  if (!el) return;
  const n = state.corrections.length;
  if (!n) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = `${n} corrections active`;
}
