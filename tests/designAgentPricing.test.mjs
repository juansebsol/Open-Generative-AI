import test from 'node:test';
import assert from 'node:assert/strict';

// The Design Agent prices plans in the browser; give it just enough window
// to read provider settings and a fetch that answers /api/price.
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

const { addUpQuotes, estimatePlan, paidStepRoute, pickImageModel } = await import('../packages/studio/src/designAgent/agentModels.js');
const { resetQuoteCache } = await import('../packages/studio/src/providers/pricing.js');
const { saveProviderSettings } = await import('../packages/studio/src/providers/keys.js');
const { COSTLY_TOOLS, DESIGN_TOOLS } = await import('../packages/studio/src/designAgent/tools.js');

const total = (amount, extra = {}) => ({ kind: 'total', amount, currency: 'USD', ...extra });

test('plan lines add up, and a step without a price makes the total a floor', () => {
  assert.deepEqual(addUpQuotes([
    { name: 'Nano Banana Pro', count: 2, quote: total(0.15) },
    { name: 'SeedVR2', count: 1, quote: { kind: 'unit', unitPrice: 0.05, unit: 'image', currency: 'USD' } },
  ]), {
    amount: 0.35,
    currency: 'USD',
    partial: false,
    lines: [{ name: 'Nano Banana Pro', count: 2, each: 0.15 }, { name: 'SeedVR2', count: 1, each: 0.05 }],
  });

  const floor = addUpQuotes([{ name: 'A', count: 1, quote: total(0.1) }, { name: 'B', count: 1, quote: { kind: 'unavailable' } }]);
  assert.equal(floor.amount, 0.1);
  assert.equal(floor.partial, true);
  assert.equal(floor.lines[1].each, null);

  assert.equal(addUpQuotes([{ name: 'A', count: 1, quote: total(0.1, { partial: true }) }]).partial, true);
  assert.equal(addUpQuotes([{ name: 'A', count: 1, quote: total(0.1) }], 1).partial, true, 'a step no model can run');
  assert.equal(addUpQuotes([{ name: 'Local', count: 3, quote: { kind: 'free' } }]).amount, 0);
  assert.equal(addUpQuotes([{ name: 'A', count: 1, quote: { kind: 'error' } }]), null);
  assert.equal(addUpQuotes([{ name: 'A', count: 1, quote: total(1) }, { name: 'B', count: 1, quote: total(1, { currency: 'EUR' }) }]), null);
});

test('a plan is priced on the models its steps run on, one quote per model', async () => {
  saveProviderSettings({ keys: { fal: 'fal-key-123456' }, urls: {}, options: {}, order: ['fal'] });
  const requested = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    requested.push(...body.requests.map((item) => item.endpoint));
    return new Response(JSON.stringify({ quotes: body.requests.map((item) => total(item.endpoint === paidStepRoute('generate_image').endpoint ? 0.15 : 0.04)) }), { status: 200 });
  };
  resetQuoteCache();

  const image = pickImageModel('');
  assert.ok(image, 'a fal key runs an image model');
  const route = paidStepRoute('generate_image', { aspect: '3:4' });
  assert.deepEqual(route.payload, { num_images: 1, aspect_ratio: '3:4' });

  const estimate = await estimatePlan(['generate_image', 'generate_image', 'upscale'], { aspect: '3:4' });
  assert.equal(new Set(requested).size, requested.length, 'each model is quoted once');
  assert.equal(estimate.lines.find((line) => line.name === image.name).count, 2);
  assert.equal(estimate.amount, 0.34);
  assert.equal(estimate.partial, false);
});

test('the plan tool lists each paid call so it can be priced', () => {
  const plan = DESIGN_TOOLS.find((tool) => tool.function.name === 'plan').function.parameters;
  assert.ok(plan.required.includes('paid_steps'));
  assert.deepEqual(new Set(plan.properties.paid_steps.items.enum), COSTLY_TOOLS);
});
