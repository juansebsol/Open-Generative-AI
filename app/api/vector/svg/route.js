// POST /api/vector/svg  { provider, model, prompt, page, palette, refine }  + header x-provider-key
// One code-written SVG from a chat model (Gemini, Claude via OpenRouter,
// GPT) for the Vector pages, or a refinement of an existing one when
// `refine: { svg, instruction }` is sent. The markup comes back sanitised,
// with the provider's reported cost when it gives one.

import { generateSvgChat } from 'studio/providers/server';
import { assertSameOrigin, errorResponse, json, providerKey, readJson } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { provider, model, prompt, page, palette, refine } = await readJson(request);
    if (typeof provider !== 'string' || typeof model !== 'string') {
      return json({ error: 'provider and model are required' }, { status: 400 });
    }
    const origin = request.headers.get('origin') || undefined;
    return json(await generateSvgChat({ provider, key: providerKey(request), origin, model, prompt, page, palette, refine }));
  } catch (error) {
    return errorResponse(error);
  }
}
