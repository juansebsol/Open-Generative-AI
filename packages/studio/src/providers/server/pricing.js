// Per-run price quotes, read before a job is sent so the visitor knows what
// they are agreeing to pay. WaveSpeed and fal quote through their own
// pricing APIs with the visitor's key (account discounts included);
// Google, OpenAI and ElevenLabs have no pricing API, so their quotes come from
// catalog/prices.js (fal's OpenAI and Google models use that table too); the
// per-token rates behind the Google and OpenAI prices are re-read from
// OpenRouter's public model list every PRICE_REFRESH_MINUTES, so a vendor
// price change shows up without a redeploy. Every quote is an estimate: the
// provider's own bill is what counts.

import { createHash } from 'node:crypto';
import { findRoute } from '../catalog/index.js';
import { SCHEMAS } from '../catalog/schemas.generated.js';
import { PRICES, PRICES_UPDATED } from '../catalog/prices.js';
import { mapInput, MappingError } from '../mapper.js';
import { SVG_ESTIMATE_NOTE, estimateSvgTokens } from '../../vector/svgChat.js';
import { ProviderError, requestJson } from './http.js';

export const PRICE_PROVIDER_IDS = ['fal', 'wavespeed', 'openrouter', 'google', 'openai', 'elevenlabs'];

const TIMEOUT_MS = 15_000;
// How often list prices are re-read from the providers (fal unit prices,
// OpenRouter's per-token rates). Minutes, from the environment.
export const refreshMs = () => Math.max(1, Number(process.env.PRICE_REFRESH_MINUTES) || 30) * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MEDIA_KEY = /image|video|audio|url|file|mask|model/i;
// Rough output size by resolution label, for fal endpoints billed per megapixel.
const MEGAPIXELS = { 512: 0.26, '0.5K': 0.26, '1K': 1, '1024': 1, '1.5K': 2.3, '2K': 4.2, '2048': 4.2, '4K': 16.6, '720P': 0.9, '1080P': 2.1 };

const money = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const round = (value) => Math.round(value * 10000) / 10000;

// Small in-memory cache for list prices that rarely change (fal unit prices
// per account, OpenRouter's model list). Quotes that depend on inputs
// (WaveSpeed) are never cached here.
const cache = new Map();
function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { value, until: Date.now() + ttl });
  return value;
}
/** Test helper. */
export function resetPriceCache() {
  cache.clear();
}
const keyFingerprint = (key) => createHash('sha256').update(key).digest('hex').slice(0, 16);

function numberOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function imagesIn(payload) {
  return Math.max(1, Math.round(numberOf(payload.num_images) || 1));
}

function secondsIn(payload) {
  return numberOf(payload.duration) || numberOf(payload.seconds) || numberOf(payload.video_length) || null;
}

function tierLabel(payload) {
  const raw = String(payload.resolution || payload.quality || payload.size || payload.image_size || '').toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('4')) return '4K';
  if (raw.startsWith('2')) return '2K';
  if (raw.startsWith('1.5')) return '1.5K';
  if (raw.startsWith('1')) return '1K';
  if (raw === '512' || raw === '0.5K') return '512';
  return raw;
}

function textIn(payload) {
  const parts = [];
  const push = (value) => {
    if (typeof value === 'string') parts.push(value);
  };
  push(payload.text);
  push(payload.prompt);
  for (const turn of Array.isArray(payload.dialogue) ? payload.dialogue : []) push(turn?.text);
  for (const turn of Array.isArray(payload.dialogue_turns) ? payload.dialogue_turns : []) push(turn?.text);
  for (const turn of Array.isArray(payload.inputs) ? payload.inputs : []) push(turn?.text);
  return parts.join('\n');
}

// ── WaveSpeed: POST /api/v3/model/price with the mapped inputs ──────────────

function wavespeedInputs(route, payload) {
  const schema = SCHEMAS.wavespeed?.[route.endpoint] || null;
  try {
    const { input, missing } = mapInput(payload, route, schema, { allowMissing: true });
    return { input, partial: missing.length > 0 };
  } catch (error) {
    if (error instanceof MappingError) return { input: null, partial: true };
    throw error;
  }
}

