// A small, dependency-free clean-up pass run before every export: strips
// editor metadata and comments, drops empty containers, trims coordinate
// precision and collapses whitespace. Not a full optimiser (no path
// merging), but typically 10 to 40 % smaller and still the same picture.

const EDITOR_PREFIXES = ['inkscape', 'sodipodi', 'illustrator', 'sketch', 'figma', 'serif', 'xap', 'rdf', 'cc', 'dc', 'i'];
const EDITOR_ATTRIBUTES = /\s(?:xml:space|data-name|enable-background|xmlns:(?:inkscape|sodipodi|rdf|cc|dc|xap|x|i|serif|sketch|figma|ns\d+)|(?:inkscape|sodipodi|serif|sketch|figma|i):[\w.-]+|version)\s*=\s*(?:"[^"]*"|'[^']*')/g;
const NUMERIC_ATTRIBUTES = /\s(d|points|transform|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|dx|dy|offset|stroke-width|stroke-dashoffset)\s*=\s*"([^"]*)"/g;

function roundNumbers(value, precision) {
  return value.replace(/-?\d*\.\d+(?:e-?\d+)?/gi, (number) => {
    const rounded = Number(Number(number).toFixed(precision));
    return Number.isFinite(rounded) ? String(rounded) : number;
  });
}

/**
 * @param {string} svg
 * @param {{ precision?: number, keepTitle?: boolean }} [options]
 * @returns {string}
 */
export function optimizeSvg(svg, { precision = 3, keepTitle = true } = {}) {
  let out = String(svg || '');
  out = out.replace(/^﻿/, '');
  out = out.replace(/<\?xml[\s\S]*?\?>/gi, '');
  out = out.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<metadata\b[^>]*>[\s\S]*?<\/metadata\s*>/gi, '');
  if (!keepTitle) out = out.replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const prefix of EDITOR_PREFIXES) {
    out = out.replace(new RegExp(`<${prefix}:[\\w.-]+\\b[^>]*>[\\s\\S]*?<\\/${prefix}:[\\w.-]+\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`<${prefix}:[\\w.-]+\\b[^>]*\\/>`, 'gi'), '');
  }
  out = out.replace(EDITOR_ATTRIBUTES, '');
  out = out.replace(NUMERIC_ATTRIBUTES, (_, name, value) => ` ${name}="${roundNumbers(value, precision).replace(/\s+/g, ' ').trim()}"`);
  // Containers left empty by the passes above.
  for (let pass = 0; pass < 3; pass += 1) {
    out = out.replace(/<(defs|g|switch)\b[^>]*>\s*<\/\1\s*>/gi, '');
  }
  out = out.replace(/<(g|defs|symbol|clipPath|mask|pattern|marker|linearGradient|radialGradient|filter|a|switch)\b([^>]*)\/>/gi, '');
  // Whitespace: between tags, inside tags, and at the ends. Text content
  // inside <text> keeps its spaces.
  const texts = [];
  out = out.replace(/<text\b[^>]*>[\s\S]*?<\/text\s*>/gi, (block) => `\u0000${texts.push(block) - 1}\u0000`);
  out = out.replace(/>\s+</g, '><');
  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/\s+\/>/g, '/>').replace(/\s+>/g, '>');
  out = out.replace(/\s*\u0000(\d+)\u0000\s*/g, (_, index) => texts[Number(index)]);
  return out.trim();
}

/** Bytes before and after, as the export dialog reports them. */
export function optimizeStats(before, after) {
  const encoder = typeof TextEncoder === 'undefined' ? null : new TextEncoder();
  const size = (text) => (encoder ? encoder.encode(String(text || '')).length : String(text || '').length);
  const from = size(before);
  const to = size(after);
  return { from, to, saved: Math.max(0, from - to), percent: from ? Math.round(((from - to) / from) * 100) : 0 };
}
