// The Openstudio library file: everything made in this browser in one
// .openstudio file, like a Final Cut library. It is a plain ZIP (rename it
// and any OS opens it) holding:
//
//   manifest.json          format, version, when, what is inside
//   history/<key>.json     each studio's saved state, verbatim from localStorage
//   media/<id>.<ext>       every stored file, named by its media id
//   settings/providers.json  provider keys, only when the visitor ticks the box
//
// Media ids are kept on import, so the local URLs inside the histories
// (/oga-media/<id>.png) point at the restored files without rewriting.
// Importing merges: items already here stay, items from the file are added,
// and nothing is deleted. All of it runs in the browser; the file never
// leaves the computer unless the visitor sends it somewhere.

import { zipParts, readZip } from './zipStream.js';
import { importMediaRecord, listMediaRecords, mediaExtension, isStoragePersisted } from '../providers/mediaStore.js';

export const LIBRARY_EXTENSION = '.openstudio';
export const LIBRARY_FORMAT = 'openstudio-library';
export const LIBRARY_FORMAT_VERSION = 1;
export const LIBRARY_STATE_KEY = 'oga_library_v1';

// Keys the studios save under; the provider keys and our own bookkeeping
// are left out unless asked for.
const HISTORY_KEY_PATTERN = /^(hg_|oga_)/;
const PROVIDER_KEYS_KEY = 'oga_providers_v1';
const SKIPPED_KEYS = new Set([LIBRARY_STATE_KEY, PROVIDER_KEYS_KEY]);

const safeName = (key) => String(key).replace(/[^\w.-]/g, '_');

/** The localStorage entries that make up the visitor's work. */
export function collectHistory(storage = globalThis.localStorage) {
  const entries = [];
  if (!storage) return entries;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!HISTORY_KEY_PATTERN.test(key) || SKIPPED_KEYS.has(key)) continue;
    const value = storage.getItem(key);
    if (typeof value === 'string') entries.push({ key, value });
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export function readLibraryState(storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage?.getItem(LIBRARY_STATE_KEY) || 'null');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeLibraryState(patch, storage = globalThis.localStorage) {
  try {
    storage?.setItem(LIBRARY_STATE_KEY, JSON.stringify({ ...readLibraryState(storage), ...patch }));
  } catch {
    // storage full or unavailable; the export still happened
  }
}

/** Files, bytes, persistence and the last export/import, for Settings. */
export async function libraryStats() {
  const records = await listMediaRecords().catch(() => []);
  const bytes = records.reduce((sum, record) => sum + (record.size || record.blob?.size || 0), 0);
  const state = readLibraryState();
  return {
    files: records.length,
    bytes,
    histories: collectHistory().length,
    persisted: await isStoragePersisted(),
    exportedAt: state.exportedAt || null,
    importedAt: state.importedAt || null,
  };
}

/** A file name for today's export. */
export function libraryFileName(date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  return `Openstudio library ${stamp}${LIBRARY_EXTENSION}`;
}

/**
 * Builds the manifest and the entry list. Media records are read lazily,
 * one at a time, as the zip asks for them.
 */
async function* libraryEntries({ includeKeys = false, records, histories, providerSettings, onProgress }) {
  const exportedAt = new Date().toISOString();
  const media = records.map((record) => ({
    id: record.id,
    file: `media/${record.id}.${mediaExtension(record.type, record.name)}`,
    type: record.type || 'application/octet-stream',
    name: record.name || null,
    size: record.size || record.blob?.size || 0,
    createdAt: record.createdAt || null,
  }));
  const manifest = {
    format: LIBRARY_FORMAT,
    version: LIBRARY_FORMAT_VERSION,
    app: 'Openstudio',
    exportedAt,
    includesProviderKeys: Boolean(includeKeys && providerSettings),
    histories: histories.map((entry) => ({ key: entry.key, file: `history/${safeName(entry.key)}.json`, bytes: entry.value.length })),
    media,
  };
  const total = 1 + histories.length + media.length + (manifest.includesProviderKeys ? 1 : 0);
  let done = 0;
  const tick = (label) => { done += 1; onProgress?.({ done, total, label }); };

  yield { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) };
  tick('manifest.json');
  for (const entry of histories) {
    yield { name: `history/${safeName(entry.key)}.json`, data: entry.value };
    tick(entry.key);
  }
  if (manifest.includesProviderKeys) {
    yield { name: 'settings/providers.json', data: providerSettings };
    tick('settings/providers.json');
  }
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    yield { name: media[i].file, data: record.blob, date: record.createdAt ? new Date(record.createdAt) : undefined };
    tick(media[i].file);
  }
}

/**
 * Writes the library. With the File System Access API (Chrome, Edge) the
 * visitor picks where it goes and the parts are written straight to disk;
 * elsewhere the parts become one Blob (which only references the stored
 * files) and the browser downloads it.
 * @returns {Promise<{ files: number, histories: number, bytes: number, cancelled?: boolean }>}
 */
