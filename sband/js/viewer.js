/* Scan viewer. Masks are drawn at 960 px from the 1-bit PNGs and displayed scaled. */

const MASKS = [
  { id: "attunet_e1", key: "e1", label: "AttUNet e1", color: [46, 140, 220] },
  { id: "attunet_e4", key: "e4", label: "AttUNet e4, computed on 0.4°", color: [214, 140, 36] },
  { id: "attunet_e1e4", key: "e1e4", label: "AttUNet e1e4", color: [150, 70, 190] },
];

let root = null;
let patch = null;
let getState = null;
let nextOf = null;
let currentId = "";
let lastDbzh = null;
const images = new Map();
const bitsCache = new Map();

function asset(id, name) {
  return `img/${String(id).padStart(12, "0")}_${name}.${name === "m03" || name === "p04" ? "webp" : "png"}`;
}

function loadImage(url) {
  if (images.has(url)) return images.get(url);
  const pending = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
  images.set(url, pending);
  return pending;
}

async function maskBits(url) {
  if (bitsCache.has(url)) return bitsCache.get(url);
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 960;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, 960, 960);
  const data = g.getImageData(0, 0, 960, 960).data;
  const bits = new Uint8Array(960 * 960);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) bits[p] = data[i] > 127 ? 1 : 0;
  bitsCache.set(url, bits);
  return bits;
}

function selectedMasks(state) {
  return MASKS.filter(m => state.viewer.masks[m.id]);
}

function deco() {
  return `
    <svg id="rings" class="deco" viewBox="0 0 960 960" aria-hidden="true">
      <circle cx="480" cy="479" r="100"></circle>
      <circle cx="480" cy="479" r="200"></circle>
      <circle cx="480" cy="479" r="300"></circle>
      <circle cx="480" cy="479" r="400"></circle>
      <text x="588" y="479">50</text>
      <text x="688" y="479">100</text>
      <text x="788" y="479">150</text>
      <text x="888" y="479">200</text>
    </svg>
    <svg id="north-arrow" viewBox="0 0 36 48" aria-label="North">
      <polygon points="18,2 28,24 18,18 8,24"></polygon>
      <text x="18" y="42">N</text>
    </svg>
    <div id="scalebar" title="50 km"><i></i><b>50 km</b></div>`;
}

function renderStages(state) {
  const host = root.querySelector("#stages");
  const selected = selectedMasks(state);
  const side = state.viewer.mode === "side";
  const panels = side ? selected : [{ key: "combo", label: "" }];
  const key = `${state.viewer.mode}:${panels.map(p => p.key).join(",")}`;
  if (host.dataset.key === key) return false;
  host.dataset.key = key;
  host.className = side ? "stages side" : "stages";
  host.innerHTML = (panels.length ? panels : [{ key: "combo", label: "" }]).map((mask, i) => `
    <figure class="stage">
      <canvas class="dbzh-canvas" width="960" height="960"></canvas>
      <canvas class="mask-canvas" data-mask="${mask.key}" width="960" height="960"></canvas>
      ${i === 0 ? deco() : ""}
      ${mask.label ? `<figcaption>${mask.label}</figcaption>` : ""}
    </figure>`).join("");
  return true;
}

function paintDbzh(img) {
  for (const canvas of root.querySelectorAll(".dbzh-canvas")) {
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.clearRect(0, 0, 960, 960);
    if (img) g.drawImage(img, 0, 0, 960, 960);
  }
}

function paintBits(canvas, bits, color, opacity) {
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const image = g.createImageData(960, 960);
  const data = image.data;
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255);
  for (let p = 0, i = 0; p < bits.length; p++, i += 4) {
    if (!bits[p]) continue;
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = alpha;
  }
  g.putImageData(image, 0, 0);
}

function paintOverlay(canvas, layers) {
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const image = g.createImageData(960, 960);
  const data = image.data;
  for (const layer of layers) {
    const alpha = Math.min(1, Math.max(0, layer.opacity));
    const bits = layer.bits;
    for (let p = 0, i = 0; p < bits.length; p++, i += 4) {
      if (!bits[p]) continue;
      const dstA = data[i + 3] / 255;
      const outA = alpha + dstA * (1 - alpha);
      if (outA === 0) continue;
      data[i] = Math.round((layer.color[0] * alpha + data[i] * dstA * (1 - alpha)) / outA);
      data[i + 1] = Math.round((layer.color[1] * alpha + data[i + 1] * dstA * (1 - alpha)) / outA);
      data[i + 2] = Math.round((layer.color[2] * alpha + data[i + 2] * dstA * (1 - alpha)) / outA);
      data[i + 3] = Math.round(outA * 255);
    }
  }
  g.putImageData(image, 0, 0);
}

