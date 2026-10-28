// Turns an icon list (one name per line) plus shared style words into the
// runs an icon set needs: one generation per icon, same style, same
// palette. Pure, so the studio can show the plan (and its price) before
// anything is sent.

export const MAX_ICONS = 32;

const STYLE_SUFFIX = 'Single icon, centered on a plain background, consistent stroke and proportions, no text, no labels, designed as part of one icon set.';

/**
 * Reads icon names from a textarea: one per line, bullets and numbering
 * removed, blanks and repeats (case-insensitive) skipped.
 */
export function parseIconNames(text) {
  const seen = new Set();
  const names = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const name = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** The prompt one icon is generated with. */
export function iconPrompt(name, style = '', paletteWords = '') {
  const parts = [`${name} icon`];
  const styleText = String(style || '').trim().replace(/[.\s]+$/, '');
  if (styleText) parts.push(styleText);
  if (paletteWords) parts.push(paletteWords);
  parts.push(STYLE_SUFFIX);
  return parts.join('. ').replace(/\.\./g, '.');
}

/**
 * @param {{ names: string|string[], style?: string, paletteWords?: string, limit?: number }} input
 * @returns {{ runs: { name: string, prompt: string }[], count: number, skipped: string[], truncated: boolean }}
 */
export function planIconSet({ names, style = '', paletteWords = '', limit = MAX_ICONS } = {}) {
  const list = Array.isArray(names) ? parseIconNames(names.join('\n')) : parseIconNames(names);
  const max = Math.max(1, Math.min(MAX_ICONS, Math.round(Number(limit) || MAX_ICONS)));
  const kept = list.slice(0, max);
  return {
    runs: kept.map((name) => ({ name, prompt: iconPrompt(name, style, paletteWords) })),
    count: kept.length,
    skipped: list.slice(max),
    truncated: list.length > max,
  };
}

/** Total for a plan at a unit price, rounded to a cent fraction the chip shows. */
export function estimateIconSetTotal(plan, unitPrice) {
  const price = Number(unitPrice);
  if (!plan || !Number.isFinite(price)) return null;
  return Math.round(plan.count * price * 10000) / 10000;
}
