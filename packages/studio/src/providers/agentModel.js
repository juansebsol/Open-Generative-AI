// The agent model: the language model behind the assistants (Design Agent,
// Agents, Vibe Motion, the Workflow assistant). One choice for the whole app,
// kept with the provider settings as `agent`. Each catalog entry can run on
// its vendor's own API or through OpenRouter; the visitor picks a route and
// the keys they have decide whether it can run there. Until anything is
// picked the assistants use the first chat key in the visitor's order with
// that provider's default model, which is what they did before this choice
// existed.
//
// Shared by the browser (Settings, chat.js) and the server (the rates and
// the cost of each reply), so nothing here touches window at import time.

import { loadProviderSettings } from './keys.js';

export const CHAT_PROVIDER_IDS = ['openrouter', 'openai', 'google'];

// Used when no agent model is chosen and the provider has no legacy
// per-provider chat model saved.
export const DEFAULT_CHAT_MODELS = {
  openrouter: 'openrouter/auto',
  openai: 'gpt-5-mini',
  google: 'gemini-flash-latest',
};

// `openrouter` is the model's OpenRouter id, which also keys its rates (live
// from OpenRouter, else prices.js → chat). `tag` marks one model in the list.
export const AGENT_MODELS = [
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    vendor: 'anthropic',
    openrouter: 'anthropic/claude-sonnet-5.5',
    routes: [{ provider: 'openrouter', endpoint: 'anthropic/claude-sonnet-5.5' }],
    tag: 'recommended',
  },
  {
    id: 'gpt-6-1-sol',
    name: 'GPT-6.1 Sol',
    vendor: 'openai',
    openrouter: 'openai/gpt-6.1-sol',
    routes: [{ provider: 'openai', endpoint: 'gpt-6.1-sol' }, { provider: 'openrouter', endpoint: 'openai/gpt-6.1-sol' }],
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    vendor: 'google',
    openrouter: 'google/gemini-4-argon',
    routes: [{ provider: 'google', endpoint: 'gemini-4-argon' }, { provider: 'openrouter', endpoint: 'google/gemini-4-argon' }],
  },
  {
    id: 'gemini-3-8-flash',
    name: 'Gemini 3.8 Flash',
    vendor: 'google',
    openrouter: 'google/gemini-3.8-flash',
    routes: [{ provider: 'google', endpoint: 'gemini-3.8-flash' }, { provider: 'openrouter', endpoint: 'google/gemini-3.8-flash' }],
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    vendor: 'anthropic',
    openrouter: 'anthropic/claude-haiku-5.5',
    routes: [{ provider: 'openrouter', endpoint: 'anthropic/claude-haiku-5.5' }],
    tag: 'cheapest',
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    vendor: 'openai',
    openrouter: 'openai/gpt-6-luna',
    routes: [{ provider: 'openai', endpoint: 'gpt-6-luna' }, { provider: 'openrouter', endpoint: 'openai/gpt-6-luna' }],
  },
  {
    id: 'openrouter-auto',
    name: 'OpenRouter Auto',
    vendor: 'openrouter',
    openrouter: 'openrouter/auto',
    routes: [{ provider: 'openrouter', endpoint: 'openrouter/auto' }],
    variable: true,
  },
];

export const RECOMMENDED_AGENT_MODEL = 'claude-sonnet-5-5';

// Any OpenRouter model id the visitor types in.
export const CUSTOM_AGENT_MODEL = 'custom';

// A typical agent turn (system prompt, board summary, history and a few tool
// steps), for the price per message shown in Settings.
export const AGENT_MESSAGE_TOKENS = { input: 15000, output: 1200 };

export const findAgentModel = (id) => AGENT_MODELS.find((model) => model.id === id) || null;

/**
 * The catalog entry a provider model id belongs to (a direct endpoint or an
 * OpenRouter id), if any. Vendors answer with dated ids
 * (gpt-6.1-sol-2026-08-01), which belong to the model they extend.
 */
