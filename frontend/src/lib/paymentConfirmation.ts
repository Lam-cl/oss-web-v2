import { NextRequest, NextResponse } from 'next/server';

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
) {
  const { searchParams } = req.nextUrl;
  let refno = searchParams.get('refno') || searchParams.get('refNo') || '';
  let status = searchParams.get('status') || '';
  let description = searchParams.get('desc') || searchParams.get('description') || '';
  let isEsim = forceEsim || searchParams.get('esim') === '1' || searchParams.get('flow') === 'esim';

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
      const bodyEsim = body.get('esim')?.toString() || body.get('isEsim')?.toString() || '';
      isEsim = isEsim || bodyEsim === '1' || bodyEsim.toLowerCase() === 'true';
    } catch { /* body parse failed, use query params only */ }
  }

  if (searchParams.get('scope') === 'merchandise') {
    const order = searchParams.get('order') || '';
    const normalizedStatus = status.toLowerCase();
    const failed = ['fail', 'cancel', 'declin', 'error'].some((value) => normalizedStatus.includes(value));
    const merchUrl = new URL(failed ? '/payment/failed' : '/payment/success', publicOriginFor(req));
    merchUrl.searchParams.set('scope', 'merchandise');
    if (order) merchUrl.searchParams.set('order', order);
    if (refno) merchUrl.searchParams.set('ref', refno);
    if (failed && description) merchUrl.searchParams.set('reason', description);
    return NextResponse.redirect(merchUrl, method === 'POST' ? 303 : 307);
  }

  const url = new URL('/thank-you', publicOriginFor(req));
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', searchParams.get('locale') || 'en');
  if (isEsim) url.searchParams.set('esim', '1');
  if (status) url.searchParams.set('status', status);
  if (description) url.searchParams.set('desc', description);

  return NextResponse.redirect(url, method === 'POST' ? 303 : 307);
}
