import { NextRequest, NextResponse } from 'next/server';
import { readMerdekaPayment } from '@/lib/merdekaPromo';
import { merdekaPublicPage } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function reference(request: NextRequest, method: 'GET' | 'POST') {
  const params = request.nextUrl.searchParams;
  let ref = params.get('refno') || params.get('refNo') || params.get('cartid') || '';
  if (method === 'POST') {
    const form = await request.formData().catch(() => null);
    ref ||= form?.get('refno')?.toString() || form?.get('refNo')?.toString() || form?.get('cartid')?.toString() || '';
  }
  return ref.trim();
}

async function handle(request: NextRequest, method: 'GET' | 'POST') {
  const record = await readMerdekaPayment(await reference(request, method));
  const target = merdekaPublicPage();
  if (!record) {
    target.searchParams.set('invalid', '1');
    return NextResponse.redirect(target, 303);
  }

  // Return/callback data is untrusted input. It must never update payment
  // state; the status route verifies payment independently.
  target.searchParams.set('ref', record.paymentRefNo);
  return NextResponse.redirect(target, 303);
}

export async function GET(request: NextRequest) { return handle(request, 'GET'); }
export async function POST(request: NextRequest) { return handle(request, 'POST'); }