function combine(bitsets, mode, onlyIndex) {
  const out = new Uint8Array(960 * 960);
  const n = bitsets.length;
  if (!n) return out;
  if (mode === "inter") {
    for (let i = 0; i < out.length; i++) {
      let on = 1;
      for (let k = 0; k < n; k++) if (!bitsets[k][i]) { on = 0; break; }
      out[i] = on;
    }
  } else if (mode === "only") {
    const mine = bitsets[onlyIndex];
    for (let i = 0; i < out.length; i++) {
      if (!mine[i]) continue;
      let other = false;
      for (let k = 0; k < n; k++) if (k !== onlyIndex && bitsets[k][i]) { other = true; break; }
      out[i] = other ? 0 : 1;
    }
  } else {
    for (let i = 0; i < out.length; i++) {
      for (let k = 0; k < n; k++) if (bitsets[k][i]) { out[i] = 1; break; }
    }
  }
  return out;
}

function pairCount(scan, a, b) {
  const key = [a, b].sort().join("|");
  if (key === "e1|e4") return scan.n_e1_and_e4;
  if (key === "e1|e1e4") return scan.n_e1_and_e1e4;
  return scan.n_e4_and_e1e4;
}

function singleCount(scan, key) {
  return scan[`n_${key}`];
}

function interCount(scan, keys) {
  if (keys.length <= 1) return keys.length ? singleCount(scan, keys[0]) : 0;
  if (keys.length === 2) return pairCount(scan, keys[0], keys[1]);
  return scan.n_all_three;
}

function unionCount(scan, keys) {
  if (keys.length <= 1) return keys.length ? singleCount(scan, keys[0]) : 0;
  if (keys.length === 2) return singleCount(scan, keys[0]) + singleCount(scan, keys[1]) - pairCount(scan, keys[0], keys[1]);
  return singleCount(scan, "e1") + singleCount(scan, "e4") + singleCount(scan, "e1e4")
    - scan.n_e1_and_e4 - scan.n_e1_and_e1e4 - scan.n_e4_and_e1e4 + scan.n_all_three;
}

function onlyCount(scan, key, keys) {
  if (keys.length <= 1) return singleCount(scan, key);
  if (keys.length === 2) return singleCount(scan, key) - pairCount(scan, key, keys.find(k => k !== key));
  const others = keys.filter(k => k !== key);
  return singleCount(scan, key) - pairCount(scan, key, others[0]) - pairCount(scan, key, others[1]) + scan.n_all_three;
}

function km(pixels) {
  return pixels * 0.25;
}

function fmtKm(pixels) {
  return km(pixels).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function paintStats(scan, state) {
  const table = document.getElementById("mask-stats");
  if (!table) return;
  if (!scan) { table.innerHTML = ""; return; }
  const keys = selectedMasks(state).map(m => m.key);
  const rows = MASKS.map(m => {
    const n = singleCount(scan, m.key);
    return `<tr data-set="${m.key}"><td>${m.label}</td><td data-km="${km(n)}">${fmtKm(n)} km²</td><td>${n} px</td></tr>`;
  }).join("");
  const inter = interCount(scan, keys);
  const union = unionCount(scan, keys);
  let pairs = "";
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = singleCount(scan, keys[i]);
      const b = singleCount(scan, keys[j]);
      const both = pairCount(scan, keys[i], keys[j]);
      const dice = a + b ? (2 * both) / (a + b) : "";
      const iou = a + b - both ? both / (a + b - both) : "";
      pairs += `<tr data-pair="${keys[i]}-${keys[j]}"><td>${keys[i]} ∩ ${keys[j]}</td><td>Dice <span data-dice="${dice}">${dice === "" ? "—" : Number(dice).toFixed(3)}</span></td><td>IoU <span data-iou="${iou}">${iou === "" ? "—" : Number(iou).toFixed(3)}</span></td></tr>`;
    }
  }
  const onlyRows = keys.map(key => {
    const n = onlyCount(scan, key, keys);
    return `<tr data-only="${key}"><td>only ${key}</td><td data-km="${km(n)}">${fmtKm(n)} km²</td><td>${n} px</td></tr>`;
  }).join("");
  table.innerHTML = `<tbody>
    ${rows}
    <tr data-set="intersection"><td>Intersection of selected</td><td data-km="${km(inter)}">${fmtKm(inter)} km²</td><td>${inter} px</td></tr>
    <tr data-set="union"><td>Union of selected</td><td data-km="${km(union)}">${fmtKm(union)} km²</td><td>${union} px</td></tr>
    ${onlyRows}
    ${pairs}
  </tbody>`;
}

