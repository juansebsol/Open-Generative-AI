// What AI Influencer Studio sends the image model. The visitor only picks
// traits (and may add a few words of their own); this turns them into a
// described shot, the way the best results are written: aspirational but
// real, flattering light, real detail, a face people would follow. Old prompt
// tricks like "8k" and "cinematic" are left out: current models answer to a
// described photo, and a candid one also makes a better creator for the
// other studios (UGC casts these as its first frames).

// The rendering style picks the look; without one it is a photo.
const LOOKS = {
  photo: {
    open: 'A photo of an AI influencer, the kind of creator people follow for how they look and feel: aspirational but real.',
    finish: 'A candid, natural moment with a confident, warm expression and eye contact with the camera. Soft, flattering natural light with a gentle glow, warm and clean colour, the background softly out of focus, the face in sharp focus. Real texture and fine detail on the skin and hair, not airbrushed, not a plastic or doll-like face. Shot like a top creator’s social photo, not a studio headshot: no harsh flash, no text or watermark.',
  },
  anime: {
    open: 'An anime-style portrait of an AI influencer character, polished like a key visual.',
    finish: 'Clean line art, expressive eyes and soft cel shading. A confident, warm expression, looking at the viewer. Soft, flattering light and a simple, softly blurred background. No text or watermark.',
  },
  cartoon: {
    open: 'A cartoon portrait of an AI influencer character, polished like an animated film.',
    finish: 'Bold, appealing shapes, clean outlines and rich colour. A confident, warm expression, looking at the viewer. Soft, flattering light and a simple, softly blurred background. No text or watermark.',
  },
  flat: {
    open: 'A flat 2D illustration portrait of an AI influencer character.',
    finish: 'Clean shapes, crisp edges and a limited, harmonious palette. A confident, warm expression, looking at the viewer, on a simple background. No text or watermark.',
  },
};

const STYLE_LOOKS = {
  style_hyper_realistic: 'photo',
  style_anime: 'anime',
  style_cartoon: 'cartoon',
  style_2d: 'flat',
};

const sentence = (text) => {
  const clean = String(text || '').trim();
  if (!clean) return '';
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
};

/**
 * The prompt for one influencer.
 * `traits`: the picks in builder order, [{ sub, opt, value }] where `value`
 * is the option's prompt words. `custom`: the visitor's own words.
 */
export function influencerPrompt({ traits = [], custom = '', aspect = '3:4' } = {}) {
  const style = traits.find((trait) => trait.sub === 'rendering_style');
  const look = LOOKS[STYLE_LOOKS[style?.opt]] || LOOKS.photo;
  const parts = traits
    .filter((trait) => trait.sub !== 'rendering_style')
    .map((trait) => String(trait.value || '').trim())
    .filter(Boolean);
  return [
    look.open,
    parts.length ? `Their look: ${parts.join(', ')}.` : '',
    sentence(custom),
    aspect === '16:9' ? 'Framed from the chest up, a little off-centre with space around them.' : 'Framed from the chest up.',
    look.finish,
  ].filter(Boolean).join(' ');
}
