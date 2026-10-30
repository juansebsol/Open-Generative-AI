// The Benchmarks helper bubble: which Benchmarks category a studio page
// shows, what its rows are, and whether the visitor has it open. Pure, so
// the page-to-category mapping and the per-visitor state can be unit-tested.
//
// A studio that covers several kinds of job (Image: text to image or
// editing; Video: text or image to video) tells the
// shell which one is active by dispatching STUDIO_MODE_EVENT with
// { tabId, mode }; the bubble keeps the last mode per tab.

import { categoryEntries, editorsPickRow, getCategory } from './benchmarks.js';

export const STUDIO_MODE_EVENT = 'oga:studio-mode';
export const HELPER_STORAGE_KEY = 'oga_benchmarks_helper_v1';

// How many ranked models the collapsed "More" section lists after the picks.
export const MORE_COUNT = 4;

// Tab id → Benchmarks category. `category(mode)` may return null to hide the
// bubble in a mode no board covers (video to video). `pageOnly` keeps only
// the category rows that open on this very page (the 3D category mixes text
// and image models across two pages; the two audio boards each span two). Pages missing here show no bubble:
// Vibe Motion and the agents have no model picker to select into, and the
// Vectorize tracers and the Remix models are on no public board.
const MAPPINGS = {
  image: { category: (mode) => (mode === 'edit' ? 'image-editing' : 'text-to-image') },
  video: { category: (mode) => (mode === 'v2v' ? null : mode === 'i2v' ? 'image-to-video' : 'text-to-video') },
  'audio-speech': { category: () => 'text-to-speech', pageOnly: true },
  'audio-dialogue': { category: () => 'text-to-speech', pageOnly: true },
  'audio-music': { category: () => 'music', pageOnly: true },
  'three-d-text': { category: () => 'three-d', pageOnly: true },
  'three-d-image': { category: () => 'three-d', pageOnly: true },
  'vector-logo': { category: () => 'vector' },
  'vector-icons': { category: () => 'vector' },
};

export const HELPER_TAB_IDS = Object.keys(MAPPINGS);

/** The Benchmarks category a page shows in its current mode, or null for none. */
export function helperCategoryFor(tabId, mode) {
  const mapping = MAPPINGS[tabId];
  if (!mapping) return null;
  const categoryId = mapping.category(mode);
  return categoryId && getCategory(categoryId) ? categoryId : null;
}

/**
 * The category's entries for this page, each with `studio` set to the page
 * itself so "Use" selects the model where the visitor already is.
 */
export function helperEntries(tabId, mode) {
  const categoryId = helperCategoryFor(tabId, mode);
  if (!categoryId) return [];
  const mapping = MAPPINGS[tabId];
  return categoryEntries(categoryId)
    .filter((entry) => !mapping.pageOnly || entry.studio === tabId)
    .map((entry) => ({ ...entry, studio: tabId }));
}

const PICK_KINDS = ['best', 'bestValue', 'cheapestDecent'];

/**
 * Rows for the bubble from a ranking (see rankEntries): the editor's choice
 * of the category (its own section above the chart, when the category has
 * one and the model is among the rows), then the chart: the computed picks,
 * one row per distinct model with every label it earned, then the next best
 * scored models for the "More" section. The chart is complete on its own,
 * so the editor's choice also keeps its numbered place in it.
 * @param {{ picks: object, rows: object[] }} ranking
 * @param {number} [moreCount]
 * @param {{ categoryId?: string|null }} [options]  category whose editor's choice to show
 * @returns {{ editorsPick: { row: object, kinds: string[] }|null, picks: Array<{ row: object, kinds: string[] }>, more: object[] }}
 */
export function helperRows({ picks, rows }, moreCount = MORE_COUNT, { categoryId = null } = {}) {
  const chosenRow = categoryId ? editorsPickRow(categoryId, rows) : null;
  const picked = [];
  for (const kind of PICK_KINDS) {
    const row = picks?.[kind];
    if (!row) continue;
    const existing = picked.find((item) => item.row.id === row.id);
    if (existing) existing.kinds.push(kind);
    else picked.push({ row, kinds: [kind] });
  }
  const editorsPick = chosenRow ? { row: chosenRow, kinds: picked.find((item) => item.row.id === chosenRow.id)?.kinds || [] } : null;
  const pickedIds = new Set(picked.map((item) => item.row.id));
  const more = (rows || [])
    .filter((row) => Number.isFinite(row.score) && !pickedIds.has(row.id))
    .sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity))
    .slice(0, moreCount);
  return { editorsPick, picks: picked, more };
}

// ── Per-visitor open state ──────────────────────────────────────────────────

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * Whether the bubble is open for this visitor: open until they close it,
 * except on a phone-width screen (`narrow`), where the card would cover the
 * page, so it starts closed until they open it once.
 */
export function loadHelperOpen({ narrow = false } = {}) {
  try {
    const raw = storage()?.getItem(HELPER_STORAGE_KEY);
    if (!raw) return !narrow;
    const data = JSON.parse(raw);
    return typeof data?.open === 'boolean' ? data.open : !narrow;
  } catch {
    return !narrow;
  }
}

export function saveHelperOpen(open) {
  try {
    storage()?.setItem(HELPER_STORAGE_KEY, JSON.stringify({ open: Boolean(open) }));
  } catch {
    // quota or privacy mode: the choice lasts for this tab only
  }
}

// ── Studio modes ────────────────────────────────────────────────────────────
//
// Every studio is mounted at once (hidden tabs included) and announces its
// mode on mount, before the bubble has subscribed; the last mode per tab is
// kept here so the bubble can read it at any time.
const studioModes = new Map();

/** A studio tells the bubble which kind of job it is set up for right now. */
export function announceStudioMode(tabId, mode) {
  studioModes.set(tabId, mode);
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(STUDIO_MODE_EVENT, { detail: { tabId, mode } }));
}

/** The last mode a studio announced, or undefined (the mapping's default). */
export function getStudioMode(tabId) {
  return studioModes.get(tabId);
}

/** Test helper. */
export function resetStudioModes() {
  studioModes.clear();
}

/** `/studio/benchmarks` with the category preselected. */
export function benchmarksHref(benchmarksPath, categoryId) {
  return categoryId ? `${benchmarksPath}?category=${encodeURIComponent(categoryId)}` : benchmarksPath;
}
