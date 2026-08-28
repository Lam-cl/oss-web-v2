import { NextRequest, NextResponse } from 'next/server';
import { readMerdekaPayment } from '@/lib/merdekaPromo';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get('ref')?.trim() || '';
  const record = await readMerdekaPayment(ref);
  if (!record) return NextResponse.json({ error: 'Payment reference not found.' }, { status: 404 });

  const callbackApproved = /^88\b/.test(record.gatewayStatus || '')
    && /^00\b/.test(record.gatewayDescription || '');
  const callbackFailed = /^(66|11|99)/.test(record.gatewayStatus || '');
  let status: 'pending' | 'success' | 'failed' = callbackApproved
    ? 'success'
    : callbackFailed
      ? 'failed'
      : 'pending';

  if (status === 'pending') {
    try {
      const upstream = await fetch(`https://www.tonewow.net/tgpayment/getPaymentStatus?refNo=${encodeURIComponent(ref)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      });
      const data = await upstream.json();
      const rawStatus = data?.data?.[0]?.status;
      if (rawStatus === '2' || rawStatus === 2) status = 'success';
    } catch {
      // The provider status service can lag behind its payment callback.
    }
  }

  return NextResponse.json({
    status,
    payment: {
      reference: record.paymentRefNo,
      planName: `${record.planName} plan`,
      duration: record.duration,
      monthlyPrice: record.monthlyPrice,
      amount: record.amount,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}