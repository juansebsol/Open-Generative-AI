// WaveSpeedAI v3 API: https://wavespeed.ai/docs

import { ProviderError, requestJson } from '../http.js';
import { extractOutputs } from '../outputs.js';

const API_HOST = 'https://api.wavespeed.ai/api/v3';

const authHeaders = (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

function unwrap(body) {
  // WaveSpeed wraps payloads as { code, message, data }.
  if (body && typeof body === 'object' && 'data' in body) {
    if (body.code && body.code !== 200) {
      throw new ProviderError(`WaveSpeed: ${body.message || `error ${body.code}`}`, { provider: 'wavespeed', status: 502 });
    }
    return body.data;
  }
  return body;
}

export async function submit({ endpoint, input, key }) {
  const data = unwrap(await requestJson('wavespeed', `${API_HOST}/${endpoint}`, {
    method: 'POST',
    headers: authHeaders(key),
    body: JSON.stringify(input),
  }));
  if (!data?.id) throw new ProviderError('WaveSpeed did not return a prediction id', { provider: 'wavespeed' });
  return { handle: { provider: 'wavespeed', id: data.id }, state: 'queued' };
}

export async function poll({ handle, key }) {
  if (!/^[\w-]+$/.test(String(handle.id || ''))) {
    throw new ProviderError('Invalid WaveSpeed job handle', { status: 400, provider: 'wavespeed' });
  }
  const data = unwrap(await requestJson('wavespeed', `${API_HOST}/predictions/${handle.id}/result`, {
    headers: authHeaders(key),
    timeoutMs: 30_000,
  }));
  const state = String(data?.status || '').toLowerCase();
  if (state === 'completed' || state === 'succeeded') {
    const outputs = extractOutputs({ outputs: data.outputs });
    if (outputs.length === 0) return { state: 'failed', error: 'WaveSpeed finished without returning any media.' };
    return { state: 'succeeded', outputs, raw: data };
  }
  if (state === 'failed' || state === 'error' || state === 'canceled' || state === 'cancelled') {
    return { state: 'failed', error: data?.error || 'WaveSpeed generation failed.' };
  }
  return { state: state === 'created' ? 'queued' : 'running' };
}

export async function createUpload({ key, fileName, contentType, size }) {
  const data = unwrap(await requestJson('wavespeed', `${API_HOST}/media/uploads`, {
    method: 'POST',
    headers: authHeaders(key),
    body: JSON.stringify({
      filename: fileName || `upload-${Date.now()}`,
      ...(size ? { size } : {}),
      ...(contentType ? { content_type: contentType } : {}),
    }),
  }));
  if (!data?.upload?.url || !data?.download_url) {
    throw new ProviderError('WaveSpeed did not return an upload URL', { provider: 'wavespeed' });
  }
  return {
    uploadUrl: data.upload.url,
    method: data.upload.method || 'PUT',
    headers: data.upload.headers || {},
    fileUrl: data.download_url,
  };
}
