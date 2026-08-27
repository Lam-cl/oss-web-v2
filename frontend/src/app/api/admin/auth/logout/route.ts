import { NextRequest, NextResponse } from 'next/server';
import { requestIsSameOrigin, safeError } from '@/lib/admin/server';
import { ADMIN_COOKIE, ADMIN_GATE_COOKIE, revokeSessionCookie } from '@/lib/admin/session';

export async function POST(request: NextRequest) {
  if (!requestIsSameOrigin(request)) return safeError(403);
  try { await revokeSessionCookie(request.cookies.get(ADMIN_COOKIE)?.value); }
  catch { return safeError(503, { message: 'The session could not be ended. Please try again.' }); }
  const response = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  response.cookies.set(ADMIN_GATE_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
