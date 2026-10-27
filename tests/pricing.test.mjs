import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrice, tablePrice, falQuantity } from '../packages/studio/src/providers/server/pricing.js';
import { PRICES } from '../packages/studio/src/providers/catalog/prices.js';
import { mapInput } from '../packages/studio/src/providers/mapper.js';
import { ROUTE_GROUPS } from '../packages/studio/src/providers/catalog/routes.generated.js';

function mockFetch(handlers) {
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
  assert.equal(calls[0].auth, `Key ${KEY}`);
  assert.deepEqual([quote.kind, quote.amount, quote.quantity, quote.unit], ['total', 0.075, 3, 'image']);
  // Unit prices are cached per key for a day.
  await getPrice({ provider: 'fal', endpoint: 'ai-image-upscale', key: KEY, payload: { num_images: 1 } });
  assert.equal(calls.length, 1);
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
  assert.equal(tablePrice('openai', 'gpt-image-2.5-flare', {}).kind, 'tokens');
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

test('openrouter prices per output token using the table tokens per image', async () => {
  mockFetch({
    'https://openrouter.ai/api/v1/models': [200, { data: [{ id: 'google/gemini-3.1-flash-image', pricing: { image_output: '0.00006' } }, { id: 'openai/gpt-5.4-image-2', pricing: { image_output: '0.00003' } }] }],
  });
  const flash = await getPrice({ provider: 'openrouter', endpoint: 'nano-banana-2', key: '', payload: { resolution: '2K' } });
  assert.deepEqual([flash.kind, flash.amount], ['total', 0.1008]);
  const gpt = await getPrice({ provider: 'openrouter', endpoint: 'gpt-image-2-text-to-image', key: '', payload: {} });
  assert.deepEqual([gpt.kind, gpt.perMillion], ['tokens', 30]);
});

test('elevenlabs counts characters', async () => {
  const quote = await getPrice({ provider: 'elevenlabs', endpoint: 'elevenlabs-text-to-dialogue', key: '', payload: { dialogue: [{ text: 'Hello' }, { text: 'there' }] } });
  assert.deepEqual([quote.kind, quote.characters], ['characters', 11]);
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
