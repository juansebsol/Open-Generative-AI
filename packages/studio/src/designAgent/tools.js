// Tool definitions (OpenAI function-calling format) and the system prompt for
// the Design Agent.

import { ASPECT_RATIOS, LAYOUTS } from './board.js';

// Tools that spend provider credits. The agent must get a plan approved
// before running more than one of these in a turn.
export const COSTLY_TOOLS = new Set(['generate_image', 'edit_image', 'upscale', 'remove_background', 'expand_image']);

const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
  },
});

const itemId = (description = 'Board item id, e.g. asset_2 or text_1.') => ({ type: 'string', description });
const aspect = { type: 'string', enum: ASPECT_RATIOS, description: 'Output aspect ratio (width:height).' };

export const DESIGN_TOOLS = [
  fn('plan', 'Show the user a short plan and wait for approval. Required before running more than one paid image operation. The result says whether the user approved or what to change.', {
    title: { type: 'string', description: 'One-line goal.' },
    steps: { type: 'array', items: { type: 'string' }, description: '2-6 short steps, each naming the tool it uses.' },
    paid_steps: {
      type: 'array',
      items: { type: 'string', enum: [...COSTLY_TOOLS] },
      description: 'Every paid call the plan makes, one entry per call in order, e.g. ["generate_image", "generate_image", "upscale"]. The user sees the price of these before approving.',
    },
  }, ['title', 'steps', 'paid_steps']),
  fn('generate_image', 'Generate a new image from a text prompt and put it on the board as a new asset.', {
    prompt: { type: 'string', description: 'Detailed visual prompt: subject, composition, style, lighting, palette.' },
    aspect_ratio: aspect,
    label: { type: 'string', description: 'Short human label, e.g. "poster background".' },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number', description: 'Display width on the board (default 512). With a format frame, leave x, y and width out to cover the frame edge to edge.' },
  }, ['prompt']),
  fn('edit_image', 'Edit an existing image asset with an instruction (image-to-image). Creates a new asset next to it unless replace is true. Extra reference assets can be combined into the result (e.g. put a logo on a product).', {
    asset_id: itemId('Image asset to edit.'),
    instruction: { type: 'string', description: 'What to change. Say what must stay the same.' },
    reference_asset_ids: { type: 'array', items: { type: 'string' }, description: 'Other image assets to use as references.' },
    aspect_ratio: aspect,
    replace: { type: 'boolean', description: 'Replace the asset in place instead of adding a new one.' },
  }, ['asset_id', 'instruction']),
  fn('upscale', 'Upscale an image asset to a higher resolution, replacing it in place.', {
    asset_id: itemId('Image asset to upscale.'),
  }, ['asset_id']),
  fn('remove_background', 'Cut out the subject of an image asset (transparent background when a background remover is available).', {
    asset_id: itemId('Image asset.'),
    replace: { type: 'boolean', description: 'Replace the asset in place instead of adding a new one.' },
  }, ['asset_id']),
  fn('expand_image', 'Outpaint: extend an image beyond its borders, optionally to a new aspect ratio.', {
    asset_id: itemId('Image asset.'),
    aspect_ratio: aspect,
    instruction: { type: 'string', description: 'Optional guidance for the new areas.' },
  }, ['asset_id']),
  fn('place_asset', 'Move, resize, rotate or restack a board item (image or text). Free.', {
    asset_id: itemId(),
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number', description: 'New width; images keep their aspect ratio, text wraps to this width.' },
    rotation: { type: 'number', description: 'Degrees, clockwise.' },
    layer: { type: 'string', enum: ['front', 'back'], description: 'Bring to front or send to back.' },
  }, ['asset_id']),
  fn('add_text', 'Add a text layer to the board, or update one when text_id is given. Free.', {
    text: { type: 'string' },
    text_id: itemId('Existing text layer to update.'),
    x: { type: 'number' },
    y: { type: 'number' },
    font_size: { type: 'number', description: 'Pixels (board units). On a free board, headlines 64-160 and body 24-40; in a format frame, size them to the frame.' },
    color: { type: 'string', description: 'CSS hex colour, e.g. #ffffff.' },
    font_weight: { type: 'string', enum: ['normal', 'bold'] },
    font_family: { type: 'string', enum: ['sans', 'serif', 'mono', 'display'] },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    max_width: { type: 'number', description: 'Wrap width; also used to centre text over an image.' },
  }),
  fn('arrange', 'Lay out several items. row/column/grid line them up; overlay_center centres the other items on the first one (e.g. a headline over a background). Free.', {
    asset_ids: { type: 'array', items: { type: 'string' }, description: 'Items in order. Defaults to every item.' },
    layout: { type: 'string', enum: LAYOUTS },
    gap: { type: 'number' },
    x: { type: 'number' },
    y: { type: 'number' },
    columns: { type: 'number' },
    item_width: { type: 'number', description: 'Resize every item to this width first.' },
  }, ['layout']),
  fn('delete_item', 'Remove an item from the board. Free.', {
    asset_id: itemId(),
  }, ['asset_id']),
  fn('export_board', 'Render the board (or some items) to a PNG and download it. With a format frame, saves the frame at its exact size. Free.', {
    asset_ids: { type: 'array', items: { type: 'string' }, description: 'Items to include. Defaults to the frame, or to every item on a free board.' },
    background: { type: 'string', description: 'CSS hex colour or "transparent". Defaults to the board background.' },
    padding: { type: 'number', description: 'Margin around the content in board units (default 0).' },
    filename: { type: 'string' },
  }),
];

