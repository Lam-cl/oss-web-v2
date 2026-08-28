import { NextRequest, NextResponse } from 'next/server';
import { merdekaPublicOrigin } from '@/app/api/merdeka-promo/shared';
import { handlePaymentConfirmation } from '@/lib/paymentConfirmation';
import { readMerdekaPayment } from '@/lib/merdekaPromo';

async function handle(req: NextRequest, method: 'GET' | 'POST') {
  const refno = req.nextUrl.searchParams.get('refno') || req.nextUrl.searchParams.get('refNo') || '';
  const merdekaPayment = refno.toLowerCase().startsWith('16twmp')
    ? await readMerdekaPayment(refno).catch(() => null)
    : null;

  if (!merdekaPayment) return handlePaymentConfirmation(req, method);

  let status = req.nextUrl.searchParams.get('status') || '';
  let description = req.nextUrl.searchParams.get('desc') || req.nextUrl.searchParams.get('description') || '';
  if (method === 'POST') {
    const form = await req.formData().catch(() => null);
    status ||= form?.get('status')?.toString() || '';
    description ||= form?.get('desc')?.toString() || form?.get('description')?.toString() || '';
  }

  const target = new URL('/merdeka-promo-api/confirmation', merdekaPublicOrigin(req));
  target.searchParams.set('refno', refno);
  if (status) target.searchParams.set('status', status);
  if (description) target.searchParams.set('description', description);
  return NextResponse.redirect(target, method === 'POST' ? 303 : 307);
}

export async function GET(req: NextRequest) {
  return handle(req, 'GET');
}

export async function POST(req: NextRequest) {
  return handle(req, 'POST');
}
