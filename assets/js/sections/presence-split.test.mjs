/* Wiring test for the two presence pages.
   Run: node assets/js/sections/presence-split.test.mjs */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const site = path.resolve(here, '../../..');
const read = rel => fs.readFileSync(path.join(site, rel), 'utf8');

let fails = 0, ran = 0;
const ok = (name, cond, detail = '') => {
  ran++;
  if (!cond) { fails++; console.log(`  FAIL  ${name}  ${detail}`); }
  else console.log(`  PASS  ${name}`);
};

const pooled = read('assets/js/sections/presence.js');
const split = read('assets/js/sections/presence-split.js');
const main = read('assets/js/main.js');
const index = read('index.html');

console.log('presence page wiring');

ok('both pages exist and are distinct', pooled.length > 0 && split.length > 0 && pooled !== split);

ok('pooled page reads the pooled cohort and its in-sample cutoff',
  /const COHORT = 'combined'/.test(pooled) &&
  pooled.includes('model.scan.combined_cutoff') &&
  !pooled.includes('model.scan.selected_cutoff'));

ok('split page reads per-split cohorts and the validation-selected cutoff',
  split.includes('scanAnalysis(model, state.split)') &&
  split.includes('model.scan.selected_cutoff') &&
  !split.includes("const COHORT") &&
  !split.includes('combined_cutoff'));

ok('only the split page offers a dataset control',
  split.includes('name="presence-split"') && !pooled.includes('name="presence-split"'));

ok('split page marks the test cutoff held out and validation in-sample',
  /heldOut\s*=\s*state\.split === 'test'/.test(split) &&
  split.includes("'validation (held out)'") &&
  split.includes("'this split (in-sample)'"));

ok('both pages label a hand-set cutoff as unfitted',
  pooled.includes("'you (not fitted)'") && split.includes("'you (not fitted)'"));

ok('both pages are routed', /presence:\s*\{title:/.test(main) &&
  /'presence-split':\s*\{title:/.test(main));

ok('both pages are reachable from the sidebar',
  index.includes('href="#/presence"') && index.includes('href="#/presence-split"'));

ok('changing split re-seeds the custom cutoffs',
  /state\.scanCustom = state\.nightCustom = null/.test(split));

console.log('\n' + '-'.repeat(54));
console.log(fails ? `FAILED: ${fails} of ${ran}` : `all ${ran} checks passed`);
process.exit(fails ? 1 : 0);
