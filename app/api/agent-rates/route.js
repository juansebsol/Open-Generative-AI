// POST /api/agent-rates  { ids: [openrouterId, ...] }
// Per-token rates for the agent models Settings lists (and any OpenRouter id
// the visitor types), live from OpenRouter's public model list, else the
// published table. Needs no key.

import { agentRates } from 'studio/providers/server';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { ids } = await readJson(request);
    if (!Array.isArray(ids)) return json({ error: 'ids is required' }, { status: 400 });
    return json(await agentRates(ids));
  } catch (error) {
    return errorResponse(error);
  }
}
