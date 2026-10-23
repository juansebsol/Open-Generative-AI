// ComfyUI connector (browser -> the visitor's ComfyUI). Uses the standard
// txt2img graph with the checkpoint chosen in Settings, or a custom API-format
// workflow the visitor pasted, with {{prompt}}, {{negative_prompt}},
// {{seed}}, {{width}}, {{height}} placeholders.

import { blobToDataUrl, dimensionsFor, localError, randomSeed, wait } from './shared.js';

const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 30 * 60 * 1000;

export async function listCheckpoints(baseUrl) {
  const response = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`);
  if (!response.ok) throw new Error(`ComfyUI returned ${response.status}`);
  const info = await response.json();
  return info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
}

function defaultWorkflow({ checkpoint, prompt, negativePrompt, seed, width, height, batchSize }) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    5: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: batchSize } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['4', 1] } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps: 25, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'openstudio', images: ['8', 0] } },
  };
}

function fillTemplate(template, values) {
  const text = JSON.stringify(JSON.parse(template));
  return JSON.parse(text.replace(/"\{\{(\w+)\}\}"|\{\{(\w+)\}\}/g, (match, quoted, bare) => {
    const name = quoted || bare;
    const value = values[name];
    if (value === undefined) return match;
    if (quoted) return JSON.stringify(value);
    return JSON.stringify(String(value)).slice(1, -1);
  }));
}

export async function runComfyUI({ baseUrl, options = {}, payload, onRequestId }) {
  const seed = payload.seed && Number(payload.seed) !== -1 ? Number(payload.seed) : randomSeed();
  const { width, height } = dimensionsFor(payload.aspect_ratio);
  const values = {
    prompt: String(payload.prompt || ''),
    negative_prompt: String(payload.negative_prompt || ''),
    seed, width, height,
  };

  let graph;
  try {
    if (options.workflow?.trim()) {
      graph = fillTemplate(options.workflow, values);
    } else {
      const checkpoint = options.checkpoint || (await listCheckpoints(baseUrl))[0];
      if (!checkpoint) throw new Error('No checkpoints found in ComfyUI/models/checkpoints');
      graph = defaultWorkflow({
        checkpoint,
        prompt: values.prompt,
        negativePrompt: values.negative_prompt,
        seed, width, height,
        batchSize: Math.min(Math.max(Number(payload.num_images) || 1, 1), 4),
      });
    }
  } catch (error) {
    throw localError('comfyui', baseUrl, error);
  }

  let promptId;
  try {
    const response = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: `oga-${Date.now()}` }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    promptId = data.prompt_id;
  } catch (error) {
    throw localError('comfyui', baseUrl, error);
  }
  onRequestId?.(promptId);

  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    await wait(POLL_INTERVAL_MS);
    const response = await fetch(`${baseUrl}/history/${promptId}`).catch(() => null);
    if (!response?.ok) continue;
    const history = (await response.json())?.[promptId];
    if (!history) continue;
    if (history.status?.status_str === 'error') throw new Error('ComfyUI reported an error while running the workflow.');
    const images = Object.values(history.outputs || {}).flatMap((node) => node.images || []);
    if (images.length === 0) continue;

    // Copy results into data URLs so they survive ComfyUI restarts.
    const outputs = [];
    for (const image of images) {
      const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
      const blob = await (await fetch(`${baseUrl}/view?${query}`)).blob();
      outputs.push({ url: await blobToDataUrl(blob), type: 'image' });
    }
    return { handle: { provider: 'comfyui', id: promptId }, outputs };
  }
  throw new Error('ComfyUI did not finish within 30 minutes.');
}
