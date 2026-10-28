// Editor's picks for the Benchmarks page: Openstudio's own recommendation
// per category, set by hand and independent of the arena scores in
// benchmarks.js. A pick is shown next to the computed picks (best quality,
// best value, cheapest decent), never instead of them: the scores stay as
// they are, the pick just says which model we would reach for first and why.
//
// One optional entry per Benchmarks category id (see CATEGORIES in
// src/benchmarks.js): { modelId, note, asOf }.
//   modelId  the catalog id of a model that belongs to that category
//   note     one sentence on why, shown on the card and in tooltips
//   asOf     the date the pick was last reviewed (YYYY-MM-DD)
//
// To change a pick, edit or add the entry below; to drop one, delete it.
// `npm test` checks that every pick names a model of its category. The pick
// is also the initial selection on pages of that category for visitors who
// have not chosen a model yet.

export const EDITORS_PICKS = {
  vector: {
    modelId: 'svg-gemini-4-argon',
    note: 'Cleanest geometry and composition on logo marks in our own tests.',
    asOf: '2026-10-27',
  },
};

/** The editor's pick of a category, or null when it has none. */
export function getEditorsPick(categoryId) {
  return EDITORS_PICKS[categoryId] || null;
}
