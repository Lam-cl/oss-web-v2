import { NextRequest, NextResponse } from 'next/server';
import { readMerdekaPayment } from '@/lib/merdekaPromo';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get('ref')?.trim() || '';
  const record = await readMerdekaPayment(ref);
  if (!record) return NextResponse.json({ error: 'Payment reference not found.' }, { status: 404 });

  let status: 'pending' | 'success' | 'failed' = 'pending';
  try {
    const upstream = await fetch(`https://www.tonewow.net/tgpayment/getPaymentStatus?refNo=${encodeURIComponent(ref)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    const data = await upstream.json();
    if (data?.data?.[0]?.status === '2') status = 'success';
  } catch {
    // The payment record can take a short while to reach the status service.
  }
  if (status === 'pending' && /^(66|11|99)/.test(record.gatewayStatus || '')) status = 'failed';

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