async function wavespeedPrice({ endpoint, key, route, payload }) {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const ask = async (body) => {
    const data = await requestJson('wavespeed', 'https://api.wavespeed.ai/api/v3/model/price', {
      method: 'POST', headers, body: JSON.stringify(body), timeoutMs: TIMEOUT_MS,
    });
    return data?.data || {};
  };
  const { input, partial } = route ? wavespeedInputs(route, payload) : { input: null, partial: true };
  let data;
  let fromBase = false;
  try {
    data = await ask(input ? { model_id: endpoint, inputs: input } : { model_id: endpoint });
    fromBase = !input;
  } catch (error) {
    // 4005-4007: the formula could not price these inputs (unreadable media,
    // missing fields). The base price is still a useful floor.
    const code = Number(error.detail?.code);
    if (error.status !== 400 || !(code >= 4005 && code <= 4007)) throw error;
    data = await ask({ model_id: endpoint });
    fromBase = true;
  }
  const list = money(data.price);
  const rate = Number(data.discount_rate);
  const discounted = money(data.discounted_price);
  const amount = Number.isFinite(rate) && rate !== 100 && discounted !== null ? discounted : list;
  if (amount === null) throw new ProviderError('WaveSpeed returned no price', { provider: 'wavespeed', status: 502 });
  return {
    kind: 'total',
    amount: round(amount),
    currency: data.currency || 'USD',
    partial: partial || fromBase,
    ...(list !== null && list !== amount ? { listPrice: round(list) } : {}),
    source: 'wavespeed',
  };
}

// ── fal: GET /v1/models/pricing, then multiply by what the run will use ──────

async function falUnitPrice(endpoint, key) {
  return cached(falCacheKey(key, endpoint), refreshMs(), async () => {
    const body = await requestJson('fal', `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, {
      headers: { Authorization: `Key ${key}` },
      timeoutMs: TIMEOUT_MS,
    });
    const price = (body?.prices || []).find((item) => item.endpoint_id === endpoint) || body?.prices?.[0];
    if (!price || money(price.unit_price) === null) return null;
    return { unitPrice: Number(price.unit_price), unit: String(price.unit || ''), currency: price.currency || 'USD' };
  });
}

// fal's pricing API takes up to 50 endpoint ids per call and rate-limits
// bursts, so a page that prices many models asks for them in chunks and
// seeds the same per-endpoint cache that single quotes read.
const FAL_BATCH = 50;
const falCacheKey = (key, endpoint) => `fal:${keyFingerprint(key)}:${endpoint}`;
const unitPriceFrom = (body, endpoint) => {
  const price = (body?.prices || []).find((item) => String(item.endpoint_id).toLowerCase() === endpoint.toLowerCase());
  if (!price || money(price.unit_price) === null) return null;
  return { unitPrice: Number(price.unit_price), unit: String(price.unit || ''), currency: price.currency || 'USD' };
};

/**
 * Fetches the unit prices of many fal endpoints in as few calls as possible
 * and seeds the per-endpoint cache. Resolves to a Map of endpoint -> error
 * for the endpoints whose chunk failed (a rate limit stops the batch early),
 * so the caller can report them without asking fal again one by one.
 */
export async function primeFalPrices(endpoints, key) {
  const failures = new Map();
  const now = Date.now();
  const wanted = [...new Set(endpoints)].filter((endpoint) => {
    const hit = cache.get(falCacheKey(key, endpoint));
    return !(hit && hit.until > now);
  });
  for (let start = 0; start < wanted.length; start += FAL_BATCH) {
    const chunk = wanted.slice(start, start + FAL_BATCH);
    const request = requestJson('fal', `https://api.fal.ai/v1/models/pricing?endpoint_id=${chunk.map(encodeURIComponent).join(',')}`, {
      headers: { Authorization: `Key ${key}` },
      timeoutMs: TIMEOUT_MS,
    });
    for (const endpoint of chunk) {
      const cacheKey = falCacheKey(key, endpoint);
      const value = request.then((body) => unitPriceFrom(body, endpoint));
      // A failed chunk leaves nothing cached, so a later quote asks again.
      value.catch(() => cache.delete(cacheKey));
      cache.set(cacheKey, { value, until: Date.now() + refreshMs() });
    }
    try {
      await request;
    } catch (error) {
      for (const endpoint of wanted.slice(start)) failures.set(endpoint, error);
      break;
    }
  }
  return failures;
}

