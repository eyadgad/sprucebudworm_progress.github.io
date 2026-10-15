/* S-band sample pack decoder. Adapted from assets/js/lib/sample-pack.js.

   SBS1 payload, little-endian:
   magic, width, height, model count, flags, header size, reserved,
   then one uint8 plane per model, then DBZH -0.3 categories,
   then max-of-six-lowest-tilts categories. There is no ground-truth plane.
   Shared sample-pack.js is not modified and is not used for these files.
*/

export const SBS_HEADER_SIZE = 12;
export const SBS_FLAGS = 0x02;

const asBytes = value => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Sample pack must be an ArrayBuffer or typed-array view.");
};

export function validatePackMeta(value) {
  if (!value || value.format !== "sbs1-gzip") throw new Error("Unsupported S-band pack format.");
  for (const key of ["width", "height", "thumbnail_width", "thumbnail_height"]) {
    if (!Number.isInteger(value[key]) || value[key] <= 0) throw new Error(`packs.${key} is missing.`);
  }
  if (!Array.isArray(value.model_order) || value.model_order.join(",") !== "e1,e4,e1e4") {
    throw new Error("packs.model_order must be e1, e4, e1e4.");
  }
  if (typeof value.version !== "string" || !value.version) throw new Error("packs.version is missing.");
  return value;
}

export function assetUrl(template, timestamp, version) {
  const path = template.replaceAll("{ts}", String(timestamp));
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}v=${encodeURIComponent(String(version))}`;
}

export function parseSbandPack(value, metadata) {
  const cfg = validatePackMeta(metadata);
  const bytes = asBytes(value);
  if (bytes.byteLength < SBS_HEADER_SIZE) throw new Error("S-band pack is shorter than the header.");
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "SBS1") {
    throw new Error("Invalid sample pack magic; expected SBS1.");
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, SBS_HEADER_SIZE);
  const width = header.getUint16(4, true);
  const height = header.getUint16(6, true);
  const modelCount = header.getUint8(8);
  const flags = header.getUint8(9);
  const headerSize = header.getUint8(10);
  const reserved = header.getUint8(11);
  if (width !== cfg.width || height !== cfg.height) {
    throw new Error(`Sample dimensions ${width}x${height} do not match metadata.`);
  }
  if (modelCount !== cfg.model_order.length) throw new Error("Sample model count does not match metadata.");
  if (flags !== SBS_FLAGS) throw new Error(`Unsupported SBS1 flags 0x${flags.toString(16)}.`);
  if (headerSize !== SBS_HEADER_SIZE || reserved !== 0) throw new Error("Invalid SBS1 header.");
  const pixels = width * height;
  const expected = SBS_HEADER_SIZE + (modelCount + 2) * pixels;
  if (bytes.byteLength !== expected) {
    throw new Error(`Invalid SBS1 payload length ${bytes.byteLength}; expected ${expected}.`);
  }
  let offset = SBS_HEADER_SIZE;
  const probabilities = Object.create(null);
  for (const key of cfg.model_order) {
    probabilities[key] = bytes.subarray(offset, offset + pixels);
    offset += pixels;
  }
  const reflectivity = {
    m03: bytes.subarray(offset, offset + pixels),
  };
  offset += pixels;
  reflectivity.max6 = bytes.subarray(offset, offset + pixels);
  for (const plane of [reflectivity.m03, reflectivity.max6]) {
    for (let i = 0; i < plane.length; i++) {
      if (plane[i] > 6) throw new Error(`Invalid reflectivity category ${plane[i]} at pixel ${i}.`);
    }
  }
  return { width, height, pixels, probabilities, reflectivity };
}

export async function fetchSbandPack(url, metadata, fetchImpl = fetch) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser does not support gzip sample decompression.");
  }
  const response = await fetchImpl(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`${url} — HTTP ${response.status}`);
  if (!response.body) throw new Error("Sample response has no readable body.");
  let buffer;
  try {
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    buffer = await new Response(stream).arrayBuffer();
  } catch (error) {
    throw new Error(`Could not decompress sample pack: ${error.message || error}`);
  }
  return parseSbandPack(buffer, metadata);
}

export class SbandPackCache {
  constructor(loader, limit = 3) {
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
