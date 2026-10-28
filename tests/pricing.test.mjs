import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrice, getPrices, tablePrice, falQuantity, liveRates, resetPriceCache, refreshMs } from '../packages/studio/src/providers/server/pricing.js';
import { openaiUsageCost, googleUsageCost, sumCosts } from '../packages/studio/src/providers/server/usage.js';
import { PRICES } from '../packages/studio/src/providers/catalog/prices.js';
import { mapInput } from '../packages/studio/src/providers/mapper.js';
import { ROUTE_GROUPS } from '../packages/studio/src/providers/catalog/routes.generated.js';

const OPENROUTER = 'https://openrouter.ai/api/v1/models';
const openrouterList = (overrides = {}) => [200, { data: [
  { id: 'google/gemini-3.1-flash-image', pricing: { image_output: '0.00006' } },
  { id: 'google/gemini-nano-banana-2.1', pricing: { image_output: '0.00003' } },
  { id: 'openai/gpt-5.4-image-2', pricing: { image_output: '0.00003' } },
].map((model) => (overrides[model.id] ? { ...model, pricing: { image_output: String(overrides[model.id]) } } : model)) }];

function mockFetch(handlers) {
  resetPriceCache();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, auth: init.headers?.Authorization, body });
    const handler = handlers[url];
    const [status, data] = typeof handler === 'function' ? handler(body) : handler || [404, { error: 'not found' }];
    return new Response(JSON.stringify(data), { status });
  };
  return calls;
}

const KEY = 'secret-key-1234567890';

test('wavespeed quotes the mapped inputs and prefers the discounted price', async () => {
  const calls = mockFetch({
    'https://api.wavespeed.ai/api/v3/model/price': (body) => [200, { code: 200, data: { model_id: body.model_id, price: 0.5, discounted_price: 0.4, discount_rate: 80, currency: 'USD' } }],
  });
  const quote = await getPrice({ provider: 'wavespeed', endpoint: 'ai-image-upscale', key: KEY, payload: { prompt: 'x' } });
  assert.equal(calls[0].auth, `Bearer ${KEY}`);
  assert.equal(calls[0].body.model_id, 'wavespeed-ai/image-upscaler');
  assert.equal(quote.kind, 'total');
  assert.equal(quote.amount, 0.4);
  assert.equal(quote.listPrice, 0.5);
  assert.equal(quote.partial, true, 'the image was not sent, so the quote is a floor');
});

test('wavespeed falls back to the base price when the formula cannot run', async () => {
  let attempts = 0;
  mockFetch({
    'https://api.wavespeed.ai/api/v3/model/price': (body) => {
      attempts += 1;
      if (body.inputs) return [400, { code: 4006, message: 'Failed to measure media' }];
      return [200, { code: 200, data: { price: 0.45, discounted_price: 0.45, discount_rate: 100, currency: 'USD' } }];
    },
  });
  const quote = await getPrice({ provider: 'wavespeed', endpoint: 'ai-image-upscale', key: KEY, payload: {} });
  assert.equal(attempts, 2);
  assert.deepEqual([quote.kind, quote.amount, quote.partial], ['total', 0.45, true]);
});

test('fal multiplies the unit price by what the run will use', async () => {
  const calls = mockFetch({
    'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fesrgan': [200, { prices: [{ endpoint_id: 'fal-ai/esrgan', unit_price: 0.025, unit: 'image', currency: 'USD' }] }],
  });
  const quote = await getPrice({ provider: 'fal', endpoint: 'ai-image-upscale', key: KEY, payload: { num_images: 3 } });
  assert.equal(calls.find((call) => call.url.includes('fal.ai')).auth, `Key ${KEY}`);
  assert.deepEqual([quote.kind, quote.amount, quote.quantity, quote.unit], ['total', 0.075, 3, 'image']);
  // Unit prices are cached per key for a day.
  await getPrice({ provider: 'fal', endpoint: 'ai-image-upscale', key: KEY, payload: { num_images: 1 } });
  assert.equal(calls.filter((call) => call.url.includes('fal.ai')).length, 1);
});

