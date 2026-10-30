import test from 'node:test';
import assert from 'node:assert/strict';

// The helper bubble reads its open state from localStorage and the studios'
// modes from a window event; both are faked here.
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

const helper = await import('../packages/studio/src/benchmarksHelper.js');
const { CATEGORIES, categoryEntries, rankEntries } = await import('../packages/studio/src/benchmarks.js');
const { BENCHMARKS } = await import('../packages/studio/src/providers/catalog/benchmarks.js');

test('each studio page maps to the Benchmarks category for what it does', () => {
  assert.equal(helper.helperCategoryFor('image', undefined), 'text-to-image', 'no mode yet means the default');
  assert.equal(helper.helperCategoryFor('image', 'text'), 'text-to-image');
  assert.equal(helper.helperCategoryFor('image', 'edit'), 'image-editing');
  assert.equal(helper.helperCategoryFor('video', 't2v'), 'text-to-video');
  assert.equal(helper.helperCategoryFor('video', 'i2v'), 'image-to-video');
  assert.equal(helper.helperCategoryFor('video', 'v2v'), null, 'no board scores video to video');
  assert.equal(helper.helperCategoryFor('audio-speech'), 'text-to-speech');
  assert.equal(helper.helperCategoryFor('audio-dialogue'), 'text-to-speech');
  assert.equal(helper.helperCategoryFor('audio-music'), 'music');
  assert.equal(helper.helperCategoryFor('three-d-text'), 'three-d');
  assert.equal(helper.helperCategoryFor('three-d-image'), 'three-d');
  assert.equal(helper.helperCategoryFor('vector-logo'), 'vector');
  assert.equal(helper.helperCategoryFor('vector-icons'), 'vector');
});

test('pages with no picker or no scored models show no bubble', () => {
  for (const tabId of ['vector-vectorize', 'audio-remix', 'vibe-motion', 'agents', 'workflows', 'benchmarks', 'layers', 'three-d-rig', 'nope', undefined]) {
    assert.equal(helper.helperCategoryFor(tabId), null, String(tabId));
    assert.deepEqual(helper.helperEntries(tabId), [], String(tabId));
  }
  for (const tabId of helper.HELPER_TAB_IDS) assert.ok(CATEGORIES.some((category) => category.id === helper.helperCategoryFor(tabId)), tabId);
});

test('rows open on the page the visitor is on, and 3D pages keep only their own models', () => {
  const text = helper.helperEntries('three-d-text');
  const image = helper.helperEntries('three-d-image');
  assert.ok(text.length > 0 && image.length > 0);
  assert.ok(text.every((entry) => entry.studio === 'three-d-text' && entry.model.kind === 'text'));
  assert.ok(image.every((entry) => entry.studio === 'three-d-image' && entry.model.kind !== 'text'));
  assert.equal(text.length + image.length, categoryEntries('three-d').length, 'nothing is lost between the two pages');

  const icons = helper.helperEntries('vector-icons');
  assert.ok(icons.every((entry) => entry.studio === 'vector-icons'), 'Icon Set selects on Icon Set, not Text to Logo');
  assert.deepEqual(icons.map((entry) => entry.id), helper.helperEntries('vector-logo').map((entry) => entry.id));
  assert.ok(helper.helperEntries('image', 'edit').every((entry) => entry.studio === 'image'));
});

test('the vector category scores native and code-written SVG models from one board', () => {
  const vector = categoryEntries('vector');
  const scored = vector.filter((entry) => Number.isFinite(entry.score));
  assert.ok(scored.some((entry) => entry.id === 'recraft-v4-1-text-to-vector'));
  assert.ok(scored.some((entry) => entry.id === 'svg-claude-sonnet-5-5'));
  assert.equal(vector.find((entry) => entry.id === 'ideogram-vector-text-to-vector').score, null, 'no public board lists Ideogram Vector');
  assert.ok(scored.every((entry) => BENCHMARKS[entry.id].source === 'rapidata-svg'), 'one scale per category');
  assert.ok(!vector.some((entry) => entry.model.kind === 'vectorize'), 'tracers are not ranked');
});

const row = (id, score, price) => ({ id, name: id, score, price });

test('helper rows merge a model that wins several picks and list the next best under More', () => {
  const ranking = rankEntries([row('top', 1200, 0.02), row('second', 1150, 0.5), row('third', 1100, 0.3), row('fourth', 1050, 0.1), row('unscored', null, 0.01)]);
  const { picks, more } = helper.helperRows(ranking, 2);
  assert.deepEqual(picks.map((item) => [item.row.id, item.kinds]), [['top', ['best', 'bestValue', 'cheapestDecent']]]);
  assert.deepEqual(more.map((item) => item.id), ['second', 'third'], 'More lists scored non-picks by score, capped');
});

test('helper rows keep the three picks in order when they differ', () => {
  // value: (1250-1000)/0.05 = 5000 beats (1101-1000)/0.03 ≈ 3367; cheap is still decent (floor 1100) and cheapest.
  const ranking = rankEntries([row('best', 1300, 1), row('value', 1250, 0.05), row('cheap', 1101, 0.03)]);
  const { picks, more } = helper.helperRows(ranking);
  assert.deepEqual(picks.map((item) => item.row.id), ['best', 'value', 'cheap']);
  assert.deepEqual(picks.map((item) => item.kinds), [['best'], ['bestValue'], ['cheapestDecent']]);
  assert.deepEqual(more, []);
  assert.deepEqual(helper.helperRows({ picks: {}, rows: [] }), { editorsPick: null, picks: [], more: [] });
});

