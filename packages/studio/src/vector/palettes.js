// Brand palettes for Text to Logo and Icon Set. Recraft takes colours as
// RGB objects (`colors`, `background_color`); models without colour inputs
// (Ideogram) get the same palette spelled out in the prompt.

export const PALETTES = [
  { id: 'none', name: 'Model’s choice', colors: [], background: null },
  { id: 'mono', name: 'Mono', colors: ['#111111', '#ffffff'], background: '#ffffff' },
  { id: 'mono-dark', name: 'Mono on dark', colors: ['#f5f5f5', '#9ca3af'], background: '#0b0b0d' },
  { id: 'ocean', name: 'Ocean', colors: ['#0ea5e9', '#0f172a', '#22d3ee'], background: '#ffffff' },
  { id: 'forest', name: 'Forest', colors: ['#166534', '#86efac', '#1c1917'], background: '#f7fee7' },
  { id: 'sunset', name: 'Sunset', colors: ['#f97316', '#db2777', '#7c2d12'], background: '#fff7ed' },
  { id: 'royal', name: 'Royal', colors: ['#4f46e5', '#c7d2fe', '#111827'], background: '#ffffff' },
  { id: 'earth', name: 'Earth', colors: ['#78350f', '#d6d3d1', '#365314'], background: '#fafaf9' },
  { id: 'custom', name: 'Custom', colors: ['#2563eb', '#111827'], background: '#ffffff' },
];

export const MAX_PALETTE_COLORS = 5;

/** "#1a2b3c" or "1a2b3c" or "#abc" -> { r, g, b }; null when not a colour. */
export function hexToRgb(hex) {
  const text = String(hex || '').trim().replace(/^#/, '');
  const full = text.length === 3 ? text.split('').map((char) => char + char).join('') : text;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const value = parseInt(full, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
}

/** Only well-formed colours, at most MAX_PALETTE_COLORS, no repeats. */
export function normalizePalette(palette) {
  const colors = [];
  for (const color of palette?.colors || []) {
    const rgb = hexToRgb(color);
    if (!rgb) continue;
    const hex = rgbToHex(rgb);
    if (!colors.includes(hex)) colors.push(hex);
    if (colors.length >= MAX_PALETTE_COLORS) break;
  }
  const background = hexToRgb(palette?.background);
  return { colors, background: background ? rgbToHex(background) : null };
}

/** Recraft inputs for a palette; empty when the palette is "model's choice". */
export function paletteToRecraft(palette) {
  const { colors, background } = normalizePalette(palette);
  const payload = {};
  if (colors.length) payload.colors = colors.map(hexToRgb);
  if (background) payload.background_color = hexToRgb(background);
  return payload;
}

/** Prompt words for models without colour inputs. */
export function paletteToPromptWords(palette) {
  const { colors, background } = normalizePalette(palette);
  if (!colors.length && !background) return '';
  const parts = [];
  if (colors.length) parts.push(`colour palette ${colors.join(', ')}`);
  if (background) parts.push(`on a ${background} background`);
  return parts.join(' ');
}
