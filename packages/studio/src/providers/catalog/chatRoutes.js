// Chat-completion models the Vector pages ask to write SVG markup directly
// ("code-written SVG"). They are not media endpoints: the studio sends them
// through /api/vector/svg (server/svgChat.js) rather than /api/generate, but
// they sit in the same route table so the picker, the key check and the
// price chip treat them like any other model. The provider endpoint is the
// vendor's chat model id; the same slug routes to the vendor directly or
// through OpenRouter, whichever the visitor has a key for, in their order.
//
// Rates for the price chip live in prices.js under `chat`, keyed by slug.

export const CHAT_SVG_ROUTES = {
  'svg-gemini-4-argon': [
    { provider: 'google', endpoint: 'gemini-4-argon' },
    { provider: 'openrouter', endpoint: 'google/gemini-4-argon' },
  ],
  'svg-gemini-3-8-flash': [
    { provider: 'google', endpoint: 'gemini-3.8-flash' },
    { provider: 'openrouter', endpoint: 'google/gemini-3.8-flash' },
  ],
  'svg-claude-sonnet-5-5': [
    { provider: 'openrouter', endpoint: 'anthropic/claude-sonnet-5.5' },
  ],
  'svg-claude-haiku-5-5': [
    { provider: 'openrouter', endpoint: 'anthropic/claude-haiku-5.5' },
  ],
  'svg-gpt-6-1-sol': [
    { provider: 'openai', endpoint: 'gpt-6.1-sol' },
    { provider: 'openrouter', endpoint: 'openai/gpt-6.1-sol' },
  ],
  'svg-gpt-6-luna': [
    { provider: 'openai', endpoint: 'gpt-6-luna' },
    { provider: 'openrouter', endpoint: 'openai/gpt-6-luna' },
  ],
};

export const isChatSvgEndpoint = (endpoint) => Object.prototype.hasOwnProperty.call(CHAT_SVG_ROUTES, endpoint);
