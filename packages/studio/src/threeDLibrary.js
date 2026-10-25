// One asset library for all 3D pages. Every page shows the same results, and
// "Send to" hands a model from one page to another (Text to 3D → Retexture,
// Retexture → Rig and animate, …), switching the shell to that tab.

const STORAGE_KEY = 'hg_three_d_library';
const LEGACY_KEY = 'hg_three_d_studio_persistent';
const LIMIT = 60;
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
    // Results from the single-tab 3D Studio move into the shared library.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    if (Array.isArray(legacy?.history)) {
      const known = new Set(entries.map((entry) => entry.id));
      entries = [...entries, ...legacy.history.filter((entry) => isEntry(entry) && !known.has(entry.id))];
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch (error) {
    console.warn('[threeDLibrary] could not restore', error);
  }
  state = { ...state, entries: entries.slice(0, LIMIT), loaded: true };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: state.entries.slice(0, LIMIT) }));
  } catch (error) {
    console.warn('[threeDLibrary] could not save', error);
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

export function addEntry(entry) {
  load();
  state = { ...state, entries: [entry, ...state.entries.filter((item) => item.id !== entry.id)].slice(0, LIMIT) };
  save();
  emit();
}

export function removeEntry(id) {
  load();
  state = { ...state, entries: state.entries.filter((entry) => entry.id !== id) };
  save();
  emit();
}

export function addPending(run) {
  state = { ...state, pending: [run, ...state.pending] };
  emit();
}

export function removePending(id) {
  state = { ...state, pending: state.pending.filter((run) => run.id !== id) };
  emit();
}

/** Queues a model for another 3D page and asks the shell to open that tab. */
export function sendTo(page, payload) {
  state = { ...state, handoffs: { ...state.handoffs, [page]: payload } };
  emit();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('oga:open-studio', { detail: { tabId: `three-d-${page}` } }));
  }
}

/** Returns and clears what was sent to a page, or null. */
export function takeHandoff(page) {
  const payload = state.handoffs[page];
  if (!payload) return null;
  state = { ...state, handoffs: { ...state.handoffs, [page]: null } };
  return payload;
}

/** Test helper: forgets everything, including what was loaded from storage. */
export function resetLibrary() {
  state = EMPTY;
}
