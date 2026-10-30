import test from 'node:test';
import assert from 'node:assert/strict';

// The Audio pages share one library, keep cloned voices in it, and hand
// tracks to the Remix page.
const stored = new Map();
const localStorage = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};
const events = [];
globalThis.localStorage = localStorage;
globalThis.window = { localStorage, dispatchEvent: (event) => events.push(event), addEventListener() {}, removeEventListener() {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const lib = await import('../packages/studio/src/audioLibrary.js');
const entry = (id, extra = {}) => ({ id, url: `/oga-media/${id}.mp3`, page: 'speech', kind: 'speech', prompt: id, model: 'm', modelName: 'M', timestamp: '2026-10-29T00:00:00Z', ...extra });

test('entries and voices persist, newest first', () => {
  lib.resetLibrary();
  stored.clear();
  lib.addEntry(entry('a'));
  lib.addEntry(entry('b', { page: 'music' }));
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['b', 'a']);
  lib.updateEntry('a', { duration: 12.5 });
  assert.equal(lib.getLibrary().entries.find((item) => item.id === 'a').duration, 12.5);
  lib.updateEntry('missing', { duration: 1 });
  lib.addVoice({ id: 'v1', name: 'Me', family: 'minimax-2.6', timestamp: '2026-10-29T00:00:00Z' });
  const saved = JSON.parse(stored.get('oga_audio_library_v1'));
  assert.deepEqual(saved.entries.map((item) => item.id), ['b', 'a']);
  assert.deepEqual(saved.voices.map((voice) => voice.id), ['v1']);
  lib.removeVoice('v1');
  lib.removeEntry('b');
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['a']);
  assert.deepEqual(lib.getLibrary().voices, []);
});

test('the old Audio Studio history is folded in once and its key removed', () => {
  lib.resetLibrary();
  stored.clear();
  stored.set('hg_audio_studio_persistent', JSON.stringify({ selectedModelId: 'x', internalHistory: [{ id: 1, url: '/oga-media/old.mp3', title: 'Old take', prompt: 'hello', model: 'minimax-speech-2.6-hd', timestamp: '2026-10-01T00:00:00Z' }, { id: 2 }] }));
  stored.set('oga_audio_library_v1', JSON.stringify({ entries: [entry('new')] }));
  const { entries } = lib.getLibrary();
  assert.deepEqual(entries.map((item) => item.id), ['new', '1']);
  assert.equal(entries[1].kind, 'legacy');
  assert.equal(entries[1].title, 'Old take');
  assert.equal(stored.has('hg_audio_studio_persistent'), false);
  assert.deepEqual(JSON.parse(stored.get('oga_audio_library_v1')).entries.map((item) => item.id), ['new', '1'], 'the merge is saved');
});

test('broken stored entries are ignored on load', () => {
  lib.resetLibrary();
  stored.clear();
  stored.set('oga_audio_library_v1', JSON.stringify({ entries: [entry('ok'), { id: 'no-url' }, null], voices: [{ id: 'v' }, { id: 'w', name: 'W' }] }));
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['ok']);
  assert.deepEqual(lib.getLibrary().voices.map((voice) => voice.id), ['w']);
});

test('pending runs live in memory only, and a track can be sent to Remix', () => {
  lib.resetLibrary();
  stored.clear();
  events.length = 0;
  lib.addPending({ id: 'run', label: 'Lyria 3', done: 0, total: 1 });
  lib.updatePending('run', { done: 1 });
  assert.equal(lib.getLibrary().pending[0].done, 1);
  lib.removePending('run');
  assert.deepEqual(lib.getLibrary().pending, []);
  assert.equal(stored.has('oga_audio_library_v1'), false);
  lib.sendToAudio('remix', { source: { url: '/oga-media/a.mp3', name: 'a' } });
  assert.deepEqual(events.map((event) => [event.type, event.detail]), [['oga:open-studio', { tabId: 'audio-remix' }]]);
  assert.deepEqual(lib.takeHandoff('remix'), { source: { url: '/oga-media/a.mp3', name: 'a' } });
  assert.equal(lib.takeHandoff('remix'), null);
});
