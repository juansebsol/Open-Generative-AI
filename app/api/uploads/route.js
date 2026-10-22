// POST /api/uploads  { provider, fileName, contentType, size }  + header x-provider-key
// Returns a short-lived signed URL from the provider's own storage. The
// browser then PUTs the file there directly, so file bytes never pass
// through this server (and Vercel's 4.5 MB body limit doesn't apply).

import { createUpload } from 'studio/providers/server';
import { assertSameOrigin, errorResponse, json, providerKey, readJson } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { provider, fileName, contentType, size } = await readJson(request);
    const safeName = String(fileName || 'upload').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    return json(await createUpload({ provider, key: providerKey(request), fileName: safeName, contentType, size }));
  } catch (error) {
    return errorResponse(error);
  }
}
