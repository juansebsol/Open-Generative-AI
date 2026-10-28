// The free export kit: everything here runs in the visitor's browser with
// a canvas, no provider calls. SVG in, PNG / PDF / ICO / zip out.

import { svgDimensions } from './svgSanitize.js';
import { optimizeSvg } from './svgOptimize.js';
import { buildIco, FAVICON_SIZES } from './ico.js';
import { buildPdf, splitRgba } from './pdf.js';
import { buildZip } from './zip.js';

export const PNG_SIZES = [512, 1024, 2048];
export const PDF_RASTER_SIZE = 2048;

// Common app icon sizes. iOS names follow Xcode's asset catalog; Android the
// mipmap densities plus the Play Store listing; web the PWA manifest.
export const APP_ICON_SETS = {
  ios: [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024],
  android: [{ size: 48, dir: 'mipmap-mdpi' }, { size: 72, dir: 'mipmap-hdpi' }, { size: 96, dir: 'mipmap-xhdpi' }, { size: 144, dir: 'mipmap-xxhdpi' }, { size: 192, dir: 'mipmap-xxxhdpi' }, { size: 512, dir: 'playstore' }],
  web: [16, 32, 180, 192, 512],
};

const SVG_TYPE = 'image/svg+xml';

// Sets the root's width/height so the browser rasterises at the size we
// want (an SVG without them decodes at 300x150).
function sizedSvg(svg, width, height) {
  return String(svg).replace(/<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i, (whole, attrs) => {
    let cleaned = attrs.replace(/\s(width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, '');
    if (!/\sxmlns=/.test(cleaned)) cleaned += ' xmlns="http://www.w3.org/2000/svg"';
    return `<svg${cleaned} width="${width}" height="${height}">`;
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The SVG could not be drawn'));
    image.src = url;
  });
}

/** Pixel size of the SVG at a target longest side, keeping its aspect. */
export function fitSize(svg, longest) {
  const { viewBox } = svgDimensions(svg);
  const ratio = viewBox[2] / viewBox[3];
  const width = ratio >= 1 ? longest : Math.max(1, Math.round(longest * ratio));
  const height = ratio >= 1 ? Math.max(1, Math.round(longest / ratio)) : longest;
  return { width, height };
}

/**
 * Draws the SVG on a canvas. With `square`, the drawing is centred inside a
 * width x width square (app icons); otherwise the canvas has the SVG's aspect.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function rasterizeSvg(svg, { longest = 1024, square = false, background = null } = {}) {
  const { width, height } = fitSize(svg, longest);
  const canvasWidth = square ? longest : width;
  const canvasHeight = square ? longest : height;
  const blob = new Blob([sizedSvg(svg, width, height)], { type: SVG_TYPE });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d');
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    context.drawImage(image, Math.round((canvasWidth - width) / 2), Math.round((canvasHeight - height) / 2), width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), type));
}

export async function svgToPngBlob(svg, longest, options = {}) {
  return canvasToBlob(await rasterizeSvg(svg, { longest, ...options }));
}

export async function svgToPngBytes(svg, longest, options = {}) {
  return new Uint8Array(await (await svgToPngBlob(svg, longest, options)).arrayBuffer());
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A one-page PDF with the drawing rasterised at PDF_RASTER_SIZE. */
export async function svgToPdf(svg, { title = '' } = {}) {
  const canvas = await rasterizeSvg(svg, { longest: PDF_RASTER_SIZE });
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const { rgb, alpha } = splitRgba(pixels, width, height);
  const packedRgb = await deflate(rgb);
  const packedAlpha = alpha ? await deflate(alpha) : null;
  const compressed = Boolean(packedRgb) && (!alpha || Boolean(packedAlpha));
  return buildPdf({ width, height, rgb: compressed ? packedRgb : rgb, alpha: compressed ? packedAlpha : alpha, compressed, title });
}

/** favicon.ico with 16, 32 and 48 px frames. */
export async function svgToFavicon(svg) {
  const frames = await Promise.all(FAVICON_SIZES.map(async (size) => ({ size, png: await svgToPngBytes(svg, size, { square: true }) })));
  return buildIco(frames);
}

/** A zip of iOS, Android and web icon PNGs plus favicon.ico, manifest and the SVG. */
export async function svgToAppIconZip(svg, { name = 'icon' } = {}) {
  const files = [];
  const cache = new Map();
  const png = async (size) => {
    if (!cache.has(size)) cache.set(size, svgToPngBytes(svg, size, { square: true }));
    return cache.get(size);
  };
  for (const size of APP_ICON_SETS.ios) files.push({ name: `ios/AppIcon-${size}.png`, data: await png(size) });
  for (const { size, dir } of APP_ICON_SETS.android) files.push({ name: `android/${dir}/ic_launcher${dir === 'playstore' ? '-512' : ''}.png`, data: await png(size) });
  for (const size of APP_ICON_SETS.web) {
    const file = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    files.push({ name: `web/${file}`, data: await png(size) });
  }
  files.push({ name: 'web/favicon.ico', data: await svgToFavicon(svg) });
  files.push({ name: 'web/manifest.webmanifest', data: JSON.stringify({ name, icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2) });
  files.push({ name: `${name}.svg`, data: optimizeSvg(svg) });
  return buildZip(files);
}

export function downloadBytes(data, fileName, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

export function downloadText(text, fileName, type = SVG_TYPE) {
  downloadBytes(new Blob([text], { type }), fileName, type);
}
