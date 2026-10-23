// Tools the Agents studio exposes to the chat model (OpenAI function-calling
// format) and the code that runs them through the regular generation layer.
// Models are picked automatically from the routable catalog, preferring ones
// the visitor has a key for; the studio can pin a model per slot.

import {
  generateAudio,
  generateI2I,
  generateI2V,
  generateImage,
  generateVideo,
  removeBackground,
  upscaleImage,
} from './generation.js';
import { audioModels, i2iModels, i2vModels, t2iModels, t2vModels } from './models.js';
import { buildReferenceParams } from './modelCapabilities.js';
import { hasRoute } from './providers/catalog/index.js';
import { isEndpointAvailable } from './providers/client.js';

const endpointOf = (model) => model?.endpoint || model?.id;

const NON_EDIT_I2I = /upscal|background|extension|layer/i;
const TTS_IDS = ['elevenlabs-v4', 'elevenlabs-tts-turbo-2-5', 'minimax-speech-2.6-turbo', 'minimax-speech-2.6-hd'];
const MUSIC_IDS = ['lyria-3', 'lyria-3-pro', 'lyria-2', 'minimax-music-3.0'];
const SFX_IDS = ['mmaudio-v2-text-to-audio'];
const UPSCALE_IDS = ['seedvr2-image-upscale', 'ai-image-upscaler', 'topaz-image-upscale'];

// Preferred defaults per slot, best first. Anything else in the pool is a fallback.
const PREFERRED = {
  image: ['nano-banana-2', 'nano-banana-pro', 'nano-banana-2-1', 'nano-banana', 'gpt-image-2', 'seedream-5.0', 'bytedance-seedream-v4.5', 'flux-kontext-pro-t2i', 'qwen-image', 'flux-schnell'],
  edit: ['nano-banana-2-edit', 'nano-banana-pro-edit', 'nano-banana-2-1-edit', 'nano-banana-edit', 'gpt-image-2-edit', 'seedream-5.0-edit', 'bytedance-seedream-v4.5-edit', 'flux-kontext-pro-i2i', 'qwen-image-2.0-edit'],
  video: ['seedance-2-text-to-video-fast', 'kling-v3.0-standard-text-to-video', 'veo3.1-fast-text-to-video', 'wan2.7-text-to-video', 'minimax-hailuo-2.3-standard-t2v', 'seedance-v1.5-pro-t2v', 'kling-v2.5-turbo-pro-t2v'],
  animate: ['seedance-2-image-to-video-fast', 'kling-v3.0-standard-image-to-video', 'veo3.1-fast-image-to-video', 'wan2.7-image-to-video', 'minimax-hailuo-2.3-standard-i2v', 'kling-v2.5-turbo-pro-i2v', 'seedance-v1.5-pro-i2v'],
  speech: TTS_IDS,
  music: MUSIC_IDS,
  sound: SFX_IDS,
  upscale: UPSCALE_IDS,
};

const isEditModel = (model) => Boolean(model.inputs?.prompt || model.hasPrompt) && !NON_EDIT_I2I.test(model.id);
const pickIds = (list, ids) => ids.map((id) => list.find((model) => model.id === id)).filter(Boolean);

function upscalerEndpoint(model) {
  return model.id === 'ai-image-upscaler' ? 'ai-image-upscale' : endpointOf(model);
}

const POOLS = {
  image: () => t2iModels.filter((model) => model.inputs?.prompt),
  edit: () => i2iModels.filter(isEditModel),
  video: () => t2vModels,
  animate: () => i2vModels.filter((model) => !/omni|reference|first-last|transition/i.test(model.id)),
  speech: () => pickIds(audioModels, TTS_IDS),
  music: () => pickIds(audioModels, MUSIC_IDS),
  sound: () => pickIds(audioModels, SFX_IDS),
  upscale: () => pickIds(i2iModels, UPSCALE_IDS).filter((model) => hasRoute(upscalerEndpoint(model))),
};

