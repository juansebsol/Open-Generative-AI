// stable-diffusion.cpp sd-server (or any OpenAI-compatible image server):
// POST /v1/images/generations with response_format b64_json.

import { dimensionsFor, localError } from './shared.js';

export async function runSdServer({ baseUrl, payload, onRequestId }) {
  const { width, height } = dimensionsFor(payload.aspect_ratio, 768);
  const body = {
    prompt: String(payload.prompt || ''),
    n: Math.min(Math.max(Number(payload.num_images) || 1, 1), 4),
    size: `${width}x${height}`,
    response_format: 'b64_json',
    ...(payload.negative_prompt ? { negative_prompt: payload.negative_prompt } : {}),
    ...(payload.seed && Number(payload.seed) !== -1 ? { seed: Number(payload.seed) } : {}),
  };

  const id = `sdserver-${Date.now()}`;
  onRequestId?.(id);
  let data;
  try {
    const response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
  } catch (error) {
    throw localError('sdserver', baseUrl, error);
  }

  const outputs = (data?.data || [])
    .map((item) => (item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url))
    .filter(Boolean)
    .map((url) => ({ url, type: 'image' }));
  if (outputs.length === 0) throw new Error('The local image server returned no images.');
  return { handle: { provider: 'sdserver', id }, outputs };
}
