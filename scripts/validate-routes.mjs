#!/usr/bin/env node
// Checks every catalog model against its provider routes without calling any
// provider: builds a sample studio payload from the model's inputs, runs the
// same mapper the server uses, and reports missing required inputs and
// dropped fields.
//
//   node scripts/validate-routes.mjs                 # all route groups
//   node scripts/validate-routes.mjs --group=kling   # endpoints routed by one group
//   node scripts/validate-routes.mjs --unrouted      # also list catalog endpoints with no route
//   node scripts/validate-routes.mjs --verbose       # print warnings for every route

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_SRC = path.join(ROOT, 'packages/studio/src');
const CATALOG_DIR = path.join(STUDIO_SRC, 'providers/catalog');
const ROUTES_DIR = path.join(CATALOG_DIR, 'routes');
const SCHEMA_DIR = path.join(CATALOG_DIR, 'schemas');
const SCHEMA_PROVIDERS = new Set(['fal', 'wavespeed']);

const args = process.argv.slice(2);
const group = args.find((arg) => arg.startsWith('--group='))?.slice('--group='.length);
const showUnrouted = args.includes('--unrouted');
const verbose = args.includes('--verbose');

const { mapInput } = await import(pathToFileURL(path.join(STUDIO_SRC, 'providers/mapper.js')));
const { getAuxiliaryImageInputs } = await import(pathToFileURL(path.join(STUDIO_SRC, 'imageInputContracts.js')));
const { DIRECT_PROVIDERS } = await import(pathToFileURL(path.join(STUDIO_SRC, 'providers/directProviders.js')));
const { applyPromptPresets } = await import(pathToFileURL(path.join(STUDIO_SRC, 'imageEffects.js')));
const catalog = await import(pathToFileURL(path.join(STUDIO_SRC, 'models.js')));

