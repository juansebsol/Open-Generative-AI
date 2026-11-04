// What a UGC take is made of besides the creator: the scene (where they are
// and how the phone films them), the tone they talk in, where the product
// sits, and the script. A take is filmed in two steps: one first frame of the
// creator in the scene (an image edit of their photo, the product in hand),
// then that frame brought to life with the line spoken. These builders write
// the prompt for each step.

// The visitor only picks a scene and a tone and writes the line; these words
// are what the models actually get. They aim for a top creator's video:
// polished but real, warm light, a tidy room, a face worth stopping for.
//
// `setting` places them, `action` is what they do, `framing` is where the
// phone sits for the first frame, `camera` how it moves once the take rolls.
export const SCENES = [
  {
    id: 'talking',
    icon: 'phone',
    setting: 'a bright, tidy, styled bedroom, warm window light from one side, the background softly out of focus',
    action: 'sits facing the phone',
    framing: 'Front-camera selfie at arm’s length, slightly above eye level, the phone and the arm holding it out of frame',
    camera: 'Front-camera selfie at arm’s length with a slight handheld sway',
  },
  {
    id: 'unboxing',
    icon: 'box',
    setting: 'a bright room at a clean, styled desk by a window, warm daylight, an opened delivery box and tissue paper in front of them',
    action: 'has just lifted the product out of the box',
    framing: 'Phone propped on the desk at chest height, framed from the waist up',
    camera: 'Phone propped on the desk at chest height, then a quick lean in for a closer look',
  },
  {
    id: 'grwm',
    icon: 'brush',
    setting: 'a bright bathroom at the vanity mirror in soft, warm morning light, a few neat toiletries on the counter',
    action: 'is getting ready, turned toward the phone',
    framing: 'Phone propped against the mirror at eye level, chest-up framing',
    camera: 'Phone propped against the mirror, chest-up framing, natural movement',
  },
  {
    id: 'review',
    icon: 'star',
    setting: 'a clean, bright kitchen with a plant and warm morning light, the background softly out of focus',
    action: 'holds the product up to the camera',
    framing: 'Handheld front-camera selfie at arm’s length, the arm holding the phone out of frame',
    camera: 'Handheld selfie, pushing the product toward the lens once',
  },
  {
    id: 'car',
    icon: 'car',
    setting: 'the driver’s seat of a parked car in soft daylight, seatbelt on, the street softly blurred through the windows',
    action: 'sits turned toward the phone',
    framing: 'Phone on a dashboard mount at a slightly low angle, framed from the chest up',
    camera: 'Phone on a dashboard mount at a slightly low angle, steady, with small natural movements in the seat',
  },
  {
    id: 'street',
    icon: 'walk',
    setting: 'the middle of a city sidewalk at golden hour, an interviewer’s small microphone reaching in from the edge of the frame, warm sunlight, people walking past softly blurred behind',
    action: 'has stopped mid-walk for a quick interview',
    framing: 'Handheld by an interviewer just off camera, at eye level, chest-up',
    camera: 'Handheld by an interviewer just off camera, with a quick natural zoom',
  },
  {
    id: 'beforeafter',
    icon: 'switch',
    setting: 'a bright, tidy bathroom in warm natural light',
    action: 'is about to show the difference, pointing at the camera',
    framing: 'Front-camera selfie at arm’s length, the arm holding the phone out of frame',
    camera: 'Selfie angle with one quick push-in for the after',
  },
  {
    id: 'podcast',
    icon: 'mic',
    setting: 'a cozy podcast corner with a microphone on a boom arm, warm lamps and a softly lit shelf behind',
    action: 'leans into the microphone',
    framing: 'Locked-off medium shot from a desk camera at eye level',
    camera: 'Locked-off medium shot from a desk camera',
  },
];

export const DEFAULT_SCENE = 'talking';
export const findScene = (id) => SCENES.find((scene) => scene.id === id) || SCENES[0];

// `voice` is how they sound, `face` their look in the first frame, `energy`
// how they move once the take rolls: the tone sets all three.
export const TONES = [
  {
    id: 'upbeat',
    voice: 'upbeat, excited and friendly, like telling a friend',
    face: 'a big genuine smile and lifted eyebrows, leaning in a little, like telling a friend something exciting',
    energy: 'They are animated from the first word: smiles, raised eyebrows, talking with their hands.',
  },
  {
    id: 'calm',
    voice: 'calm, warm and honest',
    face: 'a soft, warm smile and relaxed eyes, at ease',
    energy: 'They are relaxed and warm: easy smiles, small nods, a gentle hand gesture.',
  },
  {
    id: 'deadpan',
    voice: 'dry, deadpan and matter-of-fact',
    face: 'a straight face and one eyebrow slightly raised, dry and knowing',
    energy: 'They keep a still, straight face with one raised eyebrow and hold eye contact before the punchline.',
  },
  {
    id: 'whisper',
    voice: 'soft and whispered, close to the microphone like ASMR',
    face: 'a small knowing smile, leaning close to the lens as if sharing a secret',
    energy: 'They stay close to the lens and intimate: soft smiles, small head tilts, a glance aside as if sharing a secret.',
  },
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
    : `They hold ${from} up near their face with a relaxed, natural grip, label readable. `;
};

// Where the face sits: in a vertical take the hook is captioned across the
// lower half, so the face stays above it.
const composition = (aspect) => (aspect === '9:16'
  ? 'Their face sits in the upper half of the frame with a little headroom, eyes in sharp focus.'
  : 'Their eyes sit about a third from the top of the frame, in sharp focus.');

/** The first frame: the creator from their photo, in the scene, with the product. */
export function framePrompt({ scene, tone = DEFAULT_TONE, placement = DEFAULT_PLACEMENT, product = null, productShown = true, aspect = DEFAULT_ASPECT }) {
  const where = findScene(scene);
  const mood = findTone(tone);
  const orientation = aspect === '9:16' ? 'Vertical 9:16' : aspect === '16:9' ? 'Horizontal 16:9' : 'Square';
  return [
    `${orientation} frame from a smartphone video by a top-performing UGC creator: polished but real, the kind of video people stop scrolling for.`,
    `${where.framing}.`,
    `The person from the first image ${where.action} in ${where.setting}.`,
    `They look straight into the lens mid-sentence with ${mood.face}.`,
    `${productInFrame(placement, product, productShown)}Keep their face, hair, skin and features exactly as in the first image.`,
    composition(aspect),
    'Real skin texture with a soft, healthy glow, flattering light, warm and clean phone-camera colour. Not a studio photo.',
    'No flat or grey light, no clutter, no phone or arm holding it in the shot, no text or captions.',
  ].join(' ');
}

/** The take: the frame brought to life, the line spoken to camera. */
export function takePrompt({ scene, tone, line, placement = DEFAULT_PLACEMENT, product = null }) {
  const where = findScene(scene);
  const mood = findTone(tone);
  const productMove = product && placement !== 'none'
    ? ` They gesture with the ${product.name || 'product'} as they talk.`
    : '';
  return [
    `${where.camera}. The person talks directly to the camera and says: "${String(line || '').trim()}" Their delivery is ${mood.voice}.`,
    `${mood.energy}${productMove}`,
    'They keep eye contact with the lens, their mouth matches every word, and they stay the same person in the same outfit throughout.',
    'The framing stays as in the first frame, no cuts. Real phone footage, room sound, no music, no on-screen text.',
  ].join(' ');
}
