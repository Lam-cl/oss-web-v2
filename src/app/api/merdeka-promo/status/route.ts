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

    // TEMP DEBUG — log the raw shape so you can see what the gateway actually returns
    console.log('[merdeka-status]', ref, 'upstream ok:', upstream.ok, 'raw:', JSON.stringify(data));

    // Loosen the check while debugging: log if status exists but doesn't match '2'
    const rawStatus = data?.data?.[0]?.status;
    if (rawStatus === '2' || rawStatus === 2) status = 'success';
    else if (rawStatus !== undefined) {
      console.log('[merdeka-status]', ref, 'unmatched status code:', rawStatus, typeof rawStatus);
    }
  } catch (err) {
    // TEMP DEBUG — see WHY it's failing instead of swallowing silently
    console.error('[merdeka-status] upstream fetch failed for', ref, err);
  }
  if (status === 'pending' && /^(66|11|99)/.test(record.gatewayStatus || '')) status = 'failed';

  // TEMP DEBUG — see what the local record looks like (was webhook ever received?)
  console.log('[merdeka-status]', ref, 'record.gatewayStatus:', record.gatewayStatus, 'final status:', status);

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