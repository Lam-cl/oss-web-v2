import { NextRequest } from 'next/server';

export function merdekaSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || request.headers.get('host')?.split(',')[0]?.trim();
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function merdekaPublicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host')?.split(',')[0]?.trim();
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  if (host && !host.startsWith('localhost') && !host.startsWith('127.')) return `${proto}://${host}`;
  return request.nextUrl.origin;
}