export async function exportLibrary({ includeKeys = false, onProgress = null, fileName = libraryFileName() } = {}) {
  const records = await listMediaRecords();
  const histories = collectHistory();
  const providerSettings = includeKeys ? globalThis.localStorage?.getItem(PROVIDER_KEYS_KEY) || null : null;
  const entries = libraryEntries({ includeKeys, records, histories, providerSettings, onProgress });
  let bytes = 0;
  const count = (part) => { bytes += part instanceof Blob ? part.size : part.length; return part; };

  if (typeof globalThis.showSaveFilePicker === 'function') {
    let handle;
    try {
      handle = await globalThis.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Openstudio library', accept: { 'application/zip': [LIBRARY_EXTENSION] } }],
      });
    } catch (error) {
      if (error?.name === 'AbortError') return { files: 0, histories: 0, bytes: 0, cancelled: true };
      throw error;
    }
    const writable = await handle.createWritable();
    try {
      for await (const part of zipParts(entries)) await writable.write(count(part));
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
  } else {
    const parts = [];
    for await (const part of zipParts(entries)) parts.push(count(part));
    const blob = new Blob(parts, { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  writeLibraryState({ exportedAt: new Date().toISOString(), exportedFiles: records.length, exportedBytes: bytes });
  return { files: records.length, histories: histories.length, bytes };
}

const identityOf = (item) => (item && typeof item === 'object' ? item.id ?? item.url ?? item.key ?? null : null);
const timeOf = (item) => {
  const value = item?.timestamp ?? item?.createdAt ?? item?.created_at ?? item?.date ?? null;
  const time = typeof value === 'number' ? value : value ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : time;
};

/**
 * Merges one studio's imported state into what is already saved. Arrays of
 * records are unioned by id (or url), existing first, newest first when
 * every item carries a time; objects merge key by key with the existing
 * side winning on plain values; anything else keeps the existing value.
 */
export function mergeHistory(existing, imported) {
  if (existing === undefined || existing === null) return imported;
  if (imported === undefined || imported === null) return existing;
  if (Array.isArray(existing) && Array.isArray(imported)) {
    const seen = new Set(existing.map(identityOf).filter((id) => id !== null));
    const merged = [...existing];
    for (const item of imported) {
      const id = identityOf(item);
      if (id === null) {
        if (!merged.some((other) => JSON.stringify(other) === JSON.stringify(item))) merged.push(item);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
    if (merged.length > 0 && merged.every((item) => timeOf(item) !== null)) merged.sort((a, b) => timeOf(b) - timeOf(a));
    return merged;
  }
  if (isPlainObject(existing) && isPlainObject(imported)) {
    const result = { ...existing };
    for (const [key, value] of Object.entries(imported)) result[key] = key in existing ? mergeHistory(existing[key], value) : value;
    return result;
  }
  return existing;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Merges two localStorage strings; a side that is not JSON is kept as is. */
export function mergeHistoryText(existingText, importedText) {
  if (typeof existingText !== 'string') return importedText;
  let existing;
  let imported;
  try {
    existing = JSON.parse(existingText);
    imported = JSON.parse(importedText);
  } catch {
    return existingText;
  }
  return JSON.stringify(mergeHistory(existing, imported));
}

/** Reads and checks a library file's manifest. */
export async function inspectLibrary(file) {
  const entries = await readZip(file);
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
  if (!manifestEntry) throw new Error('This is not an Openstudio library (no manifest).');
  const manifest = JSON.parse(await manifestEntry.text());
  if (manifest.format !== LIBRARY_FORMAT) throw new Error('This is not an Openstudio library.');
  if (typeof manifest.version !== 'number' || manifest.version > LIBRARY_FORMAT_VERSION) {
    throw new Error(`This library was made by a newer Openstudio (format ${manifest.version}). Update the app to import it.`);
  }
  return { manifest, entries };
}

/**
 * Restores a library into this browser: files back into IndexedDB under
 * their ids, histories merged into localStorage. Provider keys in the file
 * are applied only when `applyKeys` is set and this browser has none.
 * @returns {Promise<{ files: number, skipped: number, histories: number, keysApplied: boolean }>}
 */
export async function importLibrary(file, { onProgress = null, applyKeys = true } = {}) {
  const { manifest, entries } = await inspectLibrary(file);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const media = Array.isArray(manifest.media) ? manifest.media : [];
  const histories = Array.isArray(manifest.histories) ? manifest.histories : [];
  const total = media.length + histories.length;
  let done = 0;
  let skipped = 0;
  const tick = (label) => { done += 1; onProgress?.({ done, total, label }); };

  for (const item of media) {
    const entry = byName.get(item.file);
    if (!entry || !item.id) {
      skipped += 1;
      tick(item.file);
      continue;
    }
    const raw = await entry.blob();
    const blob = item.type && raw.type !== item.type ? new Blob([raw], { type: item.type }) : raw;
    await importMediaRecord({ id: item.id, blob, type: item.type, name: item.name, createdAt: item.createdAt });
    tick(item.file);
  }

  const storage = globalThis.localStorage;
  let restored = 0;
  for (const item of histories) {
    const entry = byName.get(item.file);
    if (!entry || !item.key || !HISTORY_KEY_PATTERN.test(item.key) || SKIPPED_KEYS.has(item.key)) {
      tick(item.file);
      continue;
    }
    const imported = await entry.text();
    try {
      storage.setItem(item.key, mergeHistoryText(storage.getItem(item.key), imported));
      restored += 1;
    } catch (error) {
      console.warn('[library] could not restore', item.key, error);
    }
    tick(item.file);
  }

  let keysApplied = false;
  const keysEntry = byName.get('settings/providers.json');
  if (applyKeys && keysEntry && manifest.includesProviderKeys) {
    const current = storage.getItem(PROVIDER_KEYS_KEY);
    let hasKeys = false;
    try {
      hasKeys = Object.values(JSON.parse(current || '{}')?.keys || {}).some(Boolean);
    } catch {
      hasKeys = false;
    }
    if (!hasKeys) {
      storage.setItem(PROVIDER_KEYS_KEY, await keysEntry.text());
      keysApplied = true;
    }
  }

  writeLibraryState({ importedAt: new Date().toISOString(), importedFiles: media.length - skipped });
  return { files: media.length - skipped, skipped, histories: restored, keysApplied };
}

/** Bytes as "1.2 GB". */
export function formatBytes(bytes, locale = 'en') {
  const value = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let amount = value;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : amount < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(amount)} ${units[index]}`;
}
