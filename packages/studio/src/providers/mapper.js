// Translates a studio payload into the input a provider endpoint accepts.
//
// Studio payload builders (generation.js) still speak one shared vocabulary:
// `image_url`, `images_list`, `last_image`, `video_url`, `audio_url`,
// `aspect_ratio` ("16:9"), `resolution` ("720p"), integer `duration`, etc.
// Every route in catalog/routes/*.json points at a provider endpoint whose
// input schema we snapshot in catalog/schemas/*.json. Mapping is:
//
//   1. drop empty values and our own bookkeeping fields
//   2. explicit `rename` from the route, else exact schema match, else the
//      first alias from FIELD_ALIASES that the schema actually has
//   3. merge collisions (image_url + images_list -> one image_urls array)
//   4. `values` remaps from the route, then coerce to the schema's type,
//      enum and min/max
//   5. `fixed` values from the route always win; `defaults` fill gaps
//   6. unknown keys are removed and required keys are checked
//
// Pure functions only: this runs on the server (app/api/generate) and in
// scripts/validate-routes.mjs.

export class MappingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MappingError';
    this.details = details;
  }
}

// Our field -> provider field candidates, in preference order.
// `as: 'array'` wraps a single value; `as: 'single'` takes the first item.
export const FIELD_ALIASES = {
  image_url: ['image_url', 'image', 'image_urls', 'images', 'input_image', 'input_image_url', 'start_image_url', 'first_frame_image', 'first_frame_url', 'start_image', 'reference_image_url', 'reference_image_urls', 'init_image', 'face_image_url', 'source_image_url'],
  images_list: ['image_urls', 'images', 'reference_image_urls', 'reference_images', 'input_image_urls', 'input_images', 'image_url', 'image', 'start_image_url', 'first_frame_image'],
  last_image: ['end_image_url', 'last_image', 'last_image_url', 'tail_image_url', 'end_image', 'last_frame_image', 'last_frame_url', 'end_frame_url'],
  end_image_url: ['end_image_url', 'last_image', 'last_image_url', 'tail_image_url', 'end_image', 'last_frame_image', 'last_frame_url', 'end_frame_url'],
  video_url: ['video_url', 'video', 'input_video', 'video_urls', 'videos', 'reference_video_url', 'source_video_url'],
  videos_list: ['video_urls', 'reference_video_urls', 'videos', 'reference_videos', 'video_url', 'video'],
  video_files: ['video_urls', 'reference_video_urls', 'videos', 'reference_videos', 'video_url', 'video'],
  audio_url: ['audio_url', 'audio', 'input_audio', 'audio_urls', 'audios', 'driving_audio_url', 'speech_url'],
  audios_list: ['audio_urls', 'reference_audio_urls', 'audios', 'reference_audios', 'audio_url', 'audio'],
  audio_files: ['audio_urls', 'reference_audio_urls', 'audios', 'reference_audios', 'audio_url', 'audio'],
  mask_image_url: ['mask_url', 'mask_image_url', 'mask', 'mask_image'],
  aspect_ratio: ['aspect_ratio', 'image_size', 'size', 'ratio'],
  duration: ['duration', 'seconds', 'video_length', 'num_seconds', 'length'],
  negative_prompt: ['negative_prompt'],
  num_images: ['num_images', 'n', 'max_images', 'batch_size'],
  generate_audio: ['generate_audio', 'enable_audio', 'with_audio', 'sound', 'audio_enabled'],
  resolution: ['resolution', 'output_resolution'],
  text: ['text', 'prompt', 'input'],
  lyrics: ['lyrics', 'lyrics_prompt'],
  voice_id: ['voice_id', 'voice'],
};

// Our own bookkeeping that must never reach a provider. (`model` and `name`
// are real inputs for some models, e.g. a Topaz model choice; unknown keys
// are dropped against the schema anyway.)
const INTERNAL_FIELDS = new Set(['onRequestId', '_modelId']);

const FAL_IMAGE_SIZES = {
  '1:1': 'square_hd',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
};

const isEmpty = (value) => (
  value === undefined
  || value === null
  || value === ''
  || (Array.isArray(value) && value.length === 0)
);

const DEFAULT_IMAGE_AREA = 1024 * 1024;

