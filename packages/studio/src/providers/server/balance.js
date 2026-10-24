// Account balance lookups for the Providers panel. Each one is a read-only
// call to the provider's own billing endpoint with the visitor's key.

import { ProviderError, requestJson } from './http.js';

const TIMEOUT_MS = 15_000;
const UNAUTHORIZED = new Set([401, 403]);

export const BALANCE_PROVIDER_IDS = ['fal', 'wavespeed', 'openrouter', 'elevenlabs'];

const usd = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

async function wavespeedBalance(key) {
  const body = await requestJson('wavespeed', 'https://api.wavespeed.ai/api/v3/balance', {
    headers: { Authorization: `Bearer ${key}` },
    timeoutMs: TIMEOUT_MS,
  });
  return { kind: 'balance', amount: usd(body?.data?.balance), currency: 'USD' };
}

// Account credits need a management key; a regular key can still report its
// own spending cap or usage.
async function openrouterBalance(key) {
  const headers = { Authorization: `Bearer ${key}` };
  try {
    const { data } = await requestJson('openrouter', 'https://openrouter.ai/api/v1/credits', { headers, timeoutMs: TIMEOUT_MS });
    return { kind: 'balance', amount: usd(data?.total_credits - data?.total_usage), currency: 'USD' };
  } catch (error) {
    if (!UNAUTHORIZED.has(error.status)) throw error;
  }
  const { data } = await requestJson('openrouter', 'https://openrouter.ai/api/v1/key', { headers, timeoutMs: TIMEOUT_MS });
  if (data?.limit_remaining !== null && data?.limit_remaining !== undefined) {
    return { kind: 'keyLimit', amount: usd(data.limit_remaining), currency: 'USD' };
  }
  return { kind: 'usage', amount: usd(data?.usage), currency: 'USD' };
}

// fal only reports billing to admin keys.
async function falBalance(key) {
  try {
    const body = await requestJson('fal', 'https://api.fal.ai/v1/account/billing?expand=credits', {
      headers: { Authorization: `Key ${key}` },
      timeoutMs: TIMEOUT_MS,
    });
    return { kind: 'balance', amount: usd(body?.credits?.current_balance), currency: body?.credits?.currency || 'USD' };
  } catch (error) {
    if (UNAUTHORIZED.has(error.status)) return { kind: 'needsAdminKey' };
    throw error;
  }
}

// ElevenLabs plans are metered in characters per billing period.
async function elevenlabsBalance(key) {
  const body = await requestJson('elevenlabs', 'https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': key },
    timeoutMs: TIMEOUT_MS,
  });
  const used = Number(body?.character_count) || 0;
  const limit = Number(body?.character_limit) || 0;
  return { kind: 'characters', used, limit, remaining: Math.max(0, limit - used), tier: body?.tier || '' };
}

const LOOKUPS = { fal: falBalance, wavespeed: wavespeedBalance, openrouter: openrouterBalance, elevenlabs: elevenlabsBalance };

export async function getBalance({ provider, key }) {
  const lookup = LOOKUPS[provider];
  if (!lookup) throw new ProviderError(`${provider} has no balance lookup`, { status: 400 });
  if (typeof key !== 'string' || key.trim().length < 8) {
    throw new ProviderError(`Add your ${provider} API key in Settings → Providers.`, { status: 401, provider });
  }
  return lookup(key.trim());
}
