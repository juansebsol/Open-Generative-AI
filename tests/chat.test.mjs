import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptChatRequest } from '../packages/studio/src/providers/server/chat.js';

test('OpenAI reasoning models drop sampling settings', () => {
  const request = { model: 'gpt-5-mini', messages: [], temperature: 0.4, top_p: 0.9, max_tokens: 500 };
  assert.deepEqual(adaptChatRequest('openai', request), { model: 'gpt-5-mini', messages: [], max_completion_tokens: 500 });
  assert.equal(adaptChatRequest('openai', { model: 'gpt-4.1', temperature: 0.4 }).temperature, 0.4);
  assert.equal(adaptChatRequest('openrouter', { model: 'gpt-5-mini', temperature: 0.4 }).temperature, 0.4);
});
