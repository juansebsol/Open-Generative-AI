// POST /api/chat  { provider, body }  + header x-provider-key
// Forwards an OpenAI-style chat completion (messages, tools, response_format)
// to OpenRouter, OpenAI or Gemini with the visitor's key.

import { chatCompletion } from 'studio/providers/server';
import { assertSameOrigin, errorResponse, json, providerKey, readJson } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { provider, body } = await readJson(request);
    const origin = request.headers.get('origin') || undefined;
    return json(await chatCompletion({ provider, key: providerKey(request), body, origin }));
  } catch (error) {
    return errorResponse(error);
  }
}
