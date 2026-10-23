// Provider registry shared by the settings UI, the client router and the
// server. Cloud keys stay in the visitor's browser and are sent per request to
// this app's own /api routes, which forward them to the provider and never
// store or log them.

export const PROVIDERS = [
  {
    id: 'fal',
    label: 'fal.ai',
    kind: 'cloud',
    keyUrl: 'https://fal.ai/dashboard/keys',
    keyPlaceholder: 'fal key (key_id:key_secret)',
    description: 'Largest catalog: image, video, audio, lip sync and upscaling.',
  },
  {
    id: 'wavespeed',
    label: 'WaveSpeedAI',
    kind: 'cloud',
    keyUrl: 'https://wavespeed.ai/accesskey',
    keyPlaceholder: 'WaveSpeed API key',
    description: 'Wide video coverage including Veo, Runway, Seedance and Wan.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'cloud',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-...',
    description: 'One key for Gemini, GPT and other image models, plus the chat model behind the assistants.',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'cloud',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'Gemini API key',
    description: 'Nano Banana image models direct from Google.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'cloud',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    description: 'GPT Image models direct from OpenAI.',
  },
  {
    id: 'comfyui',
    label: 'ComfyUI (local)',
    kind: 'local',
    urlPlaceholder: 'http://127.0.0.1:8188',
    description: 'Your own ComfyUI. Start it with --enable-cors-header so this page can reach it.',
  },
  {
    id: 'sdserver',
    label: 'sd.cpp server (local)',
    kind: 'local',
    urlPlaceholder: 'http://127.0.0.1:1234',
    description: 'stable-diffusion.cpp sd-server or any OpenAI-compatible /v1/images/generations server.',
  },
];

export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);
export const CLOUD_PROVIDER_IDS = PROVIDERS.filter((provider) => provider.kind === 'cloud').map((provider) => provider.id);
export const LOCAL_PROVIDER_IDS = PROVIDERS.filter((provider) => provider.kind === 'local').map((provider) => provider.id);

// Providers whose adapters build the request themselves instead of mapping
// through a schema snapshot. Their routes only name the provider model id.
export const DIRECT_PROVIDERS = new Set(['google', 'openai', 'openrouter']);

export function getProvider(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}
