// Makes provider SVGs safe to inline in the page. Pure string work (no DOM)
// so the same code runs in node tests and in the browser.
//
// Removed: DOCTYPE and entities, comments, processing instructions, script,
// foreignObject and other embedding elements, every on* handler, any
// href/src that is not a local "#id" or an inline raster data URL, and
// external url() references in style attributes and <style> blocks.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Elements removed with their contents.
const BLOCKED_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'handler', 'annotation-xml'];
// Attributes that may point somewhere.
const LINK_ATTRIBUTES = new Set(['href', 'xlink:href', 'src', 'data', 'from', 'to', 'values', 'by']);
// Animation targets: only block the ones that can rewrite links.
const LINK_ANIMATION_VALUES = ['href', 'xlink:href'];

const SAFE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]*$/i;
// Matches an opening or self-closing tag; quoted values may contain ">".
const TAG = /<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const decodeEntities = (value) => String(value)
  .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&(?:amp|lt|gt|quot|apos|tab|newline);/gi, ' ');
const compact = (value) => decodeEntities(value).replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();

function safeLink(value) {
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed.startsWith('#')) return true;
  if (SAFE_DATA_URL.test(trimmed)) return true;
  return false;
}

/** Drops @import, external url() references and script-like CSS. */
export function cleanCss(css) {
  return String(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/@charset[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, 'none')
    .replace(/-moz-binding\s*:[^;]*;?/gi, '')
    .replace(/behavior\s*:[^;]*;?/gi, '')
    .replace(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi, (match, _quote, target) => (safeLink(target) ? match : 'none'))
    .replace(/javascript\s*:/gi, '');
}

function cleanAttributes(raw) {
  const kept = [];
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) continue;
    if (compact(value).includes('javascript:') || compact(value).includes('vbscript:')) continue;
    if (lower === 'attributename' && LINK_ANIMATION_VALUES.includes(value.trim().toLowerCase())) return null;
    if (LINK_ATTRIBUTES.has(lower) && !safeLink(value)) continue;
    if (lower === 'style') {
      kept.push(`${name}="${cleanCss(value).replace(/"/g, '&quot;')}"`);
      continue;
    }
    kept.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
  }
  // Boolean attributes without a value are not meaningful in SVG; drop them.
  return kept;
}

/**
 * @param {string} input raw SVG text from a provider or an upload
 * @returns {string|null} safe SVG markup, or null when the text is not an SVG
 */
export function sanitizeSvg(input) {
  if (typeof input !== 'string') return null;
  let text = input.replace(/^﻿/, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '');
  text = text.replace(/<!ENTITY[\s\S]*?>/gi, '');
  text = text.replace(/<\?[\s\S]*?\?>/g, '');
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  const start = text.search(/<svg(?:[\s>/]|$)/i);
  const end = text.toLowerCase().lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end < start) return null;
  text = text.slice(start, end + '</svg>'.length);

  for (const name of BLOCKED_ELEMENTS) {
    const paired = new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}\\s*>`, 'gi');
    const single = new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*\\/?>`, 'gi');
    text = text.replace(paired, '').replace(single, '');
  }

  text = text.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_, attrs, css) => `<style${attrs}>${cleanCss(css)}</style>`);

  const dropped = [];
  text = text.replace(TAG, (whole, name, attrs) => {
    const cleaned = cleanAttributes(attrs);
    if (cleaned === null) {
      dropped.push(name);
      return '';
    }
    const selfClosing = /\/\s*$/.test(attrs) || whole.endsWith('/>');
    return `<${name}${cleaned.length ? ` ${cleaned.join(' ')}` : ''}${selfClosing ? '/' : ''}>`;
  });
  for (const name of new Set(dropped)) text = text.replace(new RegExp(`<\\/${name}\\s*>`, 'gi'), '');

  // A root without a namespace renders inline but not as a standalone file.
  text = text.replace(/^<svg\b([^>]*)>/i, (whole, attrs) => (/\sxmlns=/.test(attrs) ? whole : `<svg xmlns="${SVG_NS}"${attrs}>`));
  return text;
}

/** True when the text looks like SVG markup (used before fetching more). */
export function isSvgText(text) {
  return typeof text === 'string' && /^\s*(?:<\?xml[^>]*>\s*)?(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:[\s>/]|$)/i.test(text);
}

/**
 * Reads the root element's size. Returns a viewBox always (built from
 * width/height when the file has none), and the intrinsic width/height when
 * the file states them in px.
 * @returns {{ viewBox: [number, number, number, number], width: number|null, height: number|null }}
 */
export function svgDimensions(svg) {
  const root = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(String(svg || ''));
  const attrs = {};
  for (const match of (root?.[1] || '').matchAll(ATTRIBUTE)) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  const length = (value) => {
    const number = parseFloat(String(value ?? '').trim());
    return Number.isFinite(number) && number > 0 && !/%$/.test(String(value).trim()) ? number : null;
  };
  const width = length(attrs.width);
  const height = length(attrs.height);
  const box = String(attrs.viewbox || '').trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    return { viewBox: box, width, height };
  }
  return { viewBox: [0, 0, width || 1024, height || width || 1024], width, height };
}

/** The markup between the root <svg> tags. */
export function svgInner(svg) {
  const text = String(svg || '');
  const open = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(text);
  const close = text.toLowerCase().lastIndexOf('</svg>');
  if (!open || close === -1) return '';
  return text.slice(open.index + open[0].length, close).trim();
}
