// Windows ICO container with PNG-encoded frames (supported by every
// browser and by Windows since Vista). Pure bytes; the PNG frames come from
// a canvas in the browser (exportKit.js) or from fixtures in tests.

/**
 * @param {{ size: number, png: Uint8Array }[]} frames square frames, any order
 * @returns {Uint8Array}
 */
export function buildIco(frames) {
  const list = (frames || []).filter((frame) => frame?.png?.length && frame.size > 0).sort((a, b) => a.size - b.size);
  if (list.length === 0) throw new Error('An icon needs at least one frame');
  const headerSize = 6 + 16 * list.length;
  const total = headerSize + list.reduce((sum, frame) => sum + frame.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // icon
  view.setUint16(4, list.length, true);
  let offset = headerSize;
  list.forEach((frame, index) => {
    const entry = 6 + index * 16;
    const dimension = frame.size >= 256 ? 0 : frame.size;
    out[entry] = dimension;
    out[entry + 1] = dimension;
    out[entry + 2] = 0; // palette
    out[entry + 3] = 0; // reserved
    view.setUint16(entry + 4, 1, true); // planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, frame.png.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(frame.png, offset);
    offset += frame.png.length;
  });
  return out;
}

/** Frame sizes a favicon.ico carries. */
export const FAVICON_SIZES = [16, 32, 48];

/** Reads the directory of an ICO built here. */
export function listIco(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    frames.push({ size: bytes[entry] || 256, length: view.getUint32(entry + 8, true), offset: view.getUint32(entry + 12, true) });
  }
  return frames;
}
