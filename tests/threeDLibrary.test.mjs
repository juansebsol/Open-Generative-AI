import test from 'node:test';
import assert from 'node:assert/strict';

// The 3D pages share one library and hand models to each other through it.
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

const lib = await import('../packages/studio/src/threeDLibrary.js');
const entry = (id) => ({ id, url: `https://cdn.example/${id}.glb`, files: [], prompt: id, modelName: 'Meshy 7.1', timestamp: '2026-10-24T00:00:00Z' });

test('entries persist and newest come first', () => {
  lib.resetLibrary();
  stored.clear();
  lib.addEntry(entry('a'));
  lib.addEntry(entry('b'));
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['b', 'a']);
  assert.deepEqual(JSON.parse(stored.get('hg_three_d_library')).entries.map((item) => item.id), ['b', 'a']);
  lib.removeEntry('b');
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['a']);
});

test('results from the old single-tab studio move into the library once', () => {
  lib.resetLibrary();
  stored.clear();
  stored.set('hg_three_d_studio_persistent', JSON.stringify({ history: [entry('old'), { id: 'broken' }] }));
  assert.deepEqual(lib.getLibrary().entries.map((item) => item.id), ['old']);
  assert.equal(stored.has('hg_three_d_studio_persistent'), false);
});

test('sendTo queues a handoff for one page and asks the shell to open its tab', () => {
  lib.resetLibrary();
  stored.clear();
  events.length = 0;
  const source = { url: 'https://cdn.example/a.glb', name: 'a', thumbnail: null, fromId: 'a' };
  lib.sendTo('retexture', { source, toolLabel: 'retexture' });
  assert.equal(events[0].type, 'oga:open-studio');
  assert.equal(events[0].detail.tabId, 'three-d-retexture');
  assert.equal(lib.takeHandoff('rig'), null);
  assert.deepEqual(lib.takeHandoff('retexture'), { source, toolLabel: 'retexture' });
  assert.equal(lib.takeHandoff('retexture'), null);
});

test('pending runs are shared and cleared by id', () => {
  lib.resetLibrary();
  lib.addPending({ id: 'run-1', label: 'Meshy 7.1' });
  assert.equal(lib.getLibrary().pending.length, 1);
  lib.removePending('run-1');
  assert.equal(lib.getLibrary().pending.length, 0);
});
