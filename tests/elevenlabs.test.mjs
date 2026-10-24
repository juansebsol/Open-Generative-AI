import test from 'node:test';
import assert from 'node:assert/strict';
import { submit } from '../packages/studio/src/providers/server/adapters/elevenlabs.js';

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    return handler(call);
  };
  return calls;
}

const audio = () => new Response(new Uint8Array([73, 68, 51, 4]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });

test('text to speech resolves a voice name and posts voice settings', async () => {
  const calls = mockFetch((call) => {
    if (call.url.startsWith('https://api.elevenlabs.io/v2/voices')) {
      return new Response(JSON.stringify({ voices: [{ voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', category: 'premade' }] }), { status: 200 });
    }
    return audio();
  });
  const result = await submit({ endpoint: 'eleven_v4', input: { prompt: 'Hello there', voice_id: 'voice_daniel', stability: 0.3, speed: 1.1, language_code: 'en' }, key: 'xi-test' });
  assert.equal(result.state, 'succeeded');
  assert.match(result.outputs[0].url, /^data:audio\/mpeg;base64,/);
  assert.equal(result.outputs[0].type, 'audio');
  const tts = calls.find((call) => call.url.includes('/v1/text-to-speech/'));
  assert.match(tts.url, /\/v1\/text-to-speech\/onwK4e9ZLuTAKqWW03F9\?output_format=mp3_44100_128$/);
  assert.equal(tts.headers['xi-api-key'], 'xi-test');
  assert.deepEqual(tts.body, {
    text: 'Hello there',
    model_id: 'eleven_v4',
    voice_settings: { stability: 0.3, similarity_boost: 0.75, style: 0, speed: 1.1, use_speaker_boost: true },
    language_code: 'en',
  });
});

test('a real voice id is used without a lookup', async () => {
  const calls = mockFetch(() => audio());
  await submit({ endpoint: 'eleven_flash_v2_5', input: { prompt: 'Hi', voice_id: '21m00Tcm4TlvDq8ikWAM' }, key: 'xi-test' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /text-to-speech\/21m00Tcm4TlvDq8ikWAM/);
});

test('dialogue posts inputs with the dialogue settings shape and enforces the character limit', async () => {
  const calls = mockFetch(() => audio());
  await submit({ endpoint: 'eleven_v3', input: { dialogue: [{ text: 'Hi', voice_id: '21m00Tcm4TlvDq8ikWAM' }, { text: ' ', voice_id: 'x' }, { text: 'Hello', voice_id: 'pNInz6obpgDQGcFmaJgB' }], stability: 0.4 }, key: 'xi-test' });
  const call = calls[0];
  assert.match(call.url, /\/v1\/text-to-dialogue\?output_format=mp3_44100_128$/);
  assert.deepEqual(call.body.inputs, [{ text: 'Hi', voice_id: '21m00Tcm4TlvDq8ikWAM' }, { text: 'Hello', voice_id: 'pNInz6obpgDQGcFmaJgB' }]);
  assert.deepEqual(call.body.settings, { stability: 0.4, similarity: 0.75 });
  assert.equal(call.body.model_id, 'eleven_v3');

  await assert.rejects(
    () => submit({ endpoint: 'eleven_v3', input: { dialogue: [{ text: 'x'.repeat(2001), voice_id: '21m00Tcm4TlvDq8ikWAM' }] }, key: 'xi-test' }),
    /up to 2000 characters/,
  );
});

test('provider errors carry the ElevenLabs message and status', async () => {
  mockFetch(() => new Response(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }), { status: 401 }));
  await assert.rejects(
    () => submit({ endpoint: 'eleven_v4', input: { prompt: 'Hi', voice_id: '21m00Tcm4TlvDq8ikWAM' }, key: 'bad' }),
    (error) => error.status === 401 && /Invalid API key/.test(error.message),
  );
});
