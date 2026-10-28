import test from 'node:test';
import assert from 'node:assert/strict';

// The client quoter runs in the browser; give it just enough window to read
// provider settings and a fetch that answers /api/price.
const store = new Map();
const localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};
globalThis.window = { localStorage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, location: { origin: 'http://localhost' } };
globalThis.localStorage = localStorage;

const { quoteRuns, resetQuoteCache } = await import('../packages/studio/src/providers/pricing.js');
const { saveProviderSettings } = await import('../packages/studio/src/providers/keys.js');

function mockPriceApi(answer) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ url, key: init.headers['x-provider-key'] || '', body });
    const [status, data] = answer(body);
    return new Response(JSON.stringify(data), { status });
  };
  resetQuoteCache();
  return calls;
}

test('one request per provider, results in order, failures inline, list price when nobody is keyed', async () => {
  saveProviderSettings({ keys: { fal: 'fal-key-123456' }, urls: {}, options: {}, order: ['fal', 'wavespeed'] });
  const calls = mockPriceApi((body) => [200, { quotes: body.requests.map((item) => (
    item.endpoint === 'flux-dev-image'
      ? { error: 'fal 429: Too Many Requests', status: 429 }
      : { kind: 'total', amount: body.provider === 'openai' ? 0.211 : 0.03, currency: 'USD', provider: body.provider, endpoint: item.endpoint }
  )) }]);
  const quotes = await quoteRuns([
    { endpoint: 'nano-banana-2', payload: { resolution: '1K', prompt: 'ignored by pricedInputs? no, prompt is priced' } },
    { endpoint: 'flux-dev-image' },
    { endpoint: 'kling-o1-text-to-image' },   // WaveSpeed only: no key
    { endpoint: 'gpt-image-2-text-to-image' },
  ], { listPrices: true });

  assert.equal(calls.length, 1, 'fal batch only: the WaveSpeed-only model has no list price');
  assert.equal(calls[0].body.provider, 'fal');
  assert.equal(calls[0].key, 'fal-key-123456');
  assert.deepEqual(calls[0].body.requests.map((item) => item.endpoint), ['nano-banana-2', 'flux-dev-image', 'gpt-image-2-text-to-image']);
  assert.deepEqual([quotes[0].kind, quotes[0].amount], ['total', 0.03]);
  assert.deepEqual([quotes[1].kind, quotes[1].status], ['error', 429]);
  assert.deepEqual([quotes[2].kind, quotes[2].providers], ['noProvider', ['wavespeed']]);
  assert.equal(quotes[3].kind, 'total');

  // Without any key, OpenAI models fall back to the published list price.
  saveProviderSettings({ keys: {}, urls: {}, options: {}, order: ['fal'] });
  const again = await quoteRuns([{ endpoint: 'gpt-image-2-text-to-image' }, { endpoint: 'kling-o1-text-to-image' }], { listPrices: true });
  const listCall = calls[calls.length - 1];
  assert.deepEqual([listCall.body.provider, listCall.key], ['openai', '']);
  assert.deepEqual([again[0].kind, again[0].listOnly, again[0].amount], ['total', true, 0.211]);
  assert.equal(again[1].kind, 'noProvider');
});

test('batch results are cached and reused by later batches', async () => {
  saveProviderSettings({ keys: { fal: 'fal-key-123456' }, urls: {}, options: {}, order: ['fal'] });
  const calls = mockPriceApi((body) => [200, { quotes: body.requests.map(() => ({ kind: 'total', amount: 0.01, provider: 'fal' })) }]);
  await quoteRuns([{ endpoint: 'nano-banana-2', payload: { resolution: '1K' } }]);
  const quotes = await quoteRuns([{ endpoint: 'nano-banana-2', payload: { resolution: '1K' } }, { endpoint: 'flux-dev-image' }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.requests.map((item) => item.endpoint), ['flux-dev-image'], 'the cached quote is not asked again');
  assert.equal(quotes[0].amount, 0.01);
});

test('a failed batch request marks every run in it as an error', async () => {
  saveProviderSettings({ keys: { fal: 'fal-key-123456' }, urls: {}, options: {}, order: ['fal'] });
  mockPriceApi(() => [500, { error: 'boom' }]);
  const quotes = await quoteRuns([{ endpoint: 'nano-banana-2' }, { endpoint: 'flux-dev-image' }]);
  assert.deepEqual(quotes.map((quote) => [quote.kind, quote.status]), [['error', 500], ['error', 500]]);
});
