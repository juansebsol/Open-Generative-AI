// One registry for the companies behind the models. Catalog entries carry
// whatever `provider` / `provider_name` the upstream listing had (resellers,
// three spellings of MiniMax, nothing at all for many audio models), so the
// pickers resolve every model through resolveVendor() instead.

const VENDORS = {
  alibaba: { name: 'Alibaba', mono: 'AL', color: 'text-sky-400' },
  blackforest: { name: 'Black Forest Labs', mono: 'BF', color: 'text-amber-400' },
  bytedance: { name: 'ByteDance', mono: 'BD', color: 'text-purple-400' },
  'character-ai': { name: 'Character.AI', mono: 'CA', color: 'text-primary' },
  elevenlabs: { name: 'ElevenLabs', mono: 'EL', color: 'text-primary' },
  fal: { name: 'fal', mono: 'FA', color: 'text-indigo-300' },
  google: { name: 'Google', mono: 'G', color: 'text-blue-400' },
  'happy-horse': { name: 'Happy Horse', mono: 'HH', color: 'text-primary' },
  heygen: { name: 'HeyGen', mono: 'HG', color: 'text-primary' },
  hidream: { name: 'HiDream', mono: 'HD', color: 'text-primary' },
  hunyuan: { name: 'Hunyuan', mono: 'HY', color: 'text-primary' },
  hyper3d: { name: 'Hyper3D', mono: 'H3', color: 'text-primary' },
  ideogram: { name: 'Ideogram', mono: 'ID', color: 'text-yellow-400' },
  'infinite-talk': { name: 'InfiniteTalk', mono: 'IT', color: 'text-primary' },
  kling: { name: 'Kling', mono: 'KL', color: 'text-rose-400' },
  krea: { name: 'Krea', mono: 'KR', color: 'text-primary' },
  leonardo: { name: 'Leonardo', mono: 'LE', color: 'text-primary' },
  lightricks: { name: 'Lightricks', mono: 'LT', color: 'text-primary' },
  local: { name: 'Local engines', mono: 'LO', color: 'text-emerald-400' },
  luma: { name: 'Luma', mono: 'LU', color: 'text-primary' },
  meshy: { name: 'Meshy', mono: 'MS', color: 'text-primary' },
  meta: { name: 'Meta', mono: 'ME', color: 'text-blue-300' },
  microsoft: { name: 'Microsoft', mono: 'MC', color: 'text-primary' },
  minimax: { name: 'MiniMax', mono: 'MX', color: 'text-pink-400' },
  mmaudio: { name: 'MMAudio', mono: 'MM', color: 'text-primary' },
  mureka: { name: 'Mureka', mono: 'MU', color: 'text-primary' },
  openai: { name: 'OpenAI', mono: 'O', color: 'text-emerald-400' },
  pixverse: { name: 'PixVerse', mono: 'PX', color: 'text-primary' },
  recraft: { name: 'Recraft', mono: 'RC', color: 'text-orange-300' },
  runway: { name: 'Runway', mono: 'RW', color: 'text-primary' },
  stability: { name: 'Stability AI', mono: 'SD', color: 'text-fuchsia-400' },
  sync: { name: 'Sync', mono: 'SY', color: 'text-primary' },
  tools: { name: 'Tools', mono: 'TL', color: 'text-white/70' },
  topaz: { name: 'Topaz Labs', mono: 'TO', color: 'text-primary' },
  tripo3d: { name: 'Tripo', mono: 'TR', color: 'text-primary' },
  veed: { name: 'Veed', mono: 'VE', color: 'text-primary' },
  vidu: { name: 'Vidu', mono: 'VD', color: 'text-cyan-400' },
  wavespeed: { name: 'WaveSpeed', mono: 'WS', color: 'text-primary' },
  xai: { name: 'xAI', mono: 'xI', color: 'text-orange-400' },
  other: { name: 'Other', mono: 'AI', color: 'text-primary' },
};

// Catalog `provider` ids that mean one of the vendors above.
const ID_ALIASES = { grok: 'xai', leonardoai: 'leonardo', mmaudio: 'mmaudio' };

// Placeholder ids that say nothing about the maker; these fall through to
// the pattern rules below.
const PLACEHOLDER_IDS = new Set(['other', 'video', 'tools', '']);

// First match wins. Checked against `${id} ${family} ${name}` in lower case.
const PATTERNS = [
  [/face-swap|watermark|upscaler|captions|background-remover|image-effects|depth-anything|ai-image-upscale|ai-background|image-extension/, 'tools'],
  [/meshy/, 'meshy'],
  [/tripo/, 'tripo3d'],
  [/rodin|hyper3d/, 'hyper3d'],
  [/trellis/, 'microsoft'],
  [/pixverse/, 'pixverse'],
  [/kling/, 'kling'],
  [/vidu/, 'vidu'],
  [/seedance|seedream|seedvr|bytedance|omnihuman|latent-sync|latentsync/, 'bytedance'],
  [/\bwan[0-9. -]|^wan|qwen|alibaba/, 'alibaba'],
  [/flux|blackforest|black forest/, 'blackforest'],
  [/veo|imagen|gemini|nano-banana|lyria/, 'google'],
  [/gpt|sora|openai|dall-e/, 'openai'],
  [/grok|xai/, 'xai'],
  [/minimax|hailuo/, 'minimax'],
  [/ltx|lightricks/, 'lightricks'],
  [/hunyuan/, 'hunyuan'],
  [/hidream/, 'hidream'],
  [/ideogram/, 'ideogram'],
  [/recraft/, 'recraft'],
  [/image2svg/, 'tools'],
  [/luma|\bray[- ]/, 'luma'],
  [/runway|aleph/, 'runway'],
  [/topaz/, 'topaz'],
  [/elevenlabs|eleven /, 'elevenlabs'],
  [/mureka/, 'mureka'],
  [/stable-audio|stability|stable-diffusion/, 'stability'],
  [/krea/, 'krea'],
  [/\bmeta\b|llama/, 'meta'],
  [/happy-horse|happyhorse/, 'happy-horse'],
  [/leonardo/, 'leonardo'],
  [/mmaudio|mm audio/, 'mmaudio'],
  [/heygen/, 'heygen'],
  [/infinitetalk|infinite-talk|infinite talk/, 'infinite-talk'],
  [/sync-lipsync|^sync /, 'sync'],
  [/veed/, 'veed'],
  [/\bovi\b/, 'character-ai'],
  [/comfyui|sd-server|sdserver|local/, 'local'],
];

/** Resolves a catalog model (or family) to a canonical vendor. */
export function resolveVendor(model) {
  const raw = String(model?.provider || '').toLowerCase();
  const id = ID_ALIASES[raw] || raw;
  if (VENDORS[id] && !PLACEHOLDER_IDS.has(id)) return { id, ...VENDORS[id] };
  const haystack = `${model?.id || ''} ${model?.family || ''} ${model?.name || ''}`.toLowerCase();
  for (const [pattern, vendorId] of PATTERNS) {
    if (pattern.test(haystack)) return { id: vendorId, ...VENDORS[vendorId] };
  }
  return { id: 'other', ...VENDORS.other };
}

export function vendorById(id) {
  const vendor = VENDORS[id] || VENDORS.other;
  return { id: VENDORS[id] ? id : 'other', ...vendor };
}

export const VENDOR_IDS = Object.keys(VENDORS);
