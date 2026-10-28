import test from 'node:test';
import assert from 'node:assert/strict';
import { railEntries, railSections, providerLine, vendorMono, isVendorId, ALL_ID } from '../packages/studio/src/modelRailPicker.js';

const model = (id, name, provider_name) => ({ id, name, provider_name });
const vector = [model('recraft', 'Recraft 4.1', 'Recraft'), model('recraft-pro', 'Recraft 4.1 Pro', 'Recraft'), model('ideogram', 'Ideogram Vector', 'Ideogram')];
const chat = [model('argon', 'Gemini 4 Argon', 'Google'), model('flash', 'Gemini 3.8 Flash', 'Google'), model('sonnet', 'Claude Sonnet 5.5', 'Anthropic'), model('haiku', 'Claude Haiku 5.5', 'Anthropic'), model('sol', 'GPT-6.1 Sol', 'OpenAI'), model('luna', 'GPT-6 Luna', 'OpenAI')];
const groups = [
  { id: 'vector', label: 'Drawn by a vector model', tone: 'cyan', models: vector },
  { id: 'chat', label: 'Written by a chat model', tone: 'violet', models: chat },
];

test('the rail lists All, the groups, then vendors with counts and the tone of their group', () => {
  const rail = railEntries(groups, { allLabel: 'All' });
  assert.deepEqual(rail.all, { id: ALL_ID, label: 'All', count: 9 });
  assert.deepEqual(rail.kinds.map((kind) => [kind.id, kind.count, kind.tone]), [['vector', 3, 'cyan'], ['chat', 6, 'violet']]);
  assert.deepEqual(rail.vendors.map((vendor) => [vendor.id, vendor.name, vendor.count, vendor.tone, vendor.mono]), [
    ['vendor:anthropic', 'Anthropic', 2, 'violet', 'AN'],
    ['vendor:google', 'Google', 2, 'violet', 'GO'],
    ['vendor:openai', 'OpenAI', 2, 'violet', 'OP'],
    ['vendor:recraft', 'Recraft', 2, 'cyan', 'RE'],
    ['vendor:ideogram', 'Ideogram', 1, 'cyan', 'ID'],
  ]);
  assert.equal(isVendorId('vendor:google'), true);
  assert.equal(isVendorId('chat'), false);
  assert.equal(vendorMono('Black Forest Labs'), 'BF');
  assert.equal(vendorMono(''), '?');
  // A model in two groups counts once.
  assert.equal(railEntries([groups[0], { id: 'again', label: 'Again', models: [vector[0]] }]).all.count, 3);
});

test('All and a group keep the section headers; a vendor shows one unlabelled section', () => {
  assert.deepEqual(railSections(groups).map((section) => [section.label, section.models.length]), [['Drawn by a vector model', 3], ['Written by a chat model', 6]]);
  assert.deepEqual(railSections(groups, { railId: 'chat' }).map((section) => [section.id, section.models.length]), [['chat', 6]]);
  const vendor = railSections(groups, { railId: 'vendor:google' });
  assert.deepEqual(vendor.map((section) => [section.label, section.models.map((item) => item.id)]), [[null, ['argon', 'flash']]]);
  assert.deepEqual(railSections(groups, { railId: 'vendor:nobody' }), []);
});

test('search narrows every section by name or provider, ignoring case and accents, and drops empty ones', () => {
  assert.deepEqual(railSections(groups, { query: 'claude' }).map((section) => [section.id, section.models.map((item) => item.id)]), [['chat', ['sonnet', 'haiku']]]);
  assert.deepEqual(railSections(groups, { query: 'RECRAFT pro' }).map((section) => section.models.map((item) => item.id)), [['recraft-pro']]);
  assert.deepEqual(railSections(groups, { railId: 'vendor:openai', query: 'luna' }).map((section) => section.models.map((item) => item.id)), [['luna']]);
  assert.deepEqual(railSections(groups, { railId: 'vector', query: 'gpt' }), []);
  assert.deepEqual(railSections(groups, { query: 'Idéogram' }).map((section) => section.models.map((item) => item.id)), [['ideogram']]);
  assert.deepEqual(railSections([{ id: 'x', label: 'X', models: [{ id: 'g', name: 'Gemini', provider_name: 'Google', providerLine: 'Google · Gemini' }] }], { query: 'gemini google' }).length, 1);
});

test('the provider line names the vendor and the route it runs on', () => {
  assert.equal(providerLine('Recraft', 'fal'), 'Recraft · fal.ai');
  assert.equal(providerLine('OpenAI', 'openrouter'), 'OpenAI · OpenRouter');
  assert.equal(providerLine('Google', 'google'), 'Google · Gemini');
  assert.equal(providerLine('OpenAI', 'openai'), 'OpenAI', 'no stutter when the vendor is the provider');
  assert.equal(providerLine('fal', 'fal'), 'fal.ai');
  assert.equal(providerLine('Recraft', null), 'Recraft');
  assert.equal(providerLine('Vendor', 'custom', 'Custom API'), 'Vendor · Custom API');
});
