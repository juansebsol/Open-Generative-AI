// Small HTTP helpers shared by the provider adapters (server-side only).

import dns from 'node:dns/promises';
import net from 'node:net';

export class ProviderError extends Error {
  constructor(message, { status = 502, provider, detail } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
    this.detail = detail;
  }
}

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

function extractMessage(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  const candidates = [
    body.detail?.[0]?.msg,
    typeof body.detail === 'string' ? body.detail : null,
    body.error?.message,
    typeof body.error === 'string' ? body.error : null,
    body.message,
    body.msg,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || JSON.stringify(body).slice(0, 300);
}

// fetch + JSON with a timeout, no redirects, and provider-tagged errors.
export async function requestJson(provider, url, { method = 'GET', headers = {}, body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ProviderError(`${provider} request failed: ${error.message}`, { provider, status: 504 });
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new ProviderError(`${provider} ${response.status}: ${extractMessage(parsed)}`, {
      provider,
      status: response.status,
      detail: parsed,
    });
  }
  return parsed;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const lower = address.toLowerCase();
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
    || lower.startsWith('::ffff:127.') || lower.startsWith('::ffff:10.') || lower.startsWith('::ffff:192.168.');
}

// Media URLs come from the visitor, so before the server fetches one we make
// sure it is public https and does not resolve to a private address.
export async function assertPublicHttpsUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderError('Invalid media URL', { status: 400 });
  }
  if (url.protocol !== 'https:') throw new ProviderError('Media URLs must use https', { status: 400 });
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ProviderError('Media URL host is not allowed', { status: 400 });
  }
  return url;
}

// Returns { mimeType, base64 } for a data: URL or a public https URL.
export async function loadMedia(source) {
  const dataMatch = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(source || '');
  if (dataMatch) {
    const mimeType = dataMatch[1] || 'application/octet-stream';
    const base64 = dataMatch[2] ? dataMatch[3] : Buffer.from(decodeURIComponent(dataMatch[3])).toString('base64');
    return { mimeType, base64 };
  }
  const url = await assertPublicHttpsUrl(source);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new ProviderError(`Could not download input media (${response.status})`, { status: 400 });
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_MEDIA_BYTES) throw new ProviderError('Input media is larger than 25 MB', { status: 413 });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) throw new ProviderError('Input media is larger than 25 MB', { status: 413 });
  return { mimeType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream', base64: buffer.toString('base64') };
}

export function toDataUrl(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}
