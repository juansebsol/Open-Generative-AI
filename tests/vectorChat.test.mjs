import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SVG_OUTPUT_TOKENS, SVG_SYSTEM_TOKENS, SvgOutputError, buildRefineMessages, buildSvgMessages, buildSvgSystemPrompt, estimateSvgTokens, extractSvg, paletteInstruction,
} from '../packages/studio/src/vector/svgChat.js';
import { CHAT_SVG_ROUTES, isChatSvgEndpoint } from '../packages/studio/src/providers/catalog/chatRoutes.js';
import { getRoutes } from '../packages/studio/src/providers/catalog/index.js';
import { ALL_vectorModels, vectorChatModels, vectorTextModels } from '../packages/studio/src/vectorModels.js';
import { PRICES } from '../packages/studio/src/providers/catalog/prices.js';
import { chatPrice, getPrice, resetPriceCache } from '../packages/studio/src/providers/server/pricing.js';
import { chatUsageCost } from '../packages/studio/src/providers/server/usage.js';
import { adaptChatRequest } from '../packages/studio/src/providers/server/chat.js';
import { generateSvgChat } from '../packages/studio/src/providers/server/svgChat.js';
import { pricedInputs } from '../packages/studio/src/providers/pricing.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g id="mark"><path d="M4 4h16v16H4z"/></g></svg>';
const KEY = 'secret-key-1234567890';

// ── catalog ────────────────────────────────────────────────────────────────

test('chat models sit in the text picker after the native ones, each with a route and a rate', () => {
  const kinds = vectorTextModels.map((model) => model.kind);
  assert.ok(kinds.indexOf('chat') > kinds.lastIndexOf('text'), 'native models come first');
  assert.ok(vectorChatModels.length >= 3);
  for (const model of ALL_vectorModels.filter((entry) => entry.kind === 'chat')) {
    assert.equal(model.endpoint, model.id);
    assert.ok(isChatSvgEndpoint(model.endpoint), `${model.id} has no chat route`);
    assert.ok(getRoutes(model.endpoint).length > 0, `${model.id} is not in the route table`);
    assert.ok(PRICES.chat[model.id], `${model.id} has no rate in prices.js`);
    assert.match(model.name, /code-written SVG/);
    assert.match(model.note, /language model/);
    assert.equal(model.candidates, 'runs');
  }
  const providers = new Set(Object.values(CHAT_SVG_ROUTES).flat().map((route) => route.provider));
  assert.deepEqual([...providers].sort(), ['google', 'openai', 'openrouter']);
  for (const routes of Object.values(CHAT_SVG_ROUTES)) {
    for (const route of routes) assert.ok(!route.endpoint.startsWith('svg-'), 'provider endpoints are vendor model ids');
  }
});

// ── prompts ────────────────────────────────────────────────────────────────

