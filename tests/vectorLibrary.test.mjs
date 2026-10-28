import test from 'node:test';
import assert from 'node:assert/strict';

// The Vector studio's tools share one library and hand sources to each other.
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

const lib = await import('../packages/studio/src/vectorLibrary.js');
const entry = (id, extra = {}) => ({ id, url: `/oga-media/${id}.svg`, kind: 'svg', tool: 'logo', prompt: id, timestamp: '2026-10-27T00:00:00Z', ...extra });

test('entries persist, newest first, and sets can be removed together', () => {
  lib.resetLibrary();
  stored.clear();
  lib.addEntry(entry('a'));
  lib.addEntries([entry('b', { setId: 'set1', tool: 'icons' }), entry('c', { setId: 'set1', tool: 'icons' })]);
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['b', 'c', 'a']);
  assert.deepEqual(JSON.parse(stored.get('oga_vector_library_v1')).entries.map((item) => item.id), ['b', 'c', 'a']);
  lib.updateEntry('a', { thumbnail: '/oga-media/a.png' });
  assert.equal(lib.getLibrary().entries.find((item) => item.id === 'a').thumbnail, '/oga-media/a.png');
  lib.removeSet('set1');
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['a']);
  lib.removeEntry('a');
  assert.deepEqual(lib.getLibrary().entries, []);
});

test('broken stored entries are ignored on load', () => {
  lib.resetLibrary();
  stored.clear();
  stored.set('oga_vector_library_v1', JSON.stringify({ entries: [entry('ok'), { id: 'no-url' }, null] }));
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['ok']);
});

test('pending runs can be updated and removed', () => {
  lib.resetLibrary();
  lib.addPending({ id: 'run1', label: 'Recraft 4.1', done: 0, total: 3 });
  lib.updatePending('run1', { done: 2 });
  assert.equal(lib.getLibrary().pending[0].done, 2);
  lib.removePending('run1');
  assert.deepEqual(lib.getLibrary().pending, []);
});

test('sendToVector queues a handoff for one tool and asks the shell to open the Vector tab', () => {
  lib.resetLibrary();
  events.length = 0;
  lib.sendToVector('vectorize', { source: { url: '/oga-media/x.png', name: 'logo.png' } });
  assert.equal(events[0].type, 'oga:open-studio');
  assert.deepEqual(events[0].detail, { tabId: 'vector' });
  assert.deepEqual(lib.takeHandoff('vectorize'), { source: { url: '/oga-media/x.png', name: 'logo.png' } });
  assert.equal(lib.takeHandoff('vectorize'), null);
  assert.equal(lib.takeHandoff('logo'), null);
});
