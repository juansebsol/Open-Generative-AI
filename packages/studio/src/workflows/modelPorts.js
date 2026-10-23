// Describes what a model node accepts and produces: connectable media and
// prompt ports derived from the catalog entry, plus the scalar parameters
// shown in the inspector.

import {
  audioModels,
  i2iModels,
  i2vModels,
  lipsyncModels,
  t2iModels,
  t2vModels,
  v2vModels,
} from '../models.js';
import { getModelMediaCapabilities } from '../modelCapabilities.js';
import { getAuxiliaryImageInputs } from '../imageInputContracts.js';
import { kindsCompatible, templateVariables } from './graph.js';

export const MODEL_CATEGORIES = [
  { id: 't2i', output: 'image', models: t2iModels },
  { id: 'i2i', output: 'image', models: i2iModels },
  { id: 't2v', output: 'video', models: t2vModels },
  { id: 'i2v', output: 'video', models: i2vModels },
  { id: 'v2v', output: 'video', models: v2vModels },
  { id: 'audio', output: 'audio', models: audioModels },
  { id: 'lipsync', output: 'video', models: lipsyncModels },
];

const PREFERRED_MODELS = {
  t2i: ['nano-banana', 'flux-dev', 'flux-schnell'],
  i2i: ['nano-banana-edit', 'flux-kontext-pro-i2i', 'qwen-image-edit'],
  t2v: ['kling-v2.6-pro-t2v', 'seedance-pro-t2v-fast'],
  i2v: ['kling-v2.6-pro-i2v', 'seedance-pro-i2v-fast', 'wan2.5-image-to-video-fast'],
  v2v: [],
  audio: ['elevenlabs-tts-turbo-2-5', 'minimax-speech-2.6-turbo'],
  lipsync: ['infinitetalk-image-to-video'],
};

export function getCategory(id) {
  return MODEL_CATEGORIES.find((category) => category.id === id) || null;
}

export function findModel(categoryId, modelId) {
  return getCategory(categoryId)?.models.find((model) => model.id === modelId) || null;
}

/** First available model among the preferred ids, else the first in the list. */
export function pickModel(categoryId, preferred = [], filter = () => true) {
  const models = (getCategory(categoryId)?.models || []).filter(filter);
  for (const id of [...preferred, ...(PREFERRED_MODELS[categoryId] || [])]) {
    const model = models.find((entry) => entry.id === id);
    if (model) return model;
  }
  return models[0] || null;
}

export function modelOutputKind(categoryId) {
  return getCategory(categoryId)?.output || 'image';
}

const MEDIA_FIELD_KINDS = {
  image: 'image',
  images_list: 'image',
  video: 'video',
  videos_list: 'video',
  audio: 'audio',
  audios_list: 'audio',
};

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'int', 'float', 'boolean']);
export const NUMBER_TYPES = new Set(['number', 'integer', 'int', 'float']);

/** Media kind of a catalog input (by declared field or by its name), or null. */
export function inputMediaKind(key, schema = {}) {
  if (MEDIA_FIELD_KINDS[schema.field]) return MEDIA_FIELD_KINDS[schema.field];
  if (schema.type && !['string', 'array'].includes(schema.type)) return null;
  if (schema.type === 'array' && schema.items && schema.items.type && schema.items.type !== 'string') return null;
  const match = /(^|_)(image|images|video|videos|audio|audios)(_|$)/.exec(key);
  if (!match || !/(_url|_urls|_list|_files)$/.test(key)) return null;
  return match[2].replace(/s$/, '');
}

