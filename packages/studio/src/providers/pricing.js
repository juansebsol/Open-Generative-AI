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
  'prompt_characters', 'source_characters',
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
  // Which providers could serve it, so the chip can say whose key is missing.
  if (!route) return { kind: 'noProvider', endpoint, providers: [...new Set(getRoutes(endpoint).map((candidate) => candidate.provider))] };
  if (getProvider(route.provider)?.kind === 'local') return { kind: 'free', provider: route.provider, endpoint: route.endpoint };
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

// Providers whose quotes are published list prices and need no key, in the
// order the Benchmarks page prefers them when the visitor has no key at all.
export const LIST_PRICE_PROVIDERS = ['google', 'openai', 'elevenlabs', 'openrouter'];

const listPriceProvider = (endpoint) => {
  const routes = getRoutes(endpoint);
  return LIST_PRICE_PROVIDERS.find((candidate) => routes.some((route) => route.provider === candidate)) || null;
};

async function postQuotes(provider, requests, key) {
  const response = await fetch('/api/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-provider-key': key } : {}) },
    body: JSON.stringify({ provider, requests }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `Price lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return Array.isArray(data?.quotes) ? data.quotes : [];
}

/**
 * Quotes many runs at once: one request per provider, so fal's pricing API
 * is asked for whole batches instead of one endpoint at a time. Results come
 * back in the order of `items`; a run that could not be quoted is
 * { kind: 'error', status, message } rather than a thrown error, so the rest
 * of the batch still resolves. Quotes share quoteRun's cache.
 * @param {Array<{ endpoint: string, payload?: object }>} items
 * @param {{ listPrices?: boolean }} [options] also quote runs no keyed
 *   provider serves from a published list price (marked `listOnly`)
 */
export async function quoteRuns(items, { listPrices = false } = {}) {
  const results = new Array(items.length);
  const groups = new Map();
  const queue = (provider, index, endpoint, inputs, cacheKey, key, listOnly) => {
    const hit = cache.get(cacheKey);
    if (hit && hit.until > Date.now()) {
      results[index] = hit.quote;
      return;
    }
    if (!groups.has(provider)) groups.set(provider, { key, listOnly, batch: [] });
    groups.get(provider).batch.push({ index, endpoint, inputs, cacheKey });
  };
  items.forEach((item, index) => {
    const route = routeFor(item.endpoint);
    const inputs = pricedInputs(item.payload || {});
    if (!route) {
      const providers = [...new Set(getRoutes(item.endpoint).map((candidate) => candidate.provider))];
      results[index] = { kind: 'noProvider', endpoint: item.endpoint, providers };
      const provider = listPrices ? listPriceProvider(item.endpoint) : null;
      if (provider) queue(`list:${provider}`, index, item.endpoint, inputs, `list|${provider}|${item.endpoint}|${JSON.stringify(inputs)}`, '', true);
      return;
    }
    if (getProvider(route.provider)?.kind === 'local') {
      results[index] = { kind: 'free', provider: route.provider, endpoint: route.endpoint };
      return;
    }
    queue(route.provider, index, item.endpoint, inputs, `${route.provider}|${item.endpoint}|${JSON.stringify(inputs)}`, getProviderKey(route.provider), false);
  });
  await Promise.all([...groups].map(async ([group, { key, listOnly, batch }]) => {
    const provider = group.replace(/^list:/, '');
    let quotes;
    try {
      quotes = await postQuotes(provider, batch.map(({ endpoint, inputs }) => ({ endpoint, payload: inputs })), key);
    } catch (error) {
      for (const item of batch) results[item.index] = { kind: 'error', status: error.status, message: error.message };
      return;
    }
    batch.forEach((item, position) => {
      const quote = quotes[position];
      if (!quote || quote.error) {
        results[item.index] = { kind: 'error', status: quote?.status, message: quote?.error || 'No quote returned' };
        return;
      }
      const marked = listOnly ? { ...quote, listOnly: true } : quote;
      cache.set(item.cacheKey, { quote: marked, until: Date.now() + CACHE_TTL_MS });
      results[item.index] = marked;
    });
  }));
  return results;
}

/**
 * The published list price of an endpoint when none of the visitor's keyed
 * providers serves it: Google, OpenAI and ElevenLabs quote from the price
 * table and OpenRouter from its public model list, so no key is needed.
 * Resolves to null when the endpoint has no list-price route. The quote is
 * marked `listOnly` so the page can say it is not what a run would go through.
 */
export async function quoteListPrice(endpoint, payload = {}) {
  const provider = listPriceProvider(endpoint);
  if (!provider) return null;
  const inputs = pricedInputs(payload);
  const cacheKey = `list|${provider}|${endpoint}|${JSON.stringify(inputs)}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.quote;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const request = postQuote({ provider }, endpoint, inputs)
    .then((quote) => {
      const marked = { ...quote, listOnly: true };
      cache.set(cacheKey, { quote: marked, until: Date.now() + CACHE_TTL_MS });
      return marked;
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

// When the rate behind a table price was last confirmed.
function freshness(quote, copy, locale) {
  if (quote.rateCheckedAt) {
    const minutes = Math.max(0, Math.round((Date.now() - quote.rateCheckedAt) / 60000));
    const source = quote.rateSource === 'openrouter' ? 'OpenRouter' : quote.rateSource;
    return [fill(minutes < 1 ? copy.rateJustChecked : copy.rateChecked, { minutes: new Intl.NumberFormat(locale).format(minutes), source })];
  }
  if (quote.asOf) return [fill(copy.asOf, { date: quote.asOf })];
  return [];
}

// "ComfyUI (local)" is "ComfyUI" in the chip.
export const providerName = (id) => (getProvider(id)?.label || id || '').replace(/\s*\(.*\)$/, '');

const listNames = (ids, locale) => {
  const names = ids.map(providerName);
  try {
    return new Intl.ListFormat(locale, { type: 'disjunction' }).format(names);
  } catch {
    return names.join(' / ');
  }
};

/**
 * Turns a quote into the chip's text: `provider` (who runs it), `label`
 * (the price) and `title` (the tooltip, which names the provider's endpoint).
 * @returns {{ provider: string, label: string, title: string, tone: 'muted'|'ok'|'warn' } | null}
 */
export function describeQuote(quote, copy, locale = 'en') {
  if (!quote) return null;
  if (quote.kind === 'noProvider') {
    const providers = quote.providers || [];
    if (providers.length === 0) return null;
    return { provider: '', label: copy.noProvider, tone: 'warn', title: `${fill(copy.noProviderTitle, { providers: listNames(providers, locale) })} ${copy.change}` };
  }
  const name = providerName(quote.provider);
  const number = (value) => new Intl.NumberFormat(locale).format(value);
  const runsOn = fill(copy.runsOn, { provider: name, endpoint: quote.endpoint || '' });
  const described = describePrice(quote, copy, locale, number, name);
  if (!described) return null;
  return { provider: name, ...described, title: [runsOn, described.title, copy.change].filter(Boolean).join(' · ') };
}

function describePrice(quote, copy, locale, number, providerName) {
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
      if (quote.characters !== undefined) details.push(fill(copy.characters, { count: number(quote.characters) }));
      if (quote.tier) details.push(fill(quote.assumed ? copy.assumedTier : copy.tier, { tier: quote.tier }));
      if (quote.listOf) details.push(fill(copy.listOf, { provider: getProvider(quote.listOf)?.label || quote.listOf }));
      if (quote.partial) details.push(copy.partial);
      details.push(...freshness(quote, copy, locale));
      if (quote.note) details.push(quote.note);
      return { ...base, label, title: [base.title, ...details].join(' · ') };
    }
    case 'unit':
      return { ...base, label: fill(copy.perUnit, { amount: formatMoney(quote.unitPrice, quote.currency, locale), unit: copy.units[quote.unit] || quote.unit }) };
    case 'tokens':
      return { ...base, label: fill(copy.perMillionTokens, { amount: formatMoney(quote.perMillion, quote.currency, locale) }), title: [base.title, ...freshness(quote, copy, locale), quote.note].filter(Boolean).join(' · ') };
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
