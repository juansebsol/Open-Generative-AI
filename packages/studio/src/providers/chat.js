// Browser-side helper for the assistant features. Uses the first configured
// chat-capable provider (OpenRouter, OpenAI, Gemini) in the visitor's order.

import { getProvider } from './directProviders.js';
import { configuredProviders, getProviderKey, getProviderOptions } from './keys.js';

export const CHAT_PROVIDER_IDS = ['openrouter', 'openai', 'google'];

// Defaults when the visitor hasn't picked a chat model in Settings.
export const DEFAULT_CHAT_MODELS = {
  openrouter: 'openrouter/auto',
  openai: 'gpt-5-mini',
  google: 'gemini-flash-latest',
};

export class ChatSetupError extends Error {
  constructor() {
    super('Add an OpenRouter, OpenAI or Google Gemini key in Settings → Providers to use the assistant.');
    this.name = 'ChatSetupError';
  }
}

export function chatProvider() {
  return configuredProviders().find((id) => CHAT_PROVIDER_IDS.includes(id)) || null;
}

export function hasChatProvider() {
  return Boolean(chatProvider());
}

export function chatModelFor(provider) {
  return getProviderOptions(provider).chatModel?.trim() || DEFAULT_CHAT_MODELS[provider];
}

/**
 * One chat completion. Returns the assistant message ({ content, tool_calls }).
 * @param {{ messages: object[], tools?: object[], toolChoice?: any, responseFormat?: object, temperature?: number }} request
 */
export async function chatComplete({ messages, tools, toolChoice, responseFormat, temperature }) {
  const provider = chatProvider();
  if (!provider) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('oga:provider-setup-needed', { detail: { providers: CHAT_PROVIDER_IDS } }));
    }
    throw new ChatSetupError();
  }
  const body = {
    model: chatModelFor(provider),
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
  return data.message;
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
