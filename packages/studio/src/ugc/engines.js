// How a UGC take gets filmed. Two engines:
//  - one take: an image-to-video model that speaks the line itself (native
//    audio) from the first frame. Best up to its longest duration (8-15 s).
//  - talking avatar: the line read by a text-to-speech voice, then the first
//    frame lip-synced to it. Any length.
// Auto picks the first one-take model the visitor's keys run that is long
// enough for the script, else the avatar, else the longest one-take model.

import { audioModels, i2vModels, imageLipSyncModels } from '../models.js';
import { isEndpointAvailable } from '../providers/client.js';
import { maxEditImages, pickEditModel } from '../designAgent/agentModels.js';

// Preferred first: the ones that sound and look most like a real phone video.
const ONE_TAKE_IDS = [
  'kling-v3.0-omni-pro-image-to-video',
  'veo3.1-image-to-video',
  'seedance-v1.5-pro-i2v',
  'seedance-2-mini-image-to-video',
  'kling-v3.0-pro-image-to-video',
  'wan3.0-image-to-video',
  'vidu-q4-image-to-video',
  'ltx-2-pro-image-to-video',
  'kling-v2.6-pro-i2v',
];
const AVATAR_IDS = ['omnihuman-1-5', 'kling-v2-avatar-pro', 'kling-v2-avatar-standard', 'infinitetalk-image-to-video'];
const VOICE_IDS = ['elevenlabs-tts-turbo-2-5', 'minimax-speech-2.6-hd', 'minimax-speech-2.6-turbo'];

// The input each model takes to speak; null means it always has sound.
const AUDIO_KEYS = ['generate_audio', 'sound', 'enable_audio', 'audio'];

// What the bar and menus call each model; the catalog names are long.
const SHORT_NAMES = {
  'kling-v3.0-omni-pro-image-to-video': 'Kling 3.0 Omni',
  'veo3.1-image-to-video': 'Veo 3.1',
  'seedance-v1.5-pro-i2v': 'Seedance 1.5 Pro',
  'seedance-2-mini-image-to-video': 'Seedance 2 Mini',
  'kling-v3.0-pro-image-to-video': 'Kling 3.0 Pro',
  'wan3.0-image-to-video': 'Wan 3.0',
  'vidu-q4-image-to-video': 'Vidu Q4',
  'ltx-2-pro-image-to-video': 'LTX 2 Pro',
  'kling-v2.6-pro-i2v': 'Kling 2.6 Pro',
  'omnihuman-1-5': 'OmniHuman 1.5',
  'kling-v2-avatar-pro': 'Kling Avatar 2 Pro',
  'kling-v2-avatar-standard': 'Kling Avatar 2',
  'infinitetalk-image-to-video': 'Infinite Talk',
  'elevenlabs-tts-turbo-2-5': 'ElevenLabs',
  'minimax-speech-2.6-hd': 'MiniMax Speech',
  'minimax-speech-2.6-turbo': 'MiniMax Speech Turbo',
};

export const engineLabel = (model) => SHORT_NAMES[model?.id] || model?.name || '';

export const AUTO_ENGINE = 'auto';
export const AVATAR_ENGINE = 'avatar';

const byIds = (ids, models) => ids.map((id) => models.find((model) => model.id === id)).filter(Boolean);
const endpointOf = (model) => model?.endpoint || model?.id;
const available = (model) => Boolean(model) && isEndpointAvailable(endpointOf(model));

export const oneTakeModels = () => byIds(ONE_TAKE_IDS, i2vModels).filter(available);
export const avatarModel = () => byIds(AVATAR_IDS, imageLipSyncModels).find(available) || null;
export const voiceModel = () => byIds(VOICE_IDS, audioModels).find(available) || null;
export const frameModel = () => pickEditModel('');
export const frameTakesProduct = (model = frameModel()) => maxEditImages(model) > 1;

export function audioKey(model) {
  return AUDIO_KEYS.find((key) => key in (model?.inputs || {})) || null;
}

