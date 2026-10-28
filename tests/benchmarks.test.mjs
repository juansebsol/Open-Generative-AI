import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARKS, BENCHMARKS_UPDATED, DECENT_GAP, SOURCES, VALUE_FLOOR_GAP } from '../packages/studio/src/providers/catalog/benchmarks.js';
import { CATEGORIES, benchmarkPayload, categoryEntries, compareRows, priceOf, rankEntries, valueScore, TTS_SAMPLE_CHARACTERS } from '../packages/studio/src/benchmarks.js';
import { ALL_MODEL_LISTS } from '../packages/studio/src/models.js';

const entry = (id, score, price) => ({ id, name: id, score, price });

test('best quality is the highest score, ties going to the cheaper model', () => {
  const { picks, topScore } = rankEntries([entry('a', 1200, 0.2), entry('b', 1200, 0.1), entry('c', 1100, 0.01)]);
  assert.equal(topScore, 1200);
  assert.equal(picks.best.id, 'b');
});

test('best value is quality above the floor per dollar, not raw score per dollar', () => {
  // 'cheap' is far below the leader: raw Elo/$ would crown it, the floor does not.
  const rows = [entry('top', 1222, 0.21), entry('mid', 1176, 0.034), entry('cheap', 740, 0.003)];
  const { picks, valueFloor } = rankEntries(rows);
  assert.equal(valueFloor, 1222 - VALUE_FLOOR_GAP);
  assert.equal(picks.bestValue.id, 'mid');
  assert.equal(valueScore(740, 0.003, 1222), 0, 'nothing above the floor counts as no value');
  assert.equal(valueScore(1176, 0.034, 1222), (1176 - 922) / 0.034);
});

test('cheapest decent is the lowest price within DECENT_GAP of the leader', () => {
  const rows = [entry('top', 1200, 0.5), entry('ok', 1000, 0.02), entry('tooWeak', 999, 0.001), entry('alsoOk', 1050, 0.02)];
  const { picks, decentFloor, rows: ranked } = rankEntries(rows);
  assert.equal(decentFloor, 1200 - DECENT_GAP);
  assert.equal(picks.cheapestDecent.id, 'alsoOk', 'same price: the better-scored model wins');
  assert.deepEqual(ranked.map((row) => row.decent), [true, true, false, true]);
});

test('unscored models never win a pick but stay in the rows', () => {
  const rows = [entry('scored', 1000, 0.1), entry('mystery', null, 0.0001)];
  const { picks, rows: ranked } = rankEntries(rows);
  assert.equal(picks.best.id, 'scored');
  assert.equal(picks.bestValue.id, 'scored');
  assert.equal(picks.cheapestDecent.id, 'scored');
  assert.equal(ranked.find((row) => row.id === 'mystery').value, null);
  assert.equal(ranked.find((row) => row.id === 'mystery').decent, false);
});

test('unpriced models can be best quality but not best value or cheapest', () => {
  const rows = [entry('great', 1300, null), entry('fine', 1250, 0.05)];
  const { picks } = rankEntries(rows);
  assert.equal(picks.best.id, 'great');
  assert.equal(picks.bestValue.id, 'fine');
  assert.equal(picks.cheapestDecent.id, 'fine');
});

test('a free local model above the floor has infinite value', () => {
  const { picks, rows } = rankEntries([entry('paid', 1200, 0.1), entry('local', 1000, 0)]);
  assert.equal(rows.find((row) => row.id === 'local').value, Infinity);
  assert.equal(picks.bestValue.id, 'local');
  assert.equal(rankEntries([entry('paid', 1300, 0.1), entry('local', 900, 0)]).picks.bestValue.id, 'paid', 'free but below the floor is worth nothing');
});

test('with no scored models there are no picks', () => {
  const { picks, topScore } = rankEntries([entry('a', null, 0.1), entry('b', null, null)]);
  assert.deepEqual([topScore, picks.best, picks.bestValue, picks.cheapestDecent], [null, null, null, null]);
});

test('priceOf turns quotes into one number only when there is one', () => {
  assert.equal(priceOf({ kind: 'total', amount: 0.034 }), 0.034);
  assert.equal(priceOf({ kind: 'free' }), 0);
  assert.equal(priceOf({ kind: 'unit', unitPrice: 0.1 }), null);
  assert.equal(priceOf({ kind: 'noProvider' }), null);
  assert.equal(priceOf(null), null);
});

test('table sorting puts missing scores and prices last in either direction', () => {
  const rows = [entry('a', 1000, null), entry('b', null, 0.1), entry('c', 1100, 0.2)];
  assert.deepEqual(rows.slice().sort(compareRows('score', 'desc')).map((row) => row.id), ['c', 'a', 'b']);
  assert.deepEqual(rows.slice().sort(compareRows('score', 'asc')).map((row) => row.id), ['a', 'c', 'b']);
  assert.deepEqual(rows.slice().sort(compareRows('price', 'asc')).map((row) => row.id), ['b', 'c', 'a']);
});

test('every scored id is a catalog model and every score names its source', () => {
  const ids = new Set(Object.values(ALL_MODEL_LISTS).flat().map((model) => model.id));
  for (const [id, benchmark] of Object.entries(BENCHMARKS)) {
    assert.ok(ids.has(id), `${id} is scored but not in the catalog`);
    assert.ok(Number.isFinite(benchmark.score), `${id} has no numeric score`);
    assert.ok(SOURCES[benchmark.source], `${id} cites unknown source ${benchmark.source}`);
    assert.ok(benchmark.leaderboardName, `${id} does not say which leaderboard row it was read from`);
  }
  assert.match(BENCHMARKS_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
});

test('every category has entries and each scored entry carries its source and date', () => {
  for (const category of CATEGORIES) {
    const entries = categoryEntries(category.id);
    assert.ok(entries.length > 0, `${category.id} is empty`);
    for (const item of entries) {
      assert.ok(item.studio, `${item.id} has no studio to open`);
      if (item.score !== null) {
        assert.equal(item.asOf, BENCHMARKS_UPDATED);
        assert.ok(item.source?.url);
      }
    }
  }
  assert.ok(categoryEntries('three-d').every((item) => item.model.kind !== 'edit'), '3D tools are not ranked');
  assert.ok(!categoryEntries('image-editing').some((item) => item.id.startsWith('ai-')), 'utility tools are not ranked');
});

test('speech is priced on a fixed sample so per-character rates compare', () => {
  const tts = categoryEntries('text-to-speech');
  for (const item of tts) {
    const payload = benchmarkPayload(item.model, 'text-to-speech');
    const text = payload.prompt || payload.text || payload.dialogue_turns?.[0]?.text;
    assert.equal(text.length, TTS_SAMPLE_CHARACTERS, item.id);
  }
  const image = categoryEntries('text-to-image').find((item) => item.id === 'gpt-image-2');
  assert.equal(benchmarkPayload(image.model, 'text-to-image').prompt, undefined, 'image payloads carry only the model defaults');
});
