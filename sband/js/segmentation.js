import { MODEL_COLOR, esc, groupedBars, initShell, load, loadOptional, num, table, td } from "./common.js";

initShell();
const main = document.getElementById("main");
main.innerHTML = `<p class="small">Loading segmentation tables…</p>`;

function diceBlock(dice) {
  const models = dice.per_model.run_lowest;
  const rows = Object.entries(models).map(([name, m]) => [
    td(name),
    td(num(m.n_pos)),
    td(num(m.macro_dice_pos, 3)),
    td(num(m.published_macro_dice_all_val, 3)),
    td(`${m.pred_area.n_exact} / ${m.pred_area.n}`),
    td(num(m.pred_area.max_abs)),
    td(num(m.mean_bg_fp, 4)),
  ]);
  const miss = Object.entries(dice.missing_years).map(([y, n]) => `${y}: ${n}`).join(", ");
  return `
    <h2>C-band check, before any S-band mask</h2>
    <p>The published Dice figures (0.489 / 0.299 / 0.514) are macro means over all 310 positive validation scenes. This machine has 2018–2019 only: ${num(dice.n_val_on_disk)} of ${num(dice.n_val_manifest)} validation scenes, ${num(dice.n_pos_on_disk)} positive and ${num(dice.n_neg_on_disk)} negative. Missing years: ${esc(miss)}. Targets were present for every on-disk scene (missing targets ${num(dice.missing_target)}).</p>
    <p>Two masks were compared with <code>val_per_scene.json</code>, which stores the predicted area from the training evaluation. <code>stock_index0</code> is the current <code>src/channels.py</code> constant (C-band TH index 0, −0.5°). On a 12-scene probe its median absolute area error was ${num(dice.probe_identity.stock_index0.median_abs, 0)} pixels. <code>run_lowest</code>, the finite pixels of the lowest channel in the run, matched the published area on ${dice.probe_identity.run_lowest.n_exact} of ${dice.probe_identity.run_lowest.n} probe scenes and then on every on-disk validation scene. Ground-truth area also matched on ${models.attunet_e1_m03.gt_area_exact} of ${models.attunet_e1_m03.n} scenes. The subset Dice is not the published Dice; the missing years move it. The area match is the code-path check.</p>
    ${table(["Model", "Positive scenes", "Subset macro Dice", "Published macro Dice", "Pred-area exact", "Max |area|", "Mean bg FP"], rows)}
    <p class="small">Inference is the training full-scene path: 256 px windows, stride 128, Gaussian border weights, no test-time flips, bfloat16. A pixel is positive when probability is strictly greater than 0.15. Reflectivity on this check is C-band TH, because that is what the weights saw. S-band uses DBZH at the same angles.</p>
  `;
}

