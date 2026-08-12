/* SBW1 parser/cache tests.
   Run in Node: node assets/js/lib/sample-pack.test.js
   Run in a browser: import this module and call runSamplePackTests(). */

import { assetUrl, fetchSamplePack, packedBit, parseSamplePack,
  SamplePackCache, validateSampleAssets } from './sample-pack.js';

const META = {
  format: 'sbw1-gzip', width: 2, height: 2, thumbnail_width: 1, thumbnail_height: 1,
  model_order: ['a', 'b', 'c', 'd'],
  pack_path: 'data/samples/{ts}.sbw.gz',
  thumbnail_path: 'data/samples/{ts}.webp',
  version: 'fixture-1', model_artifact_version: 'models-fixture-1',
  reflectivity_source: 'max_th_e0_th_e5',
};

function fixture() {
  const bytes = new Uint8Array(12 + 4 * 4 + 1 + 4);
  bytes.set([83, 66, 87, 49]); // SBW1
  const h = new DataView(bytes.buffer);
  h.setUint16(4, 2, true); h.setUint16(6, 2, true);
  bytes[8] = 4; bytes[9] = 3; bytes[10] = 12; bytes[11] = 0;
  bytes.set([1, 2, 3, 4], 12);
  bytes.set([11, 12, 13, 14], 16);
  bytes.set([21, 22, 23, 24], 20);
  bytes.set([31, 32, 33, 34], 24);
  bytes[28] = 0b10100000; // MSB-first: true, false, true, false
  bytes.set([0, 1, 5, 6], 29);
  return bytes;
}

export async function runSamplePackTests() {
  const results = [];
  const ok = (name, condition, detail = '') => results.push({name, ok: Boolean(condition), detail});
  const throws = (name, fn, pattern) => {
    try { fn(); ok(name, false, 'did not throw'); }
    catch (error) { ok(name, pattern.test(String(error.message || error)), String(error.message || error)); }
  };

  ok('valid metadata', validateSampleAssets(META) === META);
  ok('asset URL substitutes timestamp and versions it',
    assetUrl(META.pack_path, 201907240000, META.version) ===
      'data/samples/201907240000.sbw.gz?v=fixture-1');

  const raw = fixture(), pack = parseSamplePack(raw, META);
  ok('dimensions and pixel count', pack.width === 2 && pack.height === 2 && pack.pixels === 4);
  ok('four zero-copy probability views',
    Object.keys(pack.probabilities).join(',') === 'a,b,c,d' &&
    pack.probabilities.a[0] === 1 && pack.probabilities.d[3] === 34 &&
    pack.probabilities.a.buffer === raw.buffer);
  ok('MSB-first ground-truth mask', [0, 1, 2, 3].map(i => packedBit(pack.groundTruth, i)).join('') === '1010');
  ok('categorical reflectivity preserved', [...pack.reflectivity].join(',') === '0,1,5,6');

  const badMagic = fixture(); badMagic[0] = 0;
  throws('rejects bad magic', () => parseSamplePack(badMagic, META), /magic/);
  const badFlags = fixture(); badFlags[9] = 1;
  throws('rejects non-categorical flags', () => parseSamplePack(badFlags, META), /flags/);
  const badReserved = fixture(); badReserved[11] = 1;
  throws('rejects nonzero reserved byte', () => parseSamplePack(badReserved, META), /reserved/);
  const badLength = new Uint8Array(raw.length + 1); badLength.set(raw);
  throws('rejects trailing payload bytes', () => parseSamplePack(badLength, META), /payload length/);
  const badCategory = fixture(); badCategory[29] = 7;
  throws('rejects reflectivity categories above 6', () => parseSamplePack(badCategory, META), /category 7/);

  let loads = 0;
  const cache = new SamplePackCache(async key => { loads++; return {key}; }, 3);
  await cache.get('a'); await cache.get('b'); await cache.get('c'); await cache.get('a'); await cache.get('d');
  await cache.get('b');
  ok('three-entry LRU refreshes hits and evicts oldest', loads === 5, `loader called ${loads} times`);

  let resolveSlow, slowLoads = 0;
  const slow = new SamplePackCache(() => { slowLoads++; return new Promise(r => { resolveSlow = r; }); });
  const p1 = slow.get('same'), p2 = slow.get('same');
  await Promise.resolve(); resolveSlow({value: 1});
  const pair = await Promise.all([p1, p2]);
  ok('concurrent callers share one in-flight load', slowLoads === 1 && pair[0] === pair[1]);

  if (typeof CompressionStream === 'function' && typeof DecompressionStream === 'function') {
    const compressed = await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    let fetches = 0;
    const decoded = await fetchSamplePack('/fixture.sbw.gz', META, async () => {
      fetches++; return new Response(compressed, {status: 200});
    });
    ok('gzip fetch decodes one response', fetches === 1 && decoded.probabilities.c[2] === 23);
  }

  return {ran: results.length, failed: results.filter(r => !r.ok).length, results};
}

if (typeof process !== 'undefined' && process?.versions?.node) {
  const report = await runSamplePackTests();
  report.results.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ${r.detail}`}`));
  console.log(report.failed ? `FAILED: ${report.failed} of ${report.ran}` : `all ${report.ran} checks passed`);
  process.exit(report.failed ? 1 : 0);
}
