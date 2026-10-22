#!/usr/bin/env node
// Refreshes the input-schema snapshots that the server-side mapper uses.
//
//   node scripts/sync-provider-schemas.mjs            # fetch schemas missing from the snapshots
//   node scripts/sync-provider-schemas.mjs --refresh  # re-fetch every routed endpoint
//   node scripts/sync-provider-schemas.mjs --only=kling   # one route group
//
// Both sources are public and need no API key:
//   fal:       https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>
//   WaveSpeed: the request_schema embedded in https://wavespeed.ai/models/<id>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogIndex } from './build-catalog-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = path.join(ROOT, 'packages/studio/src/providers/catalog');
const ROUTES_DIR = path.join(CATALOG_DIR, 'routes');
const SCHEMA_DIR = path.join(CATALOG_DIR, 'schemas');
const SCHEMA_PROVIDERS = ['fal', 'wavespeed'];

const args = new Set(process.argv.slice(2));
const refresh = args.has('--refresh');
const only = [...args].find((arg) => arg.startsWith('--only='))?.slice('--only='.length);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, { attempts = 5, accept = 'application/json' } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url, { headers: { accept, 'user-agent': 'open-generative-ai-schema-sync' } });
    if (response.ok) return response;
    if (response.status === 404) return null;
    if (attempt === attempts) throw new Error(`${response.status} for ${url}`);
    await sleep(response.status === 429 ? 4000 * attempt : 1000 * attempt);
  }
  return null;
}

// --- normalisation ---------------------------------------------------------

function resolveRef(ref, components) {
  const name = ref.split('/').pop();
  return components?.[name];
}

function normaliseProp(raw, components) {
  if (!raw) return { type: 'string' };
  let prop = raw.$ref ? resolveRef(raw.$ref, components) || {} : raw;
  const out = {};
  const variants = prop.anyOf || prop.oneOf;
  if (variants) {
    const resolved = variants.map((variant) => (variant.$ref ? resolveRef(variant.$ref, components) || {} : variant));
    const nonNull = resolved.filter((variant) => variant.type !== 'null');
    const enumVariant = nonNull.find((variant) => variant.enum);
    const objectVariant = nonNull.find((variant) => variant.type === 'object' || variant.properties);
    const primary = enumVariant || nonNull.find((variant) => variant.type && variant.type !== 'object') || nonNull[0] || {};
    prop = { ...primary, default: prop.default ?? primary.default };
    if (objectVariant && primary !== objectVariant) out.anyOfObject = true;
  }

  out.type = prop.type || (prop.enum ? 'string' : prop.properties ? 'object' : 'string');
  if (Array.isArray(out.type)) out.type = out.type.find((type) => type !== 'null') || 'string';
  if (prop.enum) out.enum = prop.enum;
  if (prop.default !== undefined) out.default = prop.default;
  if (prop.minimum !== undefined) out.minimum = prop.minimum;
  if (prop.maximum !== undefined) out.maximum = prop.maximum;
  if (out.type === 'array') {
    const items = prop.items?.$ref ? resolveRef(prop.items.$ref, components) : prop.items;
    out.items = items?.type === 'object' || items?.properties ? 'object' : 'string';
    if (prop.maxItems !== undefined) out.maxItems = prop.maxItems;
  }
  return out;
}

function normaliseSchema(schema, components) {
  const props = {};
  for (const [name, raw] of Object.entries(schema?.properties || {})) {
    props[name] = normaliseProp(raw, components);
  }
  return { required: schema?.required || [], props };
}

// --- fal ---------------------------------------------------------------------

