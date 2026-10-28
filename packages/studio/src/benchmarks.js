// The Benchmarks page: which model is best, best value and cheapest-decent
// per task category. Scores come from catalog/benchmarks.js (curated, dated,
// sourced); prices come from the same quotes the price chip shows. This
// module is pure so the ranking can be unit-tested without a browser.

import { BENCHMARKS, BENCHMARKS_UPDATED, DECENT_GAP, SOURCES, VALUE_FLOOR_GAP } from './providers/catalog/benchmarks.js';
import { audioModels, i2iModels, i2vModels, t2iModels, t2vModels, threeDModels } from './models.js';
import { vectorTextModels } from './vectorModels.js';

// Utility and derivative entries that are not comparable on a quality board:
// upscalers, background tools, LoRA inference variants, layer decomposition,
// effects presets. They stay in their studios, just not in the rankings.
const UTILITY = /^ai-|upscal|-lora$|-lora-|lora-inference|layer|watermark|face-expression|image-effects|reframe|character|pulid|redux|subject-reference|effects|template|text-to-image-2512$/;

// Audio models are one list; the family tells speech from music.
const TTS_FAMILIES = new Set(['minimax-2.3', 'minimax-2.6', 'audio-generation', 'gemini-tts']);
const MUSIC_FAMILIES = new Set(['minimax-music', 'lyria', 'mureka', 'elevenlabs-music', 'stable-audio']);

// Text every speech model is priced on, so per-character rates compare.
export const TTS_SAMPLE_CHARACTERS = 500;
const TTS_SAMPLE = 'The quick brown fox jumps over the lazy dog. '.repeat(12).slice(0, TTS_SAMPLE_CHARACTERS);

// Prompt length every code-written SVG model is priced on (per-token rates).
export const SVG_PROMPT_CHARACTERS = 100;

/** Which audio category a model belongs to, from its family. */
export function audioCategoryOf(model) {
  if (TTS_FAMILIES.has(model?.family)) return 'text-to-speech';
  if (MUSIC_FAMILIES.has(model?.family)) return 'music';
  return null;
}

export const CATEGORIES = [
  { id: 'text-to-image', studio: () => 'image', models: () => t2iModels.filter((model) => !UTILITY.test(model.id)) },
  { id: 'image-editing', studio: () => 'image', models: () => i2iModels.filter((model) => !UTILITY.test(model.id) && model.inputs?.prompt) },
  { id: 'text-to-video', studio: () => 'video', models: () => t2vModels.filter((model) => !UTILITY.test(model.id)) },
  { id: 'image-to-video', studio: () => 'video', models: () => i2vModels.filter((model) => !UTILITY.test(model.id)) },
  { id: 'text-to-speech', studio: () => 'audio', models: () => audioModels.filter((model) => TTS_FAMILIES.has(model.family)) },
  { id: 'music', studio: () => 'audio', models: () => audioModels.filter((model) => MUSIC_FAMILIES.has(model.family)) },
  { id: 'three-d', studio: (model) => (model.kind === 'text' ? 'three-d-text' : 'three-d-image'), models: () => threeDModels.filter((model) => model.kind !== 'edit') },
  // Text to Logo and Icon Set share these models; the tracers on Vectorize
  // are on no public board, so there is no category for them.
  { id: 'vector', studio: () => 'vector-logo', models: () => vectorTextModels },
];

export function getCategory(id) {
  return CATEGORIES.find((category) => category.id === id) || null;
}

/**
 * The payload a model is priced on: its own defaults (what the studio sends
 * before the visitor changes anything), plus a fixed sample text for speech.
 */
export function benchmarkPayload(model, categoryId) {
  const payload = {};
  for (const [key, input] of Object.entries(model.inputs || {})) {
    if (input?.default !== undefined && !input.field) payload[key] = input.default;
  }
  if (categoryId === 'text-to-speech') {
    if (model.inputs?.dialogue_turns) payload.dialogue_turns = [{ text: TTS_SAMPLE }];
    else if (model.inputs?.text) payload.text = TTS_SAMPLE;
    else payload.prompt = TTS_SAMPLE;
  }
  if (categoryId === 'vector') {
    // One SVG per run, the way the Vector pages quote a single candidate.
    if (model.kind === 'chat') Object.assign(payload, { num_images: 1, prompt_characters: SVG_PROMPT_CHARACTERS });
    else if (model.candidates === 'num_images') payload.num_images = 1;
  }
  return payload;
}

