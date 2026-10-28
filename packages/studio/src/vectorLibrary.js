// The Vector studio's result library, shared by its tools (Text to Logo,
// Icon Set, Vectorize). Entries point at files saved in this browser
// (mediaStore) as image/svg+xml, with a PNG thumbnail for raster
// consumers. "Send to" queues a result for another tool, or for another
// studio later (the Logo Rescue and Vector to 3D bridges hook in here).

const STORAGE_KEY = 'oga_vector_library_v1';
const LIMIT = 160;
const EMPTY = { entries: [], pending: [], handoffs: {}, loaded: false };

const listeners = new Set();
let state = EMPTY;

const isEntry = (entry) => Boolean(entry?.id) && typeof entry.url === 'string';

function emit() {
  for (const listener of listeners) listener();
}

function load() {
  if (state.loaded || typeof localStorage === 'undefined') return;
  let entries = [];
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(data?.entries)) entries = data.entries.filter(isEntry);
  } catch (error) {
    console.warn('[vectorLibrary] could not restore', error);
  }
  state = { ...state, entries: entries.slice(0, LIMIT), loaded: true };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: state.entries.slice(0, LIMIT) }));
  } catch (error) {
    console.warn('[vectorLibrary] could not save', error);
  }
}

export function subscribeLibrary(listener) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLibrary() {
  load();
  return state;
}

export function getEmptyLibrary() {
  return EMPTY;
}

/**
 * @param {{ id: string, url: string, kind: 'svg'|'raster', tool: string, thumbnail?: string|null, prompt?: string, name?: string,
 *   model?: string, modelName?: string, vendor?: string, setId?: string|null, setName?: string|null, sourceUrl?: string|null, timestamp: string }} entry
 */
export function addEntry(entry) {
  load();
  state = { ...state, entries: [entry, ...state.entries.filter((item) => item.id !== entry.id)].slice(0, LIMIT) };
  save();
  emit();
}

export function addEntries(entries) {
  load();
  const ids = new Set(entries.map((entry) => entry.id));
  state = { ...state, entries: [...entries, ...state.entries.filter((item) => !ids.has(item.id))].slice(0, LIMIT) };
  save();
  emit();
}

export function updateEntry(id, patch) {
  load();
  state = { ...state, entries: state.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) };
  save();
  emit();
}

export function removeEntry(id) {
  load();
  state = { ...state, entries: state.entries.filter((entry) => entry.id !== id) };
  save();
  emit();
}

export function removeSet(setId) {
  load();
  state = { ...state, entries: state.entries.filter((entry) => entry.setId !== setId) };
  save();
  emit();
}

export function addPending(run) {
  state = { ...state, pending: [run, ...state.pending] };
  emit();
}

export function updatePending(id, patch) {
  state = { ...state, pending: state.pending.map((run) => (run.id === id ? { ...run, ...patch } : run)) };
  emit();
}

export function removePending(id) {
  state = { ...state, pending: state.pending.filter((run) => run.id !== id) };
  emit();
}

/**
 * Queues a source for one of the studio's tools and asks the shell to open
 * the Vector tab. Other studios can call this too (Image Studio sending a
 * raster to Vectorize, the Draw modal sending a sketch later).
 */
export function sendToVector(tool, payload) {
  state = { ...state, handoffs: { ...state.handoffs, [tool]: payload } };
  emit();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('oga:open-studio', { detail: { tabId: 'vector' } }));
  }
}

/** Returns and clears what was sent to a tool, or null. */
export function takeHandoff(tool) {
  const payload = state.handoffs[tool];
  if (!payload) return null;
  state = { ...state, handoffs: { ...state.handoffs, [tool]: null } };
  return payload;
}

/** Test helper: forgets everything, including what was loaded from storage. */
export function resetLibrary() {
  state = EMPTY;
}