test('fal quotes OpenAI and Google models from the price table, not its generic unit', async () => {
  const calls = mockFetch({
    'https://api.fal.ai/v1/models/pricing?endpoint_id=openai%2Fgpt-image-2': [200, { prices: [{ endpoint_id: 'openai/gpt-image-2', unit_price: 1, unit: 'units', currency: 'USD' }] }],
  });
  const auto = await getPrice({ provider: 'fal', endpoint: 'gpt-image-2-text-to-image', key: KEY, payload: { quality: 'auto', aspect_ratio: '1:1' } });
  assert.deepEqual([auto.kind, auto.amount, auto.tier, auto.assumed, auto.listOf], ['total', 0.211, 'high', true, 'openai']);
  const medium = await getPrice({ provider: 'fal', endpoint: 'gpt-image-2-text-to-image', key: KEY, payload: { quality: 'medium', aspect_ratio: '1:1' } });
  assert.deepEqual([medium.amount, medium.assumed], [0.053, undefined]);
  // fal's GPT Image 2 route drops the studio's resolution, so 4K does not raise its quote.
  const fourK = await getPrice({ provider: 'fal', endpoint: 'gpt-image-2-text-to-image', key: KEY, payload: { resolution: '4K' } });
  assert.equal(fourK.amount, 0.211);
  const banana = await getPrice({ provider: 'fal', endpoint: 'nano-banana-2-1', key: KEY, payload: { resolution: '2K' } });
  assert.deepEqual([banana.amount, banana.listOf], [0.0504, 'google']);
  assert.equal(calls.filter((call) => call.url.includes('fal.ai')).length, 0, 'the table answers without asking fal');
});

test('a generic fal unit with no table behind it is reported as unavailable', async () => {
  mockFetch({
    'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fesrgan': [200, { prices: [{ endpoint_id: 'fal-ai/esrgan', unit_price: 1, unit: 'unit', currency: 'USD' }] }],
  });
  const quote = await getPrice({ provider: 'fal', endpoint: 'ai-image-upscale', key: 'another-key-0987654321', payload: {} });
  assert.equal(quote.kind, 'unavailable');
});

test('fal units it cannot count become a per-unit quote', () => {
  assert.equal(falQuantity('gpu-h100-second', { prompt: 'x' }), null);
  assert.deepEqual(falQuantity('video second', { duration: 8 }), { quantity: 8, unit: 'second' });
  assert.equal(falQuantity('megapixel', { resolution: '2K', num_images: 2 }).quantity, 8.4);
});

test('google and openai come from the price table', () => {
  assert.deepEqual(tablePrice('google', 'gemini-3-pro-image', { resolution: '4K', num_images: 2 }).amount, 0.48);
  assert.equal(tablePrice('google', 'gemini-3.1-flash-image', {}).tier, '1K');
  assert.equal(tablePrice('openai', 'gpt-image-2', { quality: 'medium', aspect_ratio: '3:2' }).amount, 0.041);
  assert.equal(tablePrice('openai', 'gpt-image-2', {}).tier, 'high', 'unset quality is priced at the top tier');
  assert.deepEqual([tablePrice('openai', 'gpt-image-2', { resolution: '4K' }).amount, tablePrice('openai', 'gpt-image-2', { resolution: '4K' }).tier], [0.401, 'high 4K']);
  assert.equal(tablePrice('openai', 'gpt-image-2', { resolution: '2K', quality: 'medium' }).amount, 0.056);
  assert.equal(tablePrice('openai', 'unknown-model', {}).kind, 'unavailable');
});

test('every google and openai route in the catalog has a table entry', () => {
  for (const routes of Object.values(ROUTE_GROUPS)) {
    for (const list of Object.values(routes)) {
      for (const route of list) {
        if (route.provider !== 'google' && route.provider !== 'openai') continue;
        assert.ok(PRICES[route.provider][route.endpoint], `${route.provider}/${route.endpoint} is missing from prices.js`);
      }
    }
  }
});

