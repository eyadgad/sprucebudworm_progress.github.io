import { MODEL_COLOR, esc, groupedBars, initShell, load, num, pct, table, td } from "./common.js";

initShell();
const main = document.getElementById("main");
main.innerHTML = `<p class="small">Loading classification tables…</p>`;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function calendar(cls) {
  const by = new Map(cls.nights.map(n => [n.night, n]));
  const extra = new Set(cls.excluded_nights);
  const ids = [...by.keys(), ...extra].sort();
  const months = [...new Set(ids.map(n => n.slice(0, 7)))];
  let html = `<div class="legend-inline">
    <span><i class="sw" style="background:${MODEL_COLOR[0]}"></i>e1 fraction</span>
    <span><i class="sw" style="background:${MODEL_COLOR[1]}"></i>e4 fraction</span>
    <span><i class="sw" style="background:${MODEL_COLOR[2]}"></i>e1e4 fraction</span>
    <span>Gold border: annotation shortlist. Blue: confident negative. Red: disagreement.</span>
  </div>`;
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    html += `<h3>${esc(month)}</h3><div class="cal-head">${DOW.map(d => `<span>${d}</span>`).join("")}</div><div class="cal-grid">`;
    for (let i = 0; i < firstDow; i++) html += `<div class="cal-cell"><div class="empty"></div></div>`;
    for (let day = 1; day <= dim; day++) {
      const id = `${month}-${String(day).padStart(2, "0")}`;
      const rec = by.get(id);
      if (!rec && !extra.has(id)) {
        html += `<div class="cal-cell"><div class="empty"><span class="d" style="color:var(--muted)">${day}</span></div></div>`;
        continue;
      }
      if (!rec) {
        html += `<div class="cal-cell"><a class="excluded" href="explorer.html?night=${esc(id)}" title="Scored, but no 00–08 UTC scans"><span class="d">${day}</span><div class="miss">no 00–08</div></a></div>`;
        continue;
      }
      const role = cls.roles[id] ? ` role-${cls.roles[id]}` : "";
      const bars = rec.frac.map((f, i) => `<i><b style="width:${Math.round(f * 100)}%;background:${MODEL_COLOR[i]}"></b></i>`).join("");
      const call = rec.y.map((v, i) => (v ? "●" : "○")).join("");
      html += `<div class="cal-cell"><a class="${role.trim()}" href="explorer.html?night=${esc(id)}" title="${esc(id)} calls ${call} fractions ${rec.frac.map(f => f.toFixed(2)).join(" / ")}"><span class="d">${day} ${call}</span><div class="bars">${bars}</div></a></div>`;
    }
    html += `</div>`;
  }
  return html;
}

