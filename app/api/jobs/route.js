// POST /api/jobs  { handle, action? }  + header x-provider-key
// Polls (default) or cancels a queued provider job.

import { cancelJob, pollJob } from 'studio/providers/server';
import { assertSameOrigin, errorResponse, json, providerKey, readJson } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { handle, action } = await readJson(request);
    if (action === 'cancel') {
      await cancelJob({ handle, key: providerKey(request) });
      return json({ state: 'cancelled' });
    }
    return json(await pollJob({ handle, key: providerKey(request) }));
  } catch (error) {
    return errorResponse(error);
  }
}
