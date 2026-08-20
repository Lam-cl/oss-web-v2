import { NextRequest, NextResponse } from 'next/server';
import { fetchMerdekaMember } from '@/lib/merdekaPromo';
import { merdekaSameOrigin } from '../shared';

export const dynamic = 'force-dynamic';

const attempts = new Map<string, { count: number; resetAt: number }>();

function allowed(request: NextRequest) {
  const key = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 10;
}

export async function POST(request: NextRequest) {
  if (!merdekaSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  if (!allowed(request)) return NextResponse.json({ error: 'Too many attempts. Please wait a minute and try again.' }, { status: 429 });

  try {
    const body = await request.json().catch(() => ({}));
    const member = await fetchMerdekaMember(body?.msisdn);
    return NextResponse.json({ member }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to verify this number.',
    }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
}