try {
  const [cls, labels] = await Promise.all([load("classification.json"), load("labels.json")]);
  const hours = cls.hours;
  const hourFig = groupedBars({
    labels: hours.map(h => String(h.hour).padStart(2, "0")),
    series: [0, 1, 2].map(i => ({
      label: ["e1", "e4", "e1e4"][i],
      color: MODEL_COLOR[i],
      values: hours.map(h => h.rate[i]),
    })),
    yMax: 1,
    aria: "Positive rate by UTC hour for the three classifiers",
  });
  const hourRows = hours.map(h => [
    td(String(h.hour).padStart(2, "0")), td(num(h.n)),
    td(num(h.rate[0], 3)), td(num(h.rate[1], 3)), td(num(h.rate[2], 3)),
  ]);
  const sweepRows = cls.fraction_sweep.map(r => [
    td(num(r.fraction_threshold, 1)), td(num(r.pos_e1)), td(num(r.pos_e4)), td(num(r.pos_e1e4)),
    td(num(r.all_three)), td(num(r.exactly_two)), td(num(r.exactly_one)), td(num(r.none)),
    td(num(r.kappa_e1_e4, 3)), td(num(r.kappa_e1_e1e4, 3)), td(num(r.kappa_e4_e1e4, 3)),
  ]);
  const polRows = cls.pol_by_scan_category.map(r => [
    td(r.category), td(num(r.n)), td(num(r.median_echo_km2, 0)), td(num(r.median_insect, 3)),
    td(num(r.median_rain, 3)), td(num(r.median_rho, 3)), td(num(r.median_zdr, 2)), td(num(r.median_dbzh, 1)),
  ]);
  const monthRows = cls.month_counts.map(r => [
    td(r.month), td(num(r.n)), td(num(r.all_three)), td(num(r.e1)), td(num(r.e4)), td(num(r.e1e4)),
  ]);
  const cuts = cls.insect_cuts;
  const cutRows = Object.entries(cuts).map(([k, v]) => [
    td(k), td(num(v.median, 3)), td(num(v.p90, 3)), td(num(v.max, 3)), td(pct(v.frac_above_0_30, 1)),
  ]);
  const band = labels.by_utc_band;
  const k = cls.kappa_0008;
  const rain = cls.rain_frac_gt_0_5;
  const cats = cls.categories_0008;

  main.innerHTML = `
    <h1>S-band classification</h1>
    <p class="lede">Three Swin-Tiny classifiers, each scan scored alone. A night call is a summary of those scans: the fraction of the night’s 00–08 UTC scans that the scan model called positive. Positive at fraction ≥ 0.5.</p>

    <div class="cards">
      <div class="card"><div class="k">Scored scans</div><div class="v">${num(cls.n_scans)}</div><div class="s">${num(cls.n_nights_scored)} noon-to-noon nights</div></div>
      <div class="card"><div class="k">00–08 nights</div><div class="v">${num(cls.n_nights_0008)}</div><div class="s">each has at least 10 scans</div></div>
      <div class="card hl"><div class="k">Positive nights e1 / e4 / e1e4</div><div class="v">${cls.night_positives_frac_0_5.e1} / ${cls.night_positives_frac_0_5.e4} / ${cls.night_positives_frac_0_5.e1e4}</div><div class="s">fraction ≥ 0.5</div></div>
      <div class="card"><div class="k">Any scan, secondary</div><div class="v">${cls.night_positives_any_scan.e1} / ${cls.night_positives_any_scan.e4} / ${cls.night_positives_any_scan.e1e4}</div><div class="s">of the same ${num(cls.n_nights_0008)}</div></div>
    </div>

    <div class="note warn"><span class="tag">label</span><div class="bd">
      The C-band manifest has ${num(labels.n_nights)} nights, ${num(labels.nights_all_positive)} all-positive, ${num(labels.nights_all_negative)} all-negative, ${num(labels.nights_mixed)} mixed.
      A positive scan means the scan looks like a dispersal night, not that flight was in that scan.
      Training negatives exist only at 00–08 UTC (${num(band["00-08"].label0)} negative scans). All ${num(band["19-23"].n)} scans at 19–23 UTC and all ${num(band["09-11"].n)} at 09–11 UTC are label 1.
      The primary night rule therefore uses 00–08 UTC only. Four scored nights have no scan in that window and are excluded: ${esc(cls.excluded_nights.join(", "))}.
    </div></div>

    <h2>Night calendar</h2>
    <p>Each cell is one operational night (UTC noon to noon). The three bars are the fraction of that night’s 00–08 scans called positive. Filled dots are the ≥ 0.5 call, in order e1, e4, e1e4. Click a night to open it in the explorer.</p>
    ${calendar(cls)}

    <h2>Positive rate by UTC hour</h2>
    <p>About 326–336 scored scans per hour. e4 flags about 60% of 19–23 UTC (15:00–19:00 EDT) and 31–45% from 01–08 UTC. Hour 00 is 0.545, so the full 00–08 range is 0.31–0.54. Spearman correlation of probability with echo area at −0.3°: e1 ${num(cls.spearman_p_vs_echo_km2.e1, 3)}, e4 ${num(cls.spearman_p_vs_echo_km2.e4, 3)}, e1e4 ${num(cls.spearman_p_vs_echo_km2.e1e4, 3)} (n = ${num(cls.n_scans)}).</p>
    <figure><div class="viz">${hourFig}</div>
      <figcaption>Fraction of scans with probability at or above the model’s own threshold. e1 threshold 0.90, e4 0.45, e1e4 0.25. Decision is ≥ for the classifiers.</figcaption>
    </figure>
    ${table(["UTC", "n", "e1", "e4", "e1e4"], hourRows)}

    <h2>Agreement on the 00–08 night rule</h2>
    <p>At fraction ≥ 0.5: all three ${num(cats.all_three || 0)}, exactly two ${num((cats.pair_e1_e1e4 || 0) + (cats.pair_e4_e1e4 || 0) + (cats.pair_e1_e4 || 0))}, exactly one ${num((cats.only_e1 || 0) + (cats.only_e4 || 0) + (cats.only_e1e4 || 0))}, none ${num(cats.none || 0)}. There is no e1+e4 night without e1e4 (pair_e1_e4 = ${num(cats.pair_e1_e4 || 0)}). Cohen’s κ: e1–e4 ${num(k.e1_e4, 3)}, e1–e1e4 ${num(k.e1_e1e4, 3)}, e4–e1e4 ${num(k.e4_e1e4, 3)}.</p>
    <p class="small">Exactly two is ${num(cats.pair_e1_e1e4 || 0)} nights of e1+e1e4 and ${num(cats.pair_e4_e1e4 || 0)} of e4+e1e4. Exactly one is ${num(cats.only_e1 || 0)} / ${num(cats.only_e4 || 0)} / ${num(cats.only_e1e4 || 0)}.</p>

    <h2>Fraction sweep</h2>
    <p>The night is positive when the fraction of 00–08 scans called positive is at least the cut. 0.5 is the operating rule. “At least one positive scan” is not this sweep; that secondary rule flags ${cls.night_positives_any_scan.e1} / ${cls.night_positives_any_scan.e4} / ${cls.night_positives_any_scan.e1e4} nights.</p>
    ${table(["Cut", "e1", "e4", "e1e4", "All three", "Exactly two", "One", "None", "κ e1–e4", "κ e1–e1e4", "κ e4–e1e4"], sweepRows)}

    <h2>Scan-threshold sweep, secondary</h2>
    <p>Changing the classifier probability threshold from 0.05 to 0.95 barely changes how many nights have at least one positive scan, because the scores are already near 0 or near 1. That is why the night fraction, not a softer scan threshold, is the decision. The operating thresholds stay 0.90 / 0.45 / 0.25. Full grid is in <code>threshold_sweep.csv</code> and is summarized here only as the count of nights touched.</p>
    ${thresholdNote(cls)}

    <h2>Dual-pol plausibility</h2>
    <p>Insect index: fraction of finite DBZH pixels at −0.3° with RHOHV &lt; 0.80 and ZDR &gt; 3 dB. On the ${num(cls.n_scans)} scans the joint fraction has median ${num(cuts.frac_joint_080_3.median, 3)} and maximum ${num(cuts.frac_joint_080_3.max, 3)}. No scan exceeds 0.30. RHOHV &lt; 0.80 alone has median ${num(cuts.frac_rho_lt_080.median, 2)}; ZDR &gt; 3 dB alone has median ${num(cuts.frac_zdr_gt_3.median, 2)}. The cap is the joint cut. ZDR &gt; 3 dB is inside the published insect range of about 2–9 dB (Zrnić and Ryzhkov 1998) and below this product’s clip near +8 dB. RHOHV &lt; 0.80 is stricter than the biological-versus-weather cut near 0.85 cited from Schuur et al. 2003. Rain in the same tables is RHOHV &gt; 0.97.</p>
    ${table(["Cut", "Median", "p90", "Max", "Scans above 0.30"], cutRows)}
    <p>Of ${num(rain.n)} scans with rain fraction &gt; 0.5, e1 flags ${num(rain.flagged.e1)} (${pct(rain.flagged.e1 / rain.n, 1)}), e4 flags ${num(rain.flagged.e4)} (${pct(rain.flagged.e4 / rain.n, 1)}), e1e4 flags ${num(rain.flagged.e1e4)} (${pct(rain.flagged.e1e4 / rain.n, 1)}).</p>
    ${table(["Scan category", "n", "Median echo km²", "Insect", "Rain", "Median ρhv", "Median ZDR", "Median dBZ"], polRows)}
    <p class="small">Scan categories are the three classifier votes on that scan, not the night rule. Echo, insect, and rain are medians of the per-scan values at −0.3°.</p>

    <h2>Which model behaves like a biological-echo detector</h2>
    <p>On the 00–08 night rule, e1 calls ${cls.night_positives_frac_0_5.e1} of ${cls.n_nights_0008} nights. Its positive rate is a few percent at 19–23 UTC and peaks near 0.40 after sunset. It flags about 1% of heavy-rain scans, and its probability is uncorrelated with echo area. e4 calls ${cls.night_positives_frac_0_5.e4} nights, flags about 60% of late-afternoon scans, and its probability falls as echo area rises (Spearman ${num(cls.spearman_p_vs_echo_km2.e4, 2)}). It is not a rain detector. e1e4 calls ${cls.night_positives_frac_0_5.e1e4} nights and follows the night clock, but it flags about 28% of heavy-rain scans and its probability rises with area. e1 is the one that behaves like a nocturnal biological-echo detector. A night all three call positive has to pass e1, so that set inherits the rain rejection.</p>

    <h2>Date against the flight season</h2>
    <p>A positive is “C-band-dispersal-like biological echo,” not a confirmed spruce budworm. The models learned budworm versus non-budworm nights in a C-band outbreak record. Other nocturnal insects fly over this site in summer. Adult budworm dispersal is a July–August window of about 6–8 weeks, with takeoff around sunset (Garcia et al. 2022, citing Régnière et al. 2012). The Quebec species account puts pupation at the beginning of July. Early June is before that. Late August can be the tail of the season here, or other insects.</p>
    ${table(["Month", "Nights in the rule", "All three", "e1", "e4", "e1e4"], monthRows)}
    <p class="small">Sources for every count: ${esc(cls.sources.join(", "))}. κ is Cohen’s κ on the 168 binary night calls. Spearman is <code>scipy.stats.spearmanr</code> of scan probability against echo km² at −0.3°.</p>
  `;
} catch (err) {
  main.innerHTML = `<h1>S-band classification</h1><div class="note bad"><span class="tag">error</span><div class="bd">${esc(err.message)}</div></div>`;
}

function thresholdNote(cls) {
  const rows = {};
  for (const r of cls.probability_sweep) {
    rows[r.model] = rows[r.model] || [];
    rows[r.model].push(r);
  }
  const lines = Object.entries(rows).map(([model, list]) => {
    const nights = list.map(r => r.n_nights_positive);
    const scans = list.map(r => r.n_scans_positive);
    return [td(model), td(num(Math.min(...nights))), td(num(Math.max(...nights))), td(num(Math.min(...scans))), td(num(Math.max(...scans))), td(num(list.length))];
  });
  return table(["Model", "Min nights ≥1", "Max nights ≥1", "Min positive scans", "Max positive scans", "Grid points"], lines);
}
