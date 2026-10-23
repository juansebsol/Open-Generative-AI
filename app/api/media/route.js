// GET /api/media?url=<provider media URL>
// Streams a generated file from a provider CDN that doesn't allow
// cross-origin reads (e.g. WaveSpeed), so the browser can save a local copy.
// Only known provider media hosts are allowed; extra hosts can be added with
// MEDIA_PROXY_ALLOWED_HOSTS (comma-separated host suffixes).

import { NextResponse } from 'next/server';
import { assertPublicHttpsUrl } from 'studio/providers/server';
import { errorResponse } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_HOST_SUFFIXES = ['fal.media', 'fal.ai', 'fal.run', 'wavespeed.ai'];
const ALLOWED_TYPES = /^(image|video|audio)\/|^application\/octet-stream/;
const MAX_BYTES = 1024 * 1024 * 1024;

function allowedHost(hostname) {
  const extra = (process.env.MEDIA_PROXY_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_HOST_SUFFIXES, ...extra].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

export async function GET(request) {
  // Only this app's own pages may use the proxy.
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 });
  }

  try {
    const target = await assertPublicHttpsUrl(new URL(request.url).searchParams.get('url') || '');
    if (!allowedHost(target.hostname.toLowerCase())) {
      return NextResponse.json({ error: `Media host ${target.hostname} is not allowed` }, { status: 400 });
    }

    const upstream = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(280_000) });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Media download failed (${upstream.status})` }, { status: 502 });
    }
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    const length = Number(upstream.headers.get('content-length') || 0);
    if (!ALLOWED_TYPES.test(type) || length > MAX_BYTES) {
      return NextResponse.json({ error: 'Not a media file' }, { status: 400 });
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': type,
        ...(length ? { 'Content-Length': String(length) } : {}),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