/** The durations a model offers, ascending, or null when it decides itself. */
export function durationOptions(model) {
  const input = model?.inputs?.duration;
  if (!input) return null;
  if (Array.isArray(input.enum)) {
    const values = input.enum.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? values : null;
  }
  const min = Number(input.minValue ?? input.minimum ?? input.default ?? 5);
  const max = Number(input.maxValue ?? input.maximum ?? input.default ?? min);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return Array.from({ length: Math.max(1, Math.round(max - min) + 1) }, (_, index) => min + index);
}

export const longestTake = (model) => durationOptions(model)?.at(-1) ?? null;

/** The shortest duration that fits `seconds`, or the longest when none does. */
export function fitDuration(model, seconds) {
  const options = durationOptions(model);
  if (!options) return { duration: undefined, fits: true, longest: null };
  const fit = options.find((value) => value >= seconds);
  return { duration: fit ?? options.at(-1), fits: fit !== undefined, longest: options.at(-1) };
}

/** The aspect to ask for, or undefined when the model follows the first frame. */
export function aspectFor(model, aspect) {
  const options = model?.inputs?.aspect_ratio?.enum;
  return Array.isArray(options) && options.includes(aspect) ? aspect : undefined;
}

// A phone video: 720p where the model offers a choice keeps takes cheaper.
const resolutionFor = (model) => {
  const options = model?.inputs?.resolution?.enum;
  return Array.isArray(options) && options.includes('720p') ? '720p' : undefined;
};

/**
 * What films the takes: { kind: 'take', model, duration, fits } or
 * { kind: 'avatar', model, voice }, or null when nothing can run.
 * `choice` is 'auto', 'avatar' or a one-take model id.
 */
export function resolveEngine(choice = AUTO_ENGINE, seconds = 0) {
  const takes = oneTakeModels();
  const avatar = avatarModel();
  const voice = voiceModel();
  const avatarEngine = avatar && voice ? { kind: 'avatar', model: avatar, voice } : null;
  const take = (model) => ({ kind: 'take', model, ...fitDuration(model, seconds) });

  if (choice === AVATAR_ENGINE) return avatarEngine || (takes[0] ? take(takes[0]) : null);
  const chosen = takes.find((model) => model.id === choice);
  if (chosen) return take(chosen);

  const fitting = takes.find((model) => fitDuration(model, seconds).fits);
  if (fitting) return take(fitting);
  if (avatarEngine) return avatarEngine;
  const longest = [...takes].sort((a, b) => (longestTake(b) ?? 0) - (longestTake(a) ?? 0))[0];
  return longest ? take(longest) : null;
}

/** The generateI2V request for one take. */
export function takeRequest(engine, { frame, prompt, aspect }) {
  const { model, duration } = engine;
  const key = audioKey(model);
  const resolution = resolutionFor(model);
  const ratio = aspectFor(model, aspect);
  return {
    model: model.id,
    image_url: frame,
    prompt,
    ...(duration !== undefined ? { duration } : {}),
    ...(ratio ? { aspect_ratio: ratio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(key ? { [key]: true } : {}),
  };
}

/** What the price chip quotes for one take (the media is left out). */
export function pricePayload(engine, aspect) {
  if (!engine) return null;
  if (engine.kind === 'avatar') return { endpoint: endpointOf(engine.model), payload: {} };
  const { image_url: _frame, prompt: _prompt, model: _model, ...payload } = takeRequest(engine, { frame: '', prompt: '', aspect });
  return { endpoint: endpointOf(engine.model), payload };
}

/** The voices a text-to-speech model offers: [{ id, label }]. */
export function voicesOf(model) {
  const options = model?.inputs?.voice_id?.enum || [];
  return options.map((option) => (typeof option === 'object'
    ? { id: option.value, label: option.label }
    : { id: option, label: String(option).replace(/_/g, ' ') }));
}

export const defaultVoice = (model) => model?.inputs?.voice_id?.default || voicesOf(model)[0]?.id || '';
