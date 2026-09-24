import { NextRequest, NextResponse } from 'next/server';
import { merdekaCors, merdekaPreflight, merdekaSameOrigin } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * Origin is not proof that a caller owns an MSISDN. Do not proxy member
 * profiles until an authenticated backend member-verification contract exists.
 */
export async function POST(request: NextRequest) {
  if (!merdekaSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  return merdekaCors(request, NextResponse.json({
    error: 'Member verification is temporarily unavailable while secure ownership verification is being completed.',
  }, { status: 503, headers: { 'Cache-Control': 'no-store' } }));
}

export async function OPTIONS(request: NextRequest) {
  return merdekaPreflight(request, 'POST, OPTIONS');
}