// fal does not enumerate its unit names, so match them loosely.
export function falQuantity(unit, payload) {
  const name = unit.toLowerCase();
  if (/image|photo|picture/.test(name)) return { quantity: imagesIn(payload), unit: 'image' };
  if (/character/.test(name)) return { quantity: textIn(payload).length, unit: 'character' };
  if (/megapixel|\bmp\b/.test(name)) {
    const tier = tierLabel(payload);
    return { quantity: (MEGAPIXELS[tier] || 1) * imagesIn(payload), unit: 'megapixel', approximate: true };
  }
  if (/minute/.test(name)) {
    const seconds = secondsIn(payload);
    return seconds ? { quantity: seconds / 60, unit: 'minute' } : null;
  }
  if (/second|sec\b/.test(name)) {
    const seconds = secondsIn(payload);
    return seconds ? { quantity: seconds, unit: 'second' } : null;
  }
  if (/video|request|call|run|generation|output|model|audio|song|track|clip/.test(name)) return { quantity: 1, unit: name };
  return null;
}

// fal hosts OpenAI and Google image models at those vendors' list prices, and
// its pricing API reports them as a generic "unit" whose price means nothing
// per image. When the same catalog entry also routes to OpenAI or Google, the
// published table is the honest quote.
function passthroughTable(catalogId, route, payload, live) {
  // Fields the fal route drops never reach the model, so they cannot change
  // the price (GPT Image 2 on fal ignores the studio's resolution).
  const sent = { ...payload };
  for (const field of route?.drop || []) delete sent[field];
  for (const provider of ['openai', 'google']) {
    const sibling = findRoute(catalogId, provider);
    if (!sibling) continue;
    const quote = tablePrice(provider, sibling.endpoint, sent, live);
    if (quote.kind !== 'unavailable') return { ...quote, listOf: provider };
  }
  return null;
}

// "unit"/"units"/"token": fal's placeholder for formula-priced endpoints.
const GENERIC_UNIT = /^units?$|token/i;

async function falPrice({ catalogId, route, endpoint, key, payload, live }) {
  const table = catalogId ? passthroughTable(catalogId, route, payload, live) : null;
  if (table) return table;
  const price = await falUnitPrice(endpoint, key);
  if (!price) return { kind: 'unavailable', source: 'fal' };
  const used = falQuantity(price.unit, payload);
  if (!used) {
    if (GENERIC_UNIT.test(price.unit.trim())) return { kind: 'unavailable', source: 'fal' };
    return { kind: 'unit', unitPrice: price.unitPrice, unit: price.unit, currency: price.currency, source: 'fal' };
  }
  return {
    kind: 'total',
    amount: round(price.unitPrice * used.quantity),
    currency: price.currency,
    unitPrice: price.unitPrice,
    unit: used.unit,
    quantity: round(used.quantity),
    ...(used.approximate ? { partial: true } : {}),
    source: 'fal',
  };
}

// ── OpenRouter: public model list, per output token ──────────────────────────

// OpenRouter's public model list carries the vendors' per-token image rates.
// It is the live source for Google and OpenAI prices too (see prices.js).
async function openrouterModels() {
  return cached('openrouter:models', refreshMs(), async () => {
    const body = await requestJson('openrouter', 'https://openrouter.ai/api/v1/models', { timeoutMs: TIMEOUT_MS });
    const map = new Map();
    for (const model of body?.data || []) if (model?.id) map.set(model.id, model.pricing || {});
    return { models: map, fetchedAt: Date.now() };
  });
}

/** Live per-token rates, or null when OpenRouter cannot be reached right now. */
export async function liveRates() {
  try {
    return await openrouterModels();
  } catch {
    // Do not retry on every quote while OpenRouter is down.
    cache.set('openrouter:models', { value: Promise.resolve(null), until: Date.now() + RETRY_MS });
    return null;
  }
}

// The table entry that an OpenRouter model id stands for.
function tableEntryFor(openrouterId) {
  for (const provider of ['google', 'openai']) {
    for (const [endpoint, entry] of Object.entries(PRICES[provider])) {
      if (entry.openrouter === openrouterId) return { provider, endpoint };
    }
  }
  return null;
}

async function openrouterPrice({ endpoint, payload }) {
  const live = await liveRates();
  const perToken = money(live?.models.get(endpoint)?.image_output);
  if (perToken === null) return { kind: 'unavailable', source: 'openrouter' };
  // OpenRouter charges the vendor's rate for the same tokens per image, so
  // the table (scaled to today's rate) is the quote.
  const known = tableEntryFor(endpoint);
  if (known) return { ...tablePrice(known.provider, known.endpoint, payload, live), source: 'openrouter' };
  return { kind: 'tokens', perMillion: round(perToken * 1_000_000), currency: 'USD', source: 'openrouter', rateCheckedAt: live.fetchedAt, rateSource: 'openrouter' };
}

// ── Google and OpenAI: published list prices ────────────────────────────────

