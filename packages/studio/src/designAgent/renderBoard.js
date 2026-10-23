// Browser-only: renders board items to a PNG with a 2D canvas, and helpers to
// load images and save files.

import { LINE_HEIGHT, TEXT_FONTS, itemBox, rotatedBounds, unionBounds, wrapTextLines } from './board.js';

const MAX_SIDE = 8192;
const MAX_PIXELS = 48_000_000;

// The page's CSP doesn't allow fetch() on data: URLs, so decode them here.
function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, comma);
  const type = header.split(';')[0] || 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (!header.includes(';base64')) return new Blob([decodeURIComponent(body)], { type });
  const bytes = atob(body);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type });
}

// Fetches an image as a blob so the canvas never gets tainted. Provider CDNs
// that block cross-origin reads go through the app's /api/media proxy.
export async function fetchImageBlob(url) {
  if (/^data:/i.test(url)) return dataUrlToBlob(url);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
  } catch (error) {
    if (!/^https:\/\//i.test(url)) throw error;
    const proxied = await fetch(`/api/media?url=${encodeURIComponent(url)}`);
    if (!proxied.ok) throw new Error(`Could not load ${url}`);
    return proxied.blob();
  }
}

async function loadBitmap(url) {
  const blob = await fetchImageBlob(url);
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

/** Natural size of an image URL, or null if it can't be loaded. */
export function imageSize(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

const fontFor = (item) => `${item.fontWeight === 'bold' ? '700' : '400'} ${item.fontSize}px ${TEXT_FONTS[item.fontFamily] || TEXT_FONTS.sans}`;

function textLayout(ctx, item) {
  ctx.font = fontFor(item);
  const lines = wrapTextLines(item.text, item.maxWidth, (value) => ctx.measureText(value).width);
  const widest = Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
  const width = item.maxWidth || widest;
  return { lines, width, height: lines.length * item.fontSize * LINE_HEIGHT };
}

/**
 * Renders items (sorted by z) to a PNG blob.
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function renderBoardToBlob(items, { background = 'transparent', padding = 0 } = {}) {
  const drawable = items.filter((item) => item.kind === 'image' || item.kind === 'text').sort((a, b) => (a.z || 0) - (b.z || 0));
  if (drawable.length === 0) throw new Error('Nothing to export: the board is empty.');

  const measureCanvas = document.createElement('canvas').getContext('2d');
  const boxes = new Map();
  for (const item of drawable) {
    if (item.kind === 'text') {
      const layout = textLayout(measureCanvas, item);
      boxes.set(item.id, { x: item.x, y: item.y, width: layout.width, height: layout.height, layout });
    } else {
      boxes.set(item.id, itemBox(item));
    }
  }

  const pad = Math.max(0, Number(padding) || 0);
  const bounds = unionBounds(drawable.map((item) => rotatedBounds(boxes.get(item.id), item.rotation)));
  const area = { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 };

  // Render at the images' native density so exports aren't softer than the sources.
  const bitmaps = new Map();
  await Promise.all(drawable.filter((item) => item.kind === 'image').map(async (item) => {
    bitmaps.set(item.id, await loadBitmap(item.url));
  }));
  let scale = 1;
  for (const item of drawable) {
    const bitmap = bitmaps.get(item.id);
    if (bitmap && item.width > 0) scale = Math.max(scale, bitmap.width / item.width);
  }
  scale = Math.min(scale, 4, MAX_SIDE / area.width, MAX_SIDE / area.height, Math.sqrt(MAX_PIXELS / (area.width * area.height)));
  scale = Math.max(scale, 0.1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (background && background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  ctx.translate(-area.x, -area.y);

  for (const item of drawable) {
    const box = boxes.get(item.id);
    ctx.save();
    ctx.translate(box.x + box.width / 2, box.y + box.height / 2);
    if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.globalAlpha = item.opacity ?? 1;
    if (item.kind === 'image') {
      ctx.drawImage(bitmaps.get(item.id), -box.width / 2, -box.height / 2, box.width, box.height);
    } else {
      const { lines } = box.layout;
      ctx.font = fontFor(item);
      ctx.fillStyle = item.color || '#ffffff';
      ctx.textBaseline = 'middle';
      const lineHeight = item.fontSize * LINE_HEIGHT;
      lines.forEach((line, index) => {
        const lineWidth = ctx.measureText(line).width;
        const offset = item.align === 'center' ? (box.width - lineWidth) / 2 : item.align === 'right' ? box.width - lineWidth : 0;
        ctx.fillText(line, -box.width / 2 + offset, -box.height / 2 + lineHeight * index + lineHeight / 2);
      });
    }
    ctx.restore();
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not encode the PNG.'))), 'image/png');
  });
  return { blob, width: canvas.width, height: canvas.height };
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

export async function downloadImage(url, baseName) {
  try {
    const blob = await fetchImageBlob(url);
    saveBlob(blob, `${baseName}.${EXTENSIONS[blob.type] || 'png'}`);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
