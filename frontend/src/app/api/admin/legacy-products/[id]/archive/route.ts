import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession, requestIsSameOrigin, safeError } from '@/lib/admin/server';
import { archiveLegacyProduct, LegacyProductArchiveError } from '@/lib/admin/legacyProductArchive.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession(request); if (!session) return safeError(401);
  if (!requestIsSameOrigin(request)) return safeError(403);
  let body: unknown; try { body = await request.json(); } catch { return safeError(400); }
  try {
    return NextResponse.json(await archiveLegacyProduct(Number(params.id), body, session.token), { headers: { 'cache-control': 'no-store' } });
  } catch (reason) {
    return reason instanceof LegacyProductArchiveError ? safeError(reason.status, { message: reason.message }) : safeError(500);
  }
}