// Width/height for a ratio, rounded *up* to multiples of 16 so the area never
// falls below the target (several models reject anything under 1 MP).
function dimensionsForRatio(ratio, area = DEFAULT_IMAGE_AREA) {
  const height = Math.ceil(Math.sqrt(area / ratio) / 16) * 16;
  const width = Math.ceil((height * ratio) / 16) * 16;
  return { width, height };
}

function ratioOf(value) {
  const match = /^(\d+(?:\.\d+)?)\s*[:x*]\s*(\d+(?:\.\d+)?)$/i.exec(String(value).trim());
  if (!match) return null;
  return Number(match[1]) / Number(match[2]);
}

// "16:9" -> closest "1344*768" / "1344x768" style enum value, or a computed
// size of at least `area` pixels when the schema only says "string".
function sizeFromAspectRatio(aspectRatio, prop, area) {
  const target = ratioOf(aspectRatio);
  if (!target) return undefined;
  const options = prop?.enum?.filter((option) => ratioOf(option));
  if (options?.length) {
    return options.reduce((best, option) => (
      Math.abs(ratioOf(option) - target) < Math.abs(ratioOf(best) - target) ? option : best
    ));
  }
  const separator = String(prop?.default || '').includes('x') ? 'x' : '*';
  const { width, height } = dimensionsForRatio(target, area);
  return `${width}${separator}${height}`;
}

function convertAspectRatio(value, targetKey, prop, area) {
  if (targetKey === 'aspect_ratio' || targetKey === 'ratio') return value;
  if (targetKey === 'image_size') {
    const named = FAL_IMAGE_SIZES[value];
    if (prop?.enum?.includes(named) || (named && !prop?.enum)) return named;
    if (prop?.type === 'object' || prop?.anyOfObject) {
      const ratio = ratioOf(value);
      return ratio ? dimensionsForRatio(ratio, area) : undefined;
    }
    return named;
  }
  if (targetKey === 'size') return sizeFromAspectRatio(value, prop, area);
  return value;
}

function closestNumber(options, value) {
  return options.reduce((best, option) => (
    Math.abs(parseFloat(option) - value) < Math.abs(parseFloat(best) - value) ? option : best
  ));
}

// Coerce a value to the snapshot property type. Returns `undefined` when the
// value cannot be represented, which makes the caller drop the field and lets
// the provider default apply.
export function coerceValue(value, prop) {
  if (!prop) return value;
  let next = value;
  const type = prop.type;
  if (prop.anyOfObject && next && typeof next === 'object' && !Array.isArray(next)) return next;

  if (type === 'array') {
    next = Array.isArray(next) ? next : [next];
    if (prop.items === 'string') next = next.map((item) => (typeof item === 'object' && item?.url ? item.url : String(item)));
    if (prop.maxItems) next = next.slice(0, prop.maxItems);
    return next;
  }
  if (Array.isArray(next)) next = next[0];
  if (next === undefined) return undefined;

  if (type === 'string') {
    if (typeof next === 'object') return undefined;
    next = String(next);
  } else if (type === 'integer' || type === 'number') {
    const parsed = typeof next === 'number' ? next : Number(String(next).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(parsed)) return undefined;
    next = type === 'integer' ? Math.round(parsed) : parsed;
    if (prop.minimum !== undefined && next < prop.minimum) next = prop.minimum;
    if (prop.maximum !== undefined && next > prop.maximum) next = prop.maximum;
  } else if (type === 'boolean') {
    if (typeof next === 'string') next = next === 'true';
    else next = Boolean(next);
  } else if (type === 'object') {
    return typeof next === 'object' ? next : undefined;
  }

  if (prop.enum?.length) {
    if (prop.enum.includes(next)) return next;
    const asText = String(next).toLowerCase();
    const textMatch = prop.enum.find((option) => String(option).toLowerCase() === asText);
    if (textMatch !== undefined) return textMatch;
    // "8" -> "10" or "720p" -> "1080p" style nearest match, only when the
    // value and every option are a plain number with an optional unit.
    const NUMBER_WITH_UNIT = /^\d+(\.\d+)?\s*[a-z]*$/i;
    if (NUMBER_WITH_UNIT.test(String(next)) && prop.enum.every((option) => NUMBER_WITH_UNIT.test(String(option)))) {
      return closestNumber(prop.enum, parseFloat(next));
    }
    return undefined;
  }
  return next;
}

