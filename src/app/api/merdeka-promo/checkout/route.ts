import { NextRequest, NextResponse } from 'next/server';
import { merdekaCors, merdekaPreflight, merdekaSameOrigin } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A gateway URL contains customer-controlled query parameters. This route must
 * stay closed until the payment backend accepts an authenticated member proof,
 * creates the authoritative order, and returns a tamper-proof gateway session.
 */
export async function POST(request: NextRequest) {
  if (!merdekaSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  return merdekaCors(request, NextResponse.json({
    error: 'Merdeka Promo checkout is temporarily unavailable while secure member verification and payment reconciliation are being completed.',
  }, { status: 503, headers: { 'Cache-Control': 'no-store' } }));
}

export async function OPTIONS(request: NextRequest) {
  return merdekaPreflight(request, 'POST, OPTIONS');
}
