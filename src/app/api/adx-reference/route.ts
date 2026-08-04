import { NextRequest, NextResponse } from 'next/server';
import { isAdxPurchaseMode, verifyAdxCheckoutProof } from '@/lib/adxCheckoutProof';
import { normalizeAdxPaymentRef } from '@/lib/adxPurchaseMarker';
import { rememberAdxPaymentReference } from '@/lib/adxPaymentReferenceStore';
import { requestIsSameOrigin } from './shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid ADX marker request origin' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const proof = clean(body?.proof);
    const refNo = clean(body?.refNo);
    const paymentRefNo = clean(body?.paymentRefNo);
    const prodDesc = clean(body?.prodDesc);
    const purchaseMode = body?.purchaseMode;
    const simType = body?.simType;

    if (!isAdxPurchaseMode(purchaseMode) || (simType !== 'physical' && simType !== 'esim')) {
      return NextResponse.json({ error: 'Invalid ADX order type' }, { status: 400 });
    }
    if (prodDesc !== 'OSSPaymentADX') {
      return NextResponse.json({ error: 'Only OSSPaymentADX orders can use ADX routing' }, { status: 400 });
    }
    if (
      !/^[A-Za-z0-9_-]{6,80}$/.test(refNo)
      || !/^[A-Za-z0-9_-]{6,80}$/.test(paymentRefNo)
      || normalizeAdxPaymentRef(refNo) !== normalizeAdxPaymentRef(paymentRefNo)
    ) {
      return NextResponse.json({ error: 'Invalid ADX payment reference' }, { status: 400 });
    }

    verifyAdxCheckoutProof(proof, purchaseMode);
    await rememberAdxPaymentReference({
      flow: 'adx',
      prodDesc: 'OSSPaymentADX',
      refNo,
      paymentRefNo,
      simType,
      purchaseMode,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Unable to register ADX payment reference' }, { status: 400 });
  }
}
