// Server-side job orchestration used by app/api/{generate,jobs,uploads}.
// The visitor's provider key arrives with each request and is only used for
// that request: nothing here stores or logs it.

import { findRoute } from '../catalog/index.js';
import { SCHEMAS } from '../catalog/schemas.generated.js';
import { DIRECT_PROVIDERS, CLOUD_PROVIDER_IDS } from '../directProviders.js';
import { mapInput, MappingError } from '../mapper.js';
import { ProviderError, assertPublicHttpsUrl } from './http.js';
import * as fal from './adapters/fal.js';
import * as wavespeed from './adapters/wavespeed.js';
import * as google from './adapters/google.js';
import * as openai from './adapters/openai.js';
import * as openrouter from './adapters/openrouter.js';

const ADAPTERS = { fal, wavespeed, google, openai, openrouter };

export { ProviderError, MappingError, assertPublicHttpsUrl };

function adapterFor(provider) {
  if (!CLOUD_PROVIDER_IDS.includes(provider) || !ADAPTERS[provider]) {
    throw new ProviderError(`Unknown provider "${provider}"`, { status: 400 });
  }
  return ADAPTERS[provider];
}

function requireKey(provider, key) {
  if (typeof key !== 'string' || key.trim().length < 8) {
    throw new ProviderError(`Add your ${provider} API key in Settings → Providers.`, { status: 401, provider });
  }
  return key.trim();
}

// Resolves the catalog route, maps the studio payload and submits the job.
export async function submitJob({ endpoint, provider, payload, key, origin }) {
  const route = findRoute(endpoint, provider);
  if (!route) throw new ProviderError(`${endpoint} is not available on ${provider}`, { status: 400 });
  const adapter = adapterFor(provider);
  const apiKey = requireKey(provider, key);

  if (DIRECT_PROVIDERS.has(provider)) {
    return adapter.submit({ endpoint: route.endpoint, input: payload, key: apiKey, origin });
  }

  const schema = SCHEMAS[provider]?.[route.endpoint] || null;
  const { input, warnings } = mapInput(payload, route, schema);
  const result = await adapter.submit({ endpoint: route.endpoint, input, key: apiKey, origin });
  return { ...result, warnings };
}

export async function pollJob({ handle, key }) {
  if (!handle || typeof handle !== 'object') throw new ProviderError('Missing job handle', { status: 400 });
  const adapter = adapterFor(handle.provider);
  if (!adapter.poll) throw new ProviderError(`${handle.provider} jobs finish immediately`, { status: 400 });
  return adapter.poll({ handle, key: requireKey(handle.provider, key) });
}

export async function cancelJob({ handle, key }) {
  const adapter = adapterFor(handle?.provider);
  if (adapter.cancel) await adapter.cancel({ handle, key: requireKey(handle.provider, key) });
}

export async function createUpload({ provider, key, fileName, contentType, size }) {
  const adapter = adapterFor(provider);
  if (!adapter.createUpload) throw new ProviderError(`${provider} does not offer file storage`, { status: 400 });
  return adapter.createUpload({ key: requireKey(provider, key), fileName, contentType, size });
}

// Maps any thrown error to an HTTP status + safe message for the browser.
export function toErrorResponse(error) {
  if (error instanceof MappingError) return { status: 400, message: error.message };
  if (error instanceof ProviderError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 502;
    return { status, message: error.message };
  }
  if (error?.status === 400) return { status: 400, message: error.message };
  return { status: 500, message: 'Unexpected server error' };
}
