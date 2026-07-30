import { NextRequest, NextResponse } from 'next/server';

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
  let flow = searchParams.get('flow') || '';
  let prodDesc = searchParams.get('prodDesc')
    || searchParams.get('proddesc')
    || searchParams.get('PRODDESC')
    || '';
  let isEsim = forceEsim || searchParams.get('esim') === '1' || flow === 'esim';
  const esimDetails: Record<(typeof ESIM_DETAIL_KEYS)[number], string> = {
    simserial: searchParams.get('simserial') || searchParams.get('simSerial') || '',
    esimQR: searchParams.get('esimQR') || '',
    puk1: searchParams.get('puk1') || '',
    pin1: searchParams.get('pin1') || '',
    puk2: searchParams.get('puk2') || '',
    pin2: searchParams.get('pin2') || '',
  };

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
      flow = flow || body.get('flow')?.toString() || '';
      prodDesc = prodDesc
        || body.get('prodDesc')?.toString()
        || body.get('proddesc')?.toString()
        || body.get('PRODDESC')?.toString()
        || '';
      const bodyEsim = body.get('esim')?.toString() || body.get('isEsim')?.toString() || '';
      isEsim = isEsim || bodyEsim === '1' || bodyEsim.toLowerCase() === 'true';
      for (const key of ESIM_DETAIL_KEYS) {
        esimDetails[key] = esimDetails[key]
          || body.get(key)?.toString()
          || (key === 'simserial' ? body.get('simSerial')?.toString() : '')
          || '';
      }
    } catch { /* body parse failed, use query params only */ }
  }

  const isAdx = forceAdx || flow.toLowerCase() === 'adx' || prodDesc.toLowerCase() === 'osspaymentadx';

  if (ESIM_DETAIL_KEYS.some((key) => esimDetails[key])) {
    const successUrl = new URL(isAdx ? '/adx/esim-success' : '/sim/esim-success', publicOriginFor(req));
    if (refno) successUrl.searchParams.set('refno', refno);
    successUrl.searchParams.set('locale', searchParams.get('locale') || 'en');
    if (referralContext) successUrl.searchParams.set('refctx', referralContext);
    for (const key of ESIM_DETAIL_KEYS) {
      if (esimDetails[key]) successUrl.searchParams.set(key, esimDetails[key]);
    }
    return NextResponse.redirect(successUrl, method === 'POST' ? 303 : 307);
  }

  const url = new URL(isAdx ? '/adx/thank-you' : '/thank-you', publicOriginFor(req));
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', searchParams.get('locale') || 'en');
  if (isEsim) url.searchParams.set('esim', '1');
  if (referralContext) url.searchParams.set('refctx', referralContext);
  if (status) url.searchParams.set('status', status);
  if (description) url.searchParams.set('desc', description);

  return NextResponse.redirect(url, method === 'POST' ? 303 : 307);
}