export const MODEL_SLOTS = ['image', 'edit', 'video', 'animate', 'speech', 'music', 'upscale'];

/** Whether a model can run with the keys this visitor configured. */
export function isModelRunnable(slot, model) {
  return isEndpointAvailable(slot === 'upscale' ? upscalerEndpoint(model) : endpointOf(model));
}

/** Candidate models for a slot, preferred ones first. */
export function slotModels(slot) {
  const pool = POOLS[slot]?.() || [];
  const preferred = pickIds(pool, PREFERRED[slot] || []);
  return [...preferred, ...pool.filter((model) => !preferred.includes(model))];
}

/** The model a slot will use: the pinned one, else the first runnable preferred one. */
export function pickModel(slot, pinnedId, filter = () => true) {
  const ordered = slotModels(slot).filter(filter);
  if (ordered.length === 0) return null;
  const pinned = pinnedId && ordered.find((model) => model.id === pinnedId);
  if (pinned) return pinned;
  return ordered.find((model) => isModelRunnable(slot, model)) || ordered[0];
}

const hasSlot = (slot) => slotModels(slot).length > 0;

function optionValues(schema) {
  return (schema?.enum || []).map((option) => (option && typeof option === 'object' ? option.value : option));
}

// Keeps a requested value only if the model accepts it; numbers snap to the nearest allowed value.
function fitInput(model, key, value) {
  const schema = model?.inputs?.[key];
  if (!schema || value === undefined || value === null || value === '') return undefined;
  const options = optionValues(schema);
  if (options.length > 0) {
    if (options.includes(value)) return value;
    const numeric = Number(value);
    const numbers = options.map(Number).filter(Number.isFinite);
    if (Number.isFinite(numeric) && numbers.length === options.length) {
      return options[numbers.reduce((best, n, i) => (Math.abs(n - numeric) < Math.abs(numbers[best] - numeric) ? i : best), 0)];
    }
    return undefined;
  }
  const min = schema.minValue ?? schema.minimum;
  const max = schema.maxValue ?? schema.maximum;
  if (min !== undefined && max !== undefined && Number.isFinite(Number(value))) {
    return Math.min(max, Math.max(min, Math.round(Number(value))));
  }
  return undefined;
}

function requiredDefaults(model) {
  const values = {};
  for (const key of model?.required || []) {
    const schema = model.inputs?.[key];
    if (schema?.default !== undefined) values[key] = schema.default;
  }
  return values;
}

function matchVoice(model, hint) {
  const schema = model?.inputs?.voice_id;
  if (!schema?.enum || !hint) return undefined;
  const needle = String(hint).toLowerCase();
  const option = schema.enum.find((entry) => {
    const label = (typeof entry === 'object' ? `${entry.label} ${entry.value}` : String(entry)).toLowerCase().replace(/_/g, ' ');
    return label.includes(needle) || needle.split(/\s+/).some((word) => word.length > 3 && label.includes(word));
  });
  return option && typeof option === 'object' ? option.value : option;
}

function guessType(url, fallback) {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif|bmp)$/.test(clean)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(clean)) return 'audio';
  return fallback;
}

function mediaFrom(result, fallbackType) {
  const items = result?.media?.length ? result.media : (result?.outputs || []).map((url) => ({ url }));
  return items
    .filter((item) => item?.url)
    .map((item) => ({
      url: item.url,
      type: ['image', 'video', 'audio'].includes(item.type) ? item.type : guessType(item.url, fallbackType),
    }));
}

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'];
const asUrlList = (value) => (Array.isArray(value) ? value : value ? [value] : []).filter((url) => typeof url === 'string' && url.trim()).slice(0, 8);

