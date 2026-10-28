// Builds one SVG sprite from a set of icons: every icon becomes a <symbol>
// with a stable id, so a page can draw it with <use href="#icon-name">.
// Internal ids (gradients, clip paths) are prefixed per symbol so icons
// from separate files cannot collide.

import { svgDimensions, svgInner } from './svgSanitize.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** "Home Outline" -> "home-outline"; empty names become "icon". */
export function slugify(name) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'icon';
}

/**
 * A unique symbol id for a name: "icon-home", then "icon-home-2", … while
 * `used` already holds the earlier ones. Adds the result to `used`.
 */
export function symbolId(name, used = new Set(), prefix = 'icon') {
  const base = `${prefix}-${slugify(name)}`;
  let id = base;
  for (let counter = 2; used.has(id); counter += 1) id = `${base}-${counter}`;
  used.add(id);
  return id;
}

// Rewrites id="x" and every #x reference so two icons can share a document.
function namespaceIds(markup, prefix) {
  const ids = new Set();
  for (const match of markup.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)) ids.add(match[1]);
  if (ids.size === 0) return markup;
  let out = markup;
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`(\\sid\\s*=\\s*["'])${escaped}(["'])`, 'g'), `$1${prefix}-${id}$2`)
      .replace(new RegExp(`url\\(\\s*(["']?)#${escaped}\\1\\s*\\)`, 'g'), `url(#${prefix}-${id})`)
      .replace(new RegExp(`(href\\s*=\\s*["'])#${escaped}(["'])`, 'g'), `$1#${prefix}-${id}$2`);
  }
  return out;
}

/**
 * @param {{ name: string, svg: string }[]} icons sanitised SVG per icon
 * @param {{ prefix?: string }} [options]
 * @returns {{ sprite: string, symbols: { id: string, name: string, viewBox: string }[], usage: string }}
 */
export function buildSprite(icons, { prefix = 'icon' } = {}) {
  const used = new Set();
  const symbols = [];
  const parts = [];
  for (const icon of icons || []) {
    if (!icon?.svg) continue;
    const id = symbolId(icon.name, used, prefix);
    const { viewBox } = svgDimensions(icon.svg);
    const viewBoxText = viewBox.join(' ');
    const inner = namespaceIds(svgInner(icon.svg), id);
    parts.push(`<symbol id="${id}" viewBox="${viewBoxText}">${inner}</symbol>`);
    symbols.push({ id, name: icon.name, viewBox: viewBoxText });
  }
  const sprite = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" style="display:none">${parts.join('')}</svg>`;
  const usage = symbols.length ? `<svg width="24" height="24"><use href="#${symbols[0].id}"/></svg>` : '';
  return { sprite, symbols, usage };
}

/** File name for one icon inside a zip: "home-outline.svg". */
export function iconFileName(name, used = new Set()) {
  return `${symbolId(name, used, '').replace(/^-/, '')}.svg`;
}