test('openrouter prices the same table at its live per-token rate', async () => {
  mockFetch({ [OPENROUTER]: openrouterList() });
  const flash = await getPrice({ provider: 'openrouter', endpoint: 'nano-banana-2', key: '', payload: { resolution: '2K' } });
  assert.deepEqual([flash.kind, flash.amount, flash.rateSource], ['total', 0.101, 'openrouter']);
  const gpt = await getPrice({ provider: 'openrouter', endpoint: 'gpt-image-2-text-to-image', key: '', payload: { quality: 'medium' } });
  assert.deepEqual([gpt.kind, gpt.amount], ['total', 0.053]);
});

test('google and openai prices follow the live rate when it moves', async () => {
  const calls = mockFetch({ [OPENROUTER]: openrouterList({ 'google/gemini-nano-banana-2.1': 0.00006, 'openai/gpt-5.4-image-2': 0.000015 }) });
  const banana = await getPrice({ provider: 'google', endpoint: 'nano-banana-2-1', key: '', payload: { resolution: '1K' } });
  assert.equal(banana.amount, 0.0672, 'doubled rate doubles the price');
  assert.ok(banana.rateCheckedAt > 0);
  const gpt = await getPrice({ provider: 'openai', endpoint: 'gpt-image-2-text-to-image', key: '', payload: { quality: 'high' } });
  assert.equal(gpt.amount, 0.1055, 'halved rate halves the price');
  await getPrice({ provider: 'google', endpoint: 'nano-banana-2-1', key: '', payload: {} });
  assert.equal(calls.length, 1, 'the rate list is cached for PRICE_REFRESH_MINUTES');
  assert.equal(refreshMs(), 30 * 60 * 1000);
});

test('without OpenRouter the table stands, dated', async () => {
  mockFetch({});
  const quote = await getPrice({ provider: 'google', endpoint: 'nano-banana-2-1', key: '', payload: { resolution: '4K' } });
  assert.deepEqual([quote.amount, quote.asOf, quote.rateCheckedAt], [0.113, '2026-10-27', undefined]);
  assert.equal(await liveRates(), null);
});

test('gpt image 2.5 is priced per image from the published size table', () => {
  assert.deepEqual([tablePrice('openai', 'gpt-image-2.5-flare', {}).amount, tablePrice('openai', 'gpt-image-2.5-flare', {}).tier], [0.0527, 'high']);
  assert.equal(tablePrice('openai', 'gpt-image-2.5-sunburst', { quality: 'max', resolution: '4K' }).amount, 0.4003);
  assert.equal(tablePrice('openai', 'gpt-image-2.5-flare', { quality: 'xhigh', aspect_ratio: '16:9' }).amount, 0.0738);
});

test('elevenlabs quotes characters at the API rate for the model', async () => {
  const dialogue = await getPrice({ provider: 'elevenlabs', endpoint: 'elevenlabs-text-to-dialogue', key: '', payload: { dialogue: [{ text: 'Hello' }, { text: 'there' }] } });
  assert.deepEqual([dialogue.kind, dialogue.characters, dialogue.amount, dialogue.unitPrice], ['total', 11, 0.0009, 0.08]);
  const flash = await getPrice({ provider: 'elevenlabs', endpoint: 'elevenlabs-tts-turbo-2-5', key: '', payload: { prompt: 'x'.repeat(1000) } });
  assert.deepEqual([flash.amount, flash.unitPrice], [0.04, 0.04]);
});