async function fetchFalSchema(endpoint) {
  const response = await fetchWithRetry(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpoint)}`);
  if (!response) return null;
  const doc = await response.json();
  const components = doc.components?.schemas || {};
  const postPath = Object.entries(doc.paths || {}).find(([pathName, item]) => item.post && !pathName.includes('/requests/'));
  const bodyRef = postPath?.[1]?.post?.requestBody?.content?.['application/json']?.schema?.$ref;
  const input = bodyRef ? resolveRef(bodyRef, components) : Object.entries(components).find(([name]) => name.endsWith('Input'))?.[1];
  if (!input) return null;
  return normaliseSchema(input, components);
}

// --- WaveSpeed -------------------------------------------------------------------

function extractJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return null;
}

async function fetchWavespeedSchema(endpoint) {
  const response = await fetchWithRetry(`https://wavespeed.ai/models/${endpoint}`, { accept: 'text/html' });
  if (!response) return null;
  const html = await response.text();
  // The page embeds React Server Component chunks: self.__next_f.push([1,"<json-escaped text>"])
  for (const match of html.matchAll(/self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\)/g)) {
    if (!match[1].includes('request_schema')) continue;
    const chunk = JSON.parse(match[1])[1];
    const marker = chunk.indexOf('"api_schema":');
    if (marker === -1) continue;
    const objectText = extractJsonObject(chunk, chunk.indexOf('{', marker));
    if (!objectText) continue;
    const apiSchema = JSON.parse(objectText);
    const run = apiSchema.api_schemas?.find((entry) => entry.type === 'model_run') || apiSchema.api_schemas?.[0];
    const expectedPath = `/api/v3/${endpoint}`;
    if (run?.api_path && run.api_path !== expectedPath) continue;
    if (run?.request_schema) return normaliseSchema(run.request_schema, {});
  }
  return null;
}

// --- main ----------------------------------------------------------------------
// Snapshots are stored per route file (schemas/<group>.<provider>.json) so
// route groups can be edited and synced independently.

function routeFiles() {
  return fs.readdirSync(ROUTES_DIR)
    .filter((file) => file.endsWith('.json'))
    .filter((file) => !only || only === file || only === path.basename(file, '.json'));
}

function wantedEndpoints(file) {
  const table = JSON.parse(fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8'));
  const wanted = new Map(SCHEMA_PROVIDERS.map((provider) => [provider, new Set()]));
  for (const routes of Object.values(table)) {
    for (const route of routes) wanted.get(route.provider)?.add(route.endpoint);
  }
  return wanted;
}

function snapshotPath(group, provider) {
  return path.join(SCHEMA_DIR, `${group}.${provider}.json`);
}

function loadSnapshot(group, provider) {
  const file = snapshotPath(group, provider);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function saveSnapshot(group, provider, snapshot, keep) {
  fs.mkdirSync(SCHEMA_DIR, { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(snapshot)
      .filter(([endpoint]) => keep.has(endpoint))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const file = snapshotPath(group, provider);
  if (Object.keys(sorted).length === 0) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.writeFileSync(file, `${JSON.stringify(sorted)}\n`);
}

async function runPool(items, worker, concurrency = 4) {
  const queue = [...items];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

const fetchers = { fal: fetchFalSchema, wavespeed: fetchWavespeedSchema };
let failures = 0;

for (const file of routeFiles()) {
  const group = path.basename(file, '.json');
  const wanted = wantedEndpoints(file);
  for (const provider of SCHEMA_PROVIDERS) {
    const snapshot = loadSnapshot(group, provider);
    const keep = wanted.get(provider);
    const endpoints = [...keep].filter((endpoint) => refresh || !snapshot[endpoint]);
    if (endpoints.length > 0) console.log(`${group}/${provider}: fetching ${endpoints.length} schema(s)`);
    await runPool(endpoints, async (endpoint) => {
      try {
        const schema = await fetchers[provider](endpoint);
        if (schema) snapshot[endpoint] = schema;
        else {
          failures++;
          console.warn(`  ! ${provider} ${endpoint}: schema not found`);
        }
      } catch (error) {
        failures++;
        console.warn(`  ! ${provider} ${endpoint}: ${error.message}`);
      }
    }, provider === 'wavespeed' ? 3 : 5);
    saveSnapshot(group, provider, snapshot, keep);
  }
  console.log(`${group}: schemas up to date`);
}

buildCatalogIndex();

if (failures) {
  console.warn(`${failures} endpoint(s) had no schema. Check the endpoint ids in the route files.`);
  process.exitCode = 1;
}
