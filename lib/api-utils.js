// Helpers shared by the app/api route handlers.

import { NextResponse } from 'next/server';
import { toErrorResponse } from 'studio/providers/server';

const MAX_BODY_BYTES = 12 * 1024 * 1024;

// Rejects requests coming from another site's page. Browsers always send
// Origin on POST; server-to-server callers without one are allowed through.
export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    if (new URL(origin).host === host) return null;
  } catch {
    // fall through
  }
  return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 });
}

export async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) {
    const error = new Error('Request body is too large');
    error.status = 400;
    throw error;
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    const error = new Error('Request body is too large');
    error.status = 400;
    throw error;
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
}

export function providerKey(request) {
  return request.headers.get('x-provider-key') || '';
}

export function errorResponse(error) {
  const { status, message } = toErrorResponse(error);
  if (status >= 500) console.error('[api]', error?.name || 'Error', error?.message);
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function json(data, init = {}) {
  return NextResponse.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...(init.headers || {}) } });
}
