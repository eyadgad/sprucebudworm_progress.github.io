/* Decoder and small in-memory cache for Sample Explorer SBW1 assets. */

export const SBW_HEADER_SIZE = 12;
export const SBW_FLAGS = 0x03; // bit 0: MSB-first GT; bit 1: categorical reflectivity

const asBytes = value => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Sample pack must be an ArrayBuffer or typed-array view.');
};

export function validateSampleAssets(value) {
  if (!value || typeof value !== 'object') throw new Error('samples.json is missing sample_assets metadata.');
  if (value.format !== 'sbw1-gzip') throw new Error(`Unsupported sample format: ${value.format || 'missing'}.`);
  for (const key of ['width', 'height', 'thumbnail_width', 'thumbnail_height']) {
    if (!Number.isInteger(value[key]) || value[key] <= 0 || value[key] > 65535) {
      throw new Error(`sample_assets.${key} must be an integer from 1 to 65535.`);
    }
  }
  if (!Array.isArray(value.model_order) || value.model_order.length !== 4 ||
      value.model_order.some(k => typeof k !== 'string' || !k) ||
      new Set(value.model_order).size !== value.model_order.length) {
    throw new Error('sample_assets.model_order must contain four unique model keys.');
  }
  for (const key of ['pack_path', 'thumbnail_path']) {
    if (typeof value[key] !== 'string' || !value[key].includes('{ts}')) {
      throw new Error(`sample_assets.${key} must contain {ts}.`);
    }
  }
  if (value.version == null || String(value.version).length === 0) {
    throw new Error('sample_assets.version is required.');
  }
  if (typeof value.model_artifact_version !== 'string' || !value.model_artifact_version.startsWith('models-')) {
    throw new Error('sample_assets.model_artifact_version is required.');
  }
  if (value.reflectivity_source !== 'max_th_e0_th_e5') {
    throw new Error('Unsupported reflectivity source; expected max_th_e0_th_e5.');
  }
  return value;
}

export function assetUrl(template, timestamp, version) {
  const path = template.replaceAll('{ts}', String(timestamp));
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}v=${encodeURIComponent(String(version))}`;
}

/** Read one bit from an MSB-first packed mask. */
export function packedBit(mask, index) {
  return (mask[index >> 3] >> (7 - (index & 7))) & 1;
}

/**
 * Parse an uncompressed SBW1 payload. Returned arrays are zero-copy views over
 * the decompressed buffer, so keeping this object in the LRU keeps one buffer.
 */
export function parseSamplePack(value, metadata) {
  const cfg = validateSampleAssets(metadata);
  const bytes = asBytes(value);
  if (bytes.byteLength < SBW_HEADER_SIZE) throw new Error('Sample pack is shorter than the 12-byte SBW1 header.');
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'SBW1') {
    throw new Error('Invalid sample pack magic; expected SBW1.');
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, SBW_HEADER_SIZE);
  const width = header.getUint16(4, true), height = header.getUint16(6, true);
  const modelCount = header.getUint8(8), flags = header.getUint8(9);
  const headerSize = header.getUint8(10), reserved = header.getUint8(11);
  if (width !== cfg.width || height !== cfg.height) {
    throw new Error(`Sample dimensions ${width}x${height} do not match metadata ${cfg.width}x${cfg.height}.`);
  }
  if (modelCount !== cfg.model_order.length) {
    throw new Error(`Sample model count ${modelCount} does not match metadata ${cfg.model_order.length}.`);
  }
  if (flags !== SBW_FLAGS) throw new Error(`Unsupported SBW1 flags 0x${flags.toString(16).padStart(2, '0')}; expected 0x03.`);
  if (headerSize !== SBW_HEADER_SIZE) throw new Error(`Invalid SBW1 header size ${headerSize}; expected 12.`);
  if (reserved !== 0) throw new Error('Invalid SBW1 reserved byte; expected 0.');

  const pixels = width * height, gtBytes = Math.ceil(pixels / 8);
  const expected = SBW_HEADER_SIZE + modelCount * pixels + gtBytes + pixels;
  if (bytes.byteLength !== expected) {
    throw new Error(`Invalid SBW1 payload length ${bytes.byteLength}; expected ${expected}.`);
  }
  let offset = SBW_HEADER_SIZE;
  const probabilities = Object.create(null);
  for (const key of cfg.model_order) {
    probabilities[key] = bytes.subarray(offset, offset + pixels);
    offset += pixels;
  }
  const groundTruth = bytes.subarray(offset, offset + gtBytes); offset += gtBytes;
  const reflectivity = bytes.subarray(offset, offset + pixels);
  for (let i = 0; i < reflectivity.length; i++) {
    if (reflectivity[i] > 6) throw new Error(`Invalid reflectivity category ${reflectivity[i]} at pixel ${i}.`);
  }
  return {width, height, pixels, probabilities, groundTruth, reflectivity};
}

export async function fetchSamplePack(url, metadata, fetchImpl = fetch) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip sample decompression.');
  }
  const response = await fetchImpl(url, {cache: 'force-cache'});
  if (!response.ok) throw new Error(`${url} — HTTP ${response.status}`);
  if (!response.body) throw new Error('Sample response has no readable body.');
  let buffer;
  try {
    const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
    buffer = await new Response(stream).arrayBuffer();
  } catch (error) {
    throw new Error(`Could not decompress sample pack: ${error.message || error}`);
  }
  return parseSamplePack(buffer, metadata);
}

/** A promise-aware LRU: simultaneous callers share one request. */
export class SamplePackCache {
  constructor(loader, limit = 3) {
    if (typeof loader !== 'function') throw new TypeError('SamplePackCache requires a loader function.');
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('SamplePackCache limit must be a positive integer.');
    this.loader = loader;
    this.limit = limit;
    this.cache = new Map();
    this.inflight = new Map();
  }

  async get(key) {
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const pending = Promise.resolve().then(() => this.loader(key)).then(value => {
      this.cache.set(key, value);
      while (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value);
      return value;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, pending);
    return pending;
  }
}
