// Which catalog models the Design Agent uses, preferring ones the visitor's
// configured providers can run.

import { i2iModels, t2iModels } from '../models.js';
import { isEndpointAvailable } from '../providers/client.js';

const IMAGE_PREFERENCE = ['nano-banana-pro', 'nano-banana-2', 'gpt-image-2', 'nano-banana-2-1', 'gpt-image-1.5', 'nano-banana'];
const EDIT_PREFERENCE = ['nano-banana-pro-edit', 'nano-banana-2-edit', 'gpt-image-2-edit', 'nano-banana-2-1-edit', 'gpt-image-1.5-edit', 'nano-banana-edit'];
const UPSCALERS = ['seedvr2-image-upscale', 'ai-image-upscale', 'topaz-image-upscale'];

const editCapable = i2iModels.filter((model) => model.hasPrompt);

export const endpointOf = (model) => model?.endpoint || model?.id;
export const modelAvailable = (model) => Boolean(model) && isEndpointAvailable(endpointOf(model));

function pick(models, preference, overrideId) {
  if (overrideId) {
    const chosen = models.find((model) => model.id === overrideId);
    if (modelAvailable(chosen)) return chosen;
  }
  const preferred = preference.map((id) => models.find((model) => model.id === id)).filter(Boolean);
  return preferred.find(modelAvailable) || models.find(modelAvailable) || null;
}

export const pickImageModel = (overrideId) => pick(t2iModels, IMAGE_PREFERENCE, overrideId);
export const pickEditModel = (overrideId) => pick(editCapable, EDIT_PREFERENCE, overrideId);
export const pickUpscaler = () => UPSCALERS.find(isEndpointAvailable) || null;
export const canRemoveBackground = () => isEndpointAvailable('ai-background-remover');
export const canExpand = () => isEndpointAvailable('ai-image-extension');

export const availableImageModels = () => t2iModels.filter(modelAvailable);
export const availableEditModels = () => editCapable.filter(modelAvailable);

/** How many images an edit model accepts in one request. */
export function maxEditImages(model) {
  if (model?.imageField !== 'images_list') return 1;
  return Math.max(1, model.maxImages || 4);
}

/** The model's highest resolution option at or above 2k, if it has one. */
export function highResolutionOption(model) {
  const options = model?.inputs?.resolution?.enum || [];
  return options.find((value) => /^4k$/i.test(value)) || options.find((value) => /^2k$/i.test(value)) || null;
}
