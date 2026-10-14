import { initShell } from "./shell.js";
import { boot, getState, onChange } from "./state.js";

initShell("explore");

function paintNote(text) {
  const el = document.getElementById("mask-area-note");
  if (el) el.textContent = text || "";
}

function paintNight() {
  const night = getState()?.selection.night || "";
  const el = document.getElementById("selected-night");
  if (el) el.textContent = night || "none";
}

const models = await fetch("data/models.json").then(r => {
  if (!r.ok) throw new Error(`models.json ${r.status}`);
  return r.json();
});
boot(models);
paintNote(models.mask_area_note || "");
paintNight();
onChange(paintNight);
