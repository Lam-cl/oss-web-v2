import { NextRequest, NextResponse } from 'next/server';
import {
  ADX_PURCHASE_COOKIE_KEY,
  matchesAdxPurchaseMarker,
  parseAdxPurchaseMarker,
} from '@/lib/adxPurchaseMarker';

function publicOriginFor(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host')?.split(',')[0]?.trim();
  if (host && !host.startsWith('localhost') && !host.startsWith('127.')) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    return `${forwardedProto}://${host}`;
  }

  return req.nextUrl.origin;
}

export async function handlePaymentConfirmation(
  req: NextRequest,
  method: 'GET' | 'POST',
  forceEsim = false,
  forceAdx = false,
) {
  const { searchParams } = req.nextUrl;
  let refno = searchParams.get('refno') || searchParams.get('refNo') || '';
  let status = searchParams.get('status') || '';
  let description = searchParams.get('desc') || searchParams.get('description') || '';
  let flow = searchParams.get('flow') || '';
  let prodDesc = searchParams.get('prodDesc')
    || searchParams.get('proddesc')
    || searchParams.get('PRODDESC')
    || '';
  let isEsim = forceEsim || searchParams.get('esim') === '1' || flow === 'esim';

  if (method === 'POST') {
    try {
      const body = await req.formData();
      refno = refno
        || body.get('refno')?.toString()
        || body.get('refNo')?.toString()
        || body.get('cartid')?.toString()
        || '';
      status = status || body.get('status')?.toString() || '';
      description = description || body.get('desc')?.toString() || body.get('description')?.toString() || '';
      flow = flow || body.get('flow')?.toString() || '';
      prodDesc = prodDesc
        || body.get('prodDesc')?.toString()
        || body.get('proddesc')?.toString()
        || body.get('PRODDESC')?.toString()
        || '';
      const bodyEsim = body.get('esim')?.toString() || body.get('isEsim')?.toString() || '';
      isEsim = isEsim || bodyEsim === '1' || bodyEsim.toLowerCase() === 'true';
    } catch {
      // Use the query parameters when the gateway body is unavailable.
    }
  }

  const storedAdxMarker = parseAdxPurchaseMarker(req.cookies.get(ADX_PURCHASE_COOKIE_KEY)?.value);
  const matchedAdxMarker = matchesAdxPurchaseMarker(storedAdxMarker, refno) ? storedAdxMarker : null;
  const isAdx = forceAdx
    || flow.toLowerCase() === 'adx'
    || prodDesc.toLowerCase() === 'osspaymentadx'
    || Boolean(matchedAdxMarker);
  isEsim = isEsim || matchedAdxMarker?.simType === 'esim';
  const url = new URL(isAdx ? '/adx/thank-you' : '/thank-you', publicOriginFor(req));
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', searchParams.get('locale') || 'en');
  if (isEsim) url.searchParams.set('esim', '1');
  if (status) url.searchParams.set('status', status);
  if (description) url.searchParams.set('desc', description);

  const response = NextResponse.redirect(url, method === 'POST' ? 303 : 307);
  if (matchedAdxMarker) {
    response.cookies.set(ADX_PURCHASE_COOKIE_KEY, '', { path: '/', maxAge: 0 });
  }
  return response;
}
