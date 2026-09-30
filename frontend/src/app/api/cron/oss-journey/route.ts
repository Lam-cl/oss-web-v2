import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { refreshOssJourney } from '@/lib/admin/ossJourney.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const source = process.env.TONEWOW_DATA_API_TOKEN;
  const secret = process.env.CRON_SECRET || (source && createHash('sha256').update(`tonewow-oss-journey:${source}`).digest('hex'));
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  try {
    return NextResponse.json(await refreshOssJourney(), { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ message: 'OSS refresh failed.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
