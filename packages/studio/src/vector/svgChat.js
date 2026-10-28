// Code-written SVG: a chat model writes the markup itself. This module is
// the pure part (no network, no React) shared by the server route, the
// price estimate and the tests: the prompts, the reply parser and the token
// estimate. The model's markup always goes through svgSanitize.js before it
// is stored or shown.

import { normalizePalette } from './palettes.js';

// The chip's estimate: a logo or icon SVG written by a chat model is
// usually 600 to 2,000 tokens; the system prompt below is about 400.
export const SVG_OUTPUT_TOKENS = 1200;
export const SVG_SYSTEM_TOKENS = 400;
export const SVG_MAX_TOKENS = 16000;
// Models that think before answering bill the thinking as output; the
// estimate cannot see it, so the note says so.
export const SVG_ESTIMATE_NOTE = `Per-token estimate for about ${SVG_OUTPUT_TOKENS} output tokens per SVG; the model decides the real length, and thinking tokens are billed on top.`;

const PAGE_BRIEFS = {
  logo: 'The user wants a logo mark or wordmark: one composed, balanced mark on a 512×512 canvas, centred, with generous margins, built from a few clean shapes.',
  icons: 'The user wants one icon of an icon set: a single pictogram on a 24×24 grid (viewBox="0 0 24 24"), centred, consistent stroke width, optically balanced, designed to sit next to other icons in the same style.',
};

export const SVG_SYSTEM_RULES = `You write SVG by hand: clean, editable vector markup that opens in Figma, Illustrator and Inkscape without fixes.

Rules (all mandatory):
1. Reply with exactly one complete <svg> document and nothing else: no explanation, no markdown fence, no comments before or after it.
2. The root element carries xmlns="http://www.w3.org/2000/svg" and a viewBox. Do not set width or height on the root.
3. Draw with <path>, <circle>, <rect>, <ellipse>, <polygon>, <polyline> and <line>. Use <g> to group parts and give every group a short descriptive id (for example id="mark", id="leaf-left"). Keep ids unique.
4. No <script>, no <foreignObject>, no <image>, no external references of any kind (no href to a URL, no @import, no web fonts, no CSS url()). Local references to your own <defs> ids are fine.
5. Text: avoid <text> unless the user asks for a wordmark. If you must letter something, keep it to a system font-family stack and short.
6. Use the palette exactly as given; when none is given, choose at most three colours. Prefer flat fills; a gradient only when asked. No filters, no masks unless essential.
7. Geometry must be deliberate: snap to whole or half units, align to the canvas centre, keep stroke widths consistent, close every path. No random noise, no hundreds of tiny shapes.
8. Keep the file under about 150 lines.`;

/** The palette line for the prompt, or '' for "model's choice". */
export function paletteInstruction(palette) {
  const { colors, background } = normalizePalette(palette);
  if (!colors.length && !background) return '';
  const parts = [];
  if (colors.length) parts.push(`Use only these colours for the artwork: ${colors.join(', ')}.`);
  parts.push(background ? `Fill the canvas with a ${background} background rectangle as the first element.` : 'Leave the background transparent.');
  return parts.join(' ');
}

export function buildSvgSystemPrompt({ page = 'logo', palette = null } = {}) {
  const brief = PAGE_BRIEFS[page] || PAGE_BRIEFS.logo;
  const colours = paletteInstruction(palette);
  return [SVG_SYSTEM_RULES, brief, colours].filter(Boolean).join('\n\n');
}

/**
 * Messages for a fresh SVG.
 * @param {{ prompt: string, page?: 'logo'|'icons', palette?: object|null }} input
 */
export function buildSvgMessages({ prompt, page = 'logo', palette = null }) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('A prompt is required');
  return [
    { role: 'system', content: buildSvgSystemPrompt({ page, palette }) },
    { role: 'user', content: `Draw: ${text}\n\nReply with the SVG only.` },
  ];
}

/**
 * Messages for a refinement: the current SVG plus what to change.
 * @param {{ svg: string, instruction: string, page?: string, palette?: object|null }} input
 */
export function buildRefineMessages({ svg, instruction, page = 'logo', palette = null }) {
  const current = String(svg || '').trim();
  const change = String(instruction || '').trim();
  if (!current) throw new Error('The current SVG is required');
  if (!change) throw new Error('Say what to change');
  return [
    { role: 'system', content: buildSvgSystemPrompt({ page, palette }) },
    {
      role: 'user',
      content: `Here is the current SVG:\n\n${current}\n\nChange it as follows, keeping everything else (composition, ids, palette) the same: ${change}\n\nReply with the complete updated SVG only.`,
    },
  ];
}

export class SvgOutputError extends Error {
  constructor(message = 'The model did not return an SVG. Try again or rephrase the prompt.') {
    super(message);
    this.name = 'SvgOutputError';
  }
}

/**
 * The first <svg>…</svg> in a model reply, tolerating markdown fences and
 * chatter around it. Throws SvgOutputError when there is none.
 */
export function extractSvg(content) {
  const text = String(content || '');
  const fenced = /```(?:svg|xml|html)?\s*([\s\S]*?)```/i.exec(text);
  const source = fenced && /<svg[\s>]/i.test(fenced[1]) ? fenced[1] : text;
  const start = source.search(/<svg(?:[\s>/]|$)/i);
  if (start === -1) throw new SvgOutputError();
  const after = source.slice(start);
  const close = after.search(/<\/svg\s*>/i);
  if (close === -1) throw new SvgOutputError('The model stopped before finishing the SVG. Try again or ask for something simpler.');
  const end = close + after.slice(close).indexOf('>') + 1;
  return after.slice(0, end).trim();
}

const tokensOf = (characters) => Math.ceil(Math.max(0, Number(characters) || 0) / 4);

/**
 * The token budget the price chip assumes for one SVG.
 * @param {{ prompt_characters?: number, prompt?: string, source_characters?: number, num_images?: number }} payload
 * @returns {{ input: number, output: number, count: number }}
 */
export function estimateSvgTokens(payload = {}) {
  const promptCharacters = Number.isFinite(Number(payload.prompt_characters)) ? Number(payload.prompt_characters) : String(payload.prompt || '').length;
  const sourceCharacters = Number(payload.source_characters) || 0;
  const count = Math.max(1, Math.round(Number(payload.num_images) || 1));
  return {
    input: SVG_SYSTEM_TOKENS + tokensOf(promptCharacters) + tokensOf(sourceCharacters),
    output: SVG_OUTPUT_TOKENS,
    count,
  };
}
