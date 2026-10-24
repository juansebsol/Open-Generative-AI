import test from 'node:test';
import assert from 'node:assert/strict';
import { getBalance } from '../packages/studio/src/providers/server/balance.js';

function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    const [status, body] = routes[url] || [404, { error: 'not found' }];
    return new Response(JSON.stringify(body), { status });
  };
  return calls;
}

test('wavespeed balance reads data.balance', async () => {
  const calls = mockFetch({ 'https://api.wavespeed.ai/api/v3/balance': [200, { code: 200, data: { balance: 50.25 } }] });
  assert.deepEqual(await getBalance({ provider: 'wavespeed', key: 'ws-key-123456' }), { kind: 'balance', amount: 50.25, currency: 'USD' });
  assert.equal(calls[0].auth, 'Bearer ws-key-123456');
});

test('openrouter falls back to the key limit without a management key', async () => {
  mockFetch({
    'https://openrouter.ai/api/v1/credits': [403, { error: { message: 'management key required' } }],
    'https://openrouter.ai/api/v1/key': [200, { data: { limit_remaining: 7.5, usage: 2.5 } }],
  });
  assert.deepEqual(await getBalance({ provider: 'openrouter', key: 'sk-or-123456' }), { kind: 'keyLimit', amount: 7.5, currency: 'USD' });
});

test('fal reports when the key is not an admin key', async () => {
  const calls = mockFetch({ 'https://api.fal.ai/v1/account/billing?expand=credits': [403, { detail: 'admin key required' }] });
  assert.deepEqual(await getBalance({ provider: 'fal', key: 'fal-key-123456' }), { kind: 'needsAdminKey' });
  assert.equal(calls[0].auth, 'Key fal-key-123456');
});

test('elevenlabs reports characters left in the billing period', async () => {
  const calls = mockFetch({ 'https://api.elevenlabs.io/v1/user/subscription': [200, { tier: 'creator', character_count: 12000, character_limit: 100000 }] });
  assert.deepEqual(await getBalance({ provider: 'elevenlabs', key: 'xi-key-1234567' }), { kind: 'characters', used: 12000, limit: 100000, remaining: 88000, tier: 'creator' });
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/user/subscription');
});
