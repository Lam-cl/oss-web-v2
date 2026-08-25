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
  let message = 'Permintaan tidak dapat diproses. Sila cuba lagi.';
  if (status === 400) message = 'Maklumat yang dihantar tidak lengkap atau tidak sah.';
  if (status === 401) message = 'Sesi anda telah tamat. Sila log masuk semula.';
  if (status === 403) message = 'Akaun anda tidak mempunyai kebenaran untuk tindakan ini.';
  if (status === 404) message = 'Rekod yang diminta tidak ditemui.';
  if (status === 409) message = 'Maklumat ini bercanggah dengan rekod sedia ada.';
  if (status === 413) message = 'Fail yang dimuat naik terlalu besar.';
  if (status >= 500) message = 'Perkhidmatan Bundle API sedang bermasalah. Sila cuba sebentar lagi.';

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
    .filter(([key]) => !/password|passwordHash|token|accessToken|refreshToken|secret|credential/i.test(key))
    .map(([key, item]) => [key, sanitizePayload(item)]));
}
