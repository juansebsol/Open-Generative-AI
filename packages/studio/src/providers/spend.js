// Local spend ledger: one line per finished run, kept only in this browser.
// Amounts are the quote shown before the run (an estimate) or, when the
// provider reports it (OpenRouter), the actual charge. The Providers panel
// sums them per provider for the current month.

const STORAGE_KEY = 'oga_spend_v1';
const CHANGE_EVENT = 'oga:spend-changed';
const LIMIT = 3000;
const KEEP_MS = 400 * 24 * 60 * 60 * 1000;
const EMPTY = Object.freeze({ entries: [] });

let cache = null;

function hasStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

// null and undefined stay null; Number(null) would count as 0.
const asNumber = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));

const isEntry = (entry) => entry && typeof entry.provider === 'string' && Number.isFinite(Number(entry.t));

function load() {
  if (cache) return cache;
  if (!hasStorage()) return EMPTY;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    cache = { entries: (Array.isArray(raw?.entries) ? raw.entries : []).filter(isEntry) };
  } catch {
    cache = { entries: [] };
  }
  return cache;
}

function save(next) {
  cache = next;
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota or privacy mode: totals still apply for this tab
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function getSpend() {
  return load();
}

export function subscribeSpend(callback) {
  if (typeof window === 'undefined') return () => {};
  const onChange = () => callback(load());
  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Records one finished run.
 * @param {{ provider: string, endpoint?: string, amount?: number|null, currency?: string,
 *           characters?: number, estimated?: boolean, t?: number }} entry
 */
export function recordSpend(entry) {
  if (!entry?.provider) return;
  const now = entry.t || Date.now();
  const line = {
    t: now,
    provider: entry.provider,
    endpoint: entry.endpoint || '',
    amount: asNumber(entry.amount),
    currency: entry.currency || 'USD',
    characters: asNumber(entry.characters),
    estimated: entry.estimated !== false,
  };
  const entries = [line, ...load().entries.filter((item) => now - item.t < KEEP_MS)].slice(0, LIMIT);
  save({ entries });
}

export function clearSpend() {
  save({ entries: [] });
}

/** Per-provider totals for the calendar month containing `now` (local time). */
export function monthlySpend(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const totals = {};
  for (const entry of load().entries) {
    if (entry.t < start || entry.t >= end) continue;
    const bucket = totals[entry.provider] || (totals[entry.provider] = { amount: 0, runs: 0, priced: 0, estimated: 0, characters: 0, currency: entry.currency || 'USD' });
    bucket.runs += 1;
    if (entry.amount !== null) {
      bucket.amount += entry.amount;
      bucket.priced += 1;
      if (entry.estimated) bucket.estimated += 1;
    }
    if (entry.characters !== null) bucket.characters += entry.characters;
  }
  for (const bucket of Object.values(totals)) bucket.amount = Math.round(bucket.amount * 10000) / 10000;
  return totals;
}

/** Test helper. */
export function resetSpend() {
  cache = null;
}
