// The pure part of the card model picker (components/prompt/ModelCardPicker.jsx):
// tabs from the caller's groups, the search filter, the provider line under
// a model name, the score bar and the Benchmarks pick marks. Unit-tested
// without a browser.

import { helperRows } from './benchmarksHelper.js';

export const ALL_TAB_ID = 'all';

// The score bar is relative to the category leader: a model this many Elo
// below it is at the floor (the same scale the Benchmarks helper uses).
export const SCORE_BAR_RANGE = 400;

/**
 * The tab row: "All" first with every model of every group, then one tab
 * per group. Counts are attached here so the labels can show them.
 * @param {Array<{ id: string, label: string, hint?: string, models: object[] }>} groups
 * @param {{ allLabel?: string, allHint?: string }} [options]
 */
export function pickerTabs(groups, { allLabel = 'All', allHint = '' } = {}) {
  const list = (groups || []).filter((group) => group && Array.isArray(group.models));
  const seen = new Set();
  const all = [];
  for (const group of list) {
    for (const model of group.models) {
      if (!model?.id || seen.has(model.id)) continue;
      seen.add(model.id);
      all.push(model);
    }
  }
  const tabs = list.map((group) => ({ id: group.id, label: group.label, hint: group.hint || '', count: group.models.length, models: group.models }));
  if (tabs.length <= 1) return tabs.map((tab) => ({ ...tab, hint: tab.hint || allHint }));
  return [{ id: ALL_TAB_ID, label: allLabel, hint: allHint, count: all.length, models: all }, ...tabs];
}

const normalise = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Models whose name or provider matches every word of the query (case and
 * accent insensitive). An empty query keeps everything.
 */
export function filterModels(models, query) {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return models || [];
  return (models || []).filter((model) => {
    const haystack = normalise([model.name, model.provider_name, model.providerLine].filter(Boolean).join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

// How a provider is named after the vendor: "OpenAI · via OpenRouter",
// "Google · Gemini API", "Recraft · fal.ai".
const PROVIDER_SUFFIX = {
  openrouter: 'via OpenRouter',
  google: 'Gemini API',
  openai: 'OpenAI API',
  fal: 'fal.ai',
  wavespeed: 'WaveSpeedAI',
  elevenlabs: 'ElevenLabs API',
  comfyui: 'ComfyUI',
  sdserver: 'sd.cpp server',
};

/**
 * "Vendor · provider" for a card, from the route the price chip resolves.
 * @param {string} vendor  the model's provider_name
 * @param {string|null} providerId  the route's provider id, or null when none
 * @param {string} [providerLabel]  fallback label for an unknown provider id
 */
export function providerLine(vendor, providerId, providerLabel = '') {
  const suffix = providerId ? PROVIDER_SUFFIX[providerId] || providerLabel || providerId : '';
  const parts = [vendor, suffix].filter(Boolean);
  // "fal · fal.ai" reads as a stutter; the provider alone says it.
  if (parts.length === 2 && normalise(parts[0]) === normalise(parts[1]).replace(/\.ai$/, '')) return parts[1];
  return parts.join(' · ');
}

/**
 * Width of a card's score bar as a percentage of the leader's, 0 for an
 * unscored model. The floor is SCORE_BAR_RANGE Elo below the leader; the
 * bar never drops under 30 % for a scored model so it stays visible.
 */
export function scoreWidth(score, topScore) {
  if (!Number.isFinite(score) || !Number.isFinite(topScore) || topScore <= 0) return 0;
  const floor = topScore - SCORE_BAR_RANGE;
  const relative = Math.max(0, Math.min(1, (score - floor) / (topScore - floor || 1)));
  return Math.round(30 + 70 * relative);
}

/**
 * The Benchmarks marks per model id from a ranking (see rankEntries):
 * { 'svg-gpt-6-1-sol': ['best'], 'svg-claude-haiku-5-5': ['bestValue', 'cheapestDecent'] }.
 */
export function pickKindsById(ranking) {
  const map = {};
  if (!ranking) return map;
  for (const { row, kinds } of helperRows(ranking, 0).picks) map[row.id] = kinds;
  return map;
}
