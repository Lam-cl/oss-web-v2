import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin/server';
import { listOssRequests } from '@/lib/admin/ossJourney.server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!await getAdminSession(request)) return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
  try {
    const params = request.nextUrl.searchParams;
    const result = await listOssRequests({ productCode: params.get('productCode') || '', search: params.get('search') || '', period: params.get('period') || '',
      page: Number(params.get('page')), limit: Number(params.get('limit')) });
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ message: 'OSS journey is temporarily unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