test('the system prompt asks for one sanitisable SVG with the palette as hex', () => {
  const system = buildSvgSystemPrompt({ page: 'logo', palette: { colors: ['#0EA5E9', '0f172a', 'nope'], background: '#fff' } });
  assert.match(system, /exactly one complete <svg>/);
  assert.match(system, /viewBox/);
  assert.match(system, /No <script>/);
  assert.match(system, /no external references/);
  assert.match(system, /descriptive id/);
  assert.match(system, /#0ea5e9, #0f172a\./);
  assert.doesNotMatch(system, /nope/);
  assert.match(system, /#ffffff background rectangle/);
  assert.match(system, /logo mark or wordmark/);
  assert.match(buildSvgSystemPrompt({ page: 'icons' }), /viewBox="0 0 24 24"/);
  assert.equal(paletteInstruction({ colors: [], background: null }), '');
  assert.match(paletteInstruction({ colors: ['#111111'], background: null }), /transparent/);
});

test('generate and refine messages carry the prompt, the current SVG and the instruction', () => {
  const [system, user] = buildSvgMessages({ prompt: 'a fox head', page: 'logo' });
  assert.equal(system.role, 'system');
  assert.match(user.content, /^Draw: a fox head/);
  assert.throws(() => buildSvgMessages({ prompt: '  ' }), /prompt is required/);

  const refine = buildRefineMessages({ svg: SVG, instruction: 'make it bolder', page: 'icons' });
  assert.ok(refine[1].content.includes(SVG));
  assert.match(refine[1].content, /make it bolder/);
  assert.match(refine[1].content, /keeping everything else/);
  assert.match(refine[0].content, /24×24 grid/);
  assert.throws(() => buildRefineMessages({ svg: SVG, instruction: '' }), /what to change/);
});

// ── reply parsing ──────────────────────────────────────────────────────────

test('extractSvg finds the first SVG in fenced, chatty or bare replies', () => {
  assert.equal(extractSvg(`Here it is:\n\`\`\`svg\n${SVG}\n\`\`\`\nEnjoy`), SVG);
  assert.equal(extractSvg(`\`\`\`xml\n<?xml version="1.0"?>\n${SVG}\n\`\`\``), SVG);
  assert.equal(extractSvg(`Sure! ${SVG} and here is another <svg/>`), SVG);
  assert.equal(extractSvg(SVG), SVG);
  assert.equal(extractSvg('<svg viewBox="0 0 1 1"></svg  >'), '<svg viewBox="0 0 1 1"></svg  >');
  assert.throws(() => extractSvg('I cannot draw that.'), SvgOutputError);
  assert.throws(() => extractSvg('<svg viewBox="0 0 1 1"><path d="M0 0'), /stopped before finishing/);
  assert.throws(() => extractSvg('```svg\nnothing here\n```'), SvgOutputError);
});

// ── pricing ────────────────────────────────────────────────────────────────

test('estimateSvgTokens budgets the system prompt, the prompt and one SVG per run', () => {
  assert.deepEqual(estimateSvgTokens({}), { input: SVG_SYSTEM_TOKENS, output: SVG_OUTPUT_TOKENS, count: 1 });
  assert.deepEqual(estimateSvgTokens({ prompt: 'x'.repeat(400), num_images: 3 }), { input: SVG_SYSTEM_TOKENS + 100, output: SVG_OUTPUT_TOKENS, count: 3 });
  assert.equal(estimateSvgTokens({ prompt_characters: 800, source_characters: 2000 }).input, SVG_SYSTEM_TOKENS + 200 + 500);
  assert.deepEqual(pricedInputs({ prompt_characters: 300, source_characters: 1000, palette: {}, page: 'logo' }), { prompt_characters: 300, source_characters: 1000 });
});

test('chat models are quoted per token from the table or OpenRouter live rate', async () => {
  resetPriceCache();
  const table = chatPrice('svg-gemini-3-8-flash', { prompt_characters: 400 });
  const expected = Math.round(((SVG_SYSTEM_TOKENS + 100) * 7.5e-7 + SVG_OUTPUT_TOKENS * 3.75e-6) * 10000) / 10000;
  assert.deepEqual([table.kind, table.amount, table.unit, table.quantity, table.source], ['total', expected, 'svg', 1, 'table']);
  assert.ok(table.asOf);
  assert.match(table.note, /output tokens per SVG/);
  assert.equal(chatPrice('svg-unknown').kind, 'unavailable');

  const live = { fetchedAt: 123, models: new Map([['google/gemini-3.8-flash', { prompt: '0.000001', completion: '0.000005' }]]) };
  const quoted = chatPrice('svg-gemini-3-8-flash', { num_images: 2 }, live);
  assert.deepEqual([quoted.source, quoted.rateSource, quoted.rateCheckedAt, quoted.quantity], ['openrouter', 'openrouter', 123, 2]);
  assert.equal(quoted.unitPrice, Math.round((SVG_SYSTEM_TOKENS * 1e-6 + SVG_OUTPUT_TOKENS * 5e-6) * 10000) / 10000);
  assert.equal(quoted.amount, Math.round(quoted.unitPrice * 2 * 10000) / 10000);

  // Through getPrice, with OpenRouter unreachable, every route of the slug falls back to the table.
  globalThis.fetch = async () => new Response('down', { status: 503 });
  for (const provider of ['google', 'openrouter']) {
    const quote = await getPrice({ provider, endpoint: 'svg-gemini-3-8-flash', key: '', payload: { prompt_characters: 400 } });
    assert.equal(quote.provider, provider);
    assert.equal(quote.amount, expected, `${provider} quotes the same table price`);
    assert.equal(quote.estimated, true);
  }
  const direct = await getPrice({ provider: 'google', endpoint: 'svg-gemini-3-8-flash', key: '', payload: {} });
  assert.equal(direct.endpoint, 'gemini-3.8-flash', 'the quote names the vendor model id');
  resetPriceCache();
});

test('usage becomes the real cost: OpenRouter reports it, Google and OpenAI report tokens', () => {
  assert.equal(chatUsageCost('svg-gemini-3-8-flash', { prompt_tokens: 1000, completion_tokens: 2000 }), 0.00825);
  assert.equal(chatUsageCost('svg-claude-haiku-5-5', { cost: 0.00042, prompt_tokens: 1, completion_tokens: 1 }), 0.00042);
  assert.equal(chatUsageCost('svg-gpt-6-luna', { input_tokens: 500, output_tokens: 1500 }), 0.0008);
  assert.equal(chatUsageCost('svg-unknown', { prompt_tokens: 5, completion_tokens: 5 }), null);
  assert.equal(chatUsageCost('svg-gpt-6-luna', null), null);
});

test('OpenAI gpt-6 models get the reasoning-model request shape', () => {
  const adapted = adaptChatRequest('openai', { model: 'gpt-6.1-sol', messages: [], temperature: 0.7, max_tokens: 16000 });
  assert.deepEqual(adapted, { model: 'gpt-6.1-sol', messages: [], max_completion_tokens: 16000 });
});

// ── server path ────────────────────────────────────────────────────────────

function mockChat(reply, { status = 200, usage = { prompt_tokens: 500, completion_tokens: 900 }, model = 'gemini-3.8-flash' } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const data = status === 200 ? { model, usage, choices: [{ message: { role: 'assistant', content: reply } }] } : { error: { message: 'nope' } };
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

test('generateSvgChat prompts the vendor model, sanitises the reply and prices the usage', async () => {
  const dirty = `Here you go:\n\`\`\`svg\n<svg viewBox="0 0 24 24" onload="alert(1)"><script>x()</script><g id="mark"><path d="M1 1h2"/></g><image href="https://evil/x.png"/></svg>\n\`\`\``;
  const calls = mockChat(dirty);
  const result = await generateSvgChat({ provider: 'google', key: KEY, model: 'svg-gemini-3-8-flash', prompt: 'a square', page: 'icons', palette: { colors: ['#111111'], background: null } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
  assert.equal(calls[0].body.model, 'gemini-3.8-flash');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.match(calls[0].body.messages[0].content, /#111111/);
  assert.match(calls[0].body.messages[1].content, /a square/);
  assert.doesNotMatch(result.svg, /script|onload|evil/);
  assert.match(result.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 24 24">/);
  assert.match(result.svg, /<g id="mark">/);
  assert.deepEqual(result.usage, { input: 500, output: 900 });
  assert.equal(result.cost, 0.00375, '500 input and 900 output tokens at the Flash rates');
  assert.equal(result.model, 'gemini-3.8-flash');
});

test('generateSvgChat refines through OpenRouter and keeps its reported cost', async () => {
  const calls = mockChat(SVG, { usage: { prompt_tokens: 700, completion_tokens: 400, cost: 0.0011 }, model: 'anthropic/claude-haiku-5.5' });
  const result = await generateSvgChat({ provider: 'openrouter', key: KEY, model: 'svg-claude-haiku-5-5', page: 'logo', refine: { svg: SVG, instruction: 'remove the gradient' } });
  assert.match(calls[0].url, /openrouter\.ai/);
  assert.equal(calls[0].body.model, 'anthropic/claude-haiku-5.5');
  assert.deepEqual(calls[0].body.usage, { include: true });
  assert.ok(calls[0].body.messages[1].content.includes(SVG));
  assert.match(calls[0].body.messages[1].content, /remove the gradient/);
  assert.equal(result.cost, 0.0011);
  assert.equal(result.svg, SVG);
});

test('generateSvgChat rejects replies without an SVG, unknown models and missing inputs', async () => {
  mockChat('Sorry, I cannot help with that.');
  await assert.rejects(generateSvgChat({ provider: 'google', key: KEY, model: 'svg-gemini-3-8-flash', prompt: 'x' }), (error) => error.status === 502 && /did not return an SVG/.test(error.message));
  mockChat('<svg><rect/>');
  await assert.rejects(generateSvgChat({ provider: 'google', key: KEY, model: 'svg-gemini-3-8-flash', prompt: 'x' }), /stopped before finishing/);
  await assert.rejects(generateSvgChat({ provider: 'google', key: KEY, model: 'recraft-v4-1-text-to-vector', prompt: 'x' }), /Unknown SVG model/);
  await assert.rejects(generateSvgChat({ provider: 'google', key: KEY, model: 'svg-claude-haiku-5-5', prompt: 'x' }), /not available on google/);
  await assert.rejects(generateSvgChat({ provider: 'google', key: KEY, model: 'svg-gemini-3-8-flash', prompt: '' }), /prompt is required/);
  await assert.rejects(generateSvgChat({ provider: 'google', key: KEY, model: 'svg-gemini-3-8-flash', refine: { svg: SVG, instruction: '' } }), /instruction are required/);
  await assert.rejects(generateSvgChat({ provider: 'google', key: 'short', model: 'svg-gemini-3-8-flash', prompt: 'x' }), /API key/);
});
