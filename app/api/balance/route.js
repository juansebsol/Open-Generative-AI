// POST /api/balance  { provider }  + header x-provider-key
// Reads the account balance (or key limit) for fal, WaveSpeed or OpenRouter.

import { getBalance } from 'studio/providers/server';
import { assertSameOrigin, errorResponse, json, providerKey, readJson } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { provider } = await readJson(request);
    return json(await getBalance({ provider, key: providerKey(request) }));
  } catch (error) {
    return errorResponse(error);
  }
}
