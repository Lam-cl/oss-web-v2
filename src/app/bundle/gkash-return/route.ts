import { NextRequest, NextResponse } from 'next/server';
import { readOrderMetadata } from '@/lib/admin/orderMetadata.server';
import { isBundlePaymentReference } from '@/lib/paymentProcessing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUNDLE_RETURN_URL = 'https://bundleapi.tonewow.com/api/payment/gkash/return';
const MAX_RETURN_BYTES = 64 * 1024;
const noStore = { 'cache-control': 'private, no-store, max-age=0' };

function publicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host')?.split(',')[0]?.trim();
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  if (host && !host.startsWith('localhost') && !host.startsWith('127.')) {
    try { return new URL(`${proto}://${host}`).origin; } catch { /* use request origin */ }
  }
  return request.nextUrl.origin;
}

function processing(request: NextRequest) {
  return NextResponse.redirect(new URL('/payment/processing', publicOrigin(request)), { status: 303, headers: noStore });
}

function localResult(request: NextRequest, location: string | null) {
  if (!location) return null;
  try {
    const target = new URL(location, BUNDLE_RETURN_URL);
    if (!['/payment/success', '/payment/failed'].includes(target.pathname)) return null;
    return new URL(`${target.pathname}${target.search}`, publicOrigin(request));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const rawOrderId = request.nextUrl.searchParams.get('orderId') || '';
  const referenceNumber = request.nextUrl.searchParams.get('referenceNumber') || '';
  const orderId = Number(rawOrderId);
  const declared = Number(request.headers.get('content-length') || 0);
  if (!/^\d+$/.test(rawOrderId) || !Number.isSafeInteger(orderId) || orderId <= 0
    || !isBundlePaymentReference(referenceNumber)
    || !Number.isSafeInteger(declared) || declared < 0 || declared > MAX_RETURN_BYTES) return processing(request);
  try {
    const metadata = await readOrderMetadata(orderId);
    if (metadata.paymentReference?.referenceNumber !== referenceNumber) return processing(request);
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_RETURN_BYTES) return processing(request);
    const contentType = request.headers.get('content-type') || 'application/x-www-form-urlencoded';
    const upstream = await fetch(BUNDLE_RETURN_URL, {
      method: 'POST',
      headers: { 'content-type': contentType, accept: 'text/html,application/json' },
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const target = localResult(request, upstream.headers.get('location'));
    return target ? NextResponse.redirect(target, { status: 303, headers: noStore }) : processing(request);
  } catch {
    return processing(request);
  }
}