function resolveTarget(key, value, route, schema) {
  if (route.rename && Object.prototype.hasOwnProperty.call(route.rename, key)) {
    return route.rename[key];
  }
  if (!schema) return key;
  if (schema.props[key]) return key;
  for (const candidate of FIELD_ALIASES[key] || []) {
    if (schema.props[candidate]) return candidate;
  }
  return null;
}

function mergeInto(output, key, value, prop) {
  if (!(key in output)) {
    output[key] = value;
    return;
  }
  if (prop?.type === 'array' || Array.isArray(output[key])) {
    const merged = [
      ...(Array.isArray(output[key]) ? output[key] : [output[key]]),
      ...(Array.isArray(value) ? value : [value]),
    ];
    output[key] = [...new Set(merged)];
  }
  // For scalar collisions the first mapped value (the more specific field) wins.
}

/**
 * @param {object} payload  studio payload (shared vocabulary)
 * @param {object} route    { provider, endpoint, rename?, split?, fixed?, defaults?, drop?, values?, imageArea? }
 * @param {object|null} schema  snapshot { required: [], props: { name: prop } }
 * @returns {{ input: object, warnings: string[] }}
 */
export function mapInput(payload, route, schema) {
  const warnings = [];
  const output = {};
  const drop = new Set(route.drop || []);
  const source = { ...(payload || {}) };

  // width/height pairs become fal-style `image_size` objects when the
  // endpoint has no separate width/height inputs.
  if (schema && source.width && source.height && !schema.props.width) {
    if (schema.props.image_size) {
      source.image_size = { width: Number(source.width), height: Number(source.height) };
      delete source.aspect_ratio;
    } else if (schema.props.size && !schema.props.size.enum) {
      const separator = String(schema.props.size.default || '').includes('x') ? 'x' : '*';
      source.size = `${Number(source.width)}${separator}${Number(source.height)}`;
      delete source.aspect_ratio;
    }
    delete source.width;
    delete source.height;
  }

  // `split` spreads one list over several provider fields, e.g. a
  // first/last-frame model's images_list -> image_url + end_image_url.
  for (const [key, targets] of Object.entries(route.split || {})) {
    const items = Array.isArray(source[key]) ? source[key] : (isEmpty(source[key]) ? [] : [source[key]]);
    targets.forEach((target, index) => {
      if (!isEmpty(items[index])) output[target] = coerceValue(items[index], schema?.props?.[target]);
    });
    delete source[key];
  }

  for (const [key, rawValue] of Object.entries(source)) {
    if (INTERNAL_FIELDS.has(key) || drop.has(key) || isEmpty(rawValue)) continue;
    if (key === 'seed' && Number(rawValue) === -1) continue;

    const target = resolveTarget(key, rawValue, route, schema);
    if (!target) {
      warnings.push(`dropped ${key}`);
      continue;
    }

    const prop = schema?.props?.[target];
    let value = rawValue;
    if (key === 'aspect_ratio') value = convertAspectRatio(value, target, prop, route.imageArea);
    if (route.values?.[target] && Object.prototype.hasOwnProperty.call(route.values[target], value)) {
      value = route.values[target][value];
      // A null remap means "leave it to the provider default".
      if (value === null) continue;
    }
    if (schema) value = coerceValue(value, prop);
    if (isEmpty(value)) {
      warnings.push(`dropped ${key}=${JSON.stringify(rawValue)} (not accepted by ${target})`);
      continue;
    }
    mergeInto(output, target, value, prop);
  }

  for (const [key, value] of Object.entries(route.fixed || {})) {
    output[key] = value;
  }
  // `defaults` only fill gaps, e.g. a required prompt the studio left blank.
  for (const [key, value] of Object.entries(route.defaults || {})) {
    if (isEmpty(output[key])) output[key] = value;
  }

  if (schema) {
    for (const key of Object.keys(output)) {
      if (!schema.props[key] && !(route.fixed && key in route.fixed)) {
        warnings.push(`dropped ${key} (unknown to ${route.endpoint})`);
        delete output[key];
      }
    }
    const missing = (schema.required || []).filter((key) => isEmpty(output[key]) && schema.props[key]?.default === undefined);
    if (missing.length > 0) {
      throw new MappingError(`Missing required input: ${missing.join(', ')}`, { missing, endpoint: route.endpoint });
    }
  }

  return { input: output, warnings };
}
