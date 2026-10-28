import test from 'node:test';
import assert from 'node:assert/strict';
import { zipBlob, zipParts, readZip } from '../packages/studio/src/library/zipStream.js';
import { listZip, crc32 } from '../packages/studio/src/vector/zip.js';
import { mergeHistory, mergeHistoryText, collectHistory, formatBytes } from '../packages/studio/src/library/libraryFile.js';

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

test('zipStream writes a stored zip the plain reader lists in order', async () => {
  const blob = await zipBlob([
    { name: 'manifest.json', data: '{"format":"openstudio-library"}' },
    { name: 'media/a.png', data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }) },
    { name: 'empty.txt', data: '' },
  ]);
  assert.equal(blob.type, 'application/zip');
  assert.deepEqual(listZip(await bytesOf(blob)), ['manifest.json', 'media/a.png', 'empty.txt']);
});

test('readZip reads entries back as slices, with the right CRC and size', async () => {
  const image = new Uint8Array(3000).map((_, i) => (i * 7) % 251);
  const blob = await zipBlob([
    { name: 'manifest.json', data: '{"ok":true}' },
    { name: 'media/x.bin', data: new Blob([image]) },
  ]);
  const entries = await readZip(blob);
  assert.deepEqual(entries.map((entry) => entry.name), ['manifest.json', 'media/x.bin']);
  assert.equal(entries[0].method, 0);
  assert.equal(await entries[0].text(), '{"ok":true}');
  assert.equal(entries[1].size, 3000);
  assert.equal(entries[1].crc, crc32(image));
  assert.deepEqual(await bytesOf(await entries[1].blob()), image);
});

test('zipParts emits the entry blobs themselves, not copies', async () => {
  const media = new Blob([new Uint8Array(10)]);
  const parts = [];
  for await (const part of zipParts([{ name: 'm', data: media }])) parts.push(part);
  assert.ok(parts.includes(media), 'the stored blob is passed through by reference');
});

test('readZip opens a deflated entry when the file was re-zipped by another tool', async () => {
  // A zip with one deflate-raw entry, built by hand around CompressionStream.
  const text = 'hello hello hello hello hello';
  const raw = new TextEncoder().encode(text);
  const deflated = await bytesOf(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).blob());
  const name = new TextEncoder().encode('a.txt');
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 8, true);
  local.setUint32(14, crc32(raw), true); local.setUint32(18, deflated.length, true); local.setUint32(22, raw.length, true);
  local.setUint16(26, name.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true); central.setUint16(10, 8, true);
  central.setUint32(16, crc32(raw), true); central.setUint32(20, deflated.length, true); central.setUint32(24, raw.length, true);
  central.setUint16(28, name.length, true); central.setUint32(42, 0, true);
  const centralStart = 30 + name.length + deflated.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + name.length, true); end.setUint32(16, centralStart, true);
  const file = new Blob([local, name, deflated, central, name, end]);
  const [entry] = await readZip(file);
  assert.equal(entry.method, 8);
  assert.equal(await entry.text(), text);
});

test('zipStream switches to ZIP64 past 65,534 entries and reads them back', async () => {
  const many = Array.from({ length: 65_540 }, (_, i) => ({ name: `e${i}`, data: '' }));
  const blob = await zipBlob(many);
  const entries = await readZip(blob);
  assert.equal(entries.length, 65_540);
  assert.equal(entries[65_539].name, 'e65539');
});

test('mergeHistory unions record arrays by id, keeps what is here, newest first', () => {
  const existing = { localHistory: [{ id: 'a', timestamp: '2026-10-28T10:00:00Z' }], prompt: 'mine', batchSize: 2 };
  const imported = { localHistory: [{ id: 'a', timestamp: '2026-10-28T10:00:00Z', prompt: 'changed' }, { id: 'b', timestamp: '2026-10-28T12:00:00Z' }], prompt: 'theirs', extra: true };
  const merged = mergeHistory(existing, imported);
  assert.deepEqual(merged.localHistory.map((item) => item.id), ['b', 'a']);
  assert.equal(merged.localHistory[1].prompt, undefined, 'the existing record wins');
  assert.equal(merged.prompt, 'mine');
  assert.equal(merged.batchSize, 2);
  assert.equal(merged.extra, true, 'missing fields are filled in');
});

test('mergeHistory falls back to url identity and whole-value equality', () => {
  const merged = mergeHistory([{ url: '/oga-media/1.png' }, 'x'], [{ url: '/oga-media/1.png' }, { url: '/oga-media/2.png' }, 'x', 'y']);
  assert.deepEqual(merged, [{ url: '/oga-media/1.png' }, 'x', { url: '/oga-media/2.png' }, 'y']);
});

test('mergeHistoryText keeps a side that is not JSON and takes the import when nothing is here', () => {
  assert.equal(mergeHistoryText(undefined, '{"a":1}'), '{"a":1}');
  assert.equal(mergeHistoryText('plain', '{"a":1}'), 'plain');
  assert.equal(mergeHistoryText('{"entries":[{"id":1}]}', '{"entries":[{"id":2}]}'), '{"entries":[{"id":1},{"id":2}]}');
});

test('collectHistory takes the studio keys and leaves provider keys out', () => {
  const store = new Map([
    ['hg_image_studio_persistent', '{"localHistory":[]}'],
    ['oga_vector_library_v1', '{"entries":[]}'],
    ['oga_providers_v1', '{"keys":{"fal":"secret"}}'],
    ['oga_library_v1', '{"exportedAt":"x"}'],
    ['unrelated', 'no'],
  ]);
  const storage = { get length() { return store.size; }, key: (i) => [...store.keys()][i], getItem: (key) => store.get(key) ?? null };
  assert.deepEqual(collectHistory(storage).map((entry) => entry.key), ['hg_image_studio_persistent', 'oga_vector_library_v1']);
});

test('formatBytes reads like a file manager', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1.2 * 1024 ** 3), '1.2 GB');
  assert.equal(formatBytes(240 * 1024 ** 2), '240 MB');
});