test('the bubble is open the first time and remembers being closed per visitor', () => {
  stored.clear();
  assert.equal(helper.loadHelperOpen(), true);
  helper.saveHelperOpen(false);
  assert.equal(JSON.parse(stored.get(helper.HELPER_STORAGE_KEY)).open, false);
  assert.equal(helper.loadHelperOpen(), false);
  helper.saveHelperOpen(true);
  assert.equal(helper.loadHelperOpen(), true);
  stored.set(helper.HELPER_STORAGE_KEY, 'not json');
  assert.equal(helper.loadHelperOpen(), true, 'a broken value falls back to open');
  stored.set(helper.HELPER_STORAGE_KEY, JSON.stringify({ open: 'no' }));
  assert.equal(helper.loadHelperOpen(), true);
});

test('on a phone-width screen the bubble starts closed until the visitor opens it', () => {
  stored.clear();
  assert.equal(helper.loadHelperOpen({ narrow: true }), false);
  helper.saveHelperOpen(true);
  assert.equal(helper.loadHelperOpen({ narrow: true }), true, 'an explicit choice wins');
  helper.saveHelperOpen(false);
  assert.equal(helper.loadHelperOpen({ narrow: false }), false);
});

test('studios announce their mode with an event and the last mode per tab is kept', () => {
  helper.resetStudioModes();
  events.length = 0;
  assert.equal(helper.getStudioMode('image'), undefined);
  helper.announceStudioMode('image', 'edit');
  helper.announceStudioMode('video', 'i2v');
  helper.announceStudioMode('image', 'text');
  assert.equal(helper.getStudioMode('image'), 'text');
  assert.equal(helper.getStudioMode('video'), 'i2v');
  assert.equal(events.length, 3);
  assert.equal(events[0].type, helper.STUDIO_MODE_EVENT);
  assert.deepEqual(events[0].detail, { tabId: 'image', mode: 'edit' });
});

test('See all links to the Benchmarks page with the category preselected', () => {
  assert.equal(helper.benchmarksHref('/studio/benchmarks', 'image-editing'), '/studio/benchmarks?category=image-editing');
  assert.equal(helper.benchmarksHref('/zh/studio/benchmarks', 'three-d'), '/zh/studio/benchmarks?category=three-d');
  assert.equal(helper.benchmarksHref('/studio/benchmarks', null), '/studio/benchmarks');
});

test("the editor's choice has its own entry and keeps its numbered place in the chart", () => {
  const ranking = rankEntries([row('svg-gpt-6-1-sol', 1437, 0.02), row('svg-claude-sonnet-5-5', 1392, 0.02), row('svg-gemini-4-argon', 1318, 0.01), row('svg-claude-haiku-5-5', 1247, 0.001), row('recraft-v4-1-text-to-vector', 998, 0.08)]);
  const { editorsPick, picks, more } = helper.helperRows(ranking, 10, { categoryId: 'vector' });
  assert.equal(editorsPick.row.id, 'svg-gemini-4-argon');
  assert.ok(editorsPick.row.editorsPick.note.length > 0);
  const chart = [...picks.map((item) => item.row.id), ...more.map((item) => item.id)];
  assert.ok(chart.includes('svg-gemini-4-argon'), 'the chart stays complete');
  assert.equal(picks[0].row.id, 'svg-gpt-6-1-sol', 'best quality still leads the chart');
  assert.equal(new Set(chart).size, chart.length, 'no model twice in the chart');
  // A choice that also wins a computed pick keeps its labels in the chart.
  const small = rankEntries([row('svg-gemini-4-argon', 1318, 0.01), row('recraft-v4-1-text-to-vector', 998, 0.08)]);
  const chosen = helper.helperRows(small, 10, { categoryId: 'vector' });
  assert.deepEqual(chosen.editorsPick.kinds, ['best', 'bestValue', 'cheapestDecent']);
  assert.deepEqual(chosen.picks.map((item) => [item.row.id, item.kinds]), [['svg-gemini-4-argon', ['best', 'bestValue', 'cheapestDecent']]]);
  assert.deepEqual(chosen.more.map((item) => item.id), ['recraft-v4-1-text-to-vector']);
  // No category, or one without a choice: no entry and the chart is as before.
  assert.equal(helper.helperRows(ranking, 10).editorsPick, null);
  assert.equal(helper.helperRows(ranking, 10, { categoryId: 'text-to-image' }).editorsPick, null);
  assert.deepEqual(helper.helperRows(ranking, 10, { categoryId: 'text-to-image' }).picks, helper.helperRows(ranking, 10).picks);
});

test('a page remembers which editor\'s choice it applied, per page', async () => {
  const seen = await import('../packages/studio/src/editorsPickSeen.js');
  stored.clear();
  assert.equal(seen.loadPickSeen('vector-logo'), null);
  seen.savePickSeen('vector-logo', 'svg-gemini-4-argon');
  seen.savePickSeen('image', 'nano-banana-2-1');
  assert.equal(seen.loadPickSeen('vector-logo'), 'svg-gemini-4-argon');
  assert.equal(seen.loadPickSeen('image'), 'nano-banana-2-1');
  assert.equal(seen.loadPickSeen('video'), null);
  seen.savePickSeen('image', null);
  assert.equal(seen.loadPickSeen('image'), null);
  stored.set(seen.PICK_SEEN_STORAGE_KEY, 'not json');
  assert.equal(seen.loadPickSeen('vector-logo'), null, 'a broken value is ignored');
});
