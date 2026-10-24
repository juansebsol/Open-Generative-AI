import { NextResponse } from 'next/server';
import { getLocaleFromPathname } from './lib/locales';

const isDev = process.env.NODE_ENV !== 'production';

// connect-src allows https: because the browser PUTs uploads straight to the
// provider's signed storage URL (fal, WaveSpeed) and downloads results from
// provider CDNs, and allows plain http only to this machine for local
// engines (ComfyUI, sd-server) that the visitor runs themselves.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*",
    "media-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*",
    `connect-src 'self' blob: https: http://localhost:* http://127.0.0.1:*${isDev ? ' ws:' : ''}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');

function addSecurityHeaders(response) {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return response;
}

export function middleware(request) {
    // The root layout reads the locale from this header (see lib/locales.js).
    const response = NextResponse.next();
    response.headers.set('x-locale', getLocaleFromPathname(request.nextUrl.pathname));
    return addSecurityHeaders(response);
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|__nextjs_original-stack-frame).*)',
    ],
};
