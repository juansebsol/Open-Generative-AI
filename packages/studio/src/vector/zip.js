// A minimal ZIP writer (stored entries, no compression) for the export
// kit: icon sets and app icon bundles are a few hundred kilobytes of
// already-compressed PNGs, so deflating them would gain nothing. Pure
// bytes in, bytes out; runs in node tests and the browser alike.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data));

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const day = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, day };
}

function writer(size) {
  const buffer = new Uint8Array(size);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  return {
    buffer,
    get offset() { return offset; },
    u16(value) { view.setUint16(offset, value, true); offset += 2; },
    u32(value) { view.setUint32(offset, value >>> 0, true); offset += 4; },
    bytes(data) { buffer.set(data, offset); offset += data.length; },
  };
}

/**
 * @param {{ name: string, data: Uint8Array|ArrayBuffer|string }[]} files
 * @param {{ date?: Date }} [options]
 * @returns {Uint8Array} the .zip bytes
 */
export function buildZip(files, { date = new Date() } = {}) {
  const entries = (files || []).filter((file) => file && file.name).map((file) => {
    const data = toBytes(file.data ?? '');
    return { name: encoder.encode(String(file.name)), data, crc: crc32(data) };
  });
  const { time, day } = dosDateTime(date);
  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const out = writer(localSize + centralSize + 22);
  const offsets = [];

  for (const entry of entries) {
    offsets.push(out.offset);
    out.u32(0x04034b50);
    out.u16(20); // version needed
    out.u16(0x0800); // UTF-8 names
    out.u16(0); // stored
    out.u16(time);
    out.u16(day);
    out.u32(entry.crc);
    out.u32(entry.data.length);
    out.u32(entry.data.length);
    out.u16(entry.name.length);
    out.u16(0);
    out.bytes(entry.name);
    out.bytes(entry.data);
  }

  const centralStart = out.offset;
  entries.forEach((entry, index) => {
    out.u32(0x02014b50);
    out.u16(20); // made by
    out.u16(20); // needed
    out.u16(0x0800);
    out.u16(0);
    out.u16(time);
    out.u16(day);
    out.u32(entry.crc);
    out.u32(entry.data.length);
    out.u32(entry.data.length);
    out.u16(entry.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(offsets[index]);
    out.bytes(entry.name);
  });

  out.u32(0x06054b50);
  out.u16(0); // this disk
  out.u16(0); // disk with the central directory
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0); // comment length
  return out.buffer;
}

/** Reads back the entry names of a zip built here (for tests and previews). */
export function listZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const names = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    names.push(decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength)));
    offset += 30 + nameLength + extraLength + size;
  }
  return names;
}
