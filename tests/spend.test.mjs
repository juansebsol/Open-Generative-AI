import test from 'node:test';
import assert from 'node:assert/strict';

// The spend ledger and the quote formatter live in the browser; give them a
// minimal window.
const stored = new Map();
const localStorage = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};
globalThis.window = { localStorage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const spend = await import('../packages/studio/src/providers/spend.js');
const pricing = await import('../packages/studio/src/providers/pricing.js');
const { default: copy } = await import('../packages/studio/src/messages/en/pricing.json', { with: { type: 'json' } });

test('monthly totals group runs per provider and remember which were estimates', () => {
  spend.resetSpend();
  stored.clear();
  const now = new Date(2026, 9, 27, 12).getTime();
  spend.recordSpend({ provider: 'fal', endpoint: 'a', amount: 0.05, t: now });
  spend.recordSpend({ provider: 'fal', endpoint: 'b', amount: 0.1, estimated: false, t: now - 1000 });
  spend.recordSpend({ provider: 'openrouter', endpoint: 'c', amount: 0.0336, estimated: false, t: now });
  spend.recordSpend({ provider: 'elevenlabs', endpoint: 'd', amount: null, characters: 420, t: now });
  spend.recordSpend({ provider: 'fal', endpoint: 'old', amount: 9, t: new Date(2026, 8, 30).getTime() });
  const totals = spend.monthlySpend(new Date(now));
  assert.deepEqual(totals.fal, { amount: 0.15, runs: 2, priced: 2, estimated: 1, characters: 0, currency: 'USD' });
  assert.equal(totals.openrouter.estimated, 0);
  assert.deepEqual([totals.elevenlabs.characters, totals.elevenlabs.priced], [420, 0]);
  assert.equal(JSON.parse(stored.get('oga_spend_v1')).entries.length, 5);
  spend.clearSpend();
  assert.deepEqual(spend.monthlySpend(new Date(now)), {});
});

test('only price-relevant inputs travel with a quote', () => {
  const picked = pricing.pricedInputs({ prompt: 'x', image_url: 'blob:abc', images_list: ['https://a'], duration: 5, resolution: '1080p', seed: 3, mode: '' });
  assert.deepEqual(picked, { prompt: 'x', duration: 5, resolution: '1080p' });
});

test('quotes read as short labels with a fuller tooltip', () => {
  const total = pricing.describeQuote({ kind: 'total', provider: 'fal', endpoint: 'fal-ai/esrgan', amount: 0.075, currency: 'USD', unitPrice: 0.025, unit: 'image', quantity: 3 }, copy);
  assert.deepEqual([total.provider, total.label], ['fal.ai', '≈ $0.075']);
  assert.match(total.title, /^Runs on fal\.ai via fal-ai\/esrgan\./);
  assert.match(total.title, /Click to change providers\.$/);
  assert.match(total.title, /\$0\.025 per image · × 3/);
  const floor = pricing.describeQuote({ kind: 'total', provider: 'wavespeed', amount: 0.45, currency: 'USD', partial: true }, copy);
  assert.equal(floor.label, 'from $0.45');
  const table = pricing.describeQuote({ kind: 'total', provider: 'fal', amount: 0.211, currency: 'USD', unitPrice: 0.211, unit: 'image', quantity: 1, tier: 'high', assumed: true, listOf: 'openai' }, copy);
  assert.match(table.title, /priced at high, the provider's default/);
  assert.match(table.title, /OpenAI list price/);
  assert.match(floor.title, /real price can be higher/);
  const free = pricing.describeQuote({ kind: 'free', provider: 'comfyui', endpoint: 'sdxl' }, copy);
  assert.deepEqual([free.provider, free.label], ['ComfyUI', 'Free · local']);
  assert.equal(pricing.describeQuote({ kind: 'characters', provider: 'elevenlabs', characters: 1234 }, copy).label, '1,234 characters');
  const speech = pricing.describeQuote({ kind: 'total', provider: 'elevenlabs', amount: 0.0987, currency: 'USD', unitPrice: 0.08, unit: 'thousandCharacters', quantity: 1.234, characters: 1234, asOf: '2026-10-27' }, copy);
  assert.equal(speech.label, '≈ $0.099');
  assert.match(speech.title, /\$0\.08 per 1,000 characters · × 1\.234 · 1,234 characters · list price as of 2026-10-27/);
  const live = pricing.describeQuote({ kind: 'total', provider: 'google', amount: 0.0336, currency: 'USD', rateSource: 'openrouter', rateCheckedAt: Date.now() - 5 * 60000 }, copy);
  assert.match(live.title, /rate confirmed 5 min ago via OpenRouter/);
  assert.equal(pricing.describeQuote({ kind: 'tokens', provider: 'openai', perMillion: 30, currency: 'USD' }, copy).label, '$30.00 per 1M tokens');
  assert.equal(pricing.describeQuote({ kind: 'unavailable', provider: 'openai' }, copy).tone, 'warn');
  assert.equal(pricing.describeQuote({ kind: 'noProvider', providers: [] }, copy), null, 'a model no provider serves shows nothing');
  const missing = pricing.describeQuote({ kind: 'noProvider', providers: ['fal', 'wavespeed', 'openai'] }, copy);
  assert.deepEqual([missing.label, missing.tone], ['No provider key', 'warn']);
  assert.match(missing.title, /available on fal\.ai, WaveSpeedAI, or OpenAI/);
});
