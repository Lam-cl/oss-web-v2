import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const WEBFLOW_ORIGINS = new Set([
  'https://tonewow.com',
  'https://www.tonewow.com',
]);

function requestHost(request: NextRequest) {
  return request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || request.headers.get('host')?.split(',')[0]?.trim()
    || '';
}

export function merdekaAllowedOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return null;
    return parsed.host === requestHost(request) || WEBFLOW_ORIGINS.has(parsed.origin) ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function merdekaSameOrigin(request: NextRequest) {
  return Boolean(merdekaAllowedOrigin(request));
}

export function merdekaCors(request: NextRequest, response: NextResponse) {
  const origin = merdekaAllowedOrigin(request);
  if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.append('Vary', 'Origin');
  return response;
}

export function merdekaPreflight(request: NextRequest, methods: string) {
  const origin = merdekaAllowedOrigin(request);
  if (!origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  });
}

export function merdekaPublicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host')?.split(',')[0]?.trim();
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  if (host && !host.startsWith('localhost') && !host.startsWith('127.')) return `${proto}://${host}`;
  return request.nextUrl.origin;
}

export function merdekaPublicPage() {
  const configured = process.env.MERDEKA_PROMO_PUBLIC_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' && (url.hostname === 'tonewow.com' || url.hostname === 'www.tonewow.com')) return url;
    } catch {
      // Fall through to the production-safe public campaign URL.
    }
  }
  return new URL('https://www.tonewow.com/malaysia-promo');
}
