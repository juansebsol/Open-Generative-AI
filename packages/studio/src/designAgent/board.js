// Pure helpers for the Design Agent board: ids, geometry, layouts, the board
// summary sent to the chat model, and session (de)serialisation. Kept free of
// React and browser APIs so they can be unit tested.

export const DEFAULT_IMAGE_WIDTH = 512;
export const LINE_HEIGHT = 1.2;
export const ITEM_GAP = 48;

export const TEXT_FONTS = {
  sans: 'Inter, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  display: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
};

export const ASPECT_RATIOS = ['1:1', '4:5', '3:4', '2:3', '9:16', '16:9', '4:3', '3:2', '21:9'];

export const LAYOUTS = ['row', 'column', 'grid', 'overlay_center'];

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

export function createBoard() {
  return { items: [], counters: { asset: 0, text: 0 }, background: '#ffffff' };
}

export function createSession(now = Date.now()) {
  return {
    id: `da_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
    board: createBoard(),
    viewport: { x: 80, y: 80, scale: 0.6 },
  };
}

/** Returns [id, nextBoard] with the counter for `kind` ('asset' | 'text') bumped. */
export function allocateId(board, kind) {
  const counters = { asset: 0, text: 0, ...(board.counters || {}) };
  const existing = new Set(board.items.map((item) => item.id));
  let n = counters[kind] || 0;
  let id;
  do {
    n += 1;
    id = `${kind}_${n}`;
  } while (existing.has(id));
  return [id, { ...board, counters: { ...counters, [kind]: n } }];
}

export function aspectToRatio(aspect) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspect || ''));
  if (!match) return 1;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? h / w : 1;
}

/** Splits text into lines that fit `maxWidth` using `measure(text) => px`. */
export function wrapTextLines(text, maxWidth, measure) {
  const paragraphs = String(text ?? '').split('\n');
  if (!maxWidth || maxWidth <= 0) return paragraphs;
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (measure(candidate) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Rough text box size for layout decisions; export measures exactly.
export function estimateTextSize(item) {
  const fontSize = item.fontSize || 48;
  const charWidth = fontSize * (item.fontFamily === 'mono' ? 0.62 : item.fontFamily === 'display' ? 0.5 : 0.56);
  const measure = (value) => value.length * charWidth;
  const lines = wrapTextLines(item.text, item.maxWidth, measure);
  const widest = Math.max(0, ...lines.map(measure));
  return {
    width: Math.ceil(item.maxWidth || widest),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
}

/** Unrotated box of an item in board units. */
export function itemBox(item) {
  if (item.kind === 'text') {
    const size = estimateTextSize(item);
    return { x: item.x, y: item.y, width: size.width, height: size.height };
  }
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

/** Axis-aligned bounds of a box rotated around its centre by `rotation` degrees. */
export function rotatedBounds(box, rotation = 0) {
  if (!rotation) return { ...box };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = box.width * cos + box.height * sin;
  const height = box.width * sin + box.height * cos;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

export function unionBounds(boxes) {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function contentBounds(items) {
  return unionBounds(items.map((item) => rotatedBounds(itemBox(item), item.rotation)));
}

/** Top-left spot to the right of everything on the board. */
export function findFreeSpot(items) {
  const bounds = contentBounds(items);
  if (!bounds) return { x: 0, y: 0 };
  return { x: Math.round(bounds.x + bounds.width + ITEM_GAP), y: Math.round(bounds.y) };
}

export function topZ(items) {
  return items.reduce((max, item) => Math.max(max, item.z || 0), 0);
}

// Applies a width change, keeping the image's aspect ratio. Text uses width
// as its wrap width.
export function resizeItem(item, width) {
  const nextWidth = clampNumber(width, 8, 20000, item.width);
  if (item.kind === 'text') return { ...item, maxWidth: Math.round(nextWidth) };
  const ratio = item.width > 0 ? item.height / item.width : 1;
  return { ...item, width: Math.round(nextWidth), height: Math.round(nextWidth * ratio) };
}

/**
 * Lays out `items` and returns the updated copies.
 * @param {object[]} items items to arrange, in order
 * @param {'row'|'column'|'grid'|'overlay_center'} layout
 * @param {{ gap?: number, x?: number, y?: number, columns?: number, itemWidth?: number }} options
 */
export function arrangeItems(items, layout, options = {}) {
  if (items.length === 0) return [];
  const gap = clampNumber(options.gap, 0, 2000, ITEM_GAP);
  let list = options.itemWidth ? items.map((item) => resizeItem(item, options.itemWidth)) : items.slice();
  const start = contentBounds(list) || { x: 0, y: 0 };
  const originX = Number.isFinite(Number(options.x)) ? Number(options.x) : start.x;
  const originY = Number.isFinite(Number(options.y)) ? Number(options.y) : start.y;
  const boxes = list.map(itemBox);

  if (layout === 'overlay_center') {
    const base = boxes[0];
    const cx = base.x + base.width / 2;
    const cy = base.y + base.height / 2;
    return list.map((item, index) => {
      if (index === 0) return item;
      const box = boxes[index];
      return { ...item, x: Math.round(cx - box.width / 2), y: Math.round(cy - box.height / 2) };
    });
  }

  if (layout === 'column') {
    let y = originY;
    return list.map((item, index) => {
      const placed = { ...item, x: Math.round(originX), y: Math.round(y), rotation: 0 };
      y += boxes[index].height + gap;
      return placed;
    });
  }

  if (layout === 'grid') {
    const columns = Math.max(1, Math.round(clampNumber(options.columns, 1, 50, Math.ceil(Math.sqrt(list.length)))));
    const cellWidth = Math.max(...boxes.map((box) => box.width));
    const rowHeights = [];
    boxes.forEach((box, index) => {
      const row = Math.floor(index / columns);
      rowHeights[row] = Math.max(rowHeights[row] || 0, box.height);
    });
    list = list.map((item, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const y = originY + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0);
      const x = originX + column * (cellWidth + gap) + (cellWidth - boxes[index].width) / 2;
      return { ...item, x: Math.round(x), y: Math.round(y), rotation: 0 };
    });
    return list;
  }

  // row (default)
  let x = originX;
  return list.map((item, index) => {
    const placed = { ...item, x: Math.round(x), y: Math.round(originY), rotation: 0 };
    x += boxes[index].width + gap;
    return placed;
  });
}

const shorten = (value, max = 140) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Plain-text description of the board for the chat model. */
export function boardSummary(board, selectedId) {
  const items = [...board.items].filter((item) => item.kind !== 'pending').sort((a, b) => (a.z || 0) - (b.z || 0));
  if (items.length === 0) return 'The board is empty.';
  const lines = items.map((item) => {
    const box = itemBox(item);
    const position = `at (${Math.round(item.x)}, ${Math.round(item.y)}) size ${Math.round(box.width)}x${Math.round(box.height)}${item.rotation ? ` rotation ${Math.round(item.rotation)}°` : ''}`;
    if (item.kind === 'text') {
      return `- ${item.id} text "${shorten(item.text, 80)}" ${item.fontSize}px ${item.fontWeight || 'normal'} ${item.fontFamily || 'sans'} ${item.color} align ${item.align || 'left'} ${position}`;
    }
    const origin = item.source === 'upload' ? `uploaded "${shorten(item.label, 60)}"` : `${item.source || 'generated'}${item.parentId ? ` from ${item.parentId}` : ''}: "${shorten(item.label)}"`;
    return `- ${item.id} image ${position} — ${origin}`;
  });
  const bounds = contentBounds(items);
  return [
    'Board items, bottom to top:',
    ...lines,
    bounds ? `Content bounds: x ${Math.round(bounds.x)}..${Math.round(bounds.x + bounds.width)}, y ${Math.round(bounds.y)}..${Math.round(bounds.y + bounds.height)}.` : '',
    selectedId ? `The user has ${selectedId} selected.` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Picks recent chat history for the model: at most `max` messages, starting
 * at a user message so no tool result is orphaned from its call.
 */
export function trimHistory(messages, max = 60) {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length && messages[start].role !== 'user') start += 1;
  return start < messages.length ? messages.slice(start) : messages.slice(-1);
}

function sanitizeItem(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') return null;
  if (item.kind === 'image' && typeof item.url === 'string' && !item.url.startsWith('blob:')) {
    return {
      ...item,
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      width: Number(item.width) || DEFAULT_IMAGE_WIDTH,
      height: Number(item.height) || DEFAULT_IMAGE_WIDTH,
      rotation: Number(item.rotation) || 0,
    };
  }
  if (item.kind === 'text') {
    return { ...item, x: Number(item.x) || 0, y: Number(item.y) || 0, fontSize: Number(item.fontSize) || 48, rotation: Number(item.rotation) || 0 };
  }
  return null;
}

/** Restores stored sessions, dropping in-flight placeholders and bad entries. */
export function sanitizeSessions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((session) => session && typeof session.id === 'string')
    .map((session) => ({
      ...createSession(session.createdAt || Date.now()),
      ...session,
      messages: Array.isArray(session.messages) ? session.messages : [],
      board: {
        ...createBoard(),
        ...(session.board || {}),
        items: (session.board?.items || []).map(sanitizeItem).filter(Boolean),
      },
      viewport: {
        x: Number(session.viewport?.x) || 0,
        y: Number(session.viewport?.y) || 0,
        scale: clampNumber(session.viewport?.scale, 0.05, 8, 0.6),
      },
    }));
}

/**
 * Copy of a session that is safe to persist (no placeholders, capped history).
 * With `dropInlineOver`, images still held as data: URLs longer than that many
 * characters are left out (normally they live in the browser media store).
 */
export function serializeSession(session, { maxMessages = 200, dropInlineOver = 0 } = {}) {
  const keep = (item) => item.kind !== 'pending'
    && !(dropInlineOver && item.kind === 'image' && item.url.startsWith('data:') && item.url.length > dropInlineOver);
  const items = session.board.items.filter(keep);
  const keptUrls = new Set(items.map((item) => item.url));
  return {
    ...session,
    messages: session.messages.slice(-maxMessages).map((message) => {
      let next = message.status === 'running' ? { ...message, status: 'error' } : message;
      if (dropInlineOver && next.url?.startsWith('data:') && !keptUrls.has(next.url)) next = { ...next, url: undefined };
      return next;
    }),
    board: { ...session.board, items },
  };
}
