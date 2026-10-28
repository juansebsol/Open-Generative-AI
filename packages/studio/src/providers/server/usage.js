// Turns the token usage a direct provider reports after a run into the
// amount it will bill, using the rates in catalog/prices.js. Returned to the
// client as `cost` so the spend ledger records the real figure instead of
// the quote. null when the response carried no usage.

import { PRICES } from '../catalog/prices.js';

const round = (value) => Math.round(value * 1_000_000) / 1_000_000;
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** OpenAI Images API: `usage` on /images/generations and /images/edits. */
export function openaiUsageCost(model, usage) {
  if (!usage || typeof usage !== 'object') return null;
  const entry = PRICES.openai[String(model || '').replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (!entry?.rate) return null;
  const details = usage.input_tokens_details || {};
  const textIn = count(details.text_tokens ?? (details.image_tokens === undefined ? usage.input_tokens : 0));
  const imageIn = count(details.image_tokens);
  const out = count(usage.output_tokens);
  if (!out && !textIn && !imageIn) return null;
  return round(out * entry.rate + textIn * (entry.inputRate || 0) + imageIn * (entry.imageInputRate || 0));
}

/** Gemini: `usageMetadata` on generateContent. Image output tokens are listed per modality. */
export function googleUsageCost(model, usage) {
  if (!usage || typeof usage !== 'object') return null;
  const entry = PRICES.google[String(model || '')];
  if (!entry?.rate) return null;
  const byModality = (list, modality) => (Array.isArray(list) ? list : [])
    .filter((item) => String(item?.modality || '').toUpperCase() === modality)
    .reduce((sum, item) => sum + count(item.tokenCount), 0);
  const imageOut = byModality(usage.candidatesTokensDetails, 'IMAGE') || count(usage.candidatesTokenCount);
  const promptTokens = count(usage.promptTokenCount);
  if (!imageOut && !promptTokens) return null;
  return round(imageOut * entry.rate + promptTokens * (entry.inputRate || 0));
}

/**
 * Chat completions that write SVG (catalog/chatRoutes.js): OpenRouter
 * reports the charge itself in `usage.cost`; Google's and OpenAI's
 * OpenAI-style `usage` carries token counts, priced at the table rates.
 * @param {string} catalogId the svg-* slug the rates are keyed by
 */
export function chatUsageCost(catalogId, usage) {
  if (!usage || typeof usage !== 'object') return null;
  if (Number.isFinite(Number(usage.cost)) && usage.cost !== null) return round(Number(usage.cost));
  const entry = PRICES.chat[String(catalogId || '')];
  if (!entry) return null;
  const input = count(usage.prompt_tokens ?? usage.input_tokens);
  const output = count(usage.completion_tokens ?? usage.output_tokens);
  if (!input && !output) return null;
  return round(input * entry.input + output * entry.output);
}

/** Sums per-call costs; null unless every call reported one. */
export function sumCosts(costs) {
  if (costs.length === 0 || costs.some((cost) => cost === null || cost === undefined)) return null;
  return round(costs.reduce((sum, cost) => sum + cost, 0));
}
