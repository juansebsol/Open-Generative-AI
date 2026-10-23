// OpenAI-compatible chat completions for the assistant features (Agents,
// Vibe Motion, Workflows, Design Agent). All three providers accept the same
// request shape, including tools and JSON response formats.

import { ProviderError, requestJson } from './http.js';

const CHAT_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const ALLOWED_FIELDS = ['model', 'messages', 'tools', 'tool_choice', 'response_format', 'temperature', 'max_tokens', 'max_completion_tokens', 'top_p'];
const MAX_MESSAGES = 200;

export const CHAT_PROVIDER_IDS = Object.keys(CHAT_ENDPOINTS);

export async function chatCompletion({ provider, key, body, origin }) {
  const url = CHAT_ENDPOINTS[provider];
  if (!url) throw new ProviderError(`${provider} does not support chat`, { status: 400 });
  if (typeof key !== 'string' || key.trim().length < 8) {
    throw new ProviderError(`Add your ${provider} API key in Settings → Providers.`, { status: 401, provider });
  }
  if (!body?.model || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    throw new ProviderError('A model and 1-200 messages are required', { status: 400 });
  }

  const request = Object.fromEntries(ALLOWED_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
  const data = await requestJson(provider, url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      'Content-Type': 'application/json',
      ...(provider === 'openrouter' ? { 'X-Title': 'Open Generative AI', ...(origin ? { 'HTTP-Referer': origin } : {}) } : {}),
    },
    body: JSON.stringify(request),
    timeoutMs: 180_000,
  });

  const message = data?.choices?.[0]?.message;
  if (!message) throw new ProviderError(`${provider} returned no message`, { provider, status: 502 });
  return { message, usage: data.usage || null, model: data.model || request.model };
}
