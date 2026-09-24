import { NextRequest, NextResponse } from 'next/server';
import { readMerdekaPayment } from '@/lib/merdekaPromo';
import { merdekaCors, merdekaPreflight } from '../shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get('ref')?.trim() || '';
  const record = await readMerdekaPayment(ref);
  if (!record) return merdekaCors(request, NextResponse.json({ error: 'Payment reference not found.' }, { status: 404 }));

  // Do not use return/callback query values as payment evidence. A browser can
  // alter them, so only the provider's server-side status service is consulted.
  let status: 'pending' | 'success' | 'failed' = 'pending';
  try {
    const upstream = await fetch(`https://www.tonewow.net/tgpayment/getPaymentStatus?refNo=${encodeURIComponent(ref)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (upstream.ok) {
      const data = await upstream.json();
      const rawStatus = data?.data?.[0]?.status;
      if (rawStatus === '2' || rawStatus === 2) status = 'success';
    }
  } catch {
    // A status provider outage is pending, never success or failure.
  }

  return merdekaCors(request, NextResponse.json({
    status,
    payment: {
      reference: record.paymentRefNo,
      planName: `${record.planName} plan`,
      duration: record.duration,
      monthlyPrice: record.monthlyPrice,
      amount: record.amount,
    },
  }, { headers: { 'Cache-Control': 'no-store' } }));
}

export async function OPTIONS(request: NextRequest) { return merdekaPreflight(request, 'GET, OPTIONS'); }