test('usage reported after a run becomes the actual cost', () => {
  assert.equal(openaiUsageCost('gpt-image-2', { input_tokens: 20, output_tokens: 7033, input_tokens_details: { text_tokens: 20, image_tokens: 0 } }), 0.21109);
  assert.equal(openaiUsageCost('gpt-image-2.5-flare-2026-09-08', { output_tokens: 1756 }), 0.05268);
  assert.equal(openaiUsageCost('gpt-image-2', {}), null);
  assert.equal(googleUsageCost('gemini-nano-banana-2.1', { promptTokenCount: 10, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] }), 0.033615);
  assert.equal(googleUsageCost('gemini-nano-banana-2.1', null), null);
  assert.deepEqual([sumCosts([0.1, 0.2]), sumCosts([0.1, null]), sumCosts([])], [0.3, null, null]);
});

test('fal and wavespeed quotes need a key', async () => {
  await assert.rejects(getPrice({ provider: 'fal', endpoint: 'ai-image-upscale', key: '', payload: {} }), /API key/);
});

test('lenient mapping reports missing required inputs instead of throwing', () => {
  const route = { endpoint: 'x' };
  const schema = { required: ['image', 'prompt'], props: { image: { type: 'string' }, prompt: { type: 'string' } } };
  const { input, missing } = mapInput({ prompt: 'hi' }, route, schema, { allowMissing: true });
  assert.deepEqual(input, { prompt: 'hi' });
  assert.deepEqual(missing, ['image']);
  assert.throws(() => mapInput({ prompt: 'hi' }, route, schema), /Missing required input: image/);
});

test('a batch asks fal for all its endpoints in one call and reports failures inline', async () => {
  const url = 'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fesrgan,fal-ai%2Fflux%2Fdev,fal-ai%2Fflux%2Fschnell';
  const calls = mockFetch({
    [url]: [200, { prices: [
      { endpoint_id: 'fal-ai/esrgan', unit_price: 0.025, unit: 'image', currency: 'USD' },
      { endpoint_id: 'fal-ai/flux/dev', unit_price: 0.025, unit: 'megapixel', currency: 'USD' },
    ], next_cursor: null, has_more: false }],
  });
  const quotes = await getPrices({ provider: 'fal', key: KEY, requests: [
    { endpoint: 'ai-image-upscale', payload: { num_images: 2 } },
    { endpoint: 'flux-dev-image', payload: { width: 1024, height: 1024 } },
    { endpoint: 'gpt-image-2-text-to-image', payload: { quality: 'medium', aspect_ratio: '1:1' } },
    { endpoint: 'flux-schnell-image' },
  ] });
  assert.equal(calls.filter((call) => call.url.includes('fal.ai')).length, 1, 'one fal call for the whole batch');
  assert.deepEqual([quotes[0].kind, quotes[0].amount], ['total', 0.05]);
  assert.deepEqual([quotes[1].kind, quotes[1].unit], ['total', 'megapixel']);
  assert.deepEqual([quotes[2].amount, quotes[2].listOf], [0.053, 'openai'], 'OpenAI models on fal come from the table without asking fal');
  assert.equal(quotes[3].kind, 'unavailable', 'an endpoint fal left out of its answer is unavailable, not an error');
  // The batch seeded the single-quote cache.
  const single = await getPrice({ provider: 'fal', endpoint: 'ai-image-upscale', key: KEY, payload: { num_images: 1 } });
  assert.equal(single.amount, 0.025);
  assert.equal(calls.filter((call) => call.url.includes('fal.ai')).length, 1);
});

test('a rate-limited fal batch surfaces 429 on each quote instead of failing the request', async () => {
  mockFetch({
    'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fesrgan': [429, { error: { type: 'rate_limited', message: 'Rate limit exceeded' } }],
  });
  const quotes = await getPrices({ provider: 'fal', key: KEY, requests: [{ endpoint: 'ai-image-upscale' }] });
  assert.equal(quotes[0].status, 429);
  assert.match(quotes[0].error, /429/);
  await assert.rejects(getPrices({ provider: 'fal', key: '', requests: [{ endpoint: 'ai-image-upscale' }] }), /API key/);
  await assert.rejects(getPrices({ provider: 'google', requests: [] }), /1 to/);
});
