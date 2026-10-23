// Serves media saved in this browser (IndexedDB "oga-media") at
// /oga-media/<id>, with byte-range support so videos can seek.
// Written by packages/studio/src/providers/mediaStore.js.

const DB_NAME = 'oga-media';
const STORE = 'files';
const PREFIX = '/oga-media/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
  // /oga-media/<id>.<ext>: the extension is only a display hint.
  const id = decodeURIComponent(url.pathname.slice(PREFIX.length)).replace(/\.[a-z0-9]+$/i, '');
  event.respondWith(serve(event.request, id));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRecord(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function serve(request, id) {
  const record = await getRecord(id).catch(() => null);
  if (!record) return new Response('Not found', { status: 404 });

  const { blob } = record;
  const type = record.type || blob.type || 'application/octet-stream';
  const baseHeaders = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && blob.size > 0) {
    let start = range[1] === '' ? null : Number(range[1]);
    let end = range[2] === '' ? null : Number(range[2]);
    if (start === null) {
      start = Math.max(blob.size - (end ?? 0), 0);
      end = blob.size - 1;
    } else {
      end = Math.min(end ?? blob.size - 1, blob.size - 1);
    }
    if (start > end || start >= blob.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
    }
    return new Response(blob.slice(start, end + 1, type), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${blob.size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }

  return new Response(blob, { headers: { ...baseHeaders, 'Content-Length': String(blob.size) } });
}
