// Which catalog models the Design Agent uses, preferring ones the visitor's
// configured providers can run.

import { i2iModels, t2iModels } from '../models.js';
import { isEndpointAvailable } from '../providers/client.js';
import { quoteRuns } from '../providers/pricing.js';

const IMAGE_PREFERENCE = ['nano-banana-pro', 'nano-banana-2', 'gpt-image-2', 'nano-banana-2-1', 'gpt-image-1.5', 'nano-banana'];
const EDIT_PREFERENCE = ['nano-banana-pro-edit', 'nano-banana-2-edit', 'gpt-image-2-edit', 'nano-banana-2-1-edit', 'gpt-image-1.5-edit', 'nano-banana-edit'];
const UPSCALERS = ['seedvr2-image-upscale', 'ai-image-upscale', 'topaz-image-upscale'];

const editCapable = i2iModels.filter((model) => model.hasPrompt);

export const endpointOf = (model) => model?.endpoint || model?.id;
export const modelAvailable = (model) => Boolean(model) && isEndpointAvailable(endpointOf(model));

function pick(models, preference, overrideId) {
  if (overrideId) {
    const chosen = models.find((model) => model.id === overrideId);
    if (modelAvailable(chosen)) return chosen;
  }
  const preferred = preference.map((id) => models.find((model) => model.id === id)).filter(Boolean);
  return preferred.find(modelAvailable) || models.find(modelAvailable) || null;
}

export const pickImageModel = (overrideId) => pick(t2iModels, IMAGE_PREFERENCE, overrideId);
export const pickEditModel = (overrideId) => pick(editCapable, EDIT_PREFERENCE, overrideId);
export const pickUpscaler = () => UPSCALERS.find(isEndpointAvailable) || null;
export const canRemoveBackground = () => isEndpointAvailable('ai-background-remover');
export const canExpand = () => isEndpointAvailable('ai-image-extension');

export const availableImageModels = () => t2iModels.filter(modelAvailable);
export const availableEditModels = () => editCapable.filter(modelAvailable);

/** How many images an edit model accepts in one request. */
export function maxEditImages(model) {
  if (model?.imageField !== 'images_list') return 1;
  return Math.max(1, model.maxImages || 4);
}

/** The model's highest resolution option at or above 2k, if it has one. */
export function highResolutionOption(model) {
  const options = model?.inputs?.resolution?.enum || [];
  return options.find((value) => /^4k$/i.test(value)) || options.find((value) => /^2k$/i.test(value)) || null;
}

const toolName = (id) => i2iModels.find((model) => model.id === id)?.name || id;

/**
 * What one paid tool call would run on now, for pricing it ahead of time:
 * the endpoint, the inputs its price depends on and a name to show. Follows
 * the studio's tools, which fall back to the edit model when no dedicated
 * upscaler, background remover or outpainter is available.
 * @returns {{ endpoint: string, payload: object, name: string } | null}
 */
export function paidStepRoute(tool, { imageModelId = '', editModelId = '', aspect = '' } = {}) {
  const viaEdit = (payload = {}) => {
    const model = pickEditModel(editModelId);
    return model ? { endpoint: endpointOf(model), payload: { num_images: 1, ...payload }, name: model.name } : null;
  };
  const dedicated = (endpoint) => ({ endpoint, payload: {}, name: toolName(endpoint) });
  switch (tool) {
    case 'generate_image': {
      const model = pickImageModel(imageModelId);
      return model ? { endpoint: endpointOf(model), payload: { num_images: 1, ...(aspect ? { aspect_ratio: aspect } : {}) }, name: model.name } : null;
    }
    case 'edit_image':
      return viaEdit();
    case 'upscale': {
      const upscaler = pickUpscaler();
      if (upscaler) return { ...dedicated(upscaler), payload: { resolution: '4k', upscale_factor: 2 } };
      const resolution = highResolutionOption(pickEditModel(editModelId));
      return resolution ? viaEdit({ resolution }) : null;
    }
    case 'remove_background':
      return canRemoveBackground() ? dedicated('ai-background-remover') : viaEdit();
    case 'expand_image':
      // The agent usually asks for an aspect ratio, which goes through the edit model.
      return viaEdit() || (canExpand() ? dedicated('ai-image-extension') : null);
    default:
      return null;
  }
}

// One run's price from a quote, or null when it has none per run.
function runPrice(quote) {
  if (quote?.kind === 'free') return 0;
  if (quote?.kind === 'total') return quote.amount;
  if (quote?.kind === 'unit' && ['image', 'run', 'request'].includes(quote.unit)) return quote.unitPrice;
  return null;
}

/**
 * Adds up a plan's quoted lines ({ name, count, quote }) into
 * { amount, currency, partial, lines: [{ name, count, each }] }, where `each`
 * is one run's price or null. `partial` is true when a step has no price (or
 * only a minimum), so the total is a floor. Null when nothing could be priced
 * or the currencies differ.
 */
export function addUpQuotes(lines, unpriced = 0) {
  let amount = 0;
  let currency = null;
  let priced = 0;
  let partial = unpriced > 0;
  const priceLines = [];
  for (const { name, count, quote } of lines) {
    const each = runPrice(quote);
    priceLines.push({ name, count, each: Number.isFinite(each) ? each : null });
    if (!Number.isFinite(each)) {
      partial = true;
      continue;
    }
    if (quote.kind !== 'free') {
      const lineCurrency = quote.currency || 'USD';
      if (currency && lineCurrency !== currency) return null;
      currency = lineCurrency;
    }
    if (quote.partial) partial = true;
    amount += each * count;
    priced += 1;
  }
  if (priced === 0) return null;
  return { amount: Math.round(amount * 10000) / 10000, currency: currency || 'USD', partial, lines: priceLines };
}

/**
 * Prices a plan's paid steps (tool names, one per call) on the models they
 * would run on now. Resolves to addUpQuotes' total, or null.
 */
export async function estimatePlan(paidSteps, options = {}) {
  const groups = new Map();
  let unrouted = 0;
  for (const tool of paidSteps) {
    const route = paidStepRoute(tool, options);
    if (!route) {
      unrouted += 1;
      continue;
    }
    const key = `${route.endpoint}|${JSON.stringify(route.payload)}`;
    const group = groups.get(key) || { ...route, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  const lines = [...groups.values()];
  if (lines.length === 0) return null;
  const quotes = await quoteRuns(lines.map(({ endpoint, payload }) => ({ endpoint, payload })));
  return addUpQuotes(lines.map((line, index) => ({ name: line.name, count: line.count, quote: quotes[index] })), unrouted);
}
