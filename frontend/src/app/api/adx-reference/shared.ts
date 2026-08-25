import { NextRequest } from 'next/server';

export function requestIsSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const requestHost = forwardedHost || request.headers.get('host')?.split(',')[0]?.trim();
    return Boolean(requestHost) && new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}
