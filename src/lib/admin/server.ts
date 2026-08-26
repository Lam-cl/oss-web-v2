import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, verifySessionCookie } from './session';

export const BUNDLE_API = (process.env.BUNDLE_API_URL || 'https://bundleapi.tonewow.com/api').replace(/\/$/, '');

export function requestIsSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  if (!forwardedHost) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === forwardedHost && parsed.protocol === `${forwardedProto}:`;
  } catch {
    return false;
  }
}

export async function getAdminSession(request: NextRequest) {
  return verifySessionCookie(request.cookies.get(ADMIN_COOKIE)?.value);
}

export function safeError(status: number, payload?: unknown) {
  let message = 'The request could not be processed. Please try again.';
  if (status === 400) message = 'The submitted information is incomplete or invalid.';
  if (status === 401) message = 'Your session has expired. Please sign in again.';
  if (status === 403) message = 'Your account does not have permission to perform this action.';
  if (status === 404) message = 'The requested record was not found.';
  if (status === 409) message = 'This information conflicts with an existing record.';
  if (status === 413) message = 'The uploaded file is too large.';
  if (status >= 500) message = 'The Bundle API service is temporarily unavailable. Please try again shortly.';

  if (payload && typeof payload === 'object') {
    const native = (payload as { message?: unknown }).message;
    if (typeof native === 'string' && native.length <= 240 && !/password|token|secret|hash|sql|stack/i.test(native)) message = native;
    if (Array.isArray(native) && native.every((item) => typeof item === 'string')) message = native.slice(0, 4).join('. ');
  }
  return NextResponse.json({ message }, { status });
}

export async function readUpstream(response: Response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) return response.json().catch(() => null);
  return response.text().catch(() => '');
}

export function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/password|passwordHash|token|accessToken|refreshToken|secret|credential|puk/i.test(key))
    .map(([key, item]) => [key, sanitizePayload(item)]));
}
