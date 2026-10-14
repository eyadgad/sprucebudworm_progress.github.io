import { initShell } from "./shell.js";
import { boot, getState } from "./state.js";

initShell("analysis");

const models = await fetch("data/models.json").then(r => {
  if (!r.ok) throw new Error(`models.json ${r.status}`);
  return r.json();
});
boot(models);
const rule = getState().nightRule;
const line = document.getElementById("rule-line");
line.textContent = `Night rule from shared state: ${rule.mode}, fraction ${rule.fraction}, at least ${rule.minScans} scans, hours ${String(rule.hourStart).padStart(2, "0")}–${String(rule.hourEnd).padStart(2, "0")} UTC.`;
