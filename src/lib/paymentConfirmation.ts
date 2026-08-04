import { NextRequest, NextResponse } from 'next/server';
import { readAdxPaymentReference } from '@/lib/adxPaymentReferenceStore';

const ESIM_DETAIL_KEYS = ['simserial', 'esimQR', 'puk1', 'pin1', 'puk2', 'pin2'] as const;

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
  let referralContext = searchParams.get('refctx') || '';
  let locale = searchParams.get('locale') || 'en';
  let flow = searchParams.get('flow') || '';
  let prodDesc = searchParams.get('prodDesc')
    || searchParams.get('proddesc')
    || searchParams.get('PRODDESC')
    || '';
  let isEsim = forceEsim || searchParams.get('esim') === '1' || flow === 'esim';
  const esimDetails: Partial<Record<(typeof ESIM_DETAIL_KEYS)[number], string>> = {};
  for (const key of ESIM_DETAIL_KEYS) {
    const value = key === 'simserial'
      ? searchParams.get('simserial') || searchParams.get('simSerial')
      : searchParams.get(key);
    if (value) esimDetails[key] = value;
  }

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
      referralContext = referralContext || body.get('refctx')?.toString() || '';
      locale = searchParams.get('locale') || body.get('locale')?.toString() || 'en';
      flow = flow || body.get('flow')?.toString() || '';
      prodDesc = prodDesc
        || body.get('prodDesc')?.toString()
        || body.get('proddesc')?.toString()
        || body.get('PRODDESC')?.toString()
        || '';
      const bodyEsim = body.get('esim')?.toString() || body.get('isEsim')?.toString() || '';
      isEsim = isEsim || bodyEsim === '1' || bodyEsim.toLowerCase() === 'true';
      for (const key of ESIM_DETAIL_KEYS) {
        const value = key === 'simserial'
          ? body.get('simserial')?.toString() || body.get('simSerial')?.toString()
          : body.get(key)?.toString();
        if (!esimDetails[key] && value) esimDetails[key] = value;
      }
    } catch {
      // Use the query parameters when the gateway body is unavailable.
    }
  }

  const serverAdxMarker = refno ? await readAdxPaymentReference(refno) : null;
  const isAdx = forceAdx
    || prodDesc === 'OSSPaymentADX'
    || Boolean(serverAdxMarker);
  isEsim = isEsim || serverAdxMarker?.simType === 'esim';
  const hasEsimDetails = ESIM_DETAIL_KEYS.some(key => Boolean(esimDetails[key]));
  const destination = hasEsimDetails
    ? isAdx ? '/adx/esim-success' : '/sim/esim-success'
    : isAdx ? '/adx/thank-you' : '/thank-you';
  const url = new URL(destination, publicOriginFor(req));
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', locale);
  if (isEsim && !hasEsimDetails) url.searchParams.set('esim', '1');
  if (referralContext) url.searchParams.set('refctx', referralContext);
  if (hasEsimDetails) {
    for (const key of ESIM_DETAIL_KEYS) {
      if (esimDetails[key]) url.searchParams.set(key, esimDetails[key]);
    }
  } else {
    if (status) url.searchParams.set('status', status);
    if (description) url.searchParams.set('desc', description);
  }

  return NextResponse.redirect(url, method === 'POST' ? 303 : 307);
}
