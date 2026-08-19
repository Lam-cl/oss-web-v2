import { NextRequest, NextResponse } from 'next/server';
import { readMerdekaPayment, writeMerdekaPayment } from '@/lib/merdekaPromo';
import { merdekaPublicOrigin } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function values(request: NextRequest, method: 'GET' | 'POST') {
  const params = request.nextUrl.searchParams;
  let ref = params.get('refno') || params.get('refNo') || params.get('cartid') || '';
  let status = params.get('status') || '';
  let description = params.get('description') || params.get('desc') || '';
  if (method === 'POST') {
    const form = await request.formData().catch(() => null);
    ref ||= form?.get('refno')?.toString() || form?.get('refNo')?.toString() || form?.get('cartid')?.toString() || '';
    status ||= form?.get('status')?.toString() || '';
    description ||= form?.get('description')?.toString() || form?.get('desc')?.toString() || '';
  }
  return { ref: ref.trim(), status: status.trim(), description: description.trim() };
}

async function handle(request: NextRequest, method: 'GET' | 'POST') {
  const result = await values(request, method);
  const record = await readMerdekaPayment(result.ref);
  const target = new URL('/merdeka-promo/confirmation', merdekaPublicOrigin(request));
  if (!record) {
    target.searchParams.set('invalid', '1');
    return NextResponse.redirect(target, 303);
  }
  if (result.status || result.description) {
    await writeMerdekaPayment({ ...record, gatewayStatus: result.status, gatewayDescription: result.description });
  }
  target.searchParams.set('ref', record.paymentRefNo);
  return NextResponse.redirect(target, 303);
}

export async function GET(request: NextRequest) { return handle(request, 'GET'); }
export async function POST(request: NextRequest) { return handle(request, 'POST'); }
