// Who can be cast, what the studio keeps between visits, and how the agent
// writes a script.
//
// Creators come from two places: everything made in AI Influencer Studio
// (its gallery, kept in this browser) and the saved characters every studio
// shares (characters.js). Casting an AI influencer under a name saves them as
// a character, so @Name works in the other studios too.

import { loadCharacters } from '../characters.js';
import { DEFAULT_ASPECT, DEFAULT_PLACEMENT, DEFAULT_SCENE, DEFAULT_TONE, MAX_TAKES, PLACEMENTS, SCENES, TONES, ASPECTS } from './scenes.js';

const INFLUENCER_KEY = 'oga_ai_influencer_studio';
export const STORAGE_KEY = 'oga_ugc_studio_v1';
const MAX_BATCHES = 40;

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

/** AI Influencer Studio's gallery as creators, newest first. */
export function loadInfluencers(stored = readJson(INFLUENCER_KEY)) {
  const history = Array.isArray(stored?.history) ? stored.history : [];
  return history
    .filter((entry) => typeof entry?.url === 'string' && entry.url)
    .map((entry) => {
      const traits = Array.isArray(entry.traits) ? entry.traits.map(String) : [];
      return {
        id: `influencer:${entry.id || entry.url}`,
        source: 'influencer',
        name: '',
        image: entry.url,
        label: traits.slice(0, 3).join(' · '),
        traits,
      };
    });
}

/** Saved characters and avatars as creators. */
export function loadCharacterCreators(characters = loadCharacters()) {
  return characters.map((character) => ({
    id: `character:${character.id}`,
    source: 'character',
    name: character.name,
    image: character.images[0],
    label: character.description || '',
    traits: [],
  }));
}

// ── Kept between visits ─────────────────────────────────────────────────────

const asString = (value, max = 4000) => (typeof value === 'string' ? value.slice(0, max) : '');
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);
const SCENE_IDS = SCENES.map((scene) => scene.id);
const TONE_IDS = TONES.map((tone) => tone.id);
const FINISHED = new Set(['done', 'error']);

function sanitizeCreator(creator) {
  if (!creator || typeof creator.image !== 'string' || !creator.image) return null;
  return { id: asString(creator.id, 200), source: asString(creator.source, 40), name: asString(creator.name, 80), image: creator.image, label: asString(creator.label, 200) };
}

function sanitizeProduct(product) {
  if (!product || typeof product.image !== 'string' || !product.image) return null;
  return { name: asString(product.name, 120), image: product.image, placement: oneOf(product.placement, PLACEMENTS, DEFAULT_PLACEMENT) };
}

function sanitizeTake(take) {
  if (!take || typeof take.id !== 'string') return null;
  // A take that was still filming when the page closed cannot be picked up again.
  const status = FINISHED.has(take.status) ? take.status : 'error';
  return {
    id: take.id,
    hook: asString(take.hook, 400),
    line: asString(take.line),
    status,
    url: typeof take.url === 'string' ? take.url : '',
    error: status === 'error' ? asString(take.error, 400) || 'interrupted' : '',
    duration: Number.isFinite(take.duration) ? take.duration : null,
  };
}

function sanitizeBatch(batch) {
  if (!batch || typeof batch.id !== 'string' || !Array.isArray(batch.takes)) return null;
  const takes = batch.takes.map(sanitizeTake).filter(Boolean);
  if (!takes.length) return null;
  return {
    id: batch.id,
    createdAt: Number.isFinite(batch.createdAt) ? batch.createdAt : Date.now(),
    creator: sanitizeCreator(batch.creator),
    product: sanitizeProduct(batch.product),
    scene: oneOf(batch.scene, SCENE_IDS, DEFAULT_SCENE),
    tone: oneOf(batch.tone, TONE_IDS, DEFAULT_TONE),
    aspect: oneOf(batch.aspect, ASPECTS, DEFAULT_ASPECT),
    engine: { kind: batch.engine?.kind === 'avatar' ? 'avatar' : 'take', model: asString(batch.engine?.model, 200), name: asString(batch.engine?.name, 200) },
    frame: typeof batch.frame === 'string' ? batch.frame : '',
    takes,
  };
}