/**
 * @param {{ models: Map<string, object>, fetchedAt: number } | null} live  today's
 *   per-token rates from OpenRouter; when the entry's rate has moved, the
 *   table price is scaled to it.
 */
export function tablePrice(provider, endpoint, payload = {}, live = null) {
  const entry = PRICES[provider]?.[endpoint];
  if (!entry) return { kind: 'unavailable', source: 'table' };
  const liveRate = entry.openrouter ? money(live?.models?.get(entry.openrouter)?.image_output) : null;
  const factor = liveRate && entry.rate ? liveRate / entry.rate : 1;
  const freshness = liveRate ? { rateSource: 'openrouter', rateCheckedAt: live.fetchedAt, rate: liveRate } : { asOf: PRICES_UPDATED, rate: entry.rate };
  if (entry.per === 'token') {
    return { kind: 'tokens', perMillion: round((entry.rate || 0) * factor * 1_000_000), currency: 'USD', source: 'table', note: entry.note, ...freshness };
  }
  const count = imagesIn(payload);
  // "auto" or an unset tier is priced at the provider's default, which is
  // the top tier for OpenAI; the quote says so.
  const requested = entry.tier === 'quality' ? String(payload.quality || '').toLowerCase() : tierLabel(payload);
  const tier = entry.prices[requested] ? requested : entry.default;
  const assumed = tier !== requested;
  let unitPrice;
  let label = tier;
  if (entry.tier === 'quality') {
    const size = tierLabel({ resolution: payload.resolution || payload.image_size || payload.size || '' });
    if (entry.sizes?.[size]?.[tier] !== undefined) {
      unitPrice = entry.sizes[size][tier];
      label = `${tier} ${size}`;
    } else {
      const [w, h] = String(payload.aspect_ratio || '1:1').split(':').map(Number);
      const square = !w || !h || Math.abs(w - h) < 0.01;
      unitPrice = entry.prices[tier][square ? 0 : 1];
    }
  } else {
    unitPrice = entry.prices[tier];
  }
  if (!Number.isFinite(unitPrice)) return { kind: 'unavailable', source: 'table' };
  unitPrice = round(unitPrice * factor);
  return {
    kind: 'total', amount: round(unitPrice * count), currency: 'USD', unitPrice, unit: 'image', quantity: count, tier: label,
    ...(assumed ? { assumed: true } : {}), ...(entry.note ? { note: entry.note } : {}), ...freshness, source: 'table',
  };
}

// ── Chat models writing SVG: tokens × the vendor's per-token rate ───────────

/**
 * Quotes one code-written SVG (catalog/chatRoutes.js) from the token budget
 * in vector/svgChat.js. The rate is OpenRouter's live figure for the model
 * when the list can be read (it mirrors the vendors' own prices), else the
 * table in prices.js. The same quote serves the direct vendor route and the
 * OpenRouter route, since OpenRouter charges the vendor's rate.
 */
export function chatPrice(catalogId, payload = {}, live = null) {
  const entry = PRICES.chat?.[catalogId];
  if (!entry) return { kind: 'unavailable', source: 'table' };
  const liveModel = live?.models?.get(entry.openrouter);
  const liveInput = money(liveModel?.prompt);
  const liveOutput = money(liveModel?.completion);
  const useLive = liveInput !== null && liveOutput !== null && liveInput >= 0 && liveOutput >= 0;
  const input = useLive ? liveInput : entry.input;
  const output = useLive ? liveOutput : entry.output;
  const tokens = estimateSvgTokens(payload);
  const unitPrice = round(tokens.input * input + tokens.output * output);
  return {
    kind: 'total', amount: round(unitPrice * tokens.count), currency: 'USD', unitPrice, unit: 'svg', quantity: tokens.count,
    tokens: { input: tokens.input, output: tokens.output }, note: SVG_ESTIMATE_NOTE,
    ...(useLive ? { rateSource: 'openrouter', rateCheckedAt: live.fetchedAt } : { asOf: PRICES_UPDATED }),
    source: useLive ? 'openrouter' : 'table',
  };
}

// ── ElevenLabs: characters × the published API rate for the model ───────────

export function elevenlabsRate(model) {
  const { perThousandCharacters, flashModels } = PRICES.elevenlabs;
  return (flashModels.test(String(model || '')) ? perThousandCharacters.flash : perThousandCharacters.standard) / 1000;
}

function elevenlabsPrice({ endpoint, payload }) {
  const characters = textIn(payload).length;
  const rate = elevenlabsRate(endpoint);
  return {
    kind: 'total', amount: round(characters * rate), currency: 'USD', unitPrice: round(rate * 1000), unit: 'thousandCharacters',
    quantity: round(characters / 1000), characters, asOf: PRICES_UPDATED, source: 'elevenlabs',
  };
}

export async function getPrice({ provider, endpoint, key, payload = {} }) {
  if (!PRICE_PROVIDER_IDS.includes(provider)) throw new ProviderError(`${provider} has no price lookup`, { status: 400 });
  if (typeof endpoint !== 'string' || !endpoint) throw new ProviderError('endpoint is required', { status: 400 });
  const route = findRoute(endpoint, provider);
  const providerEndpoint = route?.endpoint || endpoint;
  const input = payload && typeof payload === 'object' ? payload : {};
  const needsKey = provider === 'fal' || provider === 'wavespeed';
  if (needsKey && (typeof key !== 'string' || key.trim().length < 8)) {
    throw new ProviderError(`Add your ${provider} API key in Settings → Providers.`, { status: 401, provider });
  }
  let quote;
  if (route && PRICES.chat?.[endpoint]) {
    quote = chatPrice(endpoint, input, await liveRates());
    return { provider, endpoint: providerEndpoint, estimated: true, ...quote };
  }
  switch (provider) {
    case 'wavespeed': quote = await wavespeedPrice({ endpoint: providerEndpoint, key: key.trim(), route, payload: input }); break;
    case 'fal': quote = await falPrice({ catalogId: route ? endpoint : null, route, endpoint: providerEndpoint, key: key.trim(), payload: input, live: await liveRates() }); break;
    case 'openrouter': quote = await openrouterPrice({ endpoint: providerEndpoint, payload: input }); break;
    case 'elevenlabs': quote = elevenlabsPrice({ endpoint: providerEndpoint, payload: input }); break;
    default: quote = tablePrice(provider, providerEndpoint, input, await liveRates());
  }
  return { provider, endpoint: providerEndpoint, estimated: true, ...quote };
}

const MAX_BATCH = 200;
const BATCH_CONCURRENCY = 3;
const inlineError = (error) => {
  const status = error instanceof ProviderError || error instanceof MappingError
    ? (error.status >= 400 && error.status < 600 ? error.status : 502)
    : error?.status === 400 ? 400 : 500;
  return { error: status === 500 ? 'Unexpected server error' : error.message, status };
};

/**
 * Quotes many runs of one provider in one request: fal unit prices are
 * fetched in batches first, then each quote is computed as getPrice would.
 * A quote that fails is returned inline as { error, status } at its index,
 * so one bad endpoint does not fail the batch.
 * @param {{ provider: string, requests: Array<{ endpoint: string, payload?: object }>, key?: string }} args
 */
export async function getPrices({ provider, requests, key }) {
  if (!PRICE_PROVIDER_IDS.includes(provider)) throw new ProviderError(`${provider} has no price lookup`, { status: 400 });
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > MAX_BATCH) {
    throw new ProviderError(`requests must list 1 to ${MAX_BATCH} runs`, { status: 400 });
  }
  if (requests.some((item) => typeof item?.endpoint !== 'string' || !item.endpoint)) throw new ProviderError('every request needs an endpoint', { status: 400 });
  let failed = new Map();
  if (provider === 'fal') {
    if (typeof key !== 'string' || key.trim().length < 8) throw new ProviderError('Add your fal API key in Settings → Providers.', { status: 401, provider });
    // Models fal hosts at OpenAI's or Google's list price are quoted from the
    // table and never asked of fal's API.
    const endpoints = [];
    for (const item of requests) {
      const route = findRoute(item.endpoint, 'fal');
      if (route && !findRoute(item.endpoint, 'openai') && !findRoute(item.endpoint, 'google')) endpoints.push(route.endpoint);
    }
    failed = await primeFalPrices(endpoints, key.trim());
  }
  const quotes = new Array(requests.length);
  let next = 0;
  const worker = async () => {
    while (next < requests.length) {
      const index = next;
      next += 1;
      const { endpoint, payload } = requests[index];
      const falEndpoint = provider === 'fal' ? (findRoute(endpoint, 'fal')?.endpoint || endpoint) : null;
      if (falEndpoint && failed.has(falEndpoint)) {
        quotes[index] = inlineError(failed.get(falEndpoint));
        continue;
      }
      try {
        quotes[index] = await getPrice({ provider, endpoint, key, payload: payload || {} });
      } catch (error) {
        quotes[index] = inlineError(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, requests.length) }, worker));
  return quotes;
}
