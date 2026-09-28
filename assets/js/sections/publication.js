/* Publication results on the frozen night split. Numbers are precomputed. */

export async function render(mount) {
  mount.innerHTML = `
  <h1>Publication results</h1>
  <p class="lede">Held-out test performance of the frozen night-split retrain: five Attention U-Net seeds against five U-Net seeds, scored once at a validation-locked threshold.</p>

  <div class="meta">
    <div><div class="l">Split</div><div class="d">267 nights, no night in two splits</div></div>
    <div><div class="l">Test</div><div class="d">161 positive and 147 negative scans</div></div>
    <div><div class="l">Threshold</div><div class="d">0.15, the same for all ten runs</div></div>
    <div><div class="l">Manifest</div><div class="d"><code>170c442d…</code></div></div>
  </div>

  <h2>Segmentation</h2>
  <p>Both families use the same ten channels (nine reflectivity elevations and a validity mask), the same focal-Tversky loss, the same patch sampling, and the same 100-epoch schedule. The only designed difference is the decoder: attention gates versus a plain U-Net. Seeds 42–46 change the initialisation and the random crops. The test set was not read until every one of those choices had been written down.</p>
  <p>Macro Dice, the mean of per-scene Dice on the 161 positive test scans, is 0.526 ± 0.005 for Attention U-Net and 0.517 ± 0.009 for U-Net (mean ± sample standard deviation, five seeds). Pixel-pooled Dice on those same positive scans is 0.654 ± 0.006 and 0.651 ± 0.003. Pooling quiet scans in as well, where they can contribute only false-positive pixels, gives 0.595 ± 0.012 and 0.598 ± 0.006. The architecture gap is about one macro-Dice point. It is smaller than the seed range inside the U-Net family (0.504 to 0.528) and much smaller than the drop from validation to test.</p>

  <div class="cards">
    <div class="card hl"><div class="k">Attention U-Net</div><div class="v">0.526</div><div class="s">test macro Dice ± 0.005</div></div>
    <div class="card"><div class="k">U-Net</div><div class="v">0.517</div><div class="s">test macro Dice ± 0.009</div></div>
    <div class="card"><div class="k">NSD, 2 px</div><div class="v">0.323 vs 0.305</div><div class="s">Attention U-Net, then U-Net</div></div>
    <div class="card"><div class="k">Quiet-scan FAR</div><div class="v">0.56</div><div class="s">share of negative scans above 25 km²</div></div>
  </div>

  <div class="panel">
    <img src="assets/figures/seeds.svg" alt="Five seeds of test macro Dice and NSD for Attention U-Net and U-Net" style="width:100%;height:auto;display:block">
    <p class="small">Figure 1. Each point is one training seed on the test set. The horizontal bar is the five-seed mean.</p>
  </div>

  <div class="tscroll"><table>
    <thead><tr><th>Family</th><th>Dice</th><th>Dice, pooled</th><th>Precision</th><th>Recall</th><th>NSD</th><th>Fuzzy BF1</th></tr></thead>
    <tbody>
      <tr><td>Attention U-Net</td><td class="n">0.526 ± 0.005</td><td class="n">0.654 ± 0.006</td><td class="n">0.538 ± 0.021</td><td class="n">0.594 ± 0.033</td><td class="n">0.323 ± 0.008</td><td class="n">0.334 ± 0.006</td></tr>
      <tr><td>U-Net</td><td class="n">0.517 ± 0.009</td><td class="n">0.651 ± 0.003</td><td class="n">0.553 ± 0.020</td><td class="n">0.569 ± 0.030</td><td class="n">0.305 ± 0.019</td><td class="n">0.318 ± 0.017</td></tr>
    </tbody>
  </table></div>
  <p class="small">Table 1. Test set, positive scans, mean ± standard deviation over five seeds. NSD and fuzzy boundary F1 use a 2-pixel tolerance. Precision is higher for the plain U-Net; recall and the boundary scores are higher for Attention U-Net.</p>

  <h2>Pre-specified paired comparison</h2>
  <p>The confirmatory contrast named before the test set was opened is seed 42 against seed 42, on the same 161 positive scans, with nights as the resampling unit (2,000 night-clustered bootstrap draws, 21 nights). Attention U-Net minus U-Net is +0.0037 Dice, and the 95% interval is −0.0084 to +0.0170. The interval includes zero. The same contrast is +0.0206 for normalised surface distance (0.0082 to 0.0319) and +0.0179 for fuzzy boundary F1 (0.0062 to 0.0290). Those two intervals exclude zero. On the overlap metrics that the study treated as primary, seed 42 does not establish a difference. On the boundary metrics, it does.</p>

  <h2>Robustness</h2>
  <p>A single paired seed can be a lucky draw. The robustness check repeats that paired contrast at every matched seed, then asks whether the ranking survives the year and the move from validation to test. The threshold is not re-tuned: every run had already selected 0.15 on validation.</p>

  <div class="panel">
    <img src="assets/figures/paired.svg" alt="Night-clustered intervals for the Attention U-Net minus U-Net difference at each seed" style="width:100%;height:auto;display:block">
    <p class="small">Figure 2. Difference at each matched seed. An interval drawn in green excludes zero.</p>
  </div>

  <div class="tscroll"><table>
    <thead><tr><th>Seed</th><th>Dice difference</th><th>95% interval</th><th>NSD difference</th><th>95% interval</th></tr></thead>
    <tbody>
      <tr><td>42</td><td class="n">+0.0037</td><td class="n">−0.0084 to +0.0170</td><td class="n">+0.0206</td><td class="n">+0.0082 to +0.0319</td></tr>
      <tr><td>43</td><td class="n">+0.0009</td><td class="n">−0.0064 to +0.0083</td><td class="n">−0.0079</td><td class="n">−0.0133 to −0.0020</td></tr>
      <tr><td>44</td><td class="n">+0.0097</td><td class="n">+0.0022 to +0.0184</td><td class="n">+0.0212</td><td class="n">+0.0119 to +0.0306</td></tr>
      <tr><td>45</td><td class="n">+0.0227</td><td class="n">+0.0037 to +0.0478</td><td class="n">+0.0512</td><td class="n">+0.0371 to +0.0679</td></tr>
      <tr><td>46</td><td class="n">+0.0118</td><td class="n">+0.0015 to +0.0229</td><td class="n">+0.0062</td><td class="n">−0.0020 to +0.0168</td></tr>
    </tbody>
  </table></div>
  <p class="small">Table 2. Attention U-Net minus U-Net on the test positives, night-clustered. Dice is positive at all five seeds and the interval excludes zero at three of them. NSD excludes zero in favour of Attention U-Net at seeds 42, 44 and 45, and in favour of U-Net at seed 43.</p>
  <p>The Dice advantage is therefore same-signed and small. It is not something one would quote as a stable gain: two of the five intervals, including the pre-specified seed, include zero, and the largest interval (seed 45) is also the widest. The boundary advantage does not survive the seed check. Seed 43 reverses it by a margin whose interval excludes zero.</p>

  <div class="panel">
    <img src="assets/figures/year.svg" alt="Test macro Dice by calendar year for both families" style="width:100%;height:auto;display:block">
    <p class="small">Figure 3. Mean of the five seeds within each test year. Counts are positive test scans.</p>
  </div>
  <p>The year profile is shared. Both models are weak in 2013 (14 scans; mean Dice 0.37 and 0.33) and stronger in 2014 and 2019 (0.66 and 0.63; 0.66 and 0.65). Attention U-Net is ahead in six of the seven years. In 2018, 16 scans, U-Net is ahead by 0.002. Nothing in the year split suggests that one architecture is specialised to a single season and failing in the others. The absolute level moves by almost 0.3 Dice across years, which is an order of magnitude larger than the architecture gap.</p>

  <div class="panel">
    <img src="assets/figures/shift.svg" alt="Validation Dice plotted against test Dice for each seed" style="width:100%;height:auto;display:block">
    <p class="small">Figure 4. Every seed falls below the equality line. The drop is nearly the same size for both families.</p>
  </div>
  <p>Validation macro Dice sits between 0.553 and 0.571. Test macro Dice sits between 0.504 and 0.532. The mean drop is 0.041 for Attention U-Net and 0.042 for U-Net. Selecting the architecture on validation would have preferred Attention U-Net, and the test set agrees with the sign of that preference, but either family’s validation number overstates its test number by about four points. That shift, not the choice of decoder, is the larger fact in the experiment.</p>
  <p>Two further locks behaved as intended. The probability threshold came out at 0.15 for all ten runs, so the comparison is not an artefact of one seed landing on a friendlier cutoff. The false-alarm rate at 25 km² is 0.561 ± 0.055 and 0.550 ± 0.048: a little over half of quiet test scans still contain a false region of that size, in both families. Sensitivity retained at the same area is 0.94 and 0.93. The operating point is stable, and it is not yet a clean detector of quiet nights.</p>

  <h2>Scan and night presence from the segmenter</h2>
  <p>Calling a scan positive when its predicted area exceeds a validation-chosen cutoff, the test ROC area is 0.830 for Attention U-Net and 0.833 for U-Net (means over the five seeds). Aggregating scans to the operational night by the maximum area gives 0.804 and 0.810; aggregating by the mean gives 0.851 and 0.851. With 21 migration nights and 19 quiet nights in the test night set, these areas are coarse. They do not separate the two architectures. They do say that a night-level score built from segmented area ranks migration nights above quiet nights well above chance, and that the mean is the stronger of the two reductions on this split.</p>

  <h2>What this section does not estimate</h2>
  <div class="note warn"><span class="tag">Limit</span><div class="bd">The Swin-Tiny presence model was trained for five seeds. Its validation ROC areas are 0.941, 0.948, 0.927, 0.919 and 0.932. The seed-42 checkpoint that the protocol uses to attach scan probabilities is not on disk and not on the checkpoint mirror, so those probabilities were not scored on the test set. The cascade and the oracle-presence row were not run. Development-screening runs on the earlier, unbalanced split are omitted: their nights are not this split’s nights.</div></div>
  <p>The historical dashboard model is also omitted. It was trained on a scan-level split in which most nights appeared in more than one of train, validation and test. A lower Dice here than that model’s published figure is the expected consequence of removing that leakage, not evidence that the retrain failed.</p>
  <p class="small">Sources: <code>outputs/night_split/comparison/seeds.md</code>, <code>comparison.csv</code>, and the per-scene files written by <code>scripts/export_variant_comparison.py</code> after <code>src.finalize</code>. Intervals use <code>src.stats.paired_cluster_bootstrap</code> with 2,000 draws and seed 0. The freeze record is <code>outputs/night_split/FROZEN.md</code>.</p>
  `;
}
