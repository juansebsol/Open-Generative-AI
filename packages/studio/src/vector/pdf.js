// A one-page PDF around one RGB image with an optional alpha mask: the
// export kit's "PDF" button. The pixel data arrives already deflated
// (FlateDecode) from the browser's CompressionStream, or raw when that is
// unavailable. Pure bytes; tested in node with a tiny raw image.

const encoder = new TextEncoder();
const POINTS_PER_PIXEL = 72 / 96;

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * @param {{ width: number, height: number, rgb: Uint8Array, alpha?: Uint8Array|null, compressed?: boolean, title?: string }} image
 *   `rgb` holds width*height*3 bytes (deflated when `compressed`); `alpha`
 *   holds width*height bytes in the same encoding.
 * @returns {Uint8Array}
 */
export function buildPdf({ width, height, rgb, alpha = null, compressed = false, title = '' }) {
  if (!(width > 0 && height > 0) || !rgb?.length) throw new Error('A PDF needs an image');
  const pageWidth = Math.round(width * POINTS_PER_PIXEL * 100) / 100;
  const pageHeight = Math.round(height * POINTS_PER_PIXEL * 100) / 100;
  const filter = compressed ? ' /Filter /FlateDecode' : '';
  const text = (value) => encoder.encode(value);
  const content = text(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`);
  const safeTitle = String(title || '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '');

  const objects = [
    text('<< /Type /Catalog /Pages 2 0 R >>'),
    text('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`),
    concat([text(`<< /Length ${content.length} >>\nstream\n`), content, text('\nendstream')]),
    concat([
      text(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8${filter}${alpha ? ' /SMask 6 0 R' : ''} /Length ${rgb.length} >>\nstream\n`),
      rgb,
      text('\nendstream'),
    ]),
  ];
  if (alpha) {
    objects.push(concat([
      text(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8${filter} /Length ${alpha.length} >>\nstream\n`),
      alpha,
      text('\nendstream'),
    ]));
  }
  objects.push(text(`<< /Producer (Openstudio Vector)${safeTitle ? ` /Title (${safeTitle})` : ''} >>`));
  const infoIndex = objects.length;

  const chunks = [text('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')];
  const offsets = [];
  let position = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(position);
    const head = text(`${index + 1} 0 obj\n`);
    const tail = text('\nendobj\n');
    chunks.push(head, body, tail);
    position += head.length + body.length + tail.length;
  });
  const xrefPosition = position;
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (const offset of offsets) xref.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoIndex} 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`);
  chunks.push(text(xref.join('')));
  return concat(chunks);
}

/** Splits canvas RGBA pixels into the RGB and alpha planes a PDF wants. */
export function splitRgba(rgba, width, height) {
  const pixels = width * height;
  const rgb = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  let opaque = true;
  for (let i = 0; i < pixels; i += 1) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
    alpha[i] = rgba[i * 4 + 3];
    if (alpha[i] !== 255) opaque = false;
  }
  return { rgb, alpha: opaque ? null : alpha };
}
