// A ZIP writer and reader that never hold a whole archive in memory.
//
// Writing: entries are stored (no compression; the media is already
// compressed) and emitted as a list of *parts*, each a Uint8Array header or
// the entry's own Blob. A sink can hand those parts to a file handle one by
// one, or wrap them in one Blob, which only references the stored blobs
// instead of copying them. The CRC-32 each entry needs is computed by
// streaming the blob through in chunks before its header is written, so
// the peak memory is one chunk, whatever the library weighs. ZIP64 fields
// are written when any size or offset passes 4 GB or there are more than
// 65,534 entries, so multi-gigabyte libraries open everywhere.
//
// Reading: the central directory is read from the end of the file, and
// each entry is a slice of the file, decompressed on the fly when a tool
// re-zipped it with deflate. Nothing is read until it is asked for.
//
// Pure web platform (Blob, streams, TextEncoder), so it runs in node tests
// and the browser alike.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LIMIT_32 = 0xffffffff;
const LIMIT_16 = 0xffff;
const CHUNK = 1024 * 1024;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31);
  const day = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, day };
}

function bytesWriter(size) {
  const buffer = new Uint8Array(size);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  return {
    buffer,
    u16(value) { view.setUint16(offset, value, true); offset += 2; },
    u32(value) { view.setUint32(offset, value >>> 0, true); offset += 4; },
    u64(value) { view.setBigUint64(offset, BigInt(value), true); offset += 8; },
    bytes(data) { buffer.set(data, offset); offset += data.length; },
  };
}

// CRC-32 of a blob, one chunk at a time; also returns the byte count seen.
async function crcOfBlob(blob) {
  let crc = 0xffffffff;
  let size = 0;
  for (let start = 0; start < blob.size; start += CHUNK) {
    const bytes = new Uint8Array(await blob.slice(start, Math.min(blob.size, start + CHUNK)).arrayBuffer());
    crc = crcContinue(crc, bytes);
    size += bytes.length;
  }
  return { crc: (crc ^ 0xffffffff) >>> 0, size };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crcContinue(crc, bytes) {
  let value = crc;
  for (let i = 0; i < bytes.length; i += 1) value = CRC_TABLE[(value ^ bytes[i]) & 0xff] ^ (value >>> 8);
  return value;
}

const toBlob = (data) => (data instanceof Blob ? data : new Blob([typeof data === 'string' ? encoder.encode(data) : data]));

/**
 * Streams a ZIP out of `entries` as parts.
 * @param {AsyncIterable<{ name: string, data: Blob|Uint8Array|string, date?: Date }>|Iterable<object>} entries
 * @param {{ onEntry?: (info: { name: string, size: number, index: number }) => void }} [options]
 * @returns {AsyncGenerator<Uint8Array|Blob>} headers and file blobs, in archive order
 */
export async function* zipParts(entries, { onEntry = null } = {}) {
  const central = [];
  let offset = 0;
  let index = 0;
  for await (const entry of entries) {
    if (!entry || !entry.name) continue;
    const name = encoder.encode(String(entry.name));
    const blob = toBlob(entry.data ?? '');
    const { crc, size } = await crcOfBlob(blob);
    const { time, day } = dosDateTime(entry.date);
    const zip64 = size >= LIMIT_32 || offset >= LIMIT_32;
    const extraLength = zip64 ? 20 : 0;
    const local = bytesWriter(30 + name.length + extraLength);
    local.u32(SIG_LOCAL);
    local.u16(zip64 ? 45 : 20);
    local.u16(0x0800); // UTF-8 names
    local.u16(0); // stored
    local.u16(time);
    local.u16(day);
    local.u32(crc);
    local.u32(zip64 ? LIMIT_32 : size);
    local.u32(zip64 ? LIMIT_32 : size);
    local.u16(name.length);
    local.u16(extraLength);
    local.bytes(name);
    if (zip64) {
      local.u16(0x0001);
      local.u16(16);
      local.u64(size);
      local.u64(size);
    }
    central.push({ name, crc, size, offset, time, day });
    yield local.buffer;
    if (size > 0) yield blob;
    offset += local.buffer.length + size;
    onEntry?.({ name: entry.name, size, index });
    index += 1;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const entry of central) {
    const needs64 = entry.size >= LIMIT_32 || entry.offset >= LIMIT_32;
    const extraLength = needs64 ? 28 : 0;
    const record = bytesWriter(46 + entry.name.length + extraLength);
    record.u32(SIG_CENTRAL);
    record.u16(needs64 ? 45 : 20); // made by
    record.u16(needs64 ? 45 : 20); // needed
    record.u16(0x0800);
    record.u16(0);
    record.u16(entry.time);
    record.u16(entry.day);
    record.u32(entry.crc);
    record.u32(needs64 ? LIMIT_32 : entry.size);
    record.u32(needs64 ? LIMIT_32 : entry.size);
    record.u16(entry.name.length);
    record.u16(extraLength);
    record.u16(0); // comment
    record.u16(0); // disk
    record.u16(0); // internal attributes
    record.u32(0); // external attributes
    record.u32(needs64 ? LIMIT_32 : entry.offset);
    record.bytes(entry.name);
    if (needs64) {
      record.u16(0x0001);
      record.u16(24);
      record.u64(entry.size);
      record.u64(entry.size);
      record.u64(entry.offset);
    }
    centralSize += record.buffer.length;
    yield record.buffer;
  }

  const count = central.length;
  const needsZip64End = count >= LIMIT_16 || centralSize >= LIMIT_32 || centralStart >= LIMIT_32;
  if (needsZip64End) {
    const end64 = bytesWriter(56 + 20);
    end64.u32(SIG_EOCD64);
    end64.u64(44); // size of the rest of this record
    end64.u16(45);
    end64.u16(45);
    end64.u32(0);
    end64.u32(0);
    end64.u64(count);
    end64.u64(count);
    end64.u64(centralSize);
    end64.u64(centralStart);
    // Locator
    end64.u32(SIG_LOCATOR64);
    end64.u32(0);
    end64.u64(centralStart + centralSize);
    end64.u32(1);
    yield end64.buffer;
  }
  const end = bytesWriter(22);
  end.u32(SIG_EOCD);
  end.u16(0);
  end.u16(0);
  end.u16(Math.min(count, LIMIT_16));
  end.u16(Math.min(count, LIMIT_16));
  end.u32(Math.min(centralSize, LIMIT_32));
  end.u32(Math.min(centralStart, LIMIT_32));
  end.u16(0);
  yield end.buffer;
}

/** Collects the parts into one Blob (references the entry blobs; no copy). */
export async function zipBlob(entries, options = {}) {
  const parts = [];
  for await (const part of zipParts(entries, options)) parts.push(part);
  return new Blob(parts, { type: 'application/zip' });
}

async function readBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(Math.max(0, start), Math.min(blob.size, end)).arrayBuffer());
}