// What the agent is told about the format frame (or its absence).
function frameBrief(frame) {
  if (!frame) return 'There is no format frame: the board is free-form and export crops to the content.';
  const { name, size, width, height, aspect, print } = frame;
  const sharpness = Math.max(width, height) > 2048
    ? `${print ? 'It is printed at 300 dpi. ' : ''}Generated images come out around 1-2K pixels, so include an upscale of the background in the plan to keep it sharp.`
    : '';
  return [
    `The format is ${name} (${size}): a frame at (0, 0) sized ${width}x${height} board pixels, exactly what Export saves. Anything outside the frame is left out.`,
    `Keep the design inside the frame. For a full-bleed background call generate_image without x, y or width: the first one covers the frame using the closest aspect ratio, ${aspect}; once the frame has a background, new ones land beside it so the user can compare.`,
    `Set text in proportion to the frame: a headline around ${Math.round(height / 9)}px, body copy around ${Math.round(height / 40)}px, max_width under ${width}.`,
    sharpness,
  ].filter(Boolean).join(' ');
}

export function systemPrompt({ boardText, imageModel, editModel, capabilities, askFirst, frame = null }) {
  return [
    'You are Design Agent, a design assistant that works on an infinite canvas board with the user: posters, social posts, product mockups, brand assets.',
    'You act by calling tools. Board coordinates are pixels, origin top-left, x to the right, y down. Images are 512 wide by default; their height follows their aspect ratio.',
    frameBrief(frame),
    askFirst
      ? 'Paid image operations are generate_image, edit_image, upscale, remove_background and expand_image. When a request needs more than one of them, call plan first (2-6 short steps, with every paid call listed in paid_steps so the user sees the price) and wait for the result before running them. A single paid operation the user asked for directly can run without a plan. If the plan result asks for changes, call plan again with a revised plan.'
      : 'The user has turned off plan approval: run the steps directly, but still keep paid image operations to what the request needs.',
    'Layout tools (place_asset, add_text, arrange, delete_item, export_board) are free; use them to finish the design.',
    'Write specific image prompts: subject, composition, framing, style, lighting, palette. For posters and social posts, generate artwork without lettering and add the headline and copy with add_text (size it to the artwork, keep it readable, use max_width and align center for centred text), unless the user wants the text drawn into the image.',
    'To combine assets (logo on a product, character in a scene) use edit_image with reference_asset_ids. Prefer new assets over replacing so the user can compare versions.',
    'Refer to items by id (asset_3, text_1). When you are done, reply in one to three short sentences with what changed and one idea for a next step. Reply in the language the user writes in. Never output HTML.',
    `Image model: ${imageModel || 'none available'}. Edit model: ${editModel || 'none available'}. ${capabilities}`,
    '',
    boardText,
  ].join('\n');
}