/** OpenAI-style tool definitions for the tools this deployment can route. */
export function buildToolDefinitions() {
  const tools = [];
  const fn = (name, description, properties, required = []) => tools.push({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });

  if (hasSlot('image') || hasSlot('edit')) {
    fn('generate_image',
      'Create a new image from a detailed visual prompt. Pass reference_image_urls to keep a product, character, style or layout consistent with earlier or uploaded images.',
      {
        prompt: { type: 'string', description: 'Detailed visual description: subject, setting, composition, lighting, style, mood.' },
        aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, description: 'Defaults to 1:1.' },
        reference_image_urls: { type: 'array', items: { type: 'string' }, description: 'Optional image URLs from this conversation to use as references.' },
      }, ['prompt']);
  }
  if (hasSlot('edit')) {
    fn('edit_image',
      'Edit an existing image with an instruction (change background, recolor, add or remove objects, restyle). Keeps everything not mentioned.',
      {
        image_url: { type: 'string', description: 'URL of the image to edit (from this conversation).' },
        prompt: { type: 'string', description: 'What to change, stated as an instruction.' },
        extra_image_urls: { type: 'array', items: { type: 'string' }, description: 'Optional extra reference images (e.g. a product or a face to insert).' },
        aspect_ratio: { type: 'string', enum: ASPECT_RATIOS },
      }, ['image_url', 'prompt']);
  }
  if (hasSlot('video') || hasSlot('animate')) {
    fn('generate_video',
      'Create a short video clip. With image_url the image is animated as the first frame; otherwise the video is generated from text.',
      {
        prompt: { type: 'string', description: 'Describe motion, camera movement, action and atmosphere.' },
        image_url: { type: 'string', description: 'Optional starting image URL to animate.' },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] },
        duration: { type: 'number', description: 'Seconds, typically 5-10.' },
      }, ['prompt']);
  }
  if (hasSlot('speech')) {
    fn('text_to_speech',
      'Turn a script into a spoken voiceover.',
      {
        text: { type: 'string', description: 'The exact words to speak.' },
        voice: { type: 'string', description: 'Optional voice hint such as "calm female", "deep male", "energetic".' },
      }, ['text']);
  }
  if (hasSlot('music') || hasSlot('sound')) {
    fn('generate_audio',
      'Create music or a sound effect from a description.',
      {
        prompt: { type: 'string', description: 'Genre, mood, instruments, tempo, or the sound to create.' },
        kind: { type: 'string', enum: ['music', 'sound_effect'], description: 'Defaults to music.' },
        lyrics: { type: 'string', description: 'Optional song lyrics (only for vocal music).' },
      }, ['prompt']);
  }
  if (hasSlot('upscale')) {
    fn('upscale_image', 'Increase the resolution and detail of an image.', {
      image_url: { type: 'string', description: 'URL of the image to upscale.' },
    }, ['image_url']);
  }
  if (hasRoute('ai-background-remover')) {
    fn('remove_background', 'Cut out the subject of an image onto a transparent background.', {
      image_url: { type: 'string', description: 'URL of the image.' },
    }, ['image_url']);
  }
  return tools;
}

/** Name of the model a tool call will use, for progress labels. */
export function describeToolModel(name, args = {}, pins = {}) {
  const model = resolveToolModel(name, args, pins);
  if (model) return model.name;
  if (name === 'remove_background') return 'Background Remover';
  return '';
}

function resolveToolModel(name, args, pins) {
  switch (name) {
    case 'generate_image':
      return asUrlList(args.reference_image_urls).length > 0 && hasSlot('edit')
        ? pickModel('edit', pins.edit)
        : pickModel('image', pins.image) || pickModel('edit', pins.edit);
    case 'edit_image':
      return pickModel('edit', pins.edit);
    case 'generate_video':
      return args.image_url && hasSlot('animate') ? pickModel('animate', pins.animate) : pickModel('video', pins.video);
    case 'text_to_speech':
      return pickModel('speech', pins.speech);
    case 'generate_audio':
      if (args.kind === 'sound_effect' && hasSlot('sound')) return pickModel('sound');
      return pickModel('music', pins.music, (model) => args.lyrics || !model.required?.includes('lyrics')) || pickModel('music', pins.music);
    case 'upscale_image':
      return pickModel('upscale', pins.upscale);
    default:
      return null;
  }
}

