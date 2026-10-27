// Per-run price quotes, read before a job is sent so the visitor knows what
// they are agreeing to pay. WaveSpeed and fal quote through their own
// pricing APIs with the visitor's key (account discounts included);
// OpenRouter's public model list gives a per-token rate; Google, OpenAI and
// ElevenLabs have no pricing API, so their quotes come from catalog/prices.json
// and the text length. Every quote is an estimate: the provider's own bill
// is what counts.

import { createHash } from 'node:crypto';
import { findRoute } from '../catalog/index.js';
import { SCHEMAS } from '../catalog/schemas.generated.js';
import { PRICES } from '../catalog/prices.js';
import { mapInput, MappingError } from '../mapper.js';
import { ProviderError, requestJson } from './http.js';

export const PRICE_PROVIDER_IDS = ['fal', 'wavespeed', 'openrouter', 'google', 'openai', 'elevenlabs'];

const TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;
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
  return cached(`fal:${keyFingerprint(key)}:${endpoint}`, DAY_MS, async () => {
    const body = await requestJson('fal', `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, {
      headers: { Authorization: `Key ${key}` },
      timeoutMs: TIMEOUT_MS,
    });
    const price = (body?.prices || []).find((item) => item.endpoint_id === endpoint) || body?.prices?.[0];
    if (!price || money(price.unit_price) === null) return null;
    return { unitPrice: Number(price.unit_price), unit: String(price.unit || ''), currency: price.currency || 'USD' };
  });
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

async function falPrice({ endpoint, key, payload }) {
  const price = await falUnitPrice(endpoint, key);
  if (!price) return { kind: 'unavailable', source: 'fal' };
  const used = falQuantity(price.unit, payload);
  if (!used) return { kind: 'unit', unitPrice: price.unitPrice, unit: price.unit, currency: price.currency, source: 'fal' };
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

async function openrouterModels() {
  return cached('openrouter:models', DAY_MS, async () => {
    const body = await requestJson('openrouter', 'https://openrouter.ai/api/v1/models', { timeoutMs: TIMEOUT_MS });
    const map = new Map();
    for (const model of body?.data || []) if (model?.id) map.set(model.id, model.pricing || {});
    return map;
  });
}

async function openrouterPrice({ endpoint, payload }) {
  const pricing = (await openrouterModels()).get(endpoint);
  const perToken = money(pricing?.image_output);
  if (perToken === null) return { kind: 'unavailable', source: 'openrouter' };
  // The underlying model's tokens per image come from the static table.
  const table = PRICES.google?.[endpoint.replace(/^google\//, '')];
  const tier = tierLabel(payload) || table?.default;
  const tokens = table?.tokens?.[tier] || table?.tokens?.[table?.default];
  if (!tokens) return { kind: 'tokens', perMillion: round(perToken * 1_000_000), currency: 'USD', source: 'openrouter' };
  const count = imagesIn(payload);
  return { kind: 'total', amount: round(perToken * tokens * count), currency: 'USD', unitPrice: round(perToken * tokens), unit: 'image', quantity: count, source: 'openrouter' };
}

// ── Google and OpenAI: published list prices ────────────────────────────────

export function tablePrice(provider, endpoint, payload = {}) {
  const entry = PRICES[provider]?.[endpoint];
  if (!entry) return { kind: 'unavailable', source: 'table' };
  if (entry.per === 'token') {
    return { kind: 'tokens', perMillion: entry.perMillionOutputTokens, currency: 'USD', source: 'table', note: entry.note };
  }
  const count = imagesIn(payload);
  let tier;
  let unitPrice;
  if (entry.tier === 'quality') {
    tier = String(payload.quality || '').toLowerCase();
    if (!entry.prices[tier]) tier = entry.default;
    const [w, h] = String(payload.aspect_ratio || '1:1').split(':').map(Number);
    const square = !w || !h || Math.abs(w - h) < 0.01;
    unitPrice = entry.prices[tier][square ? 0 : 1];
  } else {
    tier = tierLabel(payload);
    if (!entry.prices[tier]) tier = entry.default;
    unitPrice = entry.prices[tier];
  }
  if (!Number.isFinite(unitPrice)) return { kind: 'unavailable', source: 'table' };
  return { kind: 'total', amount: round(unitPrice * count), currency: 'USD', unitPrice, unit: 'image', quantity: count, tier, source: 'table' };
}

function elevenlabsPrice({ payload }) {
  const characters = textIn(payload).length;
  return { kind: 'characters', characters, source: 'elevenlabs' };
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
  switch (provider) {
    case 'wavespeed': quote = await wavespeedPrice({ endpoint: providerEndpoint, key: key.trim(), route, payload: input }); break;
    case 'fal': quote = await falPrice({ endpoint: providerEndpoint, key: key.trim(), payload: input }); break;
    case 'openrouter': quote = await openrouterPrice({ endpoint: providerEndpoint, payload: input }); break;
    case 'elevenlabs': quote = elevenlabsPrice({ payload: input }); break;
    default: quote = tablePrice(provider, providerEndpoint, input);
  }
  return { provider, endpoint: providerEndpoint, estimated: true, ...quote };
}
