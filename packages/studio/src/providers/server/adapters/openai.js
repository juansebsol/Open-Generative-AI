// OpenAI Images API: https://platform.openai.com/docs/api-reference/images

import { loadMedia, ProviderError, requestJson, toDataUrl } from '../http.js';
import { collectImages, imageCount, requirePrompt } from './direct.js';
import { openaiUsageCost } from '../usage.js';

const API_HOST = 'https://api.openai.com/v1';

const LEGACY_SIZE_MODELS = /^gpt-image-1/;
// GPT Image 2+ take any WIDTHxHEIGHT in multiples of 16 with a ratio between
// 1:3 and 3:1 and 655,360-8,294,400 pixels.
const AREA_BY_RESOLUTION = { '1K': 1024 * 1024, '2K': 2048 * 2048, '4K': 3840 * 2160 };

function sizeFor(model, aspectRatio, resolution) {
  const [w, h] = String(aspectRatio || '').split(':').map(Number);
  if (!w || !h) return 'auto';
  if (LEGACY_SIZE_MODELS.test(model)) {
    if (Math.abs(w - h) < 0.01) return '1024x1024';
    return w > h ? '1536x1024' : '1024x1536';
  }
  const ratio = Math.min(Math.max(w / h, 1 / 3), 3);
  const area = AREA_BY_RESOLUTION[String(resolution || '').toUpperCase()] || AREA_BY_RESOLUTION['1K'];
  let height = Math.floor(Math.sqrt(area / ratio) / 16) * 16;
  let width = Math.floor((height * ratio) / 16) * 16;
  const scale = Math.min(1, 3840 / Math.max(width, height));
  width = Math.floor((width * scale) / 16) * 16;
  height = Math.floor((height * scale) / 16) * 16;
  return `${width}x${height}`;
}

function qualityFor(value) {
  const quality = String(value || '').toLowerCase();
  return ['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(quality) ? quality : undefined;
}

// WebP keeps base64 responses small enough for serverless response limits.
const OUTPUT = { output_format: 'webp', output_compression: 95 };

function toOutputs(data) {
  const outputs = (data?.data || [])
    .filter((item) => item.b64_json || item.url)
    .map((item) => ({ url: item.b64_json ? toDataUrl(`image/${OUTPUT.output_format}`, item.b64_json) : item.url, type: 'image' }));
  if (outputs.length === 0) throw new ProviderError('OpenAI returned no image.', { provider: 'openai', status: 422 });
  return outputs;
}

export async function submit({ endpoint, input: payload, key }) {
  const prompt = requirePrompt(payload, 'OpenAI');
  const images = collectImages(payload);
  const common = { model: endpoint, prompt, n: imageCount(payload), size: sizeFor(endpoint, payload.aspect_ratio, payload.resolution), ...OUTPUT };
  const quality = qualityFor(payload.quality);

  let data;
  if (images.length === 0) {
    data = await requestJson('openai', `${API_HOST}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...common, ...(quality ? { quality } : {}) }),
      timeoutMs: 280_000,
    });
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries(common)) form.append(name, String(value));
    if (quality) form.append('quality', quality);
    for (const [index, image] of images.slice(0, 16).entries()) {
      const { mimeType, base64 } = await loadMedia(image);
      const extension = mimeType.split('/')[1] || 'png';
      form.append('image[]', new Blob([Buffer.from(base64, 'base64')], { type: mimeType }), `image-${index}.${extension}`);
    }
    data = await requestJson('openai', `${API_HOST}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      timeoutMs: 280_000,
    });
  }

  // The Images API reports the tokens it billed; the ledger prefers that to the quote.
  const cost = openaiUsageCost(endpoint, data?.usage);
  return { handle: { provider: 'openai', id: `openai-${Date.now()}` }, state: 'succeeded', outputs: toOutputs(data), ...(cost !== null ? { cost } : {}) };
}
