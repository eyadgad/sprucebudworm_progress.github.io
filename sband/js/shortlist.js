import { esc, initShell, load, num, table, td } from "./common.js";

initShell();
const main = document.getElementById("main");

function link(night) {
  return `<a href="explorer.html?night=${esc(night)}">${esc(night)}</a>`;
}

function nightMap(cls) {
  return new Map(cls.nights.map(n => [n.night, n]));
}

try {
  const cls = await load("classification.json");
  const by = nightMap(cls);
  const roleNights = Object.entries(cls.roles);
  const groups = [
    ["shortlist", "All-three shortlist", "At least 8 scans positive for all three classifiers, insect fraction above rain fraction on those scans, and at least half of those scans at 00–06 UTC. All 13 sit inside the 28 nights the 00–08 rule calls positive for every model."],
    ["negative", "Confident negatives", "The five 00–08 nights with all three fractions equal to 0, ordered by ascending mean probability. They are widespread rain, not empty sky. The written report lists the same five; it shows the three near-zero nights in descending echo order."],
    ["disagreement", "Disagreements", cls.disagreement_rule],
  ];
  let body = "";
  for (const [key, title, blurb] of groups) {
    const nights = roleNights.filter(([, role]) => role === key).map(([night]) => night);
    // Keep the order stored by walking cls.nights only for shortlist stability: use the order in roles insertion, which is shortlist list then neg then dis.
    const rows = nights.map(night => {
      const r = by.get(night);
      const clsName = cls.disagreement_class?.[night] || "";
      return [
        link(night),
        td(clsName),
        td(`${r.n_pos[0]}/${r.n_0008}`),
        td(`${r.n_pos[1]}/${r.n_0008}`),
        td(`${r.n_pos[2]}/${r.n_0008}`),
        td(r.mean_p.map(v => num(v, 2)).join(" / ")),
        td(num(r.echo_km2, 0)),
        td(num(r.rain, 2)),
        td(num(r.n_all)),
      ];
    });
    body += `<h2>${esc(title)}</h2><p>${esc(blurb)}</p>` +
      table(["Night", "Class", "e1", "e4", "e1e4", "Mean p", "Median echo km²", "Median rain", "Scored scans"], rows);
  }
  const c = cls.scan_counts;
  const totalN = c.shortlist.nights + c.negative.nights + c.disagreement.nights;
  const total8 = c.shortlist.scans_0008 + c.negative.scans_0008 + c.disagreement.scans_0008;
  const totalAll = c.shortlist.scans_all_hours + c.negative.scans_all_hours + c.disagreement.scans_all_hours;
  const countRows = ["shortlist", "negative", "disagreement"].map(k => [
    td(k), td(num(c[k].nights)), td(num(c[k].scans_0008)), td(num(c[k].scans_all_hours)),
  ]);
  countRows.push([td("Total"), td(num(totalN)), td(num(total8)), td(num(totalAll))]);

  main.innerHTML = `
    <h1>Annotation shortlist</h1>
    <p class="lede">${num(totalN)} nights, ${num(total8)} scans in 00–08 UTC, ${num(totalAll)} scored scans if the afternoon of the same night is included. No night is in more than one group. Each night opens in the explorer.</p>
    <div class="note"><span class="tag">unit</span><div class="bd">
      Scans are the unit. The night call is the fraction of that night’s 00–08 scans. The counts below are sums of per-scan rows, not a second label.
    </div></div>
    ${table(["Group", "Nights", "Scans in 00–08 UTC", "Scored scans, all hours"], countRows)}
    ${body}
    <p class="small">00–08 counts are the scans the night rule used. The all-hours count is the full scored night, including 19–23 UTC, for context. ${esc(cls.negative_rule)}.</p>
  `;
} catch (err) {
  main.innerHTML = `<h1>Annotation shortlist</h1><div class="note bad"><span class="tag">error</span><div class="bd">${esc(err.message)}</div></div>`;
}