export function sanitizeDraft(draft) {
  const takes = Math.round(Number(draft?.takes));
  return {
    creator: sanitizeCreator(draft?.creator),
    product: sanitizeProduct(draft?.product),
    scene: oneOf(draft?.scene, SCENE_IDS, DEFAULT_SCENE),
    tone: oneOf(draft?.tone, TONE_IDS, DEFAULT_TONE),
    aspect: oneOf(draft?.aspect, ASPECTS, DEFAULT_ASPECT),
    takes: Number.isFinite(takes) ? Math.min(MAX_TAKES, Math.max(1, takes)) : 3,
    engine: asString(draft?.engine, 200) || 'auto',
    voice: asString(draft?.voice, 200),
    hooks: Array.isArray(draft?.hooks) ? draft.hooks.map((hook) => asString(hook, 400)).filter(Boolean).slice(0, 8) : [],
    body: asString(draft?.body),
  };
}

export function loadStudio(stored = readJson(STORAGE_KEY)) {
  const batches = Array.isArray(stored?.batches) ? stored.batches.map(sanitizeBatch).filter(Boolean).slice(0, MAX_BATCHES) : [];
  return { batches, draft: sanitizeDraft(stored?.draft) };
}

export function saveStudio({ batches, draft }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ batches: batches.slice(0, MAX_BATCHES), draft }));
  } catch {
    // Over quota: the takes still show for this visit.
  }
}

// ── Write it for me ─────────────────────────────────────────────────────────

export const SCRIPT_ANGLES = ['problem', 'review', 'story'];
export const SCRIPT_LENGTHS = [15, 30, 60];

const ANGLE_BRIEF = {
  problem: 'Open on the problem the viewer has, then show the product as the fix.',
  review: 'An honest first-person review: what they expected, what surprised them.',
  story: 'A short personal story that leads naturally to the product.',
};

/** The chat request that drafts hooks, the middle and a call to action. */
export function scriptRequest({ product, audience, angle = 'problem', seconds = 15, creator = '', scene = DEFAULT_SCENE }) {
  const words = Math.round(seconds * 2.6);
  const system = [
    'You write scripts for UGC (user-generated content) videos: a creator talking to a phone camera about a product, the way real people post on TikTok, Reels and Shorts.',
    'Write like people talk: short sentences, contractions, no marketing buzzwords, no hashtags, no emojis, no stage directions.',
    'Return JSON: {"hooks": [4 strings], "middle": string, "cta": string}.',
    'Each hook is one punchy opening line under 12 words that stops the scroll; make the four clearly different (a POV, a confession, a question, a bold claim).',
    `The middle and the call to action together are about ${words} words, so a hook plus the rest is about ${seconds} seconds spoken.`,
    'The call to action is one short line.',
  ].join(' ');
  const user = [
    `Product: ${product || 'the product in the video'}.`,
    audience ? `Who it is for: ${audience}.` : '',
    `Angle: ${ANGLE_BRIEF[angle] || ANGLE_BRIEF.problem}`,
    creator ? `The creator's name is ${creator}.` : '',
    `Scene: ${SCENES.find((item) => item.id === scene)?.setting || ''}.`,
  ].filter(Boolean).join('\n');
  return { system, user };
}

/** Reads the drafted script: { hooks, body } with the middle and call to action joined. */
export function parseScript(reply) {
  const hooks = Array.isArray(reply?.hooks) ? reply.hooks.map((hook) => String(hook || '').trim()).filter(Boolean).slice(0, MAX_TAKES) : [];
  const body = [reply?.middle, reply?.cta].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  if (!hooks.length && !body) throw new Error('The agent did not return a script.');
  return { hooks, body };
}
