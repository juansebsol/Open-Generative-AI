// fal.ai queue API: https://docs.fal.ai/model-apis/model-endpoints/queue

import { ProviderError, requestJson } from '../http.js';
import { extractOutputs } from '../outputs.js';

const QUEUE_HOST = 'https://queue.fal.run';
const REST_HOST = 'https://rest.fal.ai';

const authHeaders = (key) => ({ Authorization: `Key ${key}`, 'Content-Type': 'application/json' });

// Status/response URLs come back to us from the browser, so only accept ones
// that point at fal's queue host.
function assertQueueUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(`${QUEUE_HOST}/`)) {
    throw new ProviderError('Invalid fal job handle', { status: 400, provider: 'fal' });
  }
  return url;
}

export async function submit({ endpoint, input, key }) {
  const data = await requestJson('fal', `${QUEUE_HOST}/${endpoint}`, {
    method: 'POST',
    headers: authHeaders(key),
    body: JSON.stringify(input),
  });
  if (!data?.request_id) throw new ProviderError('fal did not return a request id', { provider: 'fal' });
  return {
    handle: {
      provider: 'fal',
      id: data.request_id,
      statusUrl: data.status_url,
      responseUrl: data.response_url,
    },
    state: 'queued',
  };
}

export async function poll({ handle, key }) {
  const status = await requestJson('fal', `${assertQueueUrl(handle.statusUrl)}?logs=0`, { headers: authHeaders(key), timeoutMs: 30_000 });
  const state = String(status?.status || '').toUpperCase();
  if (state === 'IN_QUEUE') return { state: 'queued', position: status.queue_position };
  if (state === 'IN_PROGRESS') return { state: 'running' };
  if (state !== 'COMPLETED') return { state: 'running' };
  if (status.error) return { state: 'failed', error: String(status.error) };

  try {
    const result = await requestJson('fal', assertQueueUrl(handle.responseUrl), { headers: authHeaders(key), timeoutMs: 60_000 });
    const outputs = extractOutputs(result);
    if (outputs.length === 0) return { state: 'failed', error: 'fal finished without returning any media.' };
    return { state: 'succeeded', outputs, raw: result };
  } catch (error) {
    if (error instanceof ProviderError && error.status >= 400 && error.status < 500) {
      return { state: 'failed', error: error.message.replace(/^fal \d+: /, '') };
    }
    throw error;
  }
}

export async function cancel({ handle, key }) {
  const url = assertQueueUrl(handle.statusUrl).replace(/\/status$/, '/cancel');
  await requestJson('fal', url, { method: 'PUT', headers: authHeaders(key) }).catch(() => null);
}

// Returns a short-lived URL the browser PUTs the file bytes to.
export async function createUpload({ key, fileName, contentType }) {
  const data = await requestJson('fal', `${REST_HOST}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
    method: 'POST',
    headers: authHeaders(key),
    body: JSON.stringify({ content_type: contentType || 'application/octet-stream', file_name: fileName || `upload-${Date.now()}` }),
  });
  if (!data?.upload_url || !data?.file_url) throw new ProviderError('fal did not return an upload URL', { provider: 'fal' });
  return {
    uploadUrl: data.upload_url,
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    fileUrl: data.file_url,
  };
}
