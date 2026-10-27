// Google Gemini API image generation (Nano Banana family):
// https://ai.google.dev/gemini-api/docs/image-generation

import { loadMedia, requestJson, toDataUrl, ProviderError } from '../http.js';
import { collectImages, imageCount, requirePrompt } from './direct.js';
import { googleUsageCost, sumCosts } from '../usage.js';

const API_HOST = 'https://generativelanguage.googleapis.com/v1beta';
const ASPECT_RATIOS = new Set(['1:1', '1:4', '4:1', '1:8', '8:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);

function imageSize(resolution) {
  const value = String(resolution || '').toUpperCase();
  if (value === '512' || value === '0.5K') return '512';
  if (value.startsWith('4')) return '4K';
  if (value.startsWith('2')) return '2K';
  if (value.startsWith('1')) return '1K';
  return undefined;
}

async function generateOnce({ endpoint, key, prompt, images, payload }) {
  const parts = [{ text: prompt }];
  for (const image of images) {
    const { mimeType, base64 } = await loadMedia(image);
    parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }

  const imageConfig = {};
  if (ASPECT_RATIOS.has(payload.aspect_ratio)) imageConfig.aspectRatio = payload.aspect_ratio;
  const size = imageSize(payload.resolution || payload.quality);
  if (size) imageConfig.imageSize = size;

  const data = await requestJson('google', `${API_HOST}/models/${encodeURIComponent(endpoint)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
      },
    }),
    timeoutMs: 240_000,
  });

  const outputs = [];
  for (const candidate of data?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) outputs.push({ url: toDataUrl(inline.mimeType || inline.mime_type || 'image/png', inline.data), type: 'image' });
    }
  }
  if (outputs.length === 0) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
    throw new ProviderError(`Gemini returned no image${reason ? ` (${reason})` : ''}.`, { provider: 'google', status: 422 });
  }
  return { outputs, cost: googleUsageCost(endpoint, data?.usageMetadata) };
}

export async function submit({ endpoint, input: payload, key }) {
  const prompt = requirePrompt(payload, 'Gemini');
  const images = collectImages(payload);
  const count = imageCount(payload);
  const outputs = [];
  const costs = [];
  for (let i = 0; i < count; i++) {
    const result = await generateOnce({ endpoint, key, prompt, images, payload });
    outputs.push(...result.outputs);
    costs.push(result.cost);
  }
  // usageMetadata lists the billed image tokens; summed when every call had it.
  const cost = sumCosts(costs);
  return { handle: { provider: 'google', id: `google-${Date.now()}` }, state: 'succeeded', outputs, ...(cost !== null ? { cost } : {}) };
}
