import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, frameBox, sanitizeSessions, serializeSession } from '../packages/studio/src/designAgent/board.js';
import {
  FORMATS,
  FORMAT_GROUPS,
  closestAspect,
  coverFrame,
  customFrame,
  formatSize,
  frameFor,
  ratioLabel,
} from '../packages/studio/src/designAgent/formats.js';
import { systemPrompt } from '../packages/studio/src/designAgent/tools.js';

test('every format has a known group, a unique id and whole pixel sizes', () => {
  assert.equal(new Set(FORMATS.map((format) => format.id)).size, FORMATS.length);
  for (const format of FORMATS) {
    assert.ok(FORMAT_GROUPS.includes(format.group), format.id);
    assert.ok(Number.isInteger(format.width) && Number.isInteger(format.height), format.id);
  }
});

test('print formats are sized at 300 dpi', () => {
  assert.deepEqual(frameFor('poster'), { format: 'poster', width: 5400, height: 7200 });
  assert.deepEqual(frameFor('business-card'), { format: 'business-card', width: 1050, height: 600 });
  assert.deepEqual(frameFor('flyer'), { format: 'flyer', width: 1748, height: 2480 });
  assert.equal(frameFor('nope'), null);
});

test('custom frames convert units and stay within limits', () => {
  assert.deepEqual(customFrame('1200', '800'), { format: 'custom', width: 1200, height: 800 });
  assert.deepEqual(customFrame(4, 6, 'in'), { format: 'custom', width: 1200, height: 1800 });
  assert.deepEqual(customFrame(100000, 2, 'px'), { format: 'custom', width: 8192, height: 16 });
  assert.equal(customFrame('', 800), null);
  assert.equal(customFrame(-5, 800), null);
});

test('sizes and ratios read the way people know them', () => {
  assert.equal(formatSize(frameFor('poster')), '18 × 24 in');
  assert.equal(formatSize(frameFor('instagram-post')), '1080 × 1350');
  assert.equal(formatSize(null), '');
  assert.equal(ratioLabel(1080, 1350), '4:5');
  assert.equal(ratioLabel(1050, 600), '7:4');
  assert.equal(ratioLabel(1200, 630), '1.90:1');
  assert.equal(ratioLabel(1748, 2480), '1:1.42');
});

test('a background covers the frame with the closest supported ratio', () => {
  assert.equal(closestAspect(1080, 1350), '4:5');
  assert.equal(closestAspect(1050, 600), '16:9');
  assert.equal(closestAspect(5400, 7200), '3:4');
  assert.deepEqual(coverFrame(frameFor('instagram-post'), '4:5'), { x: 0, y: 0, width: 1080 });
  const card = coverFrame(frameFor('business-card'), '16:9');
  assert.ok(card.width >= 1050 && (card.width * 9) / 16 >= 600, 'covers both sides');
  assert.equal(card.x, Math.round((1050 - card.width) / 2));
});

test('a frame is kept when a session is stored and restored, and dropped when broken', () => {
  const session = createSession(1);
  session.board.frame = frameFor('poster');
  const [restored] = sanitizeSessions([serializeSession(session)]);
  assert.deepEqual(restored.board.frame, { format: 'poster', width: 5400, height: 7200 });
  assert.deepEqual(frameBox(restored.board.frame), { x: 0, y: 0, width: 5400, height: 7200 });

  const broken = createSession(2);
  broken.board.frame = { format: 'poster', width: 'wide' };
  assert.equal(sanitizeSessions([broken])[0].board.frame, null);
  assert.equal(sanitizeSessions([{ id: 'old', board: { items: [] } }])[0].board.frame, null);
});

test('the agent hears about the frame, and print frames ask for an upscale', () => {
  const base = { boardText: 'The board is empty.', imageModel: 'A', editModel: 'B', capabilities: '', askFirst: true };
  assert.match(systemPrompt(base), /no format frame/);
  const poster = systemPrompt({ ...base, frame: { name: 'Poster', size: '18 × 24 in', width: 5400, height: 7200, aspect: '3:4', print: true } });
  assert.match(poster, /Poster \(18 × 24 in\)/);
  assert.match(poster, /5400x7200/);
  assert.match(poster, /300 dpi/);
  assert.match(poster, /include an upscale/);
  const post = systemPrompt({ ...base, frame: { name: 'Instagram post', size: '1080 × 1350', width: 1080, height: 1350, aspect: '4:5', print: false } });
  assert.doesNotMatch(post, /include an upscale/);
});
