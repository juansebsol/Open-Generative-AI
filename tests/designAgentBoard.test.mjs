import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateId,
  arrangeItems,
  boardSummary,
  createBoard,
  findFreeSpot,
  resizeItem,
  rotatedBounds,
  sanitizeSessions,
  serializeSession,
  trimHistory,
  wrapTextLines,
} from '../packages/studio/src/designAgent/board.js';
import { DESIGN_TOOLS } from '../packages/studio/src/designAgent/tools.js';

const image = (id, x, y, width = 100, height = 100) => ({ id, kind: 'image', url: `/oga-media/${id}.png`, x, y, width, height, rotation: 0 });

test('allocates sequential ids per kind and skips taken ones', () => {
  let board = createBoard();
  const [first, next] = allocateId(board, 'asset');
  assert.equal(first, 'asset_1');
  board = { ...next, items: [image('asset_1', 0, 0), image('asset_2', 0, 0)] };
  const [second] = allocateId(board, 'asset');
  assert.equal(second, 'asset_3');
  assert.equal(allocateId(board, 'text')[0], 'text_1');
});

test('free spot sits to the right of existing content', () => {
  assert.deepEqual(findFreeSpot([]), { x: 0, y: 0 });
  assert.deepEqual(findFreeSpot([image('a', 10, 20, 200, 100)]), { x: 258, y: 20 });
});

test('arranges items in a row, grid and centred overlay', () => {
  const items = [image('a', 0, 0, 100, 50), image('b', 500, 500, 200, 100)];
  const row = arrangeItems(items, 'row', { gap: 10, x: 0, y: 0 });
  assert.deepEqual(row.map(({ x, y }) => [x, y]), [[0, 0], [110, 0]]);

  const grid = arrangeItems([...items, image('c', 0, 0, 100, 100)], 'grid', { gap: 10, x: 0, y: 0, columns: 2 });
  assert.deepEqual(grid.map(({ x, y }) => [x, y]), [[50, 0], [210, 0], [50, 110]]);

  const overlay = arrangeItems([image('bg', 0, 0, 400, 400), { id: 't', kind: 'text', text: 'Hi', x: 0, y: 0, fontSize: 40, maxWidth: 200 }], 'overlay_center');
  assert.equal(overlay[1].x, 100);
  assert.equal(overlay[1].y, 176);
});

test('resizing an image keeps its aspect ratio; text gets a wrap width', () => {
  assert.deepEqual(resizeItem(image('a', 0, 0, 100, 50), 300), { ...image('a', 0, 0, 300, 150) });
  assert.equal(resizeItem({ id: 't', kind: 'text', text: 'x', fontSize: 20 }, 240).maxWidth, 240);
});

test('rotated bounds grow for a 90 degree turn', () => {
  const bounds = rotatedBounds({ x: 0, y: 0, width: 200, height: 100 }, 90);
  assert.equal(Math.round(bounds.width), 100);
  assert.equal(Math.round(bounds.height), 200);
  assert.equal(Math.round(bounds.x), 50);
});

test('wraps text by measured width', () => {
  const lines = wrapTextLines('one two three four', 9, (value) => value.length);
  assert.deepEqual(lines, ['one two', 'three', 'four']);
  assert.deepEqual(wrapTextLines('a\nb', 0, () => 0), ['a', 'b']);
});

test('board summary lists items and the selection', () => {
  const board = { ...createBoard(), items: [image('asset_1', 0, 0), { id: 'text_1', kind: 'text', text: 'SALE', x: 5, y: 5, fontSize: 40, color: '#fff', z: 2 }] };
  const summary = boardSummary(board, 'asset_1');
  assert.match(summary, /asset_1 image at \(0, 0\) size 100x100/);
  assert.match(summary, /text_1 text "SALE" 40px/);
  assert.match(summary, /selected/);
  assert.equal(boardSummary(createBoard()), 'The board is empty.');
});

test('history trimming starts at a user message', () => {
  const messages = [
    { role: 'user' }, { role: 'assistant' }, { role: 'tool' },
    { role: 'user' }, { role: 'assistant' }, { role: 'tool' }, { role: 'assistant' },
  ];
  assert.equal(trimHistory(messages, 5)[0], messages[3]);
  assert.equal(trimHistory(messages, 50).length, messages.length);
});

test('sessions drop placeholders and blob URLs when stored and restored', () => {
  const session = {
    id: 's1',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: 'm', role: 'tool', status: 'running' }],
    board: { ...createBoard(), items: [image('asset_1', 0, 0), { id: 'pending_x', kind: 'pending', x: 0, y: 0, width: 10, height: 10 }, { ...image('asset_2', 0, 0), url: 'blob:abc' }] },
    viewport: { x: 0, y: 0, scale: 99 },
  };
  const stored = serializeSession(session);
  assert.equal(stored.board.items.length, 2);
  assert.equal(stored.messages[0].status, 'error');
  const [restored] = sanitizeSessions(JSON.parse(JSON.stringify([stored])));
  assert.deepEqual(restored.board.items.map((item) => item.id), ['asset_1']);
  assert.equal(restored.viewport.scale, 8);
  assert.deepEqual(sanitizeSessions('nope'), []);

  const inline = { ...session, board: { ...session.board, items: [{ ...image('asset_3', 0, 0), url: `data:image/png;base64,${'A'.repeat(50)}` }] } };
  assert.equal(serializeSession(inline).board.items.length, 1);
  assert.equal(serializeSession(inline, { dropInlineOver: 20 }).board.items.length, 0);
});

test('tool schemas are valid function definitions', () => {
  const names = DESIGN_TOOLS.map((tool) => tool.function.name);
  for (const name of ['plan', 'generate_image', 'edit_image', 'upscale', 'remove_background', 'expand_image', 'place_asset', 'add_text', 'arrange', 'export_board']) {
    assert.ok(names.includes(name), name);
  }
  for (const tool of DESIGN_TOOLS) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.parameters.type, 'object');
    for (const field of tool.function.parameters.required || []) {
      assert.ok(tool.function.parameters.properties[field], `${tool.function.name}.${field}`);
    }
  }
});
