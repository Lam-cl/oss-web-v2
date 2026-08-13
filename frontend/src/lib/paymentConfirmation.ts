import { NextRequest, NextResponse } from 'next/server';
import {
  ADX_PURCHASE_COOKIE_KEY,
  matchesAdxPurchaseMarker,
  normalizeAdxPaymentRef,
  parseAdxPurchaseMarker,
} from '@/lib/adxPurchaseMarker';

const ESIM_DETAIL_KEYS = ['simserial', 'esimQR', 'puk1', 'pin1', 'puk2', 'pin2'] as const;
const BIJAKBUATDUIT_RETURN_RESOLVER =
  'https://bijakbuatduit.com/api/XH-tonewow-return-resolver.php';

async function resolveBijakBuatDuitReturn(
  refno: string,
  status: string,
  description: string,
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(refno)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const resolverUrl = new URL(BIJAKBUATDUIT_RETURN_RESOLVER);
    resolverUrl.searchParams.set('ref', refno);
    if (status) resolverUrl.searchParams.set('status', status);
    if (description) resolverUrl.searchParams.set('description', description);
    const response = await fetch(
      resolverUrl,
      { cache: 'no-store', signal: controller.signal },
    );
    if (!response.ok) return null;
    const result = await response.json().catch(() => null);
    if (!result?.matched || typeof result.redirect_url !== 'string') return null;

    const destination = new URL(result.redirect_url);
    if (destination.protocol !== 'https:'
      || destination.hostname !== 'bijakbuatduit.com'
      || destination.pathname !== '/api/XH-tonewow-payment-return.php') {
      return null;
    }
    return destination.toString();
  } catch {
    // Fail open: ordinary ToneWow confirmations must continue unchanged.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// These orders were created before ADX markers were embedded in the gateway callback URL.
const LEGACY_ADX_ORDERS: Record<string, { simType: 'physical' | 'esim' }> = {
  twoss847682607301559: { simType: 'esim' },
};

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

  // Only exact full payment references created by BijakBuatDuit are routed
  // back there. All ordinary ToneWow confirmations retain the existing flow.
  if (refno) {
    const bijakBuatDuitReturn = await resolveBijakBuatDuitReturn(refno, status, description);
    if (bijakBuatDuitReturn) {
      return NextResponse.redirect(bijakBuatDuitReturn, method === 'POST' ? 303 : 307);
    }
  }

  const storedAdxMarker = parseAdxPurchaseMarker(req.cookies.get(ADX_PURCHASE_COOKIE_KEY)?.value);
  const matchedAdxMarker = matchesAdxPurchaseMarker(storedAdxMarker, refno) ? storedAdxMarker : null;
  const legacyAdxOrder = LEGACY_ADX_ORDERS[normalizeAdxPaymentRef(refno)];
  const isAdx = forceAdx
    || flow.toLowerCase() === 'adx'
    || prodDesc.toLowerCase() === 'osspaymentadx'
    || Boolean(matchedAdxMarker)
    || Boolean(legacyAdxOrder);
  isEsim = isEsim
    || matchedAdxMarker?.simType === 'esim'
    || legacyAdxOrder?.simType === 'esim';

  const redirect = (url: URL) => {
    const response = NextResponse.redirect(url, method === 'POST' ? 303 : 307);
    if (matchedAdxMarker) {
      response.cookies.set(ADX_PURCHASE_COOKIE_KEY, '', { path: '/', maxAge: 0 });
    }
    return response;
  };

  if (ESIM_DETAIL_KEYS.some((key) => esimDetails[key])) {
    const successUrl = new URL(isAdx ? '/adx/esim-success' : '/sim/esim-success', publicOriginFor(req));
    if (refno) successUrl.searchParams.set('refno', refno);
    successUrl.searchParams.set('locale', searchParams.get('locale') || 'en');
    if (referralContext) successUrl.searchParams.set('refctx', referralContext);
    for (const key of ESIM_DETAIL_KEYS) {
      if (esimDetails[key]) successUrl.searchParams.set(key, esimDetails[key]);
    }
    return redirect(successUrl);
  }

  const url = new URL(isAdx ? '/adx/thank-you' : '/thank-you', publicOriginFor(req));
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', searchParams.get('locale') || 'en');
  if (isEsim) url.searchParams.set('esim', '1');
  if (referralContext) url.searchParams.set('refctx', referralContext);
  if (status) url.searchParams.set('status', status);
  if (description) url.searchParams.set('desc', description);

  return redirect(url);
}
