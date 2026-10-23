// Keeps generated and uploaded media in this browser (IndexedDB) so history
// keeps working after provider links expire (WaveSpeed deletes files after 7
// days). Studios store short local URLs (/oga-media/<id>); the service worker
// in public/oga-media-sw.js serves them from IndexedDB, and runEndpoint turns
// them back into a provider-readable URL before a request is sent.

export const LOCAL_MEDIA_PREFIX = '/oga-media/';
export const MEDIA_SERVICE_WORKER = '/oga-media-sw.js';

const DB_NAME = 'oga-media';
const STORE = 'files';
// Re-upload a stored file once its provider link is older than this.
const REMOTE_URL_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;
// Files no history entry references are removed after this grace period.
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'));
  dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const getRecord = (id) => withStore('readonly', (store) => store.get(id));
const putRecord = (record) => withStore('readwrite', (store) => store.put(record));

export function isLocalMediaUrl(value) {
  return typeof value === 'string' && value.startsWith(LOCAL_MEDIA_PREFIX);
}

// Local URLs carry a file extension (/oga-media/<id>.mp4) because some
// studio code picks image vs video display from the extension.
function localIdOf(url) {
  return decodeURIComponent(url.slice(LOCAL_MEDIA_PREFIX.length).split(/[?#]/)[0]).replace(/\.[a-z0-9]+$/i, '');
}

const EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/flac': 'flac',
};

function extensionFor(type) {
  const mime = String(type || '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[mime] || mime.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin';
}

// Local URLs only work while the service worker controls the page.
export function isLocalMediaReady() {
  return typeof navigator !== 'undefined'
    && Boolean(navigator.serviceWorker?.controller)
    && typeof indexedDB !== 'undefined';
}

export async function registerMediaServiceWorker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  try {
    await navigator.serviceWorker.register(MEDIA_SERVICE_WORKER, { scope: '/' });
    // Ask the browser not to evict saved results under storage pressure.
    await navigator.storage?.persist?.();
  } catch (error) {
    console.warn('[media] service worker unavailable; results stay on provider links', error);
  }
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function saveBlob(blob, { remoteUrl = null, name = null } = {}) {
  const id = newId();
  await putRecord({
    id,
    blob,
    type: blob.type || 'application/octet-stream',
    name,
    size: blob.size,
    remoteUrl,
    remoteSavedAt: remoteUrl ? Date.now() : null,
    createdAt: Date.now(),
  });
  return `${LOCAL_MEDIA_PREFIX}${id}.${extensionFor(blob.type)}`;
}

// Decoded in place: the page's CSP doesn't allow fetch() on data: URLs.
function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, comma);
  const type = header.split(';')[0] || 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (!header.includes(';base64')) return new Blob([decodeURIComponent(body)], { type });
  const bytes = atob(body);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type });
}

// Provider CDNs that allow cross-origin reads (fal) are fetched directly;
// others (WaveSpeed) go through this app's streaming /api/media route.
async function downloadRemote(url) {
  try {
    const direct = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (direct.ok) return await direct.blob();
  } catch {
    // CORS-blocked: fall through to the proxy
  }
  const proxied = await fetch(`/api/media?url=${encodeURIComponent(url)}`);
  if (!proxied.ok) throw new Error(`Could not save media (${proxied.status})`);
  return proxied.blob();
}

