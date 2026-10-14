import { esc, initShell, load, num, table, td } from "./common.js";

initShell();
const main = document.getElementById("main");
main.innerHTML = `<p class="small">Loading the inventory…</p>`;

try {
  const [ds, labels] = await Promise.all([load("dataset.json"), load("labels.json")]);
  const s = ds.sband;
  const c = ds.cband;
  const elevRows = ds.elev_s_to_c.map(r => [
    td(r.s_index), td(num(r.s_deg, 1)), td(r.c_index), td(num(r.c_deg, 1)), td(num(r.mismatch_deg, 1)),
  ]);
  const trapRows = ds.index_trap.map(r => [
    td(r.channel), td(num(r.c_deg, 1)), td(num(r.s_deg_at_index, 1)), td(num(r.error_deg, 1)),
  ]);
  const monthRows = ds.months.map(r => [
    td(r.month), td(num(r.n_files)), td(num(r.days_present)), td(r.days_missing || "none"),
    td(`${num(r.missing_6min_slots)} / ${num(r.expected_6min_slots)}`), td(num(r.gz_median_mb, 1)),
  ]);
  const heightRows = ds.height_free_fit.map(r => [
    td(r.dataset), td(num(r.nominal_deg, 1)), td(r.index), td(num(r.theta_deg, 2)),
    td(num(r.k, 3)), td(num(r.h0_m, 0)), td(num(r.rmse_m, 1)), td(num(r.n_pixels)),
  ]);
  const band = labels.by_utc_band;
  const bandRows = Object.entries(band).map(([k, v]) => [td(k), td(num(v.n)), td(num(v.label1)), td(num(v.label0))]);

  main.innerHTML = `
    <h1>S-band dataset</h1>
    <p class="lede">CASVD, the Environment and Climate Change Canada S-band at Val d’Irène, for June–August 2021 and 2022. The models on this site were trained on the C-band XAM archive from the same site, 2013–2019, of which only 2018–2019 volumes are on disk here.</p>

    <div class="cards">
      <div class="card"><div class="k">S-band files</div><div class="v">${num(s.n_files)}</div><div class="s">gzip magic failures ${num(s.n_bad_gzip)}</div></div>
      <div class="card"><div class="k">Gzipped</div><div class="v">${num(s.gzip_gib, 2)} GiB</div><div class="s">${num(s.gzip_bytes)} bytes</div></div>
      <div class="card"><div class="k">Each file inflated</div><div class="v">564,053,355</div><div class="s">${num(s.uncompressed_tib, 2)} TiB if all were inflated</div></div>
      <div class="card"><div class="k">C-band PPIs on disk</div><div class="v">${num(c.n_files)}</div><div class="s">${num(c.gib, 2)} GiB, 2018–2019</div></div>
    </div>

    <div class="note"><span class="tag">how counted</span><div class="bd">
      Filenames and gzip sizes are every <code>.nc.gz</code> in <code>Data/new_radar_S_band_data</code> (${num(s.n_files)} files, ${esc(s.first)} through ${esc(s.last)}). Uncompressed size is the gzip ISIZE field, the same ${num(s.uncompressed_bytes_each)} bytes on every file. C-band counts are every PPI under <code>Data/2018</code> and <code>Data/2019</code>. Nothing in this page was decompressed for the inventory.
    </div></div>

    <h2>Coverage</h2>
    <p>S-band cadence is 6 minutes. A complete day is 240 slots. 17:18 UTC is missing on 179 of 180 days that have any file; hour 17 has ${num(s.hour17_utc)} files. C-band filenames are only :00 and :30, and only UTC hours ${esc(c.hours_present.join(", "))}.</p>
    ${table(["Month", "Files", "Days with a file", "Days missing", "Missing 6-min slots", "Gzip median (MB)"], monthRows)}
    <p class="small">Month table from <code>sband_by_month.csv</code>. The winter between 2021-08-31 and 2022-06-03 is a gap between delivered seasons, not a hole inside a month. 2022-08 ends at 22:54 on the 31st, so its expected slot count is 7,430.</p>

    <h2>Grid, variables, tilts</h2>
    <div class="two">
      <div class="panel">
        <h3>Shared grid</h3>
        <p>Both products are 960 × 960, easting −240,000 to 239,500 m, northing 239,500 down to −240,000 m, 500 m cells, azimuthal equidistant on WGS84. The origins differ by about 14 m (0.028 of a pixel): C-band 48.480550°N, 67.600890°W; S-band 48.480469°N, 67.601036°W, which is the CASVD coordinate.</p>
      </div>
      <div class="panel">
        <h3>Variables</h3>
        <p>C-band PPIs carry <code>TH</code> and <code>height</code>. There is no dual-pol. S-band adds <code>DBZH</code>, <code>ZDR</code>, <code>RHOHV</code>, <code>WRADH</code>, <code>VRADH</code>, <code>PHIDP</code>, and <code>DR</code>. <code>DBZH</code> is the filtered reflectivity and the field these pages use. Raw <code>TH</code> is a clutter diagnostic: it contains the near-radar spike and is not the C-band <code>TH</code> analogue.</p>
      </div>
    </div>

    <h2>The index trap</h2>
    <p>C-band channel names are elevation indexes, not angles. <code>th_e1</code> is C-band index 1, which is −0.3°. The same index on S-band is 0.4°. Feeding an S-band file to the C-band loader without renaming tilts by angle selects the wrong beam. The runs on this site do not do that: −0.3° is the S-band −0.3° tilt, and C-band 0.3° is the S-band 0.4° tilt (+0.1°), flagged on every result that uses it.</p>
    ${table(["S index", "S °", "Nearest C index", "C °", "S − C °"], elevRows)}
    <p class="small">Nearest-angle map from <code>elev_s_to_c.csv</code>, modal 24-angle C-band list (931 of 933 files). Two C-band files insert 3.5° at index 12; indexes 0–11 are unchanged.</p>
    <h3>What the published night model would have read</h3>
    <p>The night-model channel list is <code>th_e0</code>…<code>th_e8</code>. Those nine C-band angles collapse onto four S-band tilts (−0.3°, 0.4°, 1.0°, 1.6°) if you match by angle. Matching by index instead is this error:</p>
    ${table(["Channel", "C-band °", "S-band ° at that index", "Index error °"], trapRows)}

    <h2>Height</h2>
    <p>A free fit of <code>h(r) = h0 + r·sin θ + r² / (2·k·Re)</code> with Re = 6,371 km. S-band height matches the labelled angle and k = 4/3. C-band height matches the labelled angle at twice the range, which is the same as k ≈ 1/3. The static <code>xam_beam_height_asl.nc</code> levels are ordinary 4/3-earth beams and do not match the C-band PPI height planes. The three classifiers and the three segmenters on this site do not read height.</p>
    ${table(["Archive", "Nominal °", "Index", "Fit θ °", "k", "h0 (m)", "RMSE (m)", "Pixels"], heightRows)}
    <p class="small">One row per archive and angle. The second sample file of each pair agrees to the stored precision (<code>height_fit.csv</code>, fit <code>free_h0_theta_k</code>).</p>

    <h2>Why a C-band label is not “flight in this scan”</h2>
    <p><code>artifacts_night/manifest.csv</code> has ${num(labels.n_scans)} scans and ${num(labels.n_nights)} nights. Every night is pure: ${num(labels.nights_all_positive)} all-positive (${num(labels.scans_label1)} scans) and ${num(labels.nights_all_negative)} all-negative (${num(labels.scans_label0)} scans). Mixed nights: ${num(labels.nights_mixed)}.</p>
    ${table(["UTC hours", "Scans", "Label 1", "Label 0"], bandRows)}
    <p>Negatives exist only at 00–08 UTC. Every scan at 19–23 and at 09–11 is label 1. A scan the classifier calls positive means “this scan looks like a C-band dispersal night,” not “a moth was in this beam.” The classification page applies that as a night fraction, and only on 00–08 UTC.</p>
  `;
} catch (err) {
  main.innerHTML = `<h1>S-band dataset</h1><div class="note bad"><span class="tag">error</span><div class="bd">${esc(err.message)}</div></div>`;
}