/**
 * Runs one tool call. Resolves to { type, media: [{ url, type }], model }.
 * Throws with a readable message on failure.
 */
export async function runAgentTool(name, args = {}, { pins = {}, onRequestId } = {}) {
  const model = resolveToolModel(name, args, pins);
  const label = model?.name || '';
  const done = (result, type) => {
    const media = mediaFrom(result, type);
    if (media.length === 0) throw new Error('The model finished without returning a file.');
    return { type, media, model: label };
  };
  const prompt = String(args.prompt || '').trim();

  switch (name) {
    case 'generate_image': {
      if (!prompt) throw new Error('A prompt is required.');
      if (!model) throw new Error('No image model is available.');
      const refs = asUrlList(args.reference_image_urls);
      const aspect_ratio = args.aspect_ratio || '1:1';
      if (refs.length > 0 && i2iModels.includes(model)) {
        return done(await generateI2I({ model: model.id, prompt, images_list: refs, image_url: refs[0], aspect_ratio, onRequestId }), 'image');
      }
      return done(await generateImage({ model: model.id, prompt, aspect_ratio, onRequestId }), 'image');
    }
    case 'edit_image': {
      if (!args.image_url) throw new Error('image_url is required.');
      if (!prompt) throw new Error('A prompt is required.');
      if (!model) throw new Error('No image editing model is available.');
      const images = [args.image_url, ...asUrlList(args.extra_image_urls)];
      return done(await generateI2I({
        model: model.id,
        prompt,
        images_list: images,
        image_url: images[0],
        ...(args.aspect_ratio ? { aspect_ratio: args.aspect_ratio } : {}),
        onRequestId,
      }), 'image');
    }
    case 'generate_video': {
      if (!prompt) throw new Error('A prompt is required.');
      if (!model) throw new Error('No video model is available.');
      const options = {
        model: model.id,
        prompt,
        aspect_ratio: fitInput(model, 'aspect_ratio', args.aspect_ratio || '16:9'),
        duration: fitInput(model, 'duration', args.duration),
        onRequestId,
      };
      if (i2vModels.includes(model)) {
        return done(await generateI2V({ ...options, ...buildReferenceParams(model, { imageUrls: [args.image_url] }) }), 'video');
      }
      return done(await generateVideo(options), 'video');
    }
    case 'text_to_speech': {
      const text = String(args.text || args.prompt || '').trim();
      if (!text) throw new Error('Text is required.');
      if (!model) throw new Error('No speech model is available.');
      const voice = matchVoice(model, args.voice);
      return done(await generateAudio({ ...requiredDefaults(model), _modelId: model.id, prompt: text, ...(voice ? { voice_id: voice } : {}), onRequestId }), 'audio');
    }
    case 'generate_audio': {
      if (!prompt) throw new Error('A prompt is required.');
      if (!model) throw new Error('No audio model is available.');
      const extra = {};
      if (model.inputs?.lyrics) {
        extra.lyrics = String(args.lyrics || '').trim() || '[Instrumental]';
        if (model.inputs.is_instrumental) extra.is_instrumental = !args.lyrics;
      }
      return done(await generateAudio({ ...requiredDefaults(model), ...extra, _modelId: model.id, prompt, onRequestId }), 'audio');
    }
    case 'upscale_image': {
      if (!args.image_url) throw new Error('image_url is required.');
      if (!model) throw new Error('No upscaler is available.');
      return done(await upscaleImage({ model: model.id, image_url: args.image_url, onRequestId }), 'image');
    }
    case 'remove_background': {
      if (!args.image_url) throw new Error('image_url is required.');
      return done(await removeBackground({ image_url: args.image_url, onRequestId }), 'image');
    }
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}