function humanize(key) {
  const text = String(key).replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function hasPromptInput(categoryId, model) {
  if (categoryId === 't2i' || categoryId === 't2v') return true;
  return Boolean(model.inputs?.prompt || model.hasPrompt);
}

export function isPromptRequired(categoryId, model) {
  if (!model) return false;
  if (model.promptRequired) return true;
  if (categoryId === 't2i' || categoryId === 't2v') return true;
  if (categoryId === 'audio') return (model.required || []).includes('prompt');
  return false;
}

/**
 * Input ports of a model node. Each port: { id, kind, label, labelKey,
 * multiple, max, required, field }. `labelKey` is a copy key for the
 * standard ports; others carry a ready label.
 */
export function getModelPorts(categoryId, model) {
  if (!model) return [];
  const ports = [];
  const usedFields = new Set();

  if (hasPromptInput(categoryId, model)) {
    ports.push({ id: 'prompt', kind: 'text', labelKey: 'prompt', required: isPromptRequired(categoryId, model), multiple: true });
    usedFields.add('prompt');
  }

  if (categoryId === 'lipsync') {
    const visual = model.category === 'video' ? 'video' : 'image';
    ports.push({ id: visual, kind: visual, labelKey: visual, required: true, multiple: false, max: 1 });
    ports.push({ id: 'audio', kind: 'audio', labelKey: 'audio', required: true, multiple: false, max: 1 });
    return ports;
  }

  const capabilities = getModelMediaCapabilities(model);
  if (categoryId === 'i2i') {
    const image = capabilities.image;
    const field = image.field || model.imageField || 'image_url';
    const multiple = image.isArray || field === 'images_list';
    ports.push({ id: 'image', kind: 'image', labelKey: multiple ? 'images' : 'image', required: true, multiple, max: multiple ? image.maxItems || 1 : 1, field });
    usedFields.add(field);
    for (const aux of getAuxiliaryImageInputs(model, 'i2i')) {
      ports.push({ id: `field:${aux.field}`, kind: 'image', label: aux.label, required: aux.required, multiple: false, max: 1, field: aux.field });
      usedFields.add(aux.field);
    }
  } else if (categoryId !== 'audio') {
    for (const kind of ['image', 'video', 'audio']) {
      const capability = capabilities[kind];
      if (!capability.field) continue;
      // With a separate last-frame field the primary input takes one image.
      const max = kind === 'image' && capability.separateLastItem ? 1 : capability.maxItems || 1;
      const required = (categoryId === 'i2v' && kind === 'image') || (categoryId === 'v2v' && kind === 'video');
      ports.push({
        id: kind,
        kind,
        labelKey: max > 1 ? `${kind}s` : kind,
        required,
        multiple: max > 1,
        max,
        field: capability.field,
      });
      usedFields.add(capability.field);
      if (kind === 'image' && capability.lastField) {
        ports.push({ id: 'last_image', kind: 'image', labelKey: 'lastImage', required: false, multiple: false, max: 1, field: capability.lastField });
        usedFields.add(capability.lastField);
      }
    }
    if (categoryId === 'v2v' && !ports.some((port) => port.kind === 'video')) {
      const field = model.videoField || 'video_url';
      ports.push({ id: 'video', kind: 'video', labelKey: 'video', required: true, multiple: false, max: 1, field });
      usedFields.add(field);
    }
  }

  // Any other declared media inputs (secondary anchors, voice samples...).
  for (const [key, schema] of Object.entries(model.inputs || {})) {
    if (usedFields.has(key)) continue;
    const kind = inputMediaKind(key, schema);
    if (!kind) continue;
    const multiple = schema.type === 'array';
    ports.push({
      id: `field:${key}`,
      kind,
      label: schema.title || humanize(key),
      required: (model.required || []).includes(key),
      multiple,
      max: multiple ? schema.maxItems || schema.max_items || 10 : 1,
      field: key,
    });
  }
  return ports;
}

const HIDDEN_PARAMS = new Set(['prompt', 'num_images', 'batch_size', 'model']);

function isEditableSchema(schema = {}) {
  if (schema.enum) return true;
  if (SCALAR_TYPES.has(schema.type)) return true;
  if (!schema.type) return true;
  if (schema.type === 'array') {
    const itemType = schema.items?.type || 'string';
    return SCALAR_TYPES.has(itemType) && !schema.items?.properties;
  }
  return false;
}

/** Scalar parameters (not prompt, not media) shown as controls. */
export function getModelParamInputs(categoryId, model) {
  if (!model?.inputs) return [];
  const portFields = new Set(getModelPorts(categoryId, model).map((port) => port.field).filter(Boolean));
  return Object.entries(model.inputs)
    .filter(([key, schema]) => !HIDDEN_PARAMS.has(key) && !portFields.has(key) && !inputMediaKind(key, schema) && isEditableSchema(schema))
    .map(([key, schema]) => ({ key, schema, label: schema.title || humanize(key) }));
}

export function enumOptionValue(option) {
  return option && typeof option === 'object' ? option.value : option;
}

export function enumOptionLabel(option) {
  return option && typeof option === 'object' ? option.label || String(option.value) : String(option);
}

export function defaultParamValues(categoryId, model) {
  const values = {};
  for (const { key, schema } of getModelParamInputs(categoryId, model)) {
    if (schema.default !== undefined) values[key] = schema.default;
  }
  return values;
}

/** Turns the inspector values into request parameters (drops blanks, coerces numbers). */
export function cleanParamValues(categoryId, model, values = {}) {
  const params = {};
  for (const { key, schema } of getModelParamInputs(categoryId, model)) {
    let value = Object.hasOwn(values, key) ? values[key] : schema.default;
    if (value === undefined || value === null || value === '') continue;
    if (schema.enum) {
      const option = schema.enum.find((entry) => String(enumOptionValue(entry)) === String(value));
      if (option === undefined && schema.default === undefined) continue;
      value = option === undefined ? schema.default : enumOptionValue(option);
    } else if (schema.type === 'array') {
      const items = Array.isArray(value) ? value : String(value).split(/[\n,]/);
      value = items.map((item) => (typeof item === 'string' ? item.trim() : item)).filter((item) => item !== '' && item != null);
      if (NUMBER_TYPES.has(schema.items?.type)) value = value.map(Number).filter(Number.isFinite);
      if (value.length === 0) continue;
    } else if (NUMBER_TYPES.has(schema.type) && !schema.enum) {
      value = Number(value);
      if (!Number.isFinite(value)) continue;
    } else if (schema.type === 'boolean') {
      value = value === true || value === 'true';
    }
    params[key] = value;
  }
  return params;
}

/** Input ports of any node type. */
export function nodeInputPorts(node) {
  switch (node?.type) {
    case 'model': {
      const model = findModel(node.data?.category, node.data?.modelId);
      return getModelPorts(node.data?.category, model);
    }
    case 'combiner':
      return templateVariables(node.data?.template).map((name) => ({ id: `var:${name}`, kind: 'text', label: name, multiple: true }));
    case 'result':
      return [{ id: 'in', kind: 'any', labelKey: 'result', multiple: false, max: 1 }];
    default:
      return [];
  }
}

/** Output kind of any node type (null for output nodes). */
export function nodeOutputKind(node) {
  switch (node?.type) {
    case 'text':
    case 'combiner':
      return 'text';
    case 'image':
    case 'video':
    case 'audio':
      return node.type;
    case 'model':
      return modelOutputKind(node.data?.category);
    default:
      return null;
  }
}

export function isConnectionValid(sourceNode, targetNode, targetHandle) {
  if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return false;
  const port = nodeInputPorts(targetNode).find((entry) => entry.id === targetHandle);
  return Boolean(port) && kindsCompatible(nodeOutputKind(sourceNode), port.kind);
}

/**
 * Drops edges whose ports no longer exist or no longer match, and extra
 * edges into single-input ports.
 */
export function pruneEdges(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const counts = new Map();
  return edges.filter((edge) => {
    const target = byId.get(edge.target);
    if (!isConnectionValid(byId.get(edge.source), target, edge.targetHandle)) return false;
    const port = nodeInputPorts(target).find((entry) => entry.id === edge.targetHandle);
    const key = `${edge.target}:${edge.targetHandle}`;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    return port.multiple || count === 1;
  });
}
