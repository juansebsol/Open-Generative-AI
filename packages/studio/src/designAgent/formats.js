// What the Design Agent can design for. A format puts a frame on the board at
// (0, 0), sized in board pixels to the format's export size (print at 300 dpi),
// so what sits inside the frame is exactly what Export saves.

import { ASPECT_RATIOS } from './board.js';

export const PRINT_DPI = 300;
export const MAX_FRAME_SIDE = 8192;
export const FORMAT_GROUPS = ['social', 'print', 'web'];
export const FRAME_UNITS = ['px', 'in', 'mm'];

const inches = (value) => Math.round(value * PRINT_DPI);
const millimetres = (value) => Math.round((value / 25.4) * PRINT_DPI);

// `featured` formats are the start tiles; `print` is the size people know them by.
export const FORMATS = [
  { id: 'instagram-post', group: 'social', width: 1080, height: 1350, featured: true },
  { id: 'instagram-story', group: 'social', width: 1080, height: 1920, featured: true },
  { id: 'square-post', group: 'social', width: 1080, height: 1080 },
  { id: 'youtube-thumbnail', group: 'social', width: 1280, height: 720, featured: true },
  { id: 'x-post', group: 'social', width: 1200, height: 675 },
  { id: 'poster', group: 'print', width: inches(18), height: inches(24), print: '18 × 24 in', featured: true },
  { id: 'flyer', group: 'print', width: millimetres(148), height: millimetres(210), print: 'A5 · 148 × 210 mm', featured: true },
  { id: 'business-card', group: 'print', width: inches(3.5), height: inches(2), print: '3.5 × 2 in', featured: true },
  { id: 'postcard', group: 'print', width: inches(6), height: inches(4), print: '6 × 4 in' },
  { id: 'website', group: 'web', width: 1440, height: 900, featured: true },
  { id: 'hero-banner', group: 'web', width: 1920, height: 1080 },
  { id: 'link-preview', group: 'web', width: 1200, height: 630, featured: true },
];

export const findFormat = (id) => FORMATS.find((format) => format.id === id) || null;

/** The frame for a preset, or null for an unknown id (a free board). */
export function frameFor(id) {
  const format = findFormat(id);
  return format ? { format: format.id, width: format.width, height: format.height } : null;
}

/** A custom frame from a width and height in px, in or mm; null when either is not a positive number. */
export function customFrame(width, height, unit = 'px') {
  const toPixels = unit === 'in' ? inches : unit === 'mm' ? millimetres : Math.round;
  const w = toPixels(Number(width));
  const h = toPixels(Number(height));
  if (!(w > 0) || !(h > 0)) return null;
  const side = (value) => Math.min(MAX_FRAME_SIDE, Math.max(16, value));
  return { format: 'custom', width: side(w), height: side(h) };
}

/** "18 × 24 in" for print presets, "1080 × 1350" otherwise. */
export function formatSize(frame) {
  if (!frame) return '';
  return findFormat(frame.format)?.print || `${frame.width} × ${frame.height}`;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** "4:5", "16:9", or "1:1.42" when the ratio has no small whole-number form. */
export function ratioLabel(width, height) {
  const divisor = gcd(Math.round(width), Math.round(height)) || 1;
  const across = Math.round(width) / divisor;
  const down = Math.round(height) / divisor;
  if (across <= 21 && down <= 21) return `${across}:${down}`;
  return width >= height ? `${(width / height).toFixed(2)}:1` : `1:${(height / width).toFixed(2)}`;
}

/** The supported image aspect ratio closest to width x height. */
export function closestAspect(width, height) {
  const target = Math.log(width / height);
  let best = ASPECT_RATIOS[0];
  let bestDistance = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const [across, down] = ratio.split(':').map(Number);
    const distance = Math.abs(Math.log(across / down) - target);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

/** Where an image of `aspect` goes to cover the frame edge to edge, centred (the export crops the overhang). */
export function coverFrame(frame, aspect) {
  const [across, down] = aspect.split(':').map(Number);
  const width = Math.ceil(Math.max(frame.width, frame.height * (across / down)));
  const height = Math.ceil(width * (down / across));
  return { x: Math.round((frame.width - width) / 2), y: Math.round((frame.height - height) / 2), width };
}
