import test from 'node:test';
import assert from 'node:assert/strict';

// The agent model resolves from provider settings kept in localStorage;
// give the modules just enough window to read and save them.
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

const {
  AGENT_MODELS, CUSTOM_AGENT_MODEL, agentModelForEndpoint, messageCost, rateIdFor, resolveAgentModel, tokenCost,
} = await import('../packages/studio/src/providers/agentModel.js');
const { loadProviderSettings, saveProviderSettings } = await import('../packages/studio/src/providers/keys.js');
const { agentRate } = await import('../packages/studio/src/providers/server/pricing.js');
const { replyCost } = await import('../packages/studio/src/providers/server/chat.js');

const settings = (overrides) => ({ keys: {}, urls: {}, options: {}, order: ['openrouter', 'openai', 'google'], agent: null, ...overrides });

test('every agent model has a unique id, an OpenRouter id and at least one route', () => {
  assert.equal(new Set(AGENT_MODELS.map((model) => model.id)).size, AGENT_MODELS.length);
  for (const model of AGENT_MODELS) {
    assert.ok(model.openrouter, model.id);
    assert.ok(model.routes.length > 0, model.id);
  }
});

test('with nothing chosen, the first chat key runs its default model, as before', () => {
  assert.equal(resolveAgentModel(settings()), null);
  const auto = resolveAgentModel(settings({ keys: { openrouter: 'or-key-123456', openai: 'sk-123456' } }));
  assert.deepEqual([auto.provider, auto.endpoint, auto.chosen], ['openrouter', 'openrouter/auto', false]);
  const openai = resolveAgentModel(settings({ keys: { openai: 'sk-123456' } }));
  assert.deepEqual([openai.provider, openai.endpoint], ['openai', 'gpt-5-mini']);
  // A chat model typed into the old per-provider field still applies until a model is chosen.
  const legacy = resolveAgentModel(settings({ keys: { openai: 'sk-123456' }, options: { openai: { chatModel: 'gpt-6-luna' } } }));
  assert.deepEqual([legacy.endpoint, legacy.name], ['gpt-6-luna', 'GPT-6 Luna']);
});

test('a chosen model runs on the route picked, or another route the keys allow', () => {
  const keys = { openrouter: 'or-key-123456', openai: 'sk-123456' };
  const direct = resolveAgentModel(settings({ keys, agent: { model: 'gpt-6-1-sol', provider: 'openai' } }));
  assert.deepEqual([direct.provider, direct.endpoint, direct.chosen, direct.blocked], ['openai', 'gpt-6.1-sol', true, null]);
  const routed = resolveAgentModel(settings({ keys, agent: { model: 'gpt-6-1-sol', provider: 'openrouter' } }));
  assert.deepEqual([routed.provider, routed.endpoint], ['openrouter', 'openai/gpt-6.1-sol']);
  const fallbackRoute = resolveAgentModel(settings({ keys: { openrouter: 'or-key-123456' }, agent: { model: 'gpt-6-1-sol', provider: 'openai' } }));
  assert.deepEqual([fallbackRoute.provider, fallbackRoute.endpoint], ['openrouter', 'openai/gpt-6.1-sol']);
});

test('a chosen model no key can run is reported, and the default stands in', () => {
  const blocked = resolveAgentModel(settings({ keys: { openai: 'sk-123456' }, agent: { model: 'claude-sonnet-5-5', provider: 'openrouter' } }));
  assert.equal(blocked.chosen, true);
  assert.deepEqual(blocked.blocked, { name: 'Claude Sonnet 5.5', providers: ['openrouter'] });
  assert.deepEqual([blocked.provider, blocked.endpoint], ['openai', 'gpt-5-mini']);
  assert.equal(resolveAgentModel(settings({ agent: { model: 'claude-sonnet-5-5', provider: 'openrouter' } })), null);
});

test('a custom OpenRouter id runs on the OpenRouter key', () => {
  const custom = resolveAgentModel(settings({ keys: { openrouter: 'or-key-123456' }, agent: { model: CUSTOM_AGENT_MODEL, provider: 'openrouter', custom: 'meta/llama-5-maverick' } }));
  assert.deepEqual([custom.provider, custom.endpoint, custom.custom, custom.name], ['openrouter', 'meta/llama-5-maverick', true, 'meta/llama-5-maverick']);
  const noKey = resolveAgentModel(settings({ keys: { openai: 'sk-123456' }, agent: { model: CUSTOM_AGENT_MODEL, custom: 'meta/llama-5-maverick' } }));
  assert.deepEqual(noKey.blocked, { name: 'meta/llama-5-maverick', providers: ['openrouter'] });
});

test('the choice is saved with the provider settings and broken ones are dropped', () => {
  saveProviderSettings({ keys: { openai: 'sk-123456' }, agent: { model: 'gpt-6-luna', provider: 'openai', extra: true } });
  assert.deepEqual(loadProviderSettings().agent, { model: 'gpt-6-luna', provider: 'openai', custom: '' });
  saveProviderSettings({ keys: {}, agent: { provider: 'openai' } });
  assert.equal(loadProviderSettings().agent, null);
});

test('direct endpoints and OpenRouter ids price at the same rates', () => {
  assert.equal(agentModelForEndpoint('gpt-6.1-sol').id, 'gpt-6-1-sol');
  assert.equal(agentModelForEndpoint('gpt-6.1-sol-2026-08-01').id, 'gpt-6-1-sol', 'a dated id names its model');
  assert.equal(agentModelForEndpoint('gpt-6.1-solar'), null);
  assert.equal(rateIdFor('openai', 'gpt-6.1-sol'), 'openai/gpt-6.1-sol');
  assert.equal(rateIdFor('openrouter', 'meta/llama-5-maverick'), 'meta/llama-5-maverick');
  assert.equal(rateIdFor('openai', 'gpt-unknown'), null);

  // Table rates when OpenRouter's list cannot be read; live rates when it can; none for auto.
  assert.deepEqual(agentRate('anthropic/claude-sonnet-5.5'), { input: 2e-6, output: 1e-5, source: 'table' });
  const live = { models: new Map([['anthropic/claude-sonnet-5.5', { prompt: '0.000003', completion: '0.000015' }], ['openrouter/auto', { prompt: '-1', completion: '-1' }]]) };
  assert.deepEqual(agentRate('anthropic/claude-sonnet-5.5', live), { input: 3e-6, output: 1.5e-5, source: 'openrouter' });
  assert.equal(agentRate('openrouter/auto', live), null);

  assert.equal(tokenCost({ input: 2e-6, output: 1e-5 }, { input: 1000, output: 100 }), 0.003);
  assert.equal(messageCost({ input: 2e-6, output: 1e-5 }), 0.042);
  assert.equal(messageCost(null), null);
});

test('a reply costs what OpenRouter reported, or its tokens at the model rate', async () => {
  assert.deepEqual(await replyCost('openrouter', 'openrouter/auto', 'anthropic/claude-sonnet-5.5', { cost: 0.0123, prompt_tokens: 10 }), { cost: 0.0123, costExact: true });
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.deepEqual(await replyCost('openai', 'gpt-6.1-sol', 'gpt-6.1-sol-2026-08-01', { prompt_tokens: 10000, completion_tokens: 1000 }), { cost: 0.03, costExact: false });
  assert.deepEqual(await replyCost('openai', 'gpt-unknown', 'gpt-unknown', { prompt_tokens: 10 }), { cost: null, costExact: false });
  assert.deepEqual(await replyCost('openai', 'gpt-6.1-sol', 'gpt-6.1-sol', null), { cost: null, costExact: false });
});
