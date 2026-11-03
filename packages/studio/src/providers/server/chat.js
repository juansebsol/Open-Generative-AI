// OpenAI-compatible chat completions for the assistant features (Agents,
// Vibe Motion, Workflows, Design Agent). All three providers accept the same
// request shape, including tools and JSON response formats.

import { ProviderError, requestJson } from './http.js';
import { agentRate, liveRates } from './pricing.js';
import { rateIdFor, tokenCost } from '../agentModel.js';

const CHAT_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const ALLOWED_FIELDS = ['model', 'messages', 'tools', 'tool_choice', 'response_format', 'temperature', 'max_tokens', 'max_completion_tokens', 'top_p'];
const MAX_MESSAGES = 200;

export const CHAT_PROVIDER_IDS = Object.keys(CHAT_ENDPOINTS);

// OpenAI reasoning models (gpt-5 and later, o-series) reject non-default
// sampling settings and take max_completion_tokens instead of max_tokens.
export function adaptChatRequest(provider, request) {
  if (provider !== 'openai' || !/^(gpt-[5-9]|o\d)/.test(request.model)) return request;
  const { temperature, top_p: topP, max_tokens: maxTokens, ...rest } = request;
  if (maxTokens !== undefined && rest.max_completion_tokens === undefined) rest.max_completion_tokens = maxTokens;
  return rest;
}

export async function chatCompletion({ provider, key, body, origin }) {
  const url = CHAT_ENDPOINTS[provider];
  if (!url) throw new ProviderError(`${provider} does not support chat`, { status: 400 });
  if (typeof key !== 'string' || key.trim().length < 8) {
    throw new ProviderError(`Add your ${provider} API key in Settings → Providers.`, { status: 401, provider });
  }
  if (!body?.model || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    throw new ProviderError('A model and 1-200 messages are required', { status: 400 });
  }

  const request = adaptChatRequest(provider, Object.fromEntries(ALLOWED_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])));
  // OpenRouter reports the actual charge in usage.cost when asked.
  if (provider === 'openrouter') request.usage = { include: true };
  const data = await requestJson(provider, url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      'Content-Type': 'application/json',
      ...(provider === 'openrouter' ? { 'X-Title': 'Openstudio', ...(origin ? { 'HTTP-Referer': origin } : {}) } : {}),
    },
    body: JSON.stringify(request),
    timeoutMs: 180_000,
  });

  const message = data?.choices?.[0]?.message;
  if (!message) throw new ProviderError(`${provider} returned no message`, { provider, status: 502 });
  const usage = data.usage || null;
  return { message, usage, model: data.model || request.model, ...(await replyCost(provider, request.model, data.model, usage)) };
}

// What one reply cost: OpenRouter reports the charge itself; the others are
// priced from the token counts at the model's rate (the one asked for, since
// vendors answer with dated ids). { cost: null } when it cannot be priced.
export async function replyCost(provider, requested, answered, usage) {
  if (!usage) return { cost: null, costExact: false };
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) return { cost: usage.cost, costExact: true };
  const id = rateIdFor(provider, requested) || rateIdFor(provider, answered);
  if (!id) return { cost: null, costExact: false };
  let live = null;
  try {
    live = await liveRates();
  } catch {
    // the table rate still prices it
  }
  const cost = tokenCost(agentRate(id, live), { input: usage.prompt_tokens, output: usage.completion_tokens });
  return { cost, costExact: false };
}
