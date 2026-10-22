// POST /api/generate  { endpoint, provider, payload }  + header x-provider-key
// Maps the studio payload onto the provider route and submits the job.
// Queue providers return a handle to poll via /api/jobs; direct image
// providers (Gemini, OpenAI, OpenRouter) return finished outputs.

import { submitJob } from 'studio/providers/server';
import { assertSameOrigin, errorResponse, json, providerKey, readJson } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { endpoint, provider, payload } = await readJson(request);
    if (typeof endpoint !== 'string' || typeof provider !== 'string') {
      return json({ error: 'endpoint and provider are required' }, { status: 400 });
    }
    const origin = request.headers.get('origin') || undefined;
    const result = await submitJob({ endpoint, provider, payload: payload || {}, key: providerKey(request), origin });
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
