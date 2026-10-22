// Catalog entries for the visitor's own local engines. These run straight
// from the browser to the visitor's machine (never through this server).

const ASPECT_RATIO_INPUT = {
  name: 'aspect_ratio',
  title: 'Aspect Ratio',
  type: 'string',
  enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
  default: '1:1',
};

const PROMPT_INPUT = {
  name: 'prompt',
  title: 'Prompt',
  type: 'string',
  description: 'Text prompt describing the image.',
};

export const LOCAL_IMAGE_MODELS = [
  {
    id: 'local-comfyui',
    name: 'ComfyUI (local)',
    endpoint: 'local-comfyui',
    family: 'local',
    provider: 'local',
    provider_name: 'Local',
    description: 'Runs on your own ComfyUI. Configure it in Settings → Providers.',
    inputs: {
      prompt: PROMPT_INPUT,
      aspect_ratio: ASPECT_RATIO_INPUT,
      num_images: { name: 'num_images', title: 'Number of images', type: 'int', default: 1, minValue: 1, maxValue: 4, step: 1 },
    },
  },
  {
    id: 'local-sdserver',
    name: 'sd.cpp server (local)',
    endpoint: 'local-sdserver',
    family: 'local',
    provider: 'local',
    provider_name: 'Local',
    description: 'Runs on your own stable-diffusion.cpp sd-server or another OpenAI-compatible image server.',
    inputs: {
      prompt: PROMPT_INPUT,
      aspect_ratio: ASPECT_RATIO_INPUT,
      num_images: { name: 'num_images', title: 'Number of images', type: 'int', default: 1, minValue: 1, maxValue: 4, step: 1 },
    },
  },
];

export const LOCAL_ROUTES = {
  'local-comfyui': [{ provider: 'comfyui', endpoint: 'txt2img' }],
  'local-sdserver': [{ provider: 'sdserver', endpoint: 'images/generations' }],
};
