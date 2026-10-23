// Node factory and starter templates for the Workflows studio.

import { layoutGraph, newId } from './graph.js';
import { defaultParamValues, enumOptionValue, getCategory, getModelParamInputs, pickModel } from './modelPorts.js';

// Keeps only suggested parameters the chosen model accepts.
function supportedParams(category, model, params = {}) {
  const inputs = new Map(getModelParamInputs(category, model).map((input) => [input.key, input.schema]));
  const kept = {};
  for (const [key, value] of Object.entries(params || {})) {
    const schema = inputs.get(key);
    if (!schema) continue;
    if (schema.enum && !schema.enum.some((option) => enumOptionValue(option) === value)) continue;
    kept[key] = value;
  }
  return kept;
}

/** Data a fresh node of each type starts with. */
export function createNode(type, position = { x: 0, y: 0 }, data = {}) {
  const base = {
    text: { text: '' },
    image: { url: '' },
    video: { url: '' },
    audio: { url: '' },
    combiner: { template: '{{a}}, {{b}}' },
    result: {},
    model: {},
  }[type] || {};
  const node = { id: newId(type), type, position, data: { ...base, ...data } };
  if (type === 'model') {
    const category = getCategory(data.category) ? data.category : 't2i';
    const model = (data.modelId && getCategory(category).models.find((entry) => entry.id === data.modelId))
      || pickModel(category);
    node.data = {
      prompt: '',
      ...data,
      category,
      modelId: model?.id || '',
      params: { ...defaultParamValues(category, model), ...supportedParams(category, model, data.params) },
    };
  }
  return node;
}

export function edge(source, target, targetHandle) {
  return { id: newId('e'), source: source.id, target: target.id, sourceHandle: 'out', targetHandle };
}

function modelNode(category, preferred, data = {}, filter) {
  const model = pickModel(category, preferred, filter);
  return createNode('model', undefined, { category, modelId: model?.id || '', ...data });
}

const TEMPLATE_BUILDERS = {
  'text-image-video': () => {
    const idea = createNode('text', undefined, { text: 'A lighthouse on a rocky cliff at golden hour, cinematic, 35mm film look' });
    const image = modelNode('t2i', ['nano-banana'], { params: { aspect_ratio: '16:9' } });
    const motion = createNode('text', undefined, { text: 'Slow dolly-in toward the lighthouse, waves crashing below, warm light flickering' });
    const video = modelNode('i2v', ['kling-v2.6-pro-i2v', 'seedance-pro-i2v-fast']);
    const output = createNode('result');
    return {
      nodes: [idea, image, motion, video, output],
      edges: [edge(idea, image, 'prompt'), edge(image, video, 'image'), edge(motion, video, 'prompt'), edge(video, output, 'in')],
    };
  },
  'upscale-remove-bg': () => {
    const source = createNode('image');
    const upscale = modelNode('i2i', ['ai-image-upscaler', 'topaz-image-upscale', 'seedvr2-image-upscale']);
    const cutout = modelNode('i2i', ['ai-background-remover']);
    const output = createNode('result');
    return {
      nodes: [source, upscale, cutout, output],
      edges: [edge(source, upscale, 'image'), edge(upscale, cutout, 'image'), edge(cutout, output, 'in')],
    };
  },
  'talking-portrait': () => {
    const look = createNode('text', undefined, { text: 'Head-and-shoulders portrait of a friendly science teacher facing the camera, soft studio light, neutral background' });
    const portrait = modelNode('t2i', ['nano-banana'], { params: { aspect_ratio: '1:1' } });
    const script = createNode('text', undefined, { text: 'Hi everyone! Today we are going to find out why the sky is blue.' });
    const voice = modelNode('audio', ['elevenlabs-tts-turbo-2-5', 'minimax-speech-2.6-turbo']);
    const lipsync = modelNode('lipsync', ['infinitetalk-image-to-video'], {}, (model) => model.category === 'image');
    const output = createNode('result');
    return {
      nodes: [look, script, portrait, voice, lipsync, output],
      edges: [
        edge(look, portrait, 'prompt'),
        edge(script, voice, 'prompt'),
        edge(portrait, lipsync, 'image'),
        edge(voice, lipsync, 'audio'),
        edge(lipsync, output, 'in'),
      ],
    };
  },
  'edit-chain': () => {
    const source = createNode('image');
    const change = createNode('text', undefined, { text: 'Turn the scene into a snowy winter evening' });
    const firstEdit = modelNode('i2i', ['nano-banana-edit', 'flux-kontext-pro-i2i']);
    const style = createNode('text', undefined, { text: 'a soft watercolor painting' });
    const combiner = createNode('combiner', undefined, { template: 'Restyle this image as {{style}}. Keep the composition and the subject unchanged.' });
    const secondEdit = modelNode('i2i', ['nano-banana-edit', 'flux-kontext-pro-i2i']);
    const output = createNode('result');
    return {
      nodes: [source, change, style, firstEdit, combiner, secondEdit, output],
      edges: [
        edge(source, firstEdit, 'image'),
        edge(change, firstEdit, 'prompt'),
        edge(style, combiner, 'var:style'),
        edge(firstEdit, secondEdit, 'image'),
        edge(combiner, secondEdit, 'prompt'),
        edge(secondEdit, output, 'in'),
      ],
    };
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATE_BUILDERS);

/** A fresh, laid-out graph for a template ({ nodes, edges }). */
export function buildTemplate(templateId) {
  const builder = TEMPLATE_BUILDERS[templateId];
  if (!builder) return null;
  const { nodes, edges } = builder();
  return { nodes: layoutGraph(nodes, edges), edges };
}
