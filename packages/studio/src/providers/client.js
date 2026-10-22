// Browser-side runner: picks a route for a catalog endpoint based on which
// providers this visitor configured, submits through /api/generate, polls
// /api/jobs, and returns the result in the shape the studios expect
// ({ url, outputs, images, request_id, provider }).

import { getRoutes } from './catalog/index.js';
import { getProvider } from './directProviders.js';
import { configuredProviders, getProviderKey, getProviderOptions, getProviderUrl } from './keys.js';
import { runComfyUI } from './local/comfyui.js';
import { runSdServer } from './local/sdserver.js';

const STORAGE_PROVIDERS = ['fal', 'wavespeed'];
const INLINE_UPLOAD_LIMIT = 8 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

export class ProviderSetupError extends Error {
  constructor(message, providers = []) {
    super(message);
    this.name = 'ProviderSetupError';
    this.providers = providers;
  }
}

function notifySetupNeeded(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('oga:provider-setup-needed', { detail }));
}

function providerLabels(ids) {
  return ids.map((id) => getProvider(id)?.label || id);
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || '';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

// The first route whose provider this visitor configured, honouring their
// provider order in Settings.
export function pickRoute(endpoint) {
  const routes = getRoutes(endpoint);
  if (routes.length === 0) {
    throw new ProviderSetupError(`This model isn't available through any supported provider yet.`);
  }
  const configured = configuredProviders();
  for (const provider of configured) {
    const route = routes.find((candidate) => candidate.provider === provider);
    if (route) return route;
  }
  const needed = [...new Set(routes.map((route) => route.provider))];
  notifySetupNeeded({ providers: needed });
  throw new ProviderSetupError(`Add a ${joinLabels(providerLabels(needed))} key in Settings → Providers to use this model.`, needed);
}

export function isEndpointAvailable(endpoint) {
  const configured = new Set(configuredProviders());
  return getRoutes(endpoint).some((route) => configured.has(route.provider));
}

async function postJson(path, body, key) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-provider-key': key } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) notifySetupNeeded({ providers: [body.provider || body.handle?.provider] });
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(header)?.[1] || 'application/octet-stream';
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type: mime });
}

// Direct providers return base64 images. When the visitor has fal or
// WaveSpeed storage, move them there so history keeps a small URL.
async function rehostInlineOutputs(outputs) {
  const storage = STORAGE_PROVIDERS.find((id) => configuredProviders().includes(id));
  if (!storage) return outputs;
  return Promise.all(outputs.map(async (output) => {
    if (!output.url.startsWith('data:')) return output;
    try {
      const blob = dataUrlToBlob(output.url);
      const extension = blob.type.split('/')[1] || 'png';
      const url = await uploadToProvider(storage, new File([blob], `output-${Date.now()}.${extension}`, { type: blob.type }));
      return { ...output, url };
    } catch {
      return output;
    }
  }));
}

function toStudioResult(handle, outputs, raw) {
  const urls = outputs.map((output) => output.url);
  return {
    ...(raw && typeof raw === 'object' ? { raw } : {}),
    request_id: handle?.id,
    id: handle?.id,
    provider: handle?.provider,
    status: 'completed',
    url: urls[0],
    outputs: urls,
    images: outputs.filter((output) => output.type === 'image').map((output) => output.url),
    media: outputs,
  };
}

async function runLocal(route, payload, onRequestId) {
  const baseUrl = getProviderUrl(route.provider);
  const options = getProviderOptions(route.provider);
  const result = route.provider === 'comfyui'
    ? await runComfyUI({ baseUrl, options, payload, onRequestId })
    : await runSdServer({ baseUrl, payload, onRequestId });
  return toStudioResult(result.handle, result.outputs);
}

/**
 * Runs one catalog endpoint with the visitor's configured providers.
 * @param {string} endpoint catalog endpoint slug
 * @param {object} payload  studio payload (shared vocabulary)
 * @param {{ onRequestId?: Function, maxAttempts?: number, interval?: number }} options
 */
export async function runEndpoint(endpoint, payload, { onRequestId, maxAttempts = 900, interval = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const route = pickRoute(endpoint);
  if (getProvider(route.provider)?.kind === 'local') return runLocal(route, payload, onRequestId);

  const key = getProviderKey(route.provider);
  const submitted = await postJson('/api/generate', { endpoint, provider: route.provider, payload }, key);
  if (submitted.warnings?.length && typeof console !== 'undefined') {
    console.info(`[providers] ${endpoint} via ${route.provider}:`, submitted.warnings.join('; '));
  }
  onRequestId?.(submitted.handle?.id);

  if (submitted.state === 'succeeded') {
    return toStudioResult(submitted.handle, await rehostInlineOutputs(submitted.outputs || []));
  }

  let transientFailures = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await wait(attempt < 5 ? interval : Math.max(interval, 3000));
    let status;
    try {
      status = await postJson('/api/jobs', { handle: submitted.handle }, key);
      transientFailures = 0;
    } catch (error) {
      if ((error.status >= 500 || !error.status) && ++transientFailures < 5) continue;
      throw error;
    }
    if (status.state === 'succeeded') return toStudioResult(submitted.handle, status.outputs || [], status.raw);
    if (status.state === 'failed') {
      const error = new Error(`Generation failed: ${status.error || 'unknown error'}`);
      error.requestId = submitted.handle?.id;
      throw error;
    }
  }
  const error = new Error(`Generation timed out. Request ID: ${submitted.handle?.id}`);
  error.requestId = submitted.handle?.id;
  throw error;
}

function putWithProgress({ uploadUrl, method, headers }, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method || 'PUT', uploadUrl);
    for (const [name, value] of Object.entries(headers || {})) xhr.setRequestHeader(name, value);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.min(Math.round((event.loaded / event.total) * 100), 99));
      };
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Please try again.'));
    xhr.send(file);
  });
}

async function uploadToProvider(provider, file, onProgress) {
  const ticket = await postJson('/api/uploads', {
    provider,
    fileName: file.name || `upload-${Date.now()}`,
    contentType: file.type || 'application/octet-stream',
    size: file.size,
  }, getProviderKey(provider));
  await putWithProgress(ticket, file, onProgress);
  onProgress?.(100);
  return ticket.fileUrl;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a reference file and returns a URL models can read. Uses fal or
 * WaveSpeed storage when configured (bytes go straight from the browser to
 * the provider); otherwise falls back to an inline data URL for small files.
 */
export async function uploadMedia(file, onProgress) {
  const storages = STORAGE_PROVIDERS.filter((id) => configuredProviders().includes(id));
  let lastError = null;
  for (const provider of storages) {
    try {
      return await uploadToProvider(provider, file, onProgress);
    } catch (error) {
      lastError = error;
    }
  }
  if (file.size <= INLINE_UPLOAD_LIMIT) {
    const url = await readAsDataUrl(file);
    onProgress?.(100);
    return url;
  }
  if (lastError) throw lastError;
  notifySetupNeeded({ providers: STORAGE_PROVIDERS });
  throw new ProviderSetupError('Add a fal.ai or WaveSpeed key in Settings → Providers to upload files larger than 8 MB.', STORAGE_PROVIDERS);
}
