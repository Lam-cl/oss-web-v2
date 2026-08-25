import { NextRequest, NextResponse } from 'next/server';
import { readOrderMetadata } from '@/lib/admin/orderMetadata.server';
import { readBundlePaymentStatus } from '@/lib/bundlePaymentStatus.server';
import { isBundlePaymentReference } from '@/lib/paymentProcessing';

export const dynamic = 'force-dynamic';
const noStore = { 'cache-control': 'private, no-store, max-age=0' };

export async function GET(request: NextRequest) {
  const rawOrderId = request.nextUrl.searchParams.get('orderId') || '';
  const referenceNumber = request.nextUrl.searchParams.get('referenceNumber') || '';
  const orderId = Number(rawOrderId);
  if (!/^\d+$/.test(rawOrderId) || !Number.isSafeInteger(orderId) || orderId <= 0
    || !isBundlePaymentReference(referenceNumber)) {
    return NextResponse.json({ error: 'Invalid payment status reference' }, { status: 400, headers: noStore });
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'Invalid payment status origin' }, { status: 403, headers: noStore });
  }

  try {
    const metadata = await readOrderMetadata(orderId);
    if (metadata.paymentReference?.referenceNumber !== referenceNumber) {
      return NextResponse.json({ error: 'Payment status reference not found' }, { status: 404, headers: noStore });
    }
    return NextResponse.json(await readBundlePaymentStatus(orderId), { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Payment status is temporarily unavailable' }, { status: 503, headers: noStore });
  }
}
