import test from 'node:test';
import assert from 'node:assert/strict';
import { mapInput, coerceValue, MappingError } from '../packages/studio/src/providers/mapper.js';
import { extractOutputs } from '../packages/studio/src/providers/server/outputs.js';

const schema = (props, required = []) => ({ props, required });

test('maps aliases and coerces types against the schema', () => {
  const { input } = mapInput(
    { prompt: 'a cat', image_url: 'https://x/a.png', duration: 5, seed: -1, onRequestId: () => {} },
    { provider: 'fal', endpoint: 'demo' },
    schema({ prompt: { type: 'string' }, image_urls: { type: 'array', items: 'string' }, duration: { type: 'string', enum: ['5', '10'] } }, ['prompt']),
  );
  assert.deepEqual(input, { prompt: 'a cat', image_urls: ['https://x/a.png'], duration: '5' });
});

test('split spreads first/last frames over two fields', () => {
  const { input } = mapInput(
    { prompt: 'p', images_list: ['https://x/1.png', 'https://x/2.png'] },
    { provider: 'fal', endpoint: 'demo', split: { images_list: ['image_url', 'end_image_url'] } },
    schema({ prompt: { type: 'string' }, image_url: { type: 'string' }, end_image_url: { type: 'string' } }),
  );
  assert.equal(input.image_url, 'https://x/1.png');
  assert.equal(input.end_image_url, 'https://x/2.png');
});

test('fixed values win, defaults only fill gaps, null value remaps drop the field', () => {
  const { input } = mapInput(
    { prompt: '', resolution: '480p', aspect_ratio: 'adaptive' },
    {
      provider: 'wavespeed',
      endpoint: 'demo',
      fixed: { resolution: '1080p' },
      defaults: { prompt: 'A person speaking.' },
      values: { aspect_ratio: { adaptive: null } },
    },
    schema({ prompt: { type: 'string' }, resolution: { type: 'string' }, aspect_ratio: { type: 'string' } }, ['prompt']),
  );
  assert.deepEqual(input, { resolution: '1080p', prompt: 'A person speaking.' });
});

test('aspect ratio becomes a size of at least the target area', () => {
  const { input } = mapInput(
    { prompt: 'p', aspect_ratio: '2:3' },
    { provider: 'wavespeed', endpoint: 'demo' },
    schema({ prompt: { type: 'string' }, size: { type: 'string', default: '1024*1024' } }),
  );
  const [width, height] = input.size.split('*').map(Number);
  assert.ok(width * height >= 1024 * 1024);
  assert.equal(width % 16, 0);
  assert.equal(height % 16, 0);
});

test('missing required inputs raise a MappingError', () => {
  assert.throws(
    () => mapInput({}, { provider: 'fal', endpoint: 'demo' }, schema({ prompt: { type: 'string' } }, ['prompt'])),
    MappingError,
  );
});

test('enum matching does not mangle ratios or sizes', () => {
  assert.equal(coerceValue('27:16', { type: 'string', enum: ['16:9', '9:16', '1:1'] }), undefined);
  assert.equal(coerceValue('2K', { type: 'string', enum: ['square_hd', 'landscape_4_3'] }), undefined);
  assert.equal(coerceValue('8', { type: 'string', enum: ['5', '10'] }), '10');
  assert.equal(coerceValue('4K', { type: 'string', enum: ['480p', '720p', '1080p', '4k'] }), '4k');
});

test('extractOutputs finds media in common provider result shapes', () => {
  assert.deepEqual(extractOutputs({ images: [{ url: 'https://cdn/a.png', content_type: 'image/png' }] }), [{ url: 'https://cdn/a.png', type: 'image' }]);
  assert.deepEqual(extractOutputs({ video: { url: 'https://cdn/v.mp4' } }), [{ url: 'https://cdn/v.mp4', type: 'video' }]);
  assert.deepEqual(extractOutputs({ outputs: ['https://cdn/s.mp3'] }), [{ url: 'https://cdn/s.mp3', type: 'audio' }]);
  assert.deepEqual(extractOutputs({ prompt: 'https://not-media', seed: 1 }), []);
});

test('flux-lora transform builds a loras list', () => {
  const { input } = mapInput(
    { prompt: 'p', lora_url: 'https://x/style.safetensors', lora_weight: 0.7 },
    { provider: 'fal', endpoint: 'demo', transform: 'flux-lora' },
    schema({ prompt: { type: 'string' }, loras: { type: 'array', items: 'object' } }),
  );
  assert.deepEqual(input.loras, [{ path: 'https://x/style.safetensors', scale: 0.7 }]);
});

test('elevenlabs-dialogue transform renames voice_id per turn', () => {
  const { input } = mapInput(
    { dialogue: [{ text: 'Hi', voice_id: 'abc' }, { text: '', voice_id: 'x' }] },
    { provider: 'fal', endpoint: 'demo', transform: 'elevenlabs-dialogue' },
    schema({ inputs: { type: 'array', items: 'object' } }, ['inputs']),
  );
  assert.deepEqual(input.inputs, [{ text: 'Hi', voice: 'abc' }]);
});

test('gemini-tts transform builds a speaker script per provider', () => {
  const payload = {
    speakers: [
      { speaker_id: 'Speaker 1', voice_name: 'Puck', style: 'Deadpan' },
      { speaker_id: 'Speaker 2', voice_name: 'Kore' },
    ],
    dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'Hello' }, { speaker_id: 'Speaker 2', text: 'Hi' }],
  };
  const fal = mapInput(payload, { provider: 'fal', endpoint: 'demo', transform: 'gemini-tts' },
    schema({ prompt: { type: 'string' }, speakers: { type: 'array', items: 'object' }, style_instructions: { type: 'string' } }, ['prompt'])).input;
  assert.equal(fal.prompt, 'Speaker 1: Hello\nSpeaker 2: Hi');
  assert.deepEqual(fal.speakers, [{ speaker_id: 'Speaker 1', voice: 'Puck' }, { speaker_id: 'Speaker 2', voice: 'Kore' }]);
  assert.match(fal.style_instructions, /Speaker 1: Deadpan delivery/);

  const single = mapInput({ speakers: [payload.speakers[0]], dialogue_turns: [payload.dialogue_turns[0]] },
    { provider: 'wavespeed', endpoint: 'demo', transform: 'gemini-tts' },
    schema({ text: { type: 'string' }, voice: { type: 'string' } }, ['text'])).input;
  assert.deepEqual(single, { text: 'Hello', voice: 'Puck' });
});
