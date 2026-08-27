import { NextRequest, NextResponse } from 'next/server';
import { OrderMetadataError, readOrderMetadata } from '@/lib/admin/orderMetadata.server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rawOrderId = request.nextUrl.searchParams.get('orderId') || '';
  if (!/^\d+$/.test(rawOrderId)) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  try {
    const metadata = await readOrderMetadata(Number(rawOrderId));
    const referenceNumber = metadata.paymentReference?.referenceNumber || '';
    if (!referenceNumber) {
      return NextResponse.json({ error: 'Payment reference not found' }, {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      });
    }
    return NextResponse.json({ referenceNumber }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof OrderMetadataError ? error.message : 'Unable to load payment reference',
    }, { status: 500 });
  }
}