/** Reads any studio media URL (local, blob:, data: or provider link) as a Blob. */
export async function fetchMediaBlob(url) {
  if (String(url).startsWith('data:')) return dataUrlToBlob(url);
  if (/^https?:\/\//i.test(url) && !url.startsWith(globalThis.location?.origin || '\0')) return downloadRemote(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read media (${response.status})`);
  return response.blob();
}

/**
 * Saves finished outputs locally and returns them with local URLs. Any output
 * that can't be saved keeps its original URL, so nothing is lost.
 */
export async function persistOutputs(outputs) {
  if (!isLocalMediaReady()) return outputs;
  return Promise.all(outputs.map(async (output) => {
    if (isLocalMediaUrl(output.url)) return output;
    try {
      const isRemote = /^https?:\/\//i.test(output.url);
      const blob = isRemote ? await downloadRemote(output.url) : dataUrlToBlob(output.url);
      const url = await saveBlob(blob, { remoteUrl: isRemote ? output.url : null });
      return { ...output, url, remoteUrl: isRemote ? output.url : undefined };
    } catch (error) {
      console.warn('[media] keeping provider link for', output.url.slice(0, 80), error.message);
      return output;
    }
  }));
}

/** Keeps a local copy of an uploaded file and returns its local URL. */
export async function storeUpload(file, remoteUrl) {
  if (!isLocalMediaReady()) return remoteUrl;
  try {
    const isRemote = /^https?:\/\//i.test(remoteUrl || '');
    return await saveBlob(file, { remoteUrl: isRemote ? remoteUrl : null, name: file.name || null });
  } catch {
    return remoteUrl;
  }
}

/**
 * Keeps a file made in the browser (e.g. a recorded video) and returns its
 * local URL, or a blob: URL for this session when local storage is unavailable.
 */
export async function saveLocalBlob(blob, { name = null } = {}) {
  if (isLocalMediaReady()) {
    try {
      return await saveBlob(blob, { name });
    } catch (error) {
      console.warn('[media] could not keep a local copy', error.message);
    }
  }
  return URL.createObjectURL(blob);
}

/**
 * Replaces local media URLs in a request payload with URLs a provider can
 * read: the saved provider link while it is fresh, otherwise a new upload.
 * @param {object} payload
 * @param {(file: File) => Promise<string>} upload
 */
export async function resolveLocalMedia(payload, upload) {
  const cache = new Map();

  const resolveUrl = async (url) => {
    if (cache.has(url)) return cache.get(url);
    const pending = (async () => {
      const record = await getRecord(localIdOf(url));
      if (!record) throw new Error('A file in this request is no longer stored in this browser. Upload it again.');
      if (record.remoteUrl && Date.now() - (record.remoteSavedAt || 0) < REMOTE_URL_MAX_AGE_MS) return record.remoteUrl;
      const file = new File([record.blob], record.name || `media-${record.id}.${extensionFor(record.type)}`, { type: record.type });
      const fresh = await upload(file);
      if (/^https?:\/\//i.test(fresh)) await putRecord({ ...record, remoteUrl: fresh, remoteSavedAt: Date.now() });
      return fresh;
    })();
    cache.set(url, pending);
    return pending;
  };

  const walk = async (value) => {
    if (isLocalMediaUrl(value)) return resolveUrl(value);
    if (Array.isArray(value)) return Promise.all(value.map(walk));
    if (value && typeof value === 'object' && !(value instanceof Blob)) {
      const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await walk(item)]));
      return Object.fromEntries(entries);
    }
    return value;
  };

  return walk(payload);
}

/**
 * Deletes stored files that no saved studio state references any more.
 * Studio history lives in localStorage, so referenced ids are found there.
 */
export async function removeUnusedMedia() {
  if (typeof localStorage === 'undefined' || typeof indexedDB === 'undefined') return;
  const referenced = new Set();
  const pattern = new RegExp(`${LOCAL_MEDIA_PREFIX.replace(/\//g, '\\/')}([\\w-]+)`, 'g');
  for (let i = 0; i < localStorage.length; i++) {
    const value = localStorage.getItem(localStorage.key(i)) || '';
    for (const match of value.matchAll(pattern)) referenced.add(match[1]);
  }
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const value = sessionStorage.getItem(sessionStorage.key(i)) || '';
      for (const match of value.matchAll(pattern)) referenced.add(match[1]);
    }
  } catch {
    // sessionStorage unavailable
  }
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  await withStore('readwrite', (store) => {
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const { id, createdAt } = cursor.value;
      if (!referenced.has(id) && createdAt < cutoff) cursor.delete();
      cursor.continue();
    };
  });
}
