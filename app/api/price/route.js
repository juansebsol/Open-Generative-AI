// POST /api/price  { provider, endpoint, payload }  + header x-provider-key
// Quotes what one run of a catalog endpoint will cost before it is sent.
// WaveSpeed and fal are asked with the visitor's key; the others come from
// published list prices. Every quote is an estimate.
//
// { provider, requests: [{ endpoint, payload }] } quotes many runs at once
// (the Benchmarks page) and answers { quotes: [...] } in the same order, with
// a failed quote reported inline as { error, status }.

import { getPrice, getPrices } from 'studio/providers/server';
import { assertSameOrigin, errorResponse, json, providerKey, readJson } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { provider, endpoint, payload, requests } = await readJson(request);
    if (typeof provider === 'string' && Array.isArray(requests)) {
      return json({ quotes: await getPrices({ provider, requests, key: providerKey(request) }) });
    }
    if (typeof provider !== 'string' || typeof endpoint !== 'string') {
      return json({ error: 'provider and endpoint are required' }, { status: 400 });
    }
    return json(await getPrice({ provider, endpoint, payload: payload || {}, key: providerKey(request) }));
  } catch (error) {
    return errorResponse(error);
  }
}
