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
    explore: {
      year: "all", night: "all", status: "all", qualifies: false, annotation: false,
      q: "", colour: "all6", view: "grid", cell: "72",
    },
    corrections: [],
    selection: { year: "2021", night: "", scan: "" },
    view: { mode: "agreement", model: ids[0] || "" },
    sort: { key: "date", model: ids[0] || "" },
    viewer: {
      tilt: "m03",
      mode: "overlay",
      only: "attunet_e1",
      masks: { attunet_e1: true, attunet_e4: true, attunet_e1e4: true },
      opacity: { attunet_e1: 0.6, attunet_e4: 0.6, attunet_e1e4: 0.6 },
    },
    ids,
  };
}

function blankCopy(base) {
  return {
    thresholds: { ...base.thresholds },
    included: { ...base.included },
    nightRule: { ...base.nightRule },
    filters: { ...base.filters },
    explore: { ...base.explore },
    corrections: base.corrections.map(c => ({ ...c })),
    selection: { ...base.selection },
    view: { ...base.view },
    sort: { ...base.sort },
    viewer: {
      ...base.viewer,
      masks: { ...base.viewer.masks },
      opacity: { ...base.viewer.opacity },
    },
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
  const known = ["y", "n", "night", "s", "th", "inc", "rule", "fq", "fs", "fm", "fa", "fk", "cx", "cm", "cid", "sk", "sid", "tv", "vm", "vo", "vk", "vp", "ey", "q", "cb", "vw", "cz"];
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
  // included and nightRule are fixed. Stale copies in localStorage are ignored.
  if (stored.filters) {
    const f = stored.filters;
    if (typeof f.qualifies === "boolean") next.filters.qualifies = f.qualifies;
    if (typeof f.annotation === "boolean") next.filters.annotation = f.annotation;
    if (typeof f.status === "string") next.filters.status = f.status;
    if (typeof f.month === "string") next.filters.month = f.month;
    const k = Number(f.minModels);
    if (Number.isFinite(k)) next.filters.minModels = k;
  }
  if (stored.explore && typeof stored.explore === "object") {
    const src = stored.explore;
    const exp = next.explore;
    if (["all", "2021", "2022"].includes(src.year)) exp.year = src.year;
    if (typeof src.night === "string") exp.night = src.night || "all";
    if (["all", "complete", "partial", "gap-skipped", "absent"].includes(src.status)) exp.status = src.status;
    if (typeof src.qualifies === "boolean") exp.qualifies = src.qualifies;
    if (typeof src.annotation === "boolean") exp.annotation = src.annotation;
    if (typeof src.q === "string") exp.q = src.q;
    if (["all6", "cls", "seg", "swin_e1", "swin_e4", "swin_e1e4", "attunet_e1", "attunet_e4", "attunet_e1e4"].includes(src.colour)) exp.colour = src.colour;
    if (["grid", "thumbs", "table"].includes(src.view)) exp.view = src.view;
    if (["48", "72", "110"].includes(String(src.cell))) exp.cell = String(src.cell);
  } else {
    next.explore.annotation = next.filters.annotation;
    next.explore.qualifies = next.filters.qualifies;
    if (["all", "complete", "partial", "gap-skipped", "absent"].includes(next.filters.status)) {
      next.explore.status = next.filters.status;
    }
    const storedNight = stored.selection && typeof stored.selection.night === "string" ? stored.selection.night : "";
    if (storedNight) next.explore.night = storedNight;
  }
  if (Array.isArray(stored.corrections)) next.corrections = decodeCorrections(encodeCorrections(stored.corrections));
  if (stored.selection) {
    for (const key of ["year", "night", "scan"]) {
      if (typeof stored.selection[key] === "string") next.selection[key] = stored.selection[key];
    }
  }
  if (stored.view) {
    if (stored.view.mode === "agreement" || stored.view.mode === "pass" || stored.view.mode === "score") {
      next.view.mode = stored.view.mode;
    }
    if (typeof stored.view.model === "string" && stored.view.model in next.thresholds) next.view.model = stored.view.model;
  }
  if (stored.sort) {
    if (stored.sort.key === "date" || stored.sort.key === "allpass" || stored.sort.key === "mean") {
      next.sort.key = stored.sort.key;
    }
    if (typeof stored.sort.model === "string" && stored.sort.model in next.thresholds) next.sort.model = stored.sort.model;
  }
  if (stored.viewer && typeof stored.viewer === "object") {
    if (stored.viewer.tilt === "m03" || stored.viewer.tilt === "p04") next.viewer.tilt = stored.viewer.tilt;
    if (["overlay", "side", "inter", "union", "only"].includes(stored.viewer.mode)) next.viewer.mode = stored.viewer.mode;
    if (typeof stored.viewer.only === "string" && stored.viewer.only in next.viewer.masks) next.viewer.only = stored.viewer.only;
    if (stored.viewer.masks) {
      for (const id of Object.keys(next.viewer.masks)) {
        if (typeof stored.viewer.masks[id] === "boolean") next.viewer.masks[id] = stored.viewer.masks[id];
      }
    }
    if (stored.viewer.opacity) {
      for (const id of Object.keys(next.viewer.opacity)) {
        const v = Number(stored.viewer.opacity[id]);
        if (Number.isFinite(v)) next.viewer.opacity[id] = Math.min(1, Math.max(0, v));
      }
    }
  }
  return next;
}

function applyHash(base, q) {
  const next = blankCopy(base);
  if (q.has("y")) next.selection.year = q.get("y") || "";
  if (q.has("n")) next.selection.night = q.get("n") || "";
  if (q.has("night")) next.selection.night = q.get("night") || "";
  if (q.has("n") || q.has("night")) next.explore.night = next.selection.night || "all";
  if (q.has("ey") && ["all", "2021", "2022"].includes(q.get("ey"))) next.explore.year = q.get("ey");
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
  // inc= and rule= are ignored. Every page uses all six models and the 00-08 UTC rule.
  if (q.has("fq")) {
    next.filters.qualifies = q.get("fq") === "1";
    next.explore.qualifies = next.filters.qualifies;
  }
  if (q.has("fs")) {
    next.filters.status = q.get("fs") || "all";
    if (["all", "complete", "partial", "gap-skipped", "absent"].includes(next.filters.status)) {
      next.explore.status = next.filters.status;
    }
  }
  if (q.has("fm")) next.filters.month = q.get("fm") || "all";
  if (q.has("fa")) {
    next.filters.annotation = q.get("fa") === "1";
    next.explore.annotation = next.filters.annotation;
  }
  if (q.has("q")) next.explore.q = q.get("q") || "";
  if (q.has("cb") && ["all6", "cls", "seg", "swin_e1", "swin_e4", "swin_e1e4", "attunet_e1", "attunet_e4", "attunet_e1e4"].includes(q.get("cb"))) {
    next.explore.colour = q.get("cb");
  }
  if (q.has("vw") && ["grid", "thumbs", "table"].includes(q.get("vw"))) next.explore.view = q.get("vw");
  if (q.has("cz") && ["48", "72", "110"].includes(q.get("cz"))) next.explore.cell = q.get("cz");
  if (q.has("fk")) {
    const v = Number(q.get("fk"));
    if (Number.isFinite(v)) next.filters.minModels = v;
  }
  if (q.has("cx")) next.corrections = decodeCorrections(q.get("cx"));
  if (q.has("cm")) {
    const mode = q.get("cm");
    if (mode === "agreement" || mode === "pass" || mode === "score") next.view.mode = mode;
  }
  if (q.has("cid") && q.get("cid") in next.thresholds) next.view.model = q.get("cid");
  if (q.has("sk")) {
    const key = q.get("sk");
    if (key === "date" || key === "allpass" || key === "mean") next.sort.key = key;
  }
  if (q.has("sid") && q.get("sid") in next.thresholds) next.sort.model = q.get("sid");
  if (q.has("tv") && (q.get("tv") === "m03" || q.get("tv") === "p04")) next.viewer.tilt = q.get("tv");
  if (q.has("vm") && ["overlay", "side", "inter", "union", "only"].includes(q.get("vm"))) next.viewer.mode = q.get("vm");
  if (q.has("vo") && q.get("vo") in next.viewer.masks) next.viewer.only = q.get("vo");
  if (q.has("vk")) {
    const on = new Set(q.get("vk").split(",").filter(Boolean));
    for (const id of Object.keys(next.viewer.masks)) next.viewer.masks[id] = on.has(id);
  }
  if (q.has("vp")) {
    for (const part of q.get("vp").split(",")) {
      const i = part.indexOf(":");
      if (i < 0) continue;
      const id = part.slice(0, i);
      const v = Number(part.slice(i + 1));
      if (id in next.viewer.opacity && Number.isFinite(v)) next.viewer.opacity[id] = Math.min(1, Math.max(0, v));
    }
  }
  return next;
}

function writeHash() {
  const q = new URLSearchParams();
  q.set("y", state.selection.year || "");
  q.set("n", state.selection.night || "");
  q.set("s", state.selection.scan || "");
  q.set("th", state.ids.map(id => `${id}:${state.thresholds[id]}`).join(","));
  q.set("ey", state.explore.year);
  q.set("q", state.explore.q);
  q.set("cb", state.explore.colour);
  q.set("vw", state.explore.view);
  q.set("cz", state.explore.cell);
  q.set("fq", state.explore.qualifies ? "1" : "0");
  q.set("fs", state.explore.status);
  q.set("fm", state.filters.month);
  q.set("fa", state.explore.annotation ? "1" : "0");
  q.set("fk", String(state.filters.minModels));
  q.set("cx", encodeCorrections(state.corrections));
  q.set("cm", state.view.mode);
  q.set("cid", state.view.model || "");
  q.set("sk", state.sort.key);
  q.set("sid", state.sort.model || "");
  const v = state.viewer;
  q.set("tv", v.tilt);
  q.set("vm", v.mode);
  q.set("vo", v.only || "");
  q.set("vk", Object.keys(v.masks).filter(id => v.masks[id]).join(","));
  q.set("vp", Object.keys(v.opacity).map(id => `${id}:${v.opacity[id]}`).join(","));
  const url = `${location.pathname}${location.search}#${q.toString()}`;
  history.replaceState(null, "", url);
}

function lockAgreement(next) {
  for (const id of next.ids) next.included[id] = true;
  next.nightRule.mode = "every";
  next.nightRule.fraction = 0.5;
  next.nightRule.minScans = 10;
  next.nightRule.hourStart = 0;
  next.nightRule.hourEnd = 8;
  next.selection.night = next.explore.night === "all" ? "" : next.explore.night;
  next.filters.qualifies = next.explore.qualifies;
  next.filters.annotation = next.explore.annotation;
  next.filters.status = next.explore.status;
  return next;
}

function persist() {
  lockAgreement(state);
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
  lockAgreement(next);
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
