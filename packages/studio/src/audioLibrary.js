// The Audio pages' result library, shared by Text to Speech, Dialogue,
// Music and Remix. Entries point at files kept in this browser (the media
// store saves every finished output locally). Cloned voices live here too,
// so the Speech page's voice picker can offer them. "Send to" queues a track
// for the Remix page.

const STORAGE_KEY = 'oga_audio_library_v1';
// The single-page Audio Studio kept its history here; it is folded in once.
const LEGACY_KEY = 'hg_audio_studio_persistent';
const LIMIT = 200;
const VOICE_LIMIT = 40;
const EMPTY = { entries: [], voices: [], pending: [], handoffs: {}, loaded: false };

const listeners = new Set();
let state = EMPTY;

const isEntry = (entry) => Boolean(entry?.id) && typeof entry.url === 'string';
const isVoice = (voice) => Boolean(voice?.id) && typeof voice.name === 'string';

function emit() {
  for (const listener of listeners) listener();
}

/** Entries from the old Audio Studio's history, oldest-format fields mapped over. */
export function migrateLegacyHistory(data) {
  const history = Array.isArray(data?.internalHistory) ? data.internalHistory : [];
  return history.filter(isEntry).map((item) => ({
    id: String(item.id),
    url: item.url,
    page: 'speech',
    kind: 'legacy',
    title: item.title || '',
    prompt: item.prompt || '',
    model: item.model || '',
    modelName: '',
    vendor: '',
    timestamp: item.timestamp || null,
  }));
}

function load() {
  if (state.loaded || typeof localStorage === 'undefined') return;
  let entries = [];
  let voices = [];
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(data?.entries)) entries = data.entries.filter(isEntry);
    if (Array.isArray(data?.voices)) voices = data.voices.filter(isVoice);
  } catch (error) {
    console.warn('[audioLibrary] could not restore', error);
  }
  let migrated = false;
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    const old = migrateLegacyHistory(legacy);
    if (old.length) {
      const ids = new Set(entries.map((entry) => entry.id));
      entries = [...entries, ...old.filter((entry) => !ids.has(entry.id))];
      migrated = true;
    }
    if (legacy) localStorage.removeItem(LEGACY_KEY);
  } catch (error) {
    console.warn('[audioLibrary] could not migrate the old history', error);
  }
  state = { ...state, entries: entries.slice(0, LIMIT), voices: voices.slice(0, VOICE_LIMIT), loaded: true };
  if (migrated) save();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: state.entries.slice(0, LIMIT), voices: state.voices.slice(0, VOICE_LIMIT) }));
  } catch (error) {
    console.warn('[audioLibrary] could not save', error);
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
 * @param {{ id: string, url: string, page: 'speech'|'dialogue'|'music'|'remix', kind: string, title?: string, prompt?: string,
 *   text?: string, lyrics?: string, model: string, modelName: string, vendor?: string, voice?: string|null, duration?: number|null,
 *   cost?: { amount: number, currency?: string }|null, sourceUrl?: string|null, sourceName?: string|null, timestamp: string }} entry
 */
export function addEntry(entry) {
  load();
  state = { ...state, entries: [entry, ...state.entries.filter((item) => item.id !== entry.id)].slice(0, LIMIT) };
  save();
  emit();
}

export function updateEntry(id, patch) {
  load();
  if (!state.entries.some((entry) => entry.id === id)) return;
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

/** @param {{ id: string, name: string, family: string, sampleUrl?: string|null, previewUrl?: string|null, timestamp: string }} voice */
export function addVoice(voice) {
  load();
  state = { ...state, voices: [voice, ...state.voices.filter((item) => item.id !== voice.id)].slice(0, VOICE_LIMIT) };
  save();
  emit();
}

export function removeVoice(id) {
  load();
  state = { ...state, voices: state.voices.filter((voice) => voice.id !== id) };
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
 * Queues a track for one of the Audio pages and asks the shell to open that
 * page's tab (`audio-<page>`): a library result sent to Remix, or a dropped
 * file from another page.
 */
export function sendToAudio(page, payload) {
  state = { ...state, handoffs: { ...state.handoffs, [page]: payload } };
  emit();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('oga:open-studio', { detail: { tabId: `audio-${page}` } }));
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
