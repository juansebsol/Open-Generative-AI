// The pure part of the rail model picker (components/prompt/ModelRailPicker.jsx):
// the rail entries (All, one per group, then the vendors with counts), the
// search and rail filter, the sections of the list and the provider line
// under a model name. Unit-tested without a browser.

export const ALL_ID = 'all';
export const VENDOR_PREFIX = 'vendor:';

const normalise = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const slug = (text) => normalise(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other';

/** Up to two letters for a vendor badge: "Recraft" → "RE", "OpenAI" → "OP". */
export function vendorMono(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}

const dedupe = (groups) => {
  const seen = new Set();
  const all = [];
  for (const group of groups) {
    for (const model of group.models || []) {
      if (!model?.id || seen.has(model.id)) continue;
      seen.add(model.id);
      all.push(model);
    }
  }
  return all;
};

/**
 * The rail: "All" with every model, one entry per group (its `tone` colours
 * the badge), then a divider and the vendors by provider name, each with the
 * tone of the first group that holds one of its models, most models first.
 * @param {Array<{ id: string, label: string, railLabel?: string, tone?: 'cyan'|'violet', models: object[] }>} groups
 *   `label` is the section header; `railLabel` the shorter rail entry when it differs
 * @param {{ allLabel?: string }} [options]
 * @returns {{ all: object, kinds: object[], vendors: object[] }}
 */
export function railEntries(groups, { allLabel = 'All' } = {}) {
  const list = (groups || []).filter((group) => group && Array.isArray(group.models));
  const models = dedupe(list);
  const kinds = list.map((group) => ({ id: group.id, label: group.railLabel || group.label, count: group.models.length, tone: group.tone || 'cyan', mono: group.mono || vendorMono(group.railLabel || group.label) }));
  const toneOf = (model) => list.find((group) => group.models.some((item) => item.id === model.id))?.tone || 'cyan';
  const vendors = new Map();
  for (const model of models) {
    const name = model.provider_name || 'Other';
    const id = `${VENDOR_PREFIX}${slug(name)}`;
    const entry = vendors.get(id) || { id, name, count: 0, tone: toneOf(model), mono: vendorMono(name) };
    entry.count += 1;
    vendors.set(id, entry);
  }
  return {
    all: { id: ALL_ID, label: allLabel, count: models.length },
    kinds,
    vendors: [...vendors.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** True when the rail id names a vendor. */
export const isVendorId = (id) => typeof id === 'string' && id.startsWith(VENDOR_PREFIX);

const matchesQuery = (model, words) => {
  if (words.length === 0) return true;
  const haystack = normalise([model.name, model.provider_name, model.providerLine].filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
};

/**
 * The list for one rail selection and search: the sections of the right
 * pane. "All" and a group keep the models under their group headers; a
 * vendor shows its models in one unlabelled section. Empty sections are
 * dropped.
 * @param {Array<{ id: string, label: string, models: object[] }>} groups
 * @param {{ railId?: string, query?: string }} [selection]
 * @returns {Array<{ id: string, label: string|null, models: object[] }>}
 */
export function railSections(groups, { railId = ALL_ID, query = '' } = {}) {
  const list = (groups || []).filter((group) => group && Array.isArray(group.models));
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (isVendorId(railId)) {
    const models = dedupe(list).filter((model) => `${VENDOR_PREFIX}${slug(model.provider_name || 'Other')}` === railId && matchesQuery(model, words));
    return models.length ? [{ id: railId, label: null, models }] : [];
  }
  const chosen = railId === ALL_ID ? list : list.filter((group) => group.id === railId);
  return chosen
    .map((group) => ({ id: group.id, label: group.label, models: group.models.filter((model) => matchesQuery(model, words)) }))
    .filter((section) => section.models.length > 0);
}

// How a provider is named after the vendor on a row: "Recraft · fal.ai",
// "OpenAI · OpenRouter", "Google · Gemini".
const PROVIDER_SUFFIX = {
  openrouter: 'OpenRouter',
  google: 'Gemini',
  openai: 'OpenAI',
  fal: 'fal.ai',
  wavespeed: 'WaveSpeedAI',
  elevenlabs: 'ElevenLabs',
  comfyui: 'ComfyUI',
  sdserver: 'sd.cpp server',
};

/**
 * "Vendor · provider" for a row, from the route the price chip resolves.
 * The provider alone when it is the vendor ("OpenAI · OpenAI" would stutter).
 * @param {string} vendor  the model's provider_name
 * @param {string|null} providerId  the route's provider id, or null when none
 * @param {string} [providerLabel]  fallback label for an unknown provider id
 */
export function providerLine(vendor, providerId, providerLabel = '') {
  const suffix = providerId ? PROVIDER_SUFFIX[providerId] || providerLabel || providerId : '';
  if (!suffix) return vendor || '';
  if (!vendor || normalise(vendor) === normalise(suffix) || normalise(suffix).startsWith(normalise(vendor))) return suffix;
  return `${vendor} · ${suffix}`;
}