function drawMasks(state) {
  if (!currentId) return;
  const rebuilt = renderStages(state);
  if (rebuilt) paintDbzh(lastDbzh);
  const selected = selectedMasks(state);
  const bitsets = selected.map(m => bitsCache.get(asset(currentId, m.key)));
  if (!selected.length || bitsets.some(bits => !bits)) {
    if (!selected.length) {
      for (const canvas of root.querySelectorAll(".mask-canvas")) {
        canvas.getContext("2d").clearRect(0, 0, 960, 960);
      }
    }
    return;
  }
  if (state.viewer.mode === "side") {
    for (let i = 0; i < selected.length; i++) {
      const canvas = root.querySelector(`.mask-canvas[data-mask="${selected[i].key}"]`);
      if (canvas) paintBits(canvas, bitsets[i], selected[i].color, state.viewer.opacity[selected[i].id]);
    }
    root.dataset.drawn = String(Number(root.dataset.drawn || 0) + 1);
    return;
  }
  const canvas = root.querySelector('.mask-canvas[data-mask="combo"]');
  if (!canvas) return;
  if (state.viewer.mode === "overlay") {
    paintOverlay(canvas, selected.map((m, i) => ({ bits: bitsets[i], color: m.color, opacity: state.viewer.opacity[m.id] })));
    root.dataset.drawn = String(Number(root.dataset.drawn || 0) + 1);
    return;
  }
  let onlyIndex = selected.findIndex(m => m.id === state.viewer.only);
  if (onlyIndex < 0) onlyIndex = 0;
  const mode = state.viewer.mode === "inter" ? "inter" : state.viewer.mode === "only" ? "only" : "union";
  const bits = combine(bitsets, mode, onlyIndex);
  const color = mode === "only" && selected[onlyIndex] ? selected[onlyIndex].color : [255, 255, 255];
  paintBits(canvas, bits, color, 1);
  root.dataset.drawn = String(Number(root.dataset.drawn || 0) + 1);
}

async function drawScan(scan, state) {
  const id = String(scan.id);
  const img = await loadImage(asset(id, state.viewer.tilt));
  await Promise.all(selectedMasks(state).map(m => maskBits(asset(id, m.key))));
  if (currentId !== id) return;
  lastDbzh = img;
  renderStages(state);
  paintDbzh(img);
  drawMasks(state);
  root.dataset.ready = "1";
  root.dataset.src = asset(id, state.viewer.tilt);
  const nxt = nextOf(id);
  if (nxt) {
    loadImage(asset(nxt, "m03"));
    loadImage(asset(nxt, "p04"));
    for (const mask of MASKS) maskBits(asset(nxt, mask.key)).catch(() => {});
  }
}

function syncControls(state) {
  const view = state.viewer;
  root.querySelector("#tilt").value = view.tilt;
  root.querySelector("#mask-mode").value = view.mode;
  root.querySelector("#only-model").value = view.only;
  root.querySelector("#only-wrap").hidden = view.mode !== "only";
  for (const mask of MASKS) {
    root.querySelector(`.mask-on[data-mask="${mask.id}"]`).checked = !!view.masks[mask.id];
    root.querySelector(`.mask-op[data-mask="${mask.id}"]`).value = String(view.opacity[mask.id]);
  }
}

