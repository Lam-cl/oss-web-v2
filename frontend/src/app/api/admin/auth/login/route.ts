import { NextRequest, NextResponse } from 'next/server';
import { BUNDLE_API, readUpstream, requestIsSameOrigin, safeError } from '@/lib/admin/server';
import { ADMIN_COOKIE, ADMIN_ROLES, createSessionCookie, jwtExpiry, SESSION_MAX_AGE } from '@/lib/admin/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!requestIsSameOrigin(request)) return safeError(403);
  let credentials: { email?: string; password?: string };
  try { credentials = await request.json(); } catch { return safeError(400); }
  if (!credentials.email || !credentials.password) return safeError(400, { message: 'Email and password are required.' });

  let upstream: Response;
  try {
    upstream = await fetch(`${BUNDLE_API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: credentials.email.trim(), password: credentials.password }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'TimeoutError') {
      return safeError(504, { message: 'The Bundle API took too long to respond. Please try signing in again.' });
    }
    return safeError(502);
  }
  const payload = await readUpstream(upstream) as Record<string, any> | null;
  if (!upstream.ok || !payload) return safeError(upstream.status, payload);

  const token = payload.token || payload.accessToken || payload.access_token;
  const user = payload.user || payload.data?.user;
  if (!token || !user || !ADMIN_ROLES.includes(user.role)) return safeError(403, { message: 'Only ADMIN or STAFF accounts can access this panel.' });

  const expiresAt = Math.min(Date.now() + SESSION_MAX_AGE * 1000, jwtExpiry(token) || Number.POSITIVE_INFINITY);
  const session = {
    token,
    user: { id: user.id, email: user.email, role: user.role, name: user.name || user.fullName },
    expiresAt,
  };
  const response = NextResponse.json({ user: session.user, expiresAt }, { headers: { 'cache-control': 'no-store' } });
  let cookie: string;
  try { cookie = await createSessionCookie(session); } catch { return safeError(500, { message: 'The admin session configuration is incomplete.' }); }
  response.cookies.set(ADMIN_COOKIE, cookie, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  });
  return response;
}