const MODEL_LISTS = ['t2iModels', 'i2iModels', 't2vModels', 'i2vModels', 'v2vModels', 'lipsyncModels', 'audioModels', 'recastModels', 'motionControlModels'];
const SAMPLE = {
  image: 'https://example.com/sample.png',
  video: 'https://example.com/sample.mp4',
  audio: 'https://example.com/sample.mp3',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadRoutes() {
  const merged = {};
  const owners = {};
  for (const file of fs.readdirSync(ROUTES_DIR).filter((name) => name.endsWith('.json'))) {
    const name = path.basename(file, '.json');
    for (const [endpoint, routes] of Object.entries(readJson(path.join(ROUTES_DIR, file)))) {
      if (owners[endpoint] && owners[endpoint] !== name) {
        console.warn(`! ${endpoint} is routed in both ${owners[endpoint]} and ${name}`);
      }
      owners[endpoint] = name;
      merged[endpoint] = routes;
    }
  }
  return { merged, owners };
}

function loadSchemas() {
  const schemas = { fal: {}, wavespeed: {} };
  if (!fs.existsSync(SCHEMA_DIR)) return schemas;
  for (const file of fs.readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.json'))) {
    const provider = file.split('.').slice(-2, -1)[0];
    if (schemas[provider]) Object.assign(schemas[provider], readJson(path.join(SCHEMA_DIR, file)));
  }
  return schemas;
}

function mediaKind(name) {
  if (/^num_|_count$|^max_|^min_/.test(name)) return null;
  const tokens = name.toLowerCase().split('_');
  const has = (...words) => tokens.some((token) => words.includes(token.replace(/s$/, '')));
  if (has('audio', 'speech')) return 'audio';
  if (has('video')) return 'video';
  if (has('image', 'frame', 'photo', 'mask', 'face', 'garment', 'swap')) return 'image';
  return null;
}

function sampleValue(name, def = {}) {
  if (def.type === 'array' && def.items?.properties) return Array.isArray(def.examples?.[0]) ? def.examples[0] : def.default;
  const kind = mediaKind(name);
  const wantsArray = def.type === 'array' || /_list$|_urls$|_files$|s_list$/.test(name);
  if (kind && (def.type === 'string' || def.type === 'array' || /url|list|files|image|video|audio/.test(name))) {
    return wantsArray ? [SAMPLE[kind]] : SAMPLE[kind];
  }
  if (def.default !== undefined) return def.default;
  if (def.enum?.length) return def.enum[0];
  if (/prompt|text|lyrics/.test(name)) return 'A calm lake at sunrise';
  if (def.type === 'int' || def.type === 'integer' || def.type === 'number' || def.type === 'float') {
    return def.minValue ?? def.minimum ?? 1;
  }
  if (def.type === 'boolean') return false;
  if (def.type === 'array') return [];
  return undefined;
}

function samplePayload(model, listName) {
  const payload = {};
  for (const [name, def] of Object.entries(model.inputs || {})) {
    const value = sampleValue(name, def);
    if (value !== undefined) payload[name] = value;
  }
  const ensure = (field, kind, asArray = false) => {
    if (field && payload[field] === undefined) payload[field] = asArray ? [SAMPLE[kind]] : SAMPLE[kind];
  };
  if (listName === 'i2iModels' || listName === 'i2vModels') {
    const field = model.imageField || 'image_url';
    ensure(field, 'image', field === 'images_list');
    for (const { field: auxField } of getAuxiliaryImageInputs(model, listName === 'i2iModels' ? 'i2i' : 'i2v') || []) {
      ensure(auxField, 'image');
    }
  }
  Object.assign(payload, EXTRA_SAMPLE_FIELDS[model.endpoint || model.id] || {});
  if (model.lastImageField) ensure(model.lastImageField, 'image');
  if (listName === 'v2vModels' || listName === 'recastModels') ensure(model.videoField || 'video_url', 'video');
  if (listName === 'recastModels' && model.imageField) ensure(model.imageField, 'image');
  if (listName === 'lipsyncModels') {
    ensure('audio_url', 'audio');
    ensure(model.category === 'video' ? 'video_url' : 'image_url', model.category === 'video' ? 'video' : 'image');
  }
  if (listName === 'motionControlModels') {
    ensure('video_url', 'video');
    ensure('images_list', 'image', true);
  }
  // Required free-text inputs (voice ids, names) have no default to sample.
  for (const field of model.required || []) {
    if (payload[field] === undefined && model.inputs?.[field]?.type === 'string') payload[field] = 'sample';
  }
  if (!payload.prompt && (model.hasPrompt || model.promptRequired || ['t2iModels', 't2vModels'].includes(listName))) {
    payload.prompt = 'A calm lake at sunrise';
  }
  delete payload.seed;
  return payload;
}

// Inputs that tool payload builders (videoToolCapabilities.js) add for models
// whose catalog entry has no `inputs`.
const EXTRA_SAMPLE_FIELDS = {
  'ai-video-face-swap': { image_url: SAMPLE.image },
  'heygen-video-translate': { language: 'English' },
};

// Endpoints the studios call directly (generation.js) rather than through a
// catalog entry, with the payload each one sends.
const SPECIAL_ENDPOINTS = {
  'bytedance-seedream-5.0-pro-layer': { name: 'Layer decomposition', payload: { image_url: SAMPLE.image, prompt: '', resolution: 'auto', output_format: 'png' } },
  'seedvr2-image-upscale': { name: 'SeedVR2 upscale', payload: { image_url: SAMPLE.image, resolution: '4k' } },
  'topaz-image-upscale': { name: 'Topaz upscale', payload: { image_url: SAMPLE.image, upscale_factor: 2 } },
  'ai-image-upscale': { name: 'Image upscale', payload: { image_url: SAMPLE.image } },
  'ai-background-remover': { name: 'Background removal', payload: { image_url: SAMPLE.image } },
  'ai-image-extension': { name: 'Image expand', payload: { image_url: SAMPLE.image } },
  'seedance-2-vip-omni-reference': { name: 'Marketing ad (720p)', payload: { prompt: 'Product ad', aspect_ratio: '16:9', duration: 5, images_list: [SAMPLE.image] } },
  'sd-2-vip-omni-reference-1080p': { name: 'Marketing ad (1080p)', payload: { prompt: 'Product ad', aspect_ratio: '16:9', duration: 5, images_list: [SAMPLE.image] } },
};

const { merged: routes, owners } = loadRoutes();
const schemas = loadSchemas();
const seen = new Map();
for (const [endpoint, special] of Object.entries(SPECIAL_ENDPOINTS)) {
  seen.set(endpoint, { model: { name: special.name, inputs: {} }, listName: 'special', payload: special.payload });
}
for (const listName of MODEL_LISTS) {
  for (const model of catalog.ALL_MODEL_LISTS?.[listName] || catalog[listName] || []) {
    const endpoint = model.endpoint || model.id;
    if (!seen.has(endpoint)) seen.set(endpoint, { model, listName });
  }
}

let errorCount = 0;
let warningCount = 0;
let routedCount = 0;
const unrouted = [];

for (const [endpoint, { model, listName, payload: fixedPayload }] of seen) {
  const endpointRoutes = routes[endpoint];
  if (!endpointRoutes?.length) {
    unrouted.push(`${endpoint}  (${listName}: ${model.name})`);
    continue;
  }
  if (group && owners[endpoint] !== group) continue;
  routedCount++;
  const payload = applyPromptPresets(endpoint, fixedPayload || samplePayload(model, listName));

  for (const route of endpointRoutes) {
    const label = `${endpoint} -> ${route.provider}:${route.endpoint}`;
    if (DIRECT_PROVIDERS.has(route.provider)) {
      if (verbose) console.log(`  ok   ${label} (direct adapter)`);
      continue;
    }
    if (!SCHEMA_PROVIDERS.has(route.provider)) {
      errorCount++;
      console.log(`  ERR  ${label}: unknown provider`);
      continue;
    }
    const schema = schemas[route.provider][route.endpoint];
    if (!schema) {
      errorCount++;
      console.log(`  ERR  ${label}: no schema snapshot (run scripts/sync-provider-schemas.mjs)`);
      continue;
    }
    try {
      const { warnings } = mapInput(payload, route, schema);
      const meaningful = warnings.filter((warning) => !/^dropped (high_bitrate|quality|camera_fixed)\b/.test(warning));
      if (meaningful.length) {
        warningCount += meaningful.length;
        if (verbose) console.log(`  warn ${label}: ${meaningful.join('; ')}`);
      } else if (verbose) {
        console.log(`  ok   ${label}`);
      }
    } catch (error) {
      errorCount++;
      console.log(`  ERR  ${label}: ${error.message}`);
    }
  }
}

for (const endpoint of Object.keys(routes)) {
  if (group && owners[endpoint] !== group) continue;
  if (!seen.has(endpoint) && !endpoint.startsWith('@')) {
    console.log(`  note ${endpoint} is routed in ${owners[endpoint]} but is not a catalog endpoint`);
  }
}

if (showUnrouted && unrouted.length) {
  console.log(`\nUnrouted catalog endpoints (${unrouted.length}) - hidden from the studios:`);
  for (const line of unrouted) console.log(`  - ${line}`);
}

console.log(`\n${routedCount} routed endpoint(s) checked${group ? ` in ${group}` : ''}, ${unrouted.length} unrouted overall, ${errorCount} error(s), ${warningCount} warning(s).`);
if (errorCount) process.exitCode = 1;
