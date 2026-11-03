// Browser-side helper for the assistant features. Runs on the agent model
// chosen in Settings (agentModel.js), or until one is chosen, the first
// chat-capable provider (OpenRouter, OpenAI, Gemini) in the visitor's order.

import { getProvider } from './directProviders.js';
import { getProviderKey, getProviderOptions } from './keys.js';
import { CHAT_PROVIDER_IDS, DEFAULT_CHAT_MODELS, resolveAgentModel } from './agentModel.js';
import { recordSpend } from './spend.js';

export { CHAT_PROVIDER_IDS, DEFAULT_CHAT_MODELS };

export class ChatSetupError extends Error {
  constructor() {
    super('Add an OpenRouter, OpenAI or Google Gemini key in Settings → Providers to use the assistant.');
    this.name = 'ChatSetupError';
  }
}

export function chatProvider() {
  return resolveAgentModel()?.provider || null;
}

export function hasChatProvider() {
  return Boolean(chatProvider());
}

/** The model a provider runs when no agent model is chosen. */
export function chatModelFor(provider) {
  return getProviderOptions(provider).chatModel?.trim() || DEFAULT_CHAT_MODELS[provider];
}

/**
 * One chat completion. Returns the assistant message ({ content, tool_calls }).
 * @param {{ messages: object[], tools?: object[], toolChoice?: any, responseFormat?: object, temperature?: number }} request
 */
export async function chatComplete(request) {
  return (await chatCompleteDetailed(request)).message;
}

/**
 * chatComplete, plus the provider and model that answered (OpenRouter's auto
 * router names the one it picked), the usage the provider reported and what
 * the reply cost in USD (null when it cannot be priced). The cost also lands
 * in Settings → Usage.
 * @returns {Promise<{ message: object, provider: string, model: string, usage: object|null, cost: number|null }>}
 */
export async function chatCompleteDetailed({ messages, tools, toolChoice, responseFormat, temperature }) {
  const agent = resolveAgentModel();
  if (!agent) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('oga:provider-setup-needed', { detail: { providers: CHAT_PROVIDER_IDS } }));
    }
    throw new ChatSetupError();
  }
  const { provider } = agent;
  const body = {
    model: agent.endpoint,
    messages,
    ...(tools?.length ? { tools, ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-provider-key': getProviderKey(provider) },
    body: JSON.stringify({ provider, body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `${getProvider(provider)?.label || provider} chat failed (${response.status})`);
  }
  const model = data.model || body.model;
  const cost = Number.isFinite(data.cost) ? data.cost : null;
  recordSpend({ provider, endpoint: model, amount: cost, estimated: !data.costExact });
  return { message: data.message, provider, model, usage: data.usage || null, cost };
}

// Pulls a JSON value out of a model reply, tolerating ```json fences.
export function parseJsonReply(content) {
  const text = String(content || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[{[]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('The assistant did not return valid JSON.');
  }
}

/** Asks for a JSON answer and parses it. */
export async function chatJson({ system, user, temperature = 0.4 }) {
  const message = await chatComplete({
    messages: [
      { role: 'system', content: `${system}\nRespond with JSON only.` },
      { role: 'user', content: user },
    ],
    responseFormat: { type: 'json_object' },
    temperature,
  });
  return parseJsonReply(message.content);
}
