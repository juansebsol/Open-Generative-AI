// Browser side of per-run pricing: picks the provider the run would use,
// asks /api/price for a quote, caches it briefly, and turns quotes into
// text for the price chip. Nothing here charges anything.

import { getRoutes } from './catalog/index.js';
import { getProvider } from './directProviders.js';
import { configuredProviders, getProviderKey } from './keys.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();
const inflight = new Map();

/** Which provider a run of this endpoint would go to, or null when none is set up. */
export function routeFor(endpoint) {
  const routes = getRoutes(endpoint);
  if (routes.length === 0) return null;
  const configured = configuredProviders();
  for (const provider of configured) {
    const route = routes.find((candidate) => candidate.provider === provider);
    if (route) return route;
  }
  return null;
}

// Only the inputs that move the price travel with a quote. Media stays out:
// the server cannot read local files, and sending URLs just to be measured
// is slow. Quotes without media are marked partial.
const PRICED_KEYS = new Set([
  'num_images', 'duration', 'seconds', 'resolution', 'quality', 'aspect_ratio', 'size', 'image_size', 'width', 'height',
  'generate_audio', 'sound', 'with_audio', 'enable_audio', 'audio', 'mode', 'tier', 'model_type', 'texture_quality', 'geometry_quality',
  'should_texture', 'texture', 'quad', 'material', 'bake', 'face_level', 'texture_size', 'texture_resolution', 'target_polycount',
  'upscale_factor', 'fps', 'frames', 'num_frames', 'steps', 'num_inference_steps', 'batch_size', 'n', 'output_format', 'voice_id',
  'text', 'dialogue', 'dialogue_turns', 'inputs', 'prompt', 'version', 'style', 'quality_mode', 'high_bitrate', 'enable_prompt_expansion',
]);

export function pricedInputs(payload = {}) {
  const picked = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!PRICED_KEYS.has(key) || value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' && /^(blob:|data:|local-media:|idb:)/.test(value)) continue;
    picked[key] = value;
  }
  return picked;
}

async function postQuote(route, endpoint, payload) {
  const key = getProviderKey(route.provider);
  const response = await fetch('/api/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-provider-key': key } : {}) },
    body: JSON.stringify({ provider: route.provider, endpoint, payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `Price lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * Quotes one run. Resolves to a quote object:
 *   { kind: 'free' | 'total' | 'unit' | 'tokens' | 'characters' | 'unavailable' | 'noProvider', ... }
 * Never throws for missing providers; network errors do throw.
 * @param {string} endpoint catalog endpoint slug
 * @param {object} payload studio payload (media is stripped unless `full`)
 */
export async function quoteRun(endpoint, payload = {}, { full = false } = {}) {
  const route = routeFor(endpoint);
  if (!route) return { kind: 'noProvider', endpoint };
  if (getProvider(route.provider)?.kind === 'local') return { kind: 'free', provider: route.provider, endpoint };
  const inputs = full ? payload : pricedInputs(payload);
  const cacheKey = `${route.provider}|${endpoint}|${JSON.stringify(inputs)}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.quote;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const request = postQuote(route, endpoint, inputs)
    .then((quote) => {
      cache.set(cacheKey, { quote, until: Date.now() + CACHE_TTL_MS });
      return quote;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, request);
  return request;
}

/** Formats an amount of money for the chip. */
export function formatMoney(amount, currency = 'USD', locale = 'en') {
  const value = Number(amount) || 0;
  const digits = value > 0 && value < 0.01 ? 4 : value < 1 ? 3 : 2;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

/**
 * Turns a quote into the chip's label and tooltip.
 * @returns {{ label: string, title: string, tone: 'muted'|'ok'|'warn' } | null}
 */
export function describeQuote(quote, copy, locale = 'en') {
  if (!quote || quote.kind === 'noProvider') return null;
  const providerName = getProvider(quote.provider)?.label || quote.provider || '';
  const number = (value) => new Intl.NumberFormat(locale).format(value);
  const base = { tone: 'muted', title: fill(copy.title, { provider: providerName }) };
  switch (quote.kind) {
    case 'free':
      return { ...base, label: copy.free, tone: 'ok', title: fill(copy.freeTitle, { provider: providerName }) };
    case 'total': {
      const amount = formatMoney(quote.amount, quote.currency, locale);
      const label = quote.partial ? fill(copy.from, { amount }) : fill(copy.estimate, { amount });
      const details = [];
      if (quote.unitPrice !== undefined && quote.unit) {
        details.push(fill(copy.perUnit, { amount: formatMoney(quote.unitPrice, quote.currency, locale), unit: copy.units[quote.unit] || quote.unit }));
      }
      if (quote.quantity && quote.quantity !== 1) details.push(fill(copy.times, { count: number(quote.quantity) }));
      if (quote.listPrice !== undefined) details.push(fill(copy.listPrice, { amount: formatMoney(quote.listPrice, quote.currency, locale) }));
      if (quote.partial) details.push(copy.partial);
      return { ...base, label, title: [base.title, ...details].join(' · ') };
    }
    case 'unit':
      return { ...base, label: fill(copy.perUnit, { amount: formatMoney(quote.unitPrice, quote.currency, locale), unit: copy.units[quote.unit] || quote.unit }) };
    case 'tokens':
      return { ...base, label: fill(copy.perMillionTokens, { amount: formatMoney(quote.perMillion, quote.currency, locale) }), title: [base.title, quote.note].filter(Boolean).join(' · ') };
    case 'characters':
      return { ...base, label: fill(copy.characters, { count: number(quote.characters) }), title: fill(copy.charactersTitle, { provider: providerName }) };
    default:
      return { ...base, label: copy.unavailable, tone: 'warn', title: fill(copy.unavailableTitle, { provider: providerName }) };
  }
}

/** Test helper. */
export function resetQuoteCache() {
  cache.clear();
  inflight.clear();
}
