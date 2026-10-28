// Which editor's pick each page has already applied for this visitor
// (localStorage key oga_editors_pick_seen_v1: { [page]: pickModelId }).
// A page opens on its category's editor's pick until the visitor has seen
// that pick once; after that their own saved choice persists, until the
// pick changes (see resolveInitialModel in benchmarks.js).

export const PICK_SEEN_STORAGE_KEY = 'oga_editors_pick_seen_v1';

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readAll() {
  try {
    const data = JSON.parse(storage()?.getItem(PICK_SEEN_STORAGE_KEY) || 'null');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** The pick id `page` last applied, or null when it never applied one. */
export function loadPickSeen(page) {
  const value = readAll()[page];
  return typeof value === 'string' && value ? value : null;
}

/** Records that `page` applied (or dismissed) the pick `pickId`; null clears it. */
export function savePickSeen(page, pickId) {
  try {
    const all = readAll();
    if (pickId) all[page] = pickId;
    else delete all[page];
    storage()?.setItem(PICK_SEEN_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // quota or privacy mode: the pick is applied again next time
  }
}