export function bindViewer(el, api) {
  root = el;
  patch = api.patch;
  getState = api.getState;
  nextOf = api.nextId;
  el.innerHTML = `
    <div id="stages"></div>
    <div class="cbar-wrap">
      <div id="cbar" class="cbar-ramp" title="−5 to 40 dBZ"></div>
      <div class="cbar-labels"><span>40</span><span>−5</span></div>
      <p id="clip-note">Values below −5 dBZ use the −5 colour. Values above 40 dBZ use the 40 colour.</p>
    </div>
    <div class="viewer-bar">
      <label>DBZH
        <select id="tilt">
          <option value="m03">−0.3°</option>
          <option value="p04">0.4°</option>
        </select>
      </label>
      <label>Masks
        <select id="mask-mode">
          <option value="overlay">Overlay</option>
          <option value="side">Side by side</option>
          <option value="inter">Intersection</option>
          <option value="union">Union</option>
          <option value="only">Only one mask</option>
        </select>
      </label>
      <label id="only-wrap" hidden>Only
        <select id="only-model">
          ${MASKS.map(m => `<option value="${m.id}">${m.label}</option>`).join("")}
        </select>
      </label>
      <button type="button" id="enlarge" aria-pressed="false">Enlarge</button>
    </div>
    <div class="mask-picks">
      ${MASKS.map(m => `<div class="mask-line">
        <label class="check"><input type="checkbox" class="mask-on" data-mask="${m.id}"><i class="swatch" style="background:rgb(${m.color.join(",")})"></i> ${m.label}</label>
        <input type="range" class="mask-op" data-mask="${m.id}" min="0" max="1" step="0.05" aria-label="${m.label} opacity">
      </div>`).join("")}
    </div>`;
  root.querySelector("#tilt").addEventListener("change", () => patch(s => { s.viewer.tilt = root.querySelector("#tilt").value; }));
  root.querySelector("#mask-mode").addEventListener("change", () => patch(s => { s.viewer.mode = root.querySelector("#mask-mode").value; }));
  root.querySelector("#only-model").addEventListener("change", () => patch(s => { s.viewer.only = root.querySelector("#only-model").value; s.viewer.mode = "only"; }));
  for (const mask of MASKS) {
    root.querySelector(`.mask-on[data-mask="${mask.id}"]`).addEventListener("change", event => {
      patch(s => { s.viewer.masks[mask.id] = event.target.checked; });
    });
    root.querySelector(`.mask-op[data-mask="${mask.id}"]`).addEventListener("input", event => {
      patch(s => { s.viewer.opacity[mask.id] = Number(event.target.value); });
    });
  }
  let viewerHome = null;
  function setLarge(on) {
    if (on) {
      viewerHome = root.parentElement;
      document.body.appendChild(root);
      document.body.classList.add("viewer-large");
    } else {
      document.body.classList.remove("viewer-large");
      const scores = document.getElementById("panel-scores");
      if (viewerHome && scores) viewerHome.insertBefore(root, scores);
      else if (viewerHome) viewerHome.appendChild(root);
    }
    const button = root.querySelector("#enlarge");
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.textContent = on ? "Close" : "Enlarge";
  }
  root.querySelector("#enlarge").addEventListener("click", () => {
    setLarge(!document.body.classList.contains("viewer-large"));
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.body.classList.contains("viewer-large")) {
      event.preventDefault();
      setLarge(false);
    }
  });
  renderStages(getState());
}

export function updateViewer(scan, state) {
  if (!root) return;
  syncControls(state);
  paintStats(scan, state);
  if (!scan) {
    currentId = "";
    lastDbzh = null;
    root.dataset.ready = "0";
    root.dataset.scan = "";
    root.dataset.src = "";
    paintDbzh(null);
    for (const canvas of root.querySelectorAll(".mask-canvas")) {
      canvas.getContext("2d").clearRect(0, 0, 960, 960);
    }
    return;
  }
  const id = String(scan.id);
  root.dataset.scan = id;
  if (id !== currentId) {
    currentId = id;
    root.dataset.ready = "0";
    drawScan(scan, state).catch(() => {
      if (currentId === id) root.dataset.ready = "error";
    });
    return;
  }
  if (root.dataset.src !== asset(id, state.viewer.tilt)) {
    root.dataset.ready = "0";
    drawScan(scan, state).catch(() => { if (currentId === id) root.dataset.ready = "error"; });
    return;
  }
  const missing = selectedMasks(state).some(m => !bitsCache.has(asset(id, m.key)));
  if (missing) {
    root.dataset.ready = "0";
    Promise.all(selectedMasks(state).map(m => maskBits(asset(id, m.key)))).then(() => {
      if (currentId !== id) return;
      drawMasks(getState());
      root.dataset.ready = "1";
    });
    return;
  }
  drawMasks(state);
  root.dataset.ready = "1";
  root.dataset.src = asset(id, state.viewer.tilt);
}