/** Every model of a category with its score (or null) attached. */
export function categoryEntries(categoryId) {
  const category = getCategory(categoryId);
  if (!category) return [];
  return category.models().map((model) => {
    const benchmark = BENCHMARKS[model.id] || null;
    return {
      id: model.id,
      name: model.name,
      endpoint: model.endpoint || model.id,
      model,
      studio: category.studio(model),
      score: benchmark ? benchmark.score : null,
      source: benchmark ? SOURCES[benchmark.source] : null,
      leaderboardName: benchmark?.leaderboardName || null,
      note: benchmark?.note || null,
      asOf: benchmark ? BENCHMARKS_UPDATED : null,
    };
  });
}

/**
 * Price per run as a number: a total quote's amount, 0 for a local engine,
 * null when the quote cannot be turned into one figure (per-unit, per-token,
 * unavailable, no provider).
 */
export function priceOf(quote) {
  if (!quote) return null;
  if (quote.kind === 'free') return 0;
  if (quote.kind === 'total' && Number.isFinite(Number(quote.amount))) return Number(quote.amount);
  return null;
}

const isScored = (entry) => Number.isFinite(entry.score);
const isPriced = (entry) => Number.isFinite(entry.price);

/** Quality per dollar; see VALUE_FLOOR_GAP in catalog/benchmarks.js. */
export function valueScore(score, price, topScore) {
  if (!Number.isFinite(score) || !Number.isFinite(price) || !Number.isFinite(topScore)) return null;
  const above = Math.max(0, score - (topScore - VALUE_FLOOR_GAP));
  if (price <= 0) return above > 0 ? Infinity : 0;
  return above / price;
}

/**
 * Ranks entries of one category.
 * @param {Array<{ id: string, score: number|null, price: number|null }>} entries
 * @returns {{ topScore: number|null, decentFloor: number|null, valueFloor: number|null,
 *   rows: Array<object>, picks: { best: object|null, bestValue: object|null, cheapestDecent: object|null } }}
 */
export function rankEntries(entries) {
  const scored = entries.filter(isScored);
  const topScore = scored.length ? Math.max(...scored.map((entry) => entry.score)) : null;
  const decentFloor = topScore === null ? null : topScore - DECENT_GAP;
  const valueFloor = topScore === null ? null : topScore - VALUE_FLOOR_GAP;
  const rows = entries.map((entry) => ({
    ...entry,
    decent: isScored(entry) && decentFloor !== null && entry.score >= decentFloor,
    value: isScored(entry) && isPriced(entry) ? valueScore(entry.score, entry.price, topScore) : null,
  }));

  // Ties: the same score goes to the cheaper model, the same price or value
  // to the better-scored one.
  const byScoreThenPrice = (a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity);
  const byPriceThenScore = (a, b) => a.price - b.price || b.score - a.score;
  const byValueThenScore = (a, b) => b.value - a.value || b.score - a.score;

  const best = rows.filter(isScored).sort(byScoreThenPrice)[0] || null;
  const bestValue = rows.filter((row) => row.value !== null && row.value > 0).sort(byValueThenScore)[0] || null;
  const cheapestDecent = rows.filter((row) => row.decent && isPriced(row)).sort(byPriceThenScore)[0] || null;

  return { topScore, decentFloor, valueFloor, rows, picks: { best, bestValue, cheapestDecent } };
}

/** Comparator for the table: unscored or unpriced rows always sort last. */
export function compareRows(key, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    const av = a[key];
    const bv = b[key];
    const aMissing = av === null || av === undefined || (typeof av === 'number' && Number.isNaN(av));
    const bMissing = bv === null || bv === undefined || (typeof bv === 'number' && Number.isNaN(bv));
    if (aMissing && bMissing) return a.name.localeCompare(b.name);
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (typeof av === 'string') return sign * av.localeCompare(bv);
    if (av === bv) return a.name.localeCompare(b.name);
    return sign * (av - bv);
  };
}

export { BENCHMARKS_UPDATED, DECENT_GAP, SOURCES, VALUE_FLOOR_GAP };
