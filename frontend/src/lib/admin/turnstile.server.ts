import type { NextRequest } from 'next/server';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ALLOWED_HOSTNAMES = new Set(['tonewow.xifuhalim.com', 'shop.tonewow.com']);
const EXPECTED_ACTION = 'admin_login';

type TurnstilePayload = {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
};

export type AdminTurnstileResult =
  | { ok: true }
  | { ok: false; status: 400 | 503; message: string };

function clientIp(request: NextRequest) {
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || '';
}

export async function verifyAdminTurnstile(request: NextRequest, token: unknown): Promise<AdminTurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const dataApiBase = process.env.TONEWOW_DATA_API_URL?.trim().replace(/\/$/, '');
  const dataApiToken = process.env.TONEWOW_DATA_API_TOKEN?.trim();
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
    return { ok: false, status: 400, message: 'Please complete the security verification.' };
  }

  const ip = clientIp(request);
  let response: Response;
  try {
    if (secret) {
      const body = new URLSearchParams({ secret, response: token.trim() });
      if (ip) body.set('remoteip', ip);
      response = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      });
    } else if (dataApiBase && dataApiToken) {
      response = await fetch(`${dataApiBase}/v1/security/turnstile/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${dataApiToken}` },
        body: JSON.stringify({ token: token.trim(), remoteIp: ip }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
    } else return { ok: false, status: 503, message: 'Security verification is temporarily unavailable.' };
  } catch {
    return { ok: false, status: 503, message: 'Security verification could not be reached. Please try again.' };
  }
  if (!response.ok) return response.status === 400
    ? { ok: false, status: 400, message: 'Security verification failed or expired. Please try again.' }
    : { ok: false, status: 503, message: 'Security verification is temporarily unavailable.' };
  const raw = await response.json().catch(() => null) as (TurnstilePayload & { data?: TurnstilePayload }) | null;
  const payload = raw?.data || raw;
  if (!payload || payload.success !== true
    || typeof payload.hostname !== 'string' || !ALLOWED_HOSTNAMES.has(payload.hostname.toLowerCase())
    || payload.action !== EXPECTED_ACTION) {
    return { ok: false, status: 400, message: 'Security verification failed or expired. Please try again.' };
  }
  return { ok: true };
}
