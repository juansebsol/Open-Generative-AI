// OpenRouter image generation through chat completions with image output:
// https://openrouter.ai/docs/features/multimodal/image-generation

import { ProviderError, requestJson } from '../http.js';
import { collectImages, imageCount, requirePrompt } from './direct.js';

const API_HOST = 'https://openrouter.ai/api/v1';

async function generateOnce({ endpoint, key, prompt, images, payload, referer }) {
  const content = [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))];
  const data = await requestJson('openrouter', `${API_HOST}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Openstudio',
      ...(referer ? { 'HTTP-Referer': referer } : {}),
    },
    body: JSON.stringify({
      model: endpoint,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
      // Returns the actual charge in usage.cost, which the spend ledger records.
      usage: { include: true },
      ...(payload.aspect_ratio ? { image_config: { aspect_ratio: payload.aspect_ratio } } : {}),
    }),
    timeoutMs: 280_000,
  });

  const outputs = [];
  for (const choice of data?.choices || []) {
    for (const image of choice?.message?.images || []) {
      const url = image?.image_url?.url || image?.url;
      if (url) outputs.push({ url, type: 'image' });
    }
  }
  if (outputs.length === 0) {
    const text = data?.choices?.[0]?.message?.content;
    throw new ProviderError(`OpenRouter returned no image${text ? `: ${String(text).slice(0, 160)}` : '.'}`, { provider: 'openrouter', status: 422 });
  }
  const cost = Number(data?.usage?.cost);
  return { outputs, cost: Number.isFinite(cost) ? cost : null };
}

export async function submit({ endpoint, input: payload, key, origin }) {
  const prompt = requirePrompt(payload, 'OpenRouter');
  const images = collectImages(payload);
  const outputs = [];
  let cost = 0;
  let costKnown = true;
  for (let i = 0; i < imageCount(payload); i++) {
    const result = await generateOnce({ endpoint, key, prompt, images, payload, referer: origin });
    outputs.push(...result.outputs);
    if (result.cost === null) costKnown = false;
    else cost += result.cost;
  }
  return { handle: { provider: 'openrouter', id: `openrouter-${Date.now()}` }, state: 'succeeded', outputs, ...(costKnown ? { cost } : {}) };
}
