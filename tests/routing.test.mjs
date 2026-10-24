import test from 'node:test';
import assert from 'node:assert/strict';

// The client router runs in the browser; give it just enough window to read
// provider settings from localStorage.
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

const { pickRoute, isEndpointAvailable } = await import('../packages/studio/src/providers/client.js');
const { saveProviderSettings } = await import('../packages/studio/src/providers/keys.js');

const settings = (keys, order) => saveProviderSettings({ keys, urls: {}, options: {}, order });

test('a configured ElevenLabs key wins when it is ordered above fal', () => {
  settings({ fal: 'fal-key-123456', elevenlabs: 'xi-key-1234567' }, ['elevenlabs', 'fal']);
  assert.equal(pickRoute('elevenlabs-v4').provider, 'elevenlabs');
  assert.equal(pickRoute('elevenlabs-text-to-dialogue-v3').provider, 'elevenlabs');
});

test('fal wins when it is ordered above ElevenLabs', () => {
  settings({ fal: 'fal-key-123456', elevenlabs: 'xi-key-1234567' }, ['fal', 'elevenlabs']);
  assert.equal(pickRoute('elevenlabs-v4').provider, 'fal');
});

test('without an ElevenLabs key the reseller still serves the model', () => {
  settings({ fal: 'fal-key-123456' }, ['elevenlabs', 'fal']);
  assert.equal(pickRoute('elevenlabs-v4').provider, 'fal');
  assert.equal(isEndpointAvailable('elevenlabs-v4'), true);
});

test('an ElevenLabs key alone does not unlock models ElevenLabs does not serve', () => {
  settings({ elevenlabs: 'xi-key-1234567' }, ['elevenlabs', 'fal']);
  assert.equal(pickRoute('elevenlabs-v4').provider, 'elevenlabs');
  assert.equal(isEndpointAvailable('elevenlabs-music-v2-5'), false);
  assert.throws(() => pickRoute('elevenlabs-music-v2-5'), /fal\.ai or WaveSpeedAI key/);
});