export function agentModelForEndpoint(endpoint) {
  const id = String(endpoint || '');
  if (!id) return null;
  const ids = (model) => [model.openrouter, ...model.routes.map((route) => route.endpoint)];
  return AGENT_MODELS.find((model) => ids(model).includes(id))
    || AGENT_MODELS.find((model) => ids(model).some((known) => /^-\d{4}-\d{2}(-\d{2})?$/.test(id.slice(known.length)) && id.startsWith(known)))
    || null;
}

/** The OpenRouter id whose rates price a provider model id: the catalog's, or the id itself on OpenRouter. */
export function rateIdFor(provider, endpoint) {
  const entry = agentModelForEndpoint(endpoint);
  if (entry) return entry.openrouter;
  return provider === 'openrouter' ? String(endpoint || '') || null : null;
}

/** A readable name for a provider model id. */
export const agentModelName = (endpoint) => agentModelForEndpoint(endpoint)?.name || String(endpoint || '');

/**
 * What the assistants run on with these settings:
 * { provider, endpoint, name, entry, custom, chosen, blocked }, or null with
 * no chat key at all. `chosen` is true once the visitor picked a model;
 * `blocked` lists the providers whose key the chosen model needs when none
 * of its routes can run, in which case the default stands in.
 */
export function resolveAgentModel(settings = loadProviderSettings()) {
  const keyed = (id) => Boolean(String(settings.keys?.[id] || '').trim());
  const fallback = () => {
    const provider = (settings.order || CHAT_PROVIDER_IDS).find((id) => CHAT_PROVIDER_IDS.includes(id) && keyed(id));
    if (!provider) return null;
    const endpoint = String(settings.options?.[provider]?.chatModel || '').trim() || DEFAULT_CHAT_MODELS[provider];
    const entry = agentModelForEndpoint(endpoint);
    return { provider, endpoint, name: entry?.name || endpoint, entry, custom: false, chosen: false, blocked: null };
  };

  const choice = settings.agent;
  if (!choice) return fallback();
  if (choice.model === CUSTOM_AGENT_MODEL) {
    const endpoint = String(choice.custom || '').trim();
    if (endpoint && keyed('openrouter')) {
      const entry = agentModelForEndpoint(endpoint);
      return { provider: 'openrouter', endpoint, name: entry?.name || endpoint, entry, custom: true, chosen: true, blocked: null };
    }
    const standIn = fallback();
    return standIn && { ...standIn, chosen: true, blocked: { name: endpoint, providers: ['openrouter'] } };
  }
  const entry = findAgentModel(choice.model);
  if (!entry) return fallback();
  const route = entry.routes.find((candidate) => candidate.provider === choice.provider && keyed(candidate.provider))
    || entry.routes.find((candidate) => keyed(candidate.provider));
  if (route) return { provider: route.provider, endpoint: route.endpoint, name: entry.name, entry, custom: false, chosen: true, blocked: null };
  const standIn = fallback();
  return standIn && { ...standIn, chosen: true, blocked: { name: entry.name, providers: entry.routes.map((candidate) => candidate.provider) } };
}

/** Cost of `tokens` at per-token `rates` ({ input, output }), or null without rates. */
export function tokenCost(rates, tokens) {
  if (!rates || !Number.isFinite(rates.input) || !Number.isFinite(rates.output)) return null;
  return Math.round(((tokens.input || 0) * rates.input + (tokens.output || 0) * rates.output) * 1e6) / 1e6;
}

/** Per-message price at `rates`, for a typical agent turn. */
export const messageCost = (rates) => tokenCost(rates, AGENT_MESSAGE_TOKENS);

/**
 * Rates for OpenRouter ids from /api/agent-rates (browser only):
 * { rates: { [id]: { input, output, source } | null }, checkedAt }.
 */
export async function fetchAgentRates(ids) {
  const response = await fetch('/api/agent-rates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Rates lookup failed (${response.status})`);
  return { rates: data.rates || {}, checkedAt: data.checkedAt || null };
}
