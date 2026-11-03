// What a UGC take is made of besides the creator: the scene (where they are
// and how the phone films them), the tone they talk in, where the product
// sits, and the script. A take is filmed in two steps: one first frame of the
// creator in the scene (an image edit of their photo, the product in hand),
// then that frame brought to life with the line spoken. These builders write
// the prompt for each step.

// `setting` places them, `action` is what they do, `camera` how it's filmed.
export const SCENES = [
  {
    id: 'talking',
    icon: 'phone',
    setting: 'a bright, lived-in bedroom with soft daylight from a window',
    action: 'sits facing the phone held at arm’s length',
    camera: 'Front-camera selfie at arm’s length with a slight handheld sway',
  },
  {
    id: 'unboxing',
    icon: 'box',
    setting: 'a desk by a window with an opened delivery box and tissue paper',
    action: 'has just lifted the product out of the box',
    camera: 'Phone propped on the desk at chest height, then a quick lean in for a closer look',
  },
  {
    id: 'grwm',
    icon: 'brush',
    setting: 'a bathroom vanity mirror in soft morning light, a few toiletries around',
    action: 'is getting ready at the mirror',
    camera: 'Phone propped against the mirror, chest-up framing, natural movement',
  },
  {
    id: 'review',
    icon: 'star',
    setting: 'a clean kitchen counter with a plant and morning light',
    action: 'holds the product up to the camera',
    camera: 'Handheld selfie, pushing the product toward the lens once',
  },
  {
    id: 'car',
    icon: 'car',
    setting: 'the driver’s seat of a parked car in daylight, seatbelt on',
    action: 'sits in the driver’s seat',
    camera: 'Phone on a dashboard mount at a slightly low angle',
  },
  {
    id: 'street',
    icon: 'walk',
    setting: 'a busy city sidewalk at golden hour with people walking past behind',
    action: 'has stopped mid-walk and holds a small clip-on microphone',
    camera: 'Handheld by an interviewer just off camera, with a quick natural zoom',
  },
  {
    id: 'beforeafter',
    icon: 'switch',
    setting: 'a bathroom with natural light',
    action: 'points at the camera, then gestures to the product',
    camera: 'Selfie angle with one quick push-in for the after',
  },
  {
    id: 'podcast',
    icon: 'mic',
    setting: 'a cozy podcast corner with a microphone on a boom arm and warm lamps',
    action: 'leans into the microphone',
    camera: 'Locked-off medium shot from a desk camera',
  },
];

export const DEFAULT_SCENE = 'talking';
export const findScene = (id) => SCENES.find((scene) => scene.id === id) || SCENES[0];

export const TONES = [
  { id: 'upbeat', voice: 'upbeat, excited and friendly, like telling a friend' },
  { id: 'calm', voice: 'calm, warm and honest' },
  { id: 'deadpan', voice: 'dry, deadpan and matter-of-fact' },
  { id: 'whisper', voice: 'soft and whispered, close to the microphone like ASMR' },
];
export const DEFAULT_TONE = 'upbeat';
export const findTone = (id) => TONES.find((tone) => tone.id === id) || TONES[0];

// Where the product is in the shot.
export const PLACEMENTS = ['hand', 'table', 'none'];
export const DEFAULT_PLACEMENT = 'hand';

export const ASPECTS = ['9:16', '1:1', '16:9'];
export const DEFAULT_ASPECT = '9:16';
export const MAX_TAKES = 4;

// ── The script ──────────────────────────────────────────────────────────────

// Talking speed for an ad read, plus a breath at either end.
export const WORDS_PER_SECOND = 2.6;

export const wordCount = (text) => (String(text || '').match(/[\p{L}\p{N}'’]+/gu) || []).length;

/** Seconds it takes to say `text`, rounded up; 0 for nothing to say. */
export function spokenSeconds(text) {
  const words = wordCount(text);
  return words === 0 ? 0 : Math.ceil(words / WORDS_PER_SECOND + 1);
}

/**
 * The line each take speaks: take i opens on hook i (cycling when there are
 * more takes than hooks), then the rest of the script. Without hooks every
 * take says the script as written.
 */
export function takeLines(hooks, body, takes) {
  const cleanHooks = (hooks || []).map((hook) => String(hook || '').trim()).filter(Boolean);
  const rest = String(body || '').trim();
  return Array.from({ length: Math.max(1, takes) }, (_, index) => {
    const hook = cleanHooks.length ? cleanHooks[index % cleanHooks.length] : '';
    return { hook, line: [hook, rest].filter(Boolean).join(' ') };
  });
}

// ── Prompts ─────────────────────────────────────────────────────────────────

// `shown`: the product's photo goes along as the second image; otherwise it
// is described by name (a scene model that takes one image).
const productInFrame = (placement, product, shown) => {
  if (!product || placement === 'none') return '';
  const name = product.name ? `the ${product.name}` : 'the product';
  const from = shown ? `${name} from the second image` : name;
  return placement === 'table'
    ? `${from.charAt(0).toUpperCase()}${from.slice(1)} sits in front of them, label facing the camera. `
    : `They hold ${from} up near their face, label readable. `;
};

/** The first frame: the creator from their photo, in the scene, with the product. */
export function framePrompt({ scene, placement = DEFAULT_PLACEMENT, product = null, productShown = true, aspect = DEFAULT_ASPECT }) {
  const where = findScene(scene);
  const orientation = aspect === '9:16' ? 'Vertical 9:16' : aspect === '16:9' ? 'Horizontal 16:9' : 'Square';
  return `${orientation} still from a smartphone video. The person from the first image ${where.action} in ${where.setting}, looking straight into the camera mid-sentence with a natural expression. ${productInFrame(placement, product, productShown)}Keep their face, hair, skin and features exactly as in the first image. Real skin texture, natural light, casual and authentic, shot on a phone, not a studio photo. No text or captions.`;
}

/** The take: the frame brought to life, the line spoken to camera. */
export function takePrompt({ scene, tone, line, placement = DEFAULT_PLACEMENT, product = null }) {
  const where = findScene(scene);
  const voice = findTone(tone).voice;
  const productMove = product && placement !== 'none'
    ? ` They gesture with the ${product.name || 'product'} as they talk.`
    : '';
  return `${where.camera}. The person talks directly to the camera and says: "${String(line || '').trim()}" Their delivery is ${voice}.${productMove} Natural lip sync and small natural head movements, handheld phone footage, room sound, no music, no on-screen text.`;
}
