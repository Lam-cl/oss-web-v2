import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession, safeError } from '@/lib/admin/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session) return safeError(401);
  return NextResponse.json({ user: session.user, expiresAt: session.expiresAt }, { headers: { 'cache-control': 'no-store' } });
}
