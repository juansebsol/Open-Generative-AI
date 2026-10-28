import test from 'node:test';
import assert from 'node:assert/strict';
import { pickerTabs, filterModels, providerLine, scoreWidth, pickKindsById, ALL_TAB_ID } from '../packages/studio/src/modelCardPicker.js';
import { rankEntries } from '../packages/studio/src/benchmarks.js';

const model = (id, name, provider_name) => ({ id, name, provider_name });
const vector = [model('recraft', 'Recraft 4.1', 'Recraft'), model('recraft-pro', 'Recraft 4.1 Pro', 'Recraft'), model('ideogram', 'Ideogram Vector', 'Ideogram')];
const chat = [model('gpt', 'GPT-6.1 Sol', 'OpenAI'), model('haiku', 'Claude Haiku 5.5', 'Anthropic')];
const groups = [
  { id: 'vector', label: 'Vector models', hint: 'Drawn.', models: vector },
  { id: 'chat', label: 'Chat models', hint: 'Written.', models: chat },
];

test('tabs start with All, carry counts, and dedupe models that sit in two groups', () => {
  const tabs = pickerTabs(groups, { allLabel: 'All', allHint: 'Both.' });
  assert.deepEqual(tabs.map((tab) => [tab.id, tab.label, tab.count, tab.hint]), [
    [ALL_TAB_ID, 'All', 5, 'Both.'],
    ['vector', 'Vector models', 3, 'Drawn.'],
    ['chat', 'Chat models', 2, 'Written.'],
  ]);
  assert.deepEqual(tabs[0].models.map((item) => item.id), ['recraft', 'recraft-pro', 'ideogram', 'gpt', 'haiku']);
  const overlapping = pickerTabs([groups[0], { id: 'again', label: 'Again', models: [vector[0]] }]);
  assert.equal(overlapping[0].count, 3);
  // One group needs no All tab; it takes the All hint when it has none.
  assert.deepEqual(pickerTabs([{ id: 'only', label: 'Only', models: chat }], { allHint: 'Hint.' }).map((tab) => [tab.id, tab.hint]), [['only', 'Hint.']]);
});

test('search matches name and provider, every word, ignoring case and accents', () => {
  const all = pickerTabs(groups)[0].models;
  assert.deepEqual(filterModels(all, '').map((item) => item.id), ['recraft', 'recraft-pro', 'ideogram', 'gpt', 'haiku']);
  assert.deepEqual(filterModels(all, 'RECRAFT pro').map((item) => item.id), ['recraft-pro']);
  assert.deepEqual(filterModels(all, 'anthropic').map((item) => item.id), ['haiku']);
  assert.deepEqual(filterModels(all, 'openrouter'), []);
  assert.deepEqual(filterModels([{ id: 'x', name: 'Gemini', provider_name: 'Google', providerLine: 'Google · Gemini API' }], 'api').map((item) => item.id), ['x']);
  assert.deepEqual(filterModels(all, 'Idéogram').map((item) => item.id), ['ideogram']);
});

test('the provider line names the vendor and the route it runs on', () => {
  assert.equal(providerLine('OpenAI', 'openrouter'), 'OpenAI · via OpenRouter');
  assert.equal(providerLine('Google', 'google'), 'Google · Gemini API');
  assert.equal(providerLine('Recraft', 'fal'), 'Recraft · fal.ai');
  assert.equal(providerLine('fal', 'fal'), 'fal.ai', 'no stutter when the vendor is the provider');
  assert.equal(providerLine('Recraft', null), 'Recraft');
  assert.equal(providerLine('Vendor', 'custom', 'Custom API'), 'Vendor · Custom API');
});

test('score bars are relative to the leader, with a visible floor and nothing for unscored models', () => {
  assert.equal(scoreWidth(1437, 1437), 100);
  assert.equal(scoreWidth(1237, 1437), 65);
  assert.equal(scoreWidth(1037, 1437), 30);
  assert.equal(scoreWidth(900, 1437), 30);
  assert.equal(scoreWidth(null, 1437), 0);
  assert.equal(scoreWidth(1000, null), 0);
});

test('pick marks are keyed by model id, several per model when it wins twice', () => {
  const ranking = rankEntries([
    { id: 'gpt', name: 'GPT', score: 1437, price: 0.013 },
    { id: 'haiku', name: 'Haiku', score: 1247, price: 0.0006 },
    { id: 'recraft', name: 'Recraft', score: 998, price: 0.08 },
    { id: 'ideogram', name: 'Ideogram', score: null, price: 0.16 },
  ]);
  assert.deepEqual(pickKindsById(ranking), { gpt: ['best'], haiku: ['bestValue', 'cheapestDecent'] });
  assert.deepEqual(pickKindsById(null), {});
});
