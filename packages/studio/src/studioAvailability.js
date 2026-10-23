// Which studios have at least one model served by a supported provider.
// The shell hides studios that would otherwise open with nothing to run.

import {
  ALL_MODEL_LISTS,
  audioModels,
  i2iModels,
  i2vModels,
  lipsyncModels,
  motionControlModels,
  recastModels,
  t2iModels,
  t2vModels,
  v2vModels,
} from './models.js';
import { hasRoute } from './providers/catalog/index.js';

function endpointForModelId(id) {
  for (const models of Object.values(ALL_MODEL_LISTS)) {
    const model = models.find((entry) => entry.id === id);
    if (model) return model.endpoint || model.id;
  }
  return id;
}

const modelAvailable = (id) => hasRoute(endpointForModelId(id));

// Hard-coded endpoints used by studios outside the model pickers
// (see generation.js and the studio components).
const STUDIO_REQUIREMENTS = {
  image: () => t2iModels.length > 0 || i2iModels.length > 0,
  layers: () => ['bytedance-seedream-5.0-pro-layer', 'topaz-image-upscale', 'seedvr2-image-upscale', 'ai-image-upscale', 'ai-background-remover', 'ai-image-extension'].some(hasRoute),
  video: () => t2vModels.length > 0 || i2vModels.length > 0 || v2vModels.length > 0,
  audio: () => audioModels.length > 0,
  'motion-control': () => motionControlModels.length > 0,
  lipsync: () => lipsyncModels.length > 0,
  'body-swap': () => recastModels.length > 0,
  cinema: () => modelAvailable('nano-banana-pro'),
  marketing: () => hasRoute('seedance-2-vip-omni-reference') || hasRoute('sd-2-vip-omni-reference-1080p'),
  'ai-influencer': () => modelAvailable('nano-banana-pro'),
  clipping: () => v2vModels.some((model) => model.family === 'ai-clipping'),
  // Runs in the browser with a chat model; shows a key prompt when none is set.
  'vibe-motion': () => true,
  // Always shown: without a chat key the studio explains how to add one.
  agents: () => true,
  // The board works offline; the chat prompts for a key when none is set.
  'design-agent': () => true,
};

export function isStudioAvailable(tabId) {
  const check = STUDIO_REQUIREMENTS[tabId];
  return check ? check() : true;
}
