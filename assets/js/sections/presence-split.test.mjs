/* Wiring test for the presence page.
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

const split = read('assets/js/sections/presence-split.js');
const main = read('assets/js/main.js');
const index = read('index.html');

console.log('presence page wiring');

ok('the pooled, test-fitted page is gone',
  !fs.existsSync(path.join(site, 'assets/js/sections/presence.js')));

ok('the page reads per-split cohorts and the validation-selected cutoff',
  split.includes('scanAnalysis(model, state.split)') &&
  split.includes('model.scan.selected_cutoff') &&
  !split.includes("const COHORT") &&
  !split.includes('combined_cutoff'));

ok('the page offers a dataset control', split.includes('name="presence-split"'));

ok('the test cutoff is held out and validation is in-sample',
  /heldOut\s*=\s*state\.split === 'test'/.test(split) &&
  split.includes("'validation (held out)'") &&
  split.includes("'this split (in-sample)'"));

ok('a hand-set cutoff is labelled as unfitted', split.includes("'you (not fitted)'"));

ok('both presence addresses route to the one page',
  /presence:\s*\{title:[^}]*presence-split\.js/.test(main) &&
  /'presence-split':\s*\{title:[^}]*presence-split\.js/.test(main) &&
  !main.includes("sections/presence.js'"));

ok('the page is reachable from the sidebar', index.includes('href="#/presence"'));

ok('changing split re-seeds the custom cutoffs',
  /state\.scanCustom = state\.nightCustom = null/.test(split));

console.log('\n' + '-'.repeat(54));
console.log(fails ? `FAILED: ${fails} of ${ran}` : `all ${ran} checks passed`);
process.exit(fails ? 1 : 0);