function segBlock(seg) {
  if (!seg) {
    return `<h2>S-band masks</h2>
      <div class="note"><span class="tag">in progress</span><div class="bd">
        Per-scan masks are not on this site yet. The segmenter is writing one mask per scored scan. This page will show mask area by hour, agreement between the three segmenters, and agreement with the classifiers when that table is copied in. The night explorer already steps through classifier probabilities; mask overlays appear with the images.
      </div></div>`;
  }
  const hours = seg.hours || [];
  const fig = hours.length ? groupedBars({
    labels: hours.map(h => String(h.hour).padStart(2, "0")),
    series: [0, 1, 2].map(i => ({
      label: ["e1", "e4", "e1e4"][i],
      color: MODEL_COLOR[i],
      values: hours.map(h => h.median_area_km2[i]),
    })),
    yMax: Math.max(1, ...hours.flatMap(h => h.median_area_km2)),
    aria: "Median mask area in square kilometres by UTC hour",
  }) : "";
  const hourRows = hours.map(h => [
    td(String(h.hour).padStart(2, "0")), td(num(h.n)),
    td(num(h.median_area_km2[0], 0)), td(num(h.median_area_km2[1], 0)), td(num(h.median_area_km2[2], 0)),
  ]);
  const agree = (seg.agreement || []).map(r => [
    td(r.pair), td(num(r.n)), td(num(r.median_dice, 3)), td(num(r.mean_dice, 3)), td(num(r.median_iou, 3)),
  ]);
  const cons = (seg.consistency || []).map(r => [
    td(r.model), td(r.classifier), td(num(r.n)), td(num(r.median_area_km2, 0)), td(num(r.mean_frac_echo, 3)),
  ]);
  const bio = (seg.biological || []).map(r => [
    td(r.model), td(num(r.median_rho_in, 3)), td(num(r.median_rho_out, 3)),
    td(num(r.median_zdr_in, 2)), td(num(r.median_zdr_out, 2)),
    td(num(r.median_insect_in, 3)), td(num(r.median_insect_out, 3)),
    td(num(r.median_rain_in, 3)), td(num(r.median_rain_out, 3)),
  ]);
  return `
    <h2>S-band mask area</h2>
    <p>${esc(seg.note || "")} Batched windows were ${seg.batched ? "used" : "not used"}; the one-window training loop produced these masks. Preflight minimum Dice between the two implementations was ${num(seg.preflight_min_dice, 3)}.</p>
    <div class="cards">
      <div class="card"><div class="k">Scans</div><div class="v">${num(seg.n_scans)}</div><div class="s">${num(seg.n_nights)} nights</div></div>
      <div class="card"><div class="k">Median area e1 / e4 / e1e4</div><div class="v">${seg.median_area_km2.map(v => num(v, 0)).join(" / ")}</div><div class="s">km², all scored scans</div></div>
    </div>
    ${fig ? `<figure><div class="viz">${fig}</div><figcaption>Median mask area (km²) by UTC hour. A mask pixel is 0.25 km².</figcaption></figure>` : ""}
    ${hourRows.length ? table(["UTC", "n", "e1 km²", "e4 km²", "e1e4 km²"], hourRows) : ""}
    <h2>Agreement between segmenters</h2>
    <p>Dice and IoU are between the two binary masks of the same scan. Empty masks on both sides count as Dice 1.</p>
    ${agree.length ? table(["Pair", "n", "Median Dice", "Mean Dice", "Median IoU"], agree) : ""}
    <h2>Consistency with the classifiers</h2>
    ${cons.length ? table(["Segmenter", "Classifier call", "n", "Median mask km²", "Mean fraction of echo"], cons) : ""}
    <h2>Masked pixels versus the echo outside the mask</h2>
    <p>Dual-pol is the −0.3° cache for every model, including e4 whose mask was drawn on the 0.4° reflectivity. Insect is RHOHV &lt; 0.80 and ZDR &gt; 3 dB. Rain is RHOHV &gt; 0.97. Medians are across scans, of the inside-mask and outside-mask fractions.</p>
    ${bio.length ? table(["Model", "ρ in", "ρ out", "ZDR in", "ZDR out", "Insect in", "Insect out", "Rain in", "Rain out"], bio) : ""}
  `;
}

try {
  const dice = await load("cband_dice.json");
  const seg = await loadOptional("segmentation.json");
  main.innerHTML = `
    <h1>S-band segmentation</h1>
    <p class="lede">Each scored scan is segmented on its own by the three Attention U-Net runs. Night totals, where they appear, are sums and medians of those scans.</p>
    <div class="meta">
      <div><div class="l">Weights</div><div class="d">attunet_e1_m03, attunet_e4_p03, attunet_e1e4_m03_p03, best.pt</div></div>
      <div><div class="l">Threshold</div><div class="d">0.15, probability strictly greater</div></div>
      <div><div class="l">Window</div><div class="d">256 px, overlap 0.5, Gaussian, no TTA</div></div>
      <div><div class="l">Valid mask</div><div class="d">Lowest channel in the run. e4 uses 0.4°.</div></div>
    </div>
    ${diceBlock(dice)}
    ${segBlock(seg)}
  `;
} catch (err) {
  main.innerHTML = `<h1>S-band segmentation</h1><div class="note bad"><span class="tag">error</span><div class="bd">${esc(err.message)}</div></div>`;
}
