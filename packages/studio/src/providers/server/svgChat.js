// Code-written SVG for the Vector pages: asks a chat model (Gemini, Claude
// via OpenRouter, GPT) for one SVG, pulls the markup out of the reply and
// sanitises it before it goes back to the browser. One call makes one SVG;
// the studio asks several times for several candidates, and the same call
// with `refine` sends an existing SVG back with an instruction.

import { findRoute } from '../catalog/index.js';
import { isChatSvgEndpoint } from '../catalog/chatRoutes.js';
import { SVG_MAX_TOKENS, SvgOutputError, buildRefineMessages, buildSvgMessages, extractSvg } from '../../vector/svgChat.js';
import { sanitizeSvg } from '../../vector/svgSanitize.js';
import { chatCompletion } from './chat.js';
import { ProviderError } from './http.js';
import { chatUsageCost } from './usage.js';

const MAX_PROMPT = 4000;
const MAX_SOURCE_SVG = 200_000;
const PAGES = new Set(['logo', 'icons']);

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * @param {{ provider: string, key: string, origin?: string, model: string, prompt?: string, page?: string,
 *   palette?: { colors?: string[], background?: string|null }|null, refine?: { svg: string, instruction: string }|null }} input
 * @returns {Promise<{ svg: string, model: string, usage: { input: number, output: number }|null, cost: number|null }>}
 */
export async function generateSvgChat({ provider, key, origin, model, prompt, page, palette, refine }) {
  if (typeof model !== 'string' || !isChatSvgEndpoint(model)) throw new ProviderError('Unknown SVG model', { status: 400 });
  const route = findRoute(model, provider);
  if (!route) throw new ProviderError(`${model} is not available on ${provider}`, { status: 400 });
  const pageId = PAGES.has(page) ? page : 'logo';
  const colours = palette && typeof palette === 'object' ? { colors: Array.isArray(palette.colors) ? palette.colors : [], background: palette.background ?? null } : null;

  let messages;
  if (refine && typeof refine === 'object') {
    const source = text(refine.svg, MAX_SOURCE_SVG);
    const instruction = text(refine.instruction, MAX_PROMPT);
    if (!source || !instruction) throw new ProviderError('A current SVG and an instruction are required to refine', { status: 400 });
    messages = buildRefineMessages({ svg: source, instruction, page: pageId, palette: colours });
  } else {
    const wanted = text(prompt, MAX_PROMPT);
    if (!wanted) throw new ProviderError('A prompt is required', { status: 400 });
    messages = buildSvgMessages({ prompt: wanted, page: pageId, palette: colours });
  }

  const result = await chatCompletion({
    provider,
    key,
    origin,
    body: { model: route.endpoint, messages, temperature: 0.7, max_tokens: SVG_MAX_TOKENS },
  });

  let svg;
  try {
    svg = sanitizeSvg(extractSvg(result.message?.content));
  } catch (error) {
    if (error instanceof SvgOutputError) throw new ProviderError(error.message, { provider, status: 502 });
    throw error;
  }
  if (!svg) throw new ProviderError('The model returned markup that is not a valid SVG. Try again or rephrase the prompt.', { provider, status: 502 });

  const usage = result.usage && typeof result.usage === 'object'
    ? { input: Number(result.usage.prompt_tokens ?? result.usage.input_tokens) || 0, output: Number(result.usage.completion_tokens ?? result.usage.output_tokens) || 0 }
    : null;
  return { svg, model: result.model || route.endpoint, usage, cost: chatUsageCost(model, result.usage) };
}
