// Evaluates one workflow node. Model nodes go through the same generation
// entry points the studios use, with upstream values substituted in.

import {
  generateAudio,
  generateI2I,
  generateI2V,
  generateImage,
  generateVideo,
  processLipSync,
  processV2V,
} from '../generation.js';
import { buildReferenceParams } from '../modelCapabilities.js';
import { fillTemplate, templateVariables } from './graph.js';
import { cleanParamValues, findModel, getModelPorts, isPromptRequired, modelOutputKind } from './modelPorts.js';

const RUNNERS = {
  t2i: generateImage,
  i2i: generateI2I,
  t2v: generateVideo,
  i2v: generateI2V,
  v2v: processV2V,
  audio: generateAudio,
  lipsync: processLipSync,
};

const MEDIA_KINDS = new Set(['image', 'video', 'audio']);

function format(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function outputUrls(output) {
  if (!output) return [];
  const values = Array.isArray(output.values) && output.values.length ? output.values : [output.value];
  return values.filter((value) => typeof value === 'string' && value);
}

function outputText(output) {
  return output?.kind === 'text' ? String(output.value || '') : '';
}

/** Request parameters for a model node, in the studio vocabulary. */
export function buildModelParams(categoryId, model, { prompt, paramValues, media }) {
  const params = { model: model.id, ...cleanParamValues(categoryId, model, paramValues) };
  if (prompt) params.prompt = prompt;
  const ports = getModelPorts(categoryId, model);
  const urls = (id) => media[id] || [];

  if (categoryId === 'lipsync') {
    if (urls('audio')[0]) params.audio_url = urls('audio')[0];
    if (urls('image')[0]) params.image_url = urls('image')[0];
    if (urls('video')[0]) params.video_url = urls('video')[0];
    return params;
  }

  if (categoryId === 'i2i') {
    const images = urls('image');
    if (images.length > 0) {
      params.images_list = images;
      params.image_url = images[0];
    }
  } else if (categoryId !== 'audio') {
    Object.assign(params, buildReferenceParams(model, {
      imageUrls: urls('image'),
      endImageUrl: urls('last_image')[0] || null,
      videoUrls: urls('video'),
      audioUrls: urls('audio'),
    }));
  }

  for (const port of ports) {
    if (!port.id.startsWith('field:')) continue;
    const values = urls(port.id);
    if (values.length === 0) continue;
    params[port.field] = port.multiple ? values : values[0];
  }
  return params;
}

/**
 * @param {object} node React Flow node ({ id, type, data })
 * @param {Record<string, object[]>} inputs target handle → upstream outputs
 * @param {{ copy: object, onRequestId?: Function }} options
 */
export async function evaluateNode(node, inputs, { copy, onRequestId } = {}) {
  const errors = copy.errors;
  const data = node.data || {};
  switch (node.type) {
    case 'text':
      return { kind: 'text', value: String(data.text || ''), values: [] };
    case 'image':
    case 'video':
    case 'audio': {
      if (!data.url) throw new Error(errors.missingMedia);
      return { kind: node.type, value: data.url, values: [data.url] };
    }
    case 'combiner': {
      const values = {};
      for (const name of templateVariables(data.template)) {
        values[name] = (inputs[`var:${name}`] || []).map(outputText).filter(Boolean).join(', ');
      }
      return { kind: 'text', value: fillTemplate(data.template, values), values: [] };
    }
    case 'result': {
      const first = (inputs.in || [])[0];
      if (!first) throw new Error(errors.nothingConnected);
      return first;
    }
    case 'model':
      return evaluateModel(data, inputs, { copy, onRequestId });
    default:
      throw new Error(errors.unknownNode);
  }
}

async function evaluateModel(data, inputs, { copy, onRequestId }) {
  const errors = copy.errors;
  const model = findModel(data.category, data.modelId);
  if (!model) throw new Error(errors.modelMissing);
  const ports = getModelPorts(data.category, model);
  const media = {};
  for (const port of ports) {
    if (port.kind === 'text') continue;
    const values = (inputs[port.id] || []).flatMap(outputUrls);
    media[port.id] = values.slice(0, port.max || values.length);
    if (port.required && media[port.id].length === 0) {
      throw new Error(format(errors.missingInput, { input: port.label || copy.ports?.[port.labelKey] || port.labelKey }));
    }
  }
  const connectedPrompt = (inputs.prompt || []).map(outputText).filter(Boolean).join('\n');
  const prompt = (connectedPrompt || String(data.prompt || '')).trim();
  if (isPromptRequired(data.category, model) && !prompt) throw new Error(errors.promptRequired);

  const run = RUNNERS[data.category];
  if (!run) throw new Error(errors.modelMissing);
  const params = buildModelParams(data.category, model, { prompt, paramValues: data.params || {}, media });
  const result = await run({ ...params, onRequestId });
  const urls = (result?.outputs?.length ? result.outputs : [result?.url]).filter(Boolean);
  if (urls.length === 0) throw new Error(errors.noOutput);
  const mediaType = result?.media?.[0]?.type;
  return {
    kind: MEDIA_KINDS.has(mediaType) ? mediaType : modelOutputKind(data.category),
    value: urls[0],
    values: urls,
  };
}
