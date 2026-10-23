// One-click image effects: each preset is a prompt for an image edit model.
// The "image-effects" catalog entry routes to Nano Banana 2 edit, and
// applyPromptPresets() swaps the chosen effect for its prompt just before a
// request goes out, so it works on every provider, including the direct ones.

export const IMAGE_EFFECTS_ENDPOINT = 'image-effects';

export const IMAGE_EFFECTS = [
  // Figurines and toys
  { id: '3d-figurine', label: '3D Figurine', prompt: 'Turn the subject into a detailed 1/7 scale collectible PVC figurine standing on a round clear acrylic base on a desk, with its retail box printed with the same artwork behind it. Realistic product photo, soft studio lighting.' },
  { id: 'action-figure', label: 'Action Figure', prompt: 'Turn the subject into a boxed action figure inside a blister-pack toy package with a printed cardboard backing, a name banner at the top and small accessories in their own compartments. Realistic toy store product photo.' },
  { id: 'plastic-bubble-figure', label: 'Bubble Figure', prompt: 'Turn the subject into a glossy, chubby vinyl toy with smooth rounded plastic shapes and a shiny finish, displayed under a clear plastic bubble dome. Bright studio product shot.' },
  { id: 'felt-keychain', label: 'Felt Keychain', prompt: 'Turn the subject into a handmade felt keychain charm with visible stitching and fuzzy wool texture, hanging from a metal key ring. Close-up macro product photo on a soft background.' },
  { id: 'felt-polaroid', label: 'Felt 3D Polaroid', prompt: 'Recreate the photo as a 3D needle-felted wool diorama inside a white Polaroid frame, with soft fuzzy fibres and handcrafted details. Cozy close-up photo.' },
  { id: 'furry-doll', label: 'Plush Doll', prompt: 'Turn the subject into a soft, fluffy plush doll with embroidered eyes, fuzzy fabric and cute proportions, sitting on a bed. Warm natural light.' },
  { id: 'angel-figurine', label: 'Angel Figurine', prompt: 'Turn the subject into a delicate porcelain angel figurine with small feathered wings and a soft glaze, displayed on a lace doily. Gentle window light.' },
  { id: 'acrylic-ornament', label: 'Acrylic Ornament', prompt: 'Turn the subject into a clear acrylic hanging ornament with a printed illustration and a thin gold ribbon, glinting in front of a softly blurred Christmas tree.' },
  { id: 'glass-ball', label: 'Snow Globe', prompt: 'Place the subject as a tiny figure inside a glass snow globe with falling snow and a wooden base, sitting on a windowsill. Shallow depth of field.' },
  { id: 'mini-world', label: 'Miniature World', prompt: 'Turn the scene into a tilt-shift miniature diorama: tiny model buildings, toy-like people and trees on a small round base, shot from above with strong background blur.' },

  // Illustration and art styles
  { id: 'cartoon', label: 'Cartoon', prompt: 'Redraw the image as a clean, colourful 2D cartoon with bold outlines and flat cel shading, keeping the subject recognisable.' },
  { id: 'american-comic', label: 'American Comic', prompt: 'Redraw the image as a classic American comic book panel: bold ink lines, halftone dots, dramatic shading and vivid primary colours.' },
  { id: 'anime', label: 'Anime', prompt: 'Redraw the image in a polished anime style with clean line art, soft cel shading, expressive eyes and a painted background.' },
  { id: 'pixel-character', label: '16-bit Game Character', prompt: 'Turn the subject into a 16-bit pixel art video game character sprite with a limited colour palette, standing in a retro side-scrolling game level.' },
  { id: 'lofi-pixel', label: 'Lofi Pixel Art', prompt: 'Redraw the scene as cozy lofi pixel art with muted pastel colours, soft lighting and a calm, nostalgic mood.' },
  { id: 'cyberpunk', label: 'Cyberpunk', prompt: 'Restyle the image as a cyberpunk scene at night: neon signs in pink and cyan, rain-slick streets, holographic ads and futuristic tech details on the subject.' },
  { id: 'van-gogh', label: 'Van Gogh', prompt: 'Repaint the image in the style of Vincent van Gogh, with thick swirling brushstrokes, vivid blues and yellows and an expressive starry sky.' },
  { id: 'mona-lisa', label: 'Renaissance Portrait', prompt: 'Repaint the subject as a Renaissance oil portrait in the manner of the Mona Lisa: soft sfumato shading, muted earthy tones, a hazy landscape background and fine craquelure.' },
  { id: 'american-gothic', label: 'American Gothic', prompt: 'Recreate the image as a parody of the painting American Gothic: the subject in 1930s farm clothing holding a pitchfork in front of a white Gothic-window farmhouse, in Grant Wood\'s oil painting style.' },
  { id: 'surrealist', label: 'Surrealist (Dali)', prompt: 'Repaint the scene as a surrealist oil painting in the style of Salvador Dali, with melting clocks, long shadows and a dreamlike desert landscape.' },

  // Decades
  { id: '1920s', label: '1920s', prompt: 'Restyle the subject as a 1920s photograph: Jazz Age clothing and hairstyle, art deco setting, sepia black-and-white film with grain and soft vignette.' },
  { id: '1950s', label: '1950s', prompt: 'Restyle the subject as a 1950s photograph: period clothing and hairstyle, a retro diner or suburban setting, warm faded Kodachrome colours.' },
  { id: '1970s', label: '1970s', prompt: 'Restyle the subject as a 1970s photograph: flared clothing, feathered hair, warm orange and brown tones, soft film grain.' },
  { id: '1980s', label: '1980s', prompt: 'Restyle the subject as a 1980s photograph: big hair, bold neon clothing, a laser-grid studio backdrop and flash-lit glossy colours.' },

  // Places
  { id: 'eiffel-tower', label: 'Paris', prompt: 'Place the subject in front of the Eiffel Tower in Paris on a sunny day, as a natural travel photo with matching lighting and perspective.' },
  { id: 'pyramids', label: 'Egypt', prompt: 'Place the subject in front of the Great Pyramids of Giza in warm desert light, as a natural travel photo with matching lighting and perspective.' },
  { id: 'great-wall', label: 'Great Wall', prompt: 'Place the subject on the Great Wall of China with misty green mountains behind, as a natural travel photo with matching lighting and perspective.' },
  { id: 'statue-of-liberty', label: 'New York', prompt: 'Place the subject in front of the Statue of Liberty with New York Harbor behind, as a natural travel photo with matching lighting and perspective.' },
  { id: 'taj-mahal', label: 'Taj Mahal', prompt: 'Place the subject in front of the Taj Mahal and its reflecting pool at sunrise, as a natural travel photo with matching lighting and perspective.' },
  { id: 'stadium', label: 'In the Stadium', prompt: 'Place the subject in a packed sports stadium under floodlights, cheering in the stands, as a candid sports photo.' },

  // Photo fixes and edits
  { id: 'professional-headshot', label: 'Professional Headshot', prompt: 'Turn this into a professional corporate headshot: business attire, neutral grey studio backdrop, soft key light, sharp focus on the eyes. Keep the person\'s identity and features unchanged.' },
  { id: 'enhance', label: 'Enhance Photo', prompt: 'Enhance this photo: correct exposure and white balance, recover detail, reduce noise and sharpen gently, keeping everything else exactly the same.' },
  { id: 'older', label: 'Age +30 Years', prompt: 'Show the same person about 30 years older, with natural ageing of skin, hair and features, keeping their identity, pose, clothing and background.' },
  { id: 'younger', label: 'Younger Self', prompt: 'Show the same person as a child of about 8 years old, keeping their recognisable features, pose and the same setting.' },
  { id: 'smile', label: 'Big Smile', prompt: 'Change the person\'s expression to a natural, warm, open smile, keeping everything else unchanged.' },
  { id: 'golden-hour', label: 'Golden Hour', prompt: 'Relight the scene for golden hour: low warm sunlight, long soft shadows and a glowing sky, keeping the composition unchanged.' },
  { id: 'night', label: 'Night Time', prompt: 'Turn the scene into night: dark blue sky, artificial lights and glowing windows, realistic night lighting on the subject.' },
  { id: 'snow', label: 'Snowy Day', prompt: 'Make it a snowy winter day: snow on the ground and surfaces, gently falling snowflakes and cool overcast light, keeping the composition.' },
  { id: 'rain', label: 'Rainy Day', prompt: 'Make it a rainy day: wet reflective surfaces, falling rain, puddles and moody grey light, keeping the composition.' },
];

const EFFECTS_BY_ID = new Map(IMAGE_EFFECTS.map((effect) => [effect.id, effect]));

/** Expands preset fields into a prompt for the endpoints that use them. */
export function applyPromptPresets(endpoint, payload) {
  if (endpoint !== IMAGE_EFFECTS_ENDPOINT || !payload) return payload;
  const { effect, prompt, ...rest } = payload;
  const preset = EFFECTS_BY_ID.get(effect) || IMAGE_EFFECTS[0];
  const extra = String(prompt || '').trim();
  return { ...rest, prompt: extra ? `${preset.prompt}\nAdditional direction: ${extra}` : preset.prompt };
}