function findSignature(bytes, signature) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 4; i >= 0; i -= 1) if (view.getUint32(i, true) === signature) return i;
  return -1;
}

/**
 * Lists a ZIP's entries without reading their data.
 * @param {Blob} file
 * @returns {Promise<{ name: string, size: number, method: number, blob: () => Promise<Blob>, text: () => Promise<string> }[]>}
 */
export async function readZip(file) {
  if (!(file instanceof Blob)) throw new Error('readZip needs a Blob');
  const tailStart = Math.max(0, file.size - (LIMIT_16 + 22 + 20 + 56));
  const tail = await readBytes(file, tailStart, file.size);
  const eocdAt = findSignature(tail, SIG_EOCD);
  if (eocdAt < 0) throw new Error('Not a ZIP file');
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let count = tailView.getUint16(eocdAt + 10, true);
  let centralSize = tailView.getUint32(eocdAt + 12, true);
  let centralStart = tailView.getUint32(eocdAt + 16, true);
  if (count === LIMIT_16 || centralSize === LIMIT_32 || centralStart === LIMIT_32) {
    const locatorAt = eocdAt - 20;
    if (locatorAt >= 0 && tailView.getUint32(locatorAt, true) === SIG_LOCATOR64) {
      const end64Offset = Number(tailView.getBigUint64(locatorAt + 8, true));
      const end64 = await readBytes(file, end64Offset, end64Offset + 56);
      const view64 = new DataView(end64.buffer, end64.byteOffset, end64.byteLength);
      if (view64.getUint32(0, true) !== SIG_EOCD64) throw new Error('Damaged ZIP64 directory');
      count = Number(view64.getBigUint64(32, true));
      centralSize = Number(view64.getBigUint64(40, true));
      centralStart = Number(view64.getBigUint64(48, true));
    }
  }

  const central = await readBytes(file, centralStart, centralStart + centralSize);
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const entries = [];
  let offset = 0;
  while (entries.length < count && offset + 46 <= central.length) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    let compressedSize = view.getUint32(offset + 20, true);
    let size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(central.subarray(offset + 46, offset + 46 + nameLength));
    // ZIP64 extra: the 0xFFFFFFFF fields above, in this order, as 64-bit values.
    let extraAt = offset + 46 + nameLength;
    const extraEnd = extraAt + extraLength;
    while (extraAt + 4 <= extraEnd) {
      const id = view.getUint16(extraAt, true);
      const length = view.getUint16(extraAt + 2, true);
      if (id === 0x0001) {
        let at = extraAt + 4;
        if (size === LIMIT_32 && at + 8 <= extraAt + 4 + length) { size = Number(view.getBigUint64(at, true)); at += 8; }
        if (compressedSize === LIMIT_32 && at + 8 <= extraAt + 4 + length) { compressedSize = Number(view.getBigUint64(at, true)); at += 8; }
        if (localOffset === LIMIT_32 && at + 8 <= extraAt + 4 + length) { localOffset = Number(view.getBigUint64(at, true)); }
      }
      extraAt += 4 + length;
    }
    const blob = async () => {
      const local = await readBytes(file, localOffset, localOffset + 30);
      const localView = new DataView(local.buffer, local.byteOffset, local.byteLength);
      if (localView.getUint32(0, true) !== SIG_LOCAL) throw new Error(`Damaged entry: ${name}`);
      const dataStart = localOffset + 30 + localView.getUint16(26, true) + localView.getUint16(28, true);
      const raw = file.slice(dataStart, dataStart + compressedSize);
      if (method === 0) return raw;
      if (method === 8 && typeof DecompressionStream !== 'undefined') {
        return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      }
      throw new Error(`Unsupported compression (${method}) for ${name}`);
    };
    entries.push({ name, size, method, crc, blob, text: async () => (await blob()).text() });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
