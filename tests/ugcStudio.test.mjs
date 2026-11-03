import test from 'node:test';
import assert from 'node:assert/strict';

// The studio reads keys and its library from localStorage; give the modules
// just enough window.
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

const { SCENES, framePrompt, spokenSeconds, takeLines, takePrompt, wordCount } = await import('../packages/studio/src/ugc/scenes.js');
const { audioKey, durationOptions, fitDuration, pricePayload, resolveEngine, takeRequest, voicesOf } = await import('../packages/studio/src/ugc/engines.js');
const { loadInfluencers, loadStudio, parseScript, saveStudio, scriptRequest } = await import('../packages/studio/src/ugc/library.js');
const { saveProviderSettings } = await import('../packages/studio/src/providers/keys.js');
const { i2vModels, audioModels } = await import('../packages/studio/src/models.js');

const model = (id) => i2vModels.find((entry) => entry.id === id);

test('a script is timed at talking speed and each take opens on its own hook', () => {
  assert.equal(wordCount('Okay, I need to talk about this can.'), 8);
  assert.equal(spokenSeconds(''), 0);
  assert.equal(spokenSeconds('one two three four five six seven eight nine ten eleven twelve thirteen'), 6);
  assert.deepEqual(takeLines(['Hook one', 'Hook two'], 'The rest.', 3).map((take) => take.line), ['Hook one The rest.', 'Hook two The rest.', 'Hook one The rest.']);
  assert.deepEqual(takeLines([], 'Just this.', 2), [{ hook: '', line: 'Just this.' }, { hook: '', line: 'Just this.' }]);
});

test('the prompts carry the scene, the product and the line', () => {
  const frame = framePrompt({ scene: 'car', placement: 'hand', product: { name: 'cold brew can' }, aspect: '9:16' });
  assert.match(frame, /^Vertical 9:16/);
  assert.match(frame, /driver’s seat/);
  assert.match(frame, /hold the cold brew can from the second image/);
  assert.doesNotMatch(framePrompt({ scene: 'car', placement: 'none', product: { name: 'can' } }), /second image/);
  const take = takePrompt({ scene: 'talking', tone: 'deadpan', line: 'It just works.' });
  assert.match(take, /deadpan/);
  assert.match(take, /says: "It just works\."/);
  assert.equal(new Set(SCENES.map((scene) => scene.id)).size, SCENES.length);
});

test('durations fit the script, or say when they cannot', () => {
  const kling = model('kling-v3.0-omni-pro-image-to-video');
  assert.equal(durationOptions(kling).at(-1), 15);
  assert.deepEqual(fitDuration(kling, 11), { duration: 11, fits: true, longest: 15 });
  assert.deepEqual(fitDuration(kling, 20), { duration: 15, fits: false, longest: 15 });
  assert.deepEqual(durationOptions(model('seedance-v1.5-pro-i2v')).slice(0, 2), [4, 5]);
  assert.equal(audioKey(model('kling-v2.6-pro-i2v')), 'sound');
  assert.equal(audioKey(model('wan3.0-image-to-video')), 'enable_audio');
  assert.equal(audioKey(model('veo3.1-image-to-video')), null);
});

test('auto picks a one-take model long enough, else the talking avatar', () => {
  saveProviderSettings({ keys: { fal: 'fal-key-123456' }, urls: {}, options: {}, order: ['fal'] });
  const short = resolveEngine('auto', 10);
  assert.equal(short.kind, 'take');
  assert.ok(short.fits);
  const long = resolveEngine('auto', 45);
  assert.equal(long.kind, 'avatar', 'nothing films 45 s in one take');
  assert.ok(long.voice, 'a voice reads it');

  const request = takeRequest(short, { frame: 'https://example.com/frame.jpg', prompt: 'Say it', aspect: '9:16' });
  assert.equal(request.image_url, 'https://example.com/frame.jpg');
  assert.ok(request.duration >= 10);
  const price = pricePayload(short, '9:16');
  assert.equal(price.payload.image_url, undefined, 'media stays out of the quote');
  assert.equal(price.payload.duration, request.duration);
});

test('voices read from the text-to-speech catalog', () => {
  const voices = voicesOf(audioModels.find((entry) => entry.id === 'elevenlabs-tts-turbo-2-5'));
  assert.ok(voices.length > 3);
  assert.ok(voices[0].id && voices[0].label);
});

test('AI Influencer Studio creators come over with their traits', () => {
  const creators = loadInfluencers({ history: [{ id: 'a1', url: 'https://example.com/maya.jpg', traits: ['Curly red hair', 'Freckles', '20s', 'Green eyes'] }, { id: 'broken' }] });
  assert.equal(creators.length, 1);
  assert.equal(creators[0].label, 'Curly red hair · Freckles · 20s');
  assert.equal(creators[0].source, 'influencer');
});

test('takes still filming when the page closed come back as interrupted', () => {
  saveStudio({
    batches: [{ id: 'b1', createdAt: 1, scene: 'car', tone: 'calm', aspect: '9:16', engine: { kind: 'take', model: 'x', name: 'X' }, takes: [{ id: 't1', status: 'done', url: 'https://example.com/a.mp4', hook: 'Hi' }, { id: 't2', status: 'filming' }] }],
    draft: { takes: 9, scene: 'nope', hooks: ['One', ''] },
  });
  const { batches, draft } = loadStudio();
  assert.equal(batches[0].takes[1].status, 'error');
  assert.equal(batches[0].takes[1].error, 'interrupted');
  assert.equal(draft.takes, 4);
  assert.equal(draft.scene, 'talking');
  assert.deepEqual(draft.hooks, ['One']);
});

test('the script writer asks for four hooks and reads them back', () => {
  const { system, user } = scriptRequest({ product: 'North cold brew', audience: 'busy people', seconds: 15, creator: 'Maya' });
  assert.match(system, /"hooks": \[4 strings\]/);
  assert.match(user, /North cold brew/);
  assert.deepEqual(parseScript({ hooks: ['A', 'B', ' '], middle: 'Middle.', cta: 'Link in bio.' }), { hooks: ['A', 'B'], body: 'Middle. Link in bio.' });
  assert.throws(() => parseScript({}));
});
