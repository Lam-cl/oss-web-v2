import { NextRequest, NextResponse } from 'next/server';
import { createAdxCheckoutProof, isAdxPurchaseMode } from '@/lib/adxCheckoutProof';
import { requestIsSameOrigin } from '@/app/api/adx-reference/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid ADX proof request origin' }, { status: 403 });
  }

  const directCheckoutToken = process.env.DIRECT_CHECKOUT_TOKEN;
  if (!directCheckoutToken || request.cookies.get('dc_token')?.value !== directCheckoutToken) {
    return NextResponse.json({ error: 'ADX checkout session is not authorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (!isAdxPurchaseMode(body?.purchaseMode)) {
    return NextResponse.json({ error: 'Invalid ADX purchase mode' }, { status: 400 });
  }

  const proof = createAdxCheckoutProof(body.purchaseMode);
  if (!proof) {
    return NextResponse.json({ error: 'ADX checkout signing key is not configured' }, { status: 500 });
  }

  return NextResponse.json({ proof, purchaseMode: body.purchaseMode });
}
