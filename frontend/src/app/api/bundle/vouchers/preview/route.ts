import { NextRequest, NextResponse } from 'next/server';

const BUNDLE_API = (process.env.BUNDLE_API_URL || 'https://bundleapi.tonewow.com/api').replace(/\/$/, '');

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() || request.headers.get('host');
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  try {
    const body = await request.json();
    const code = String(body.code || '').trim().toUpperCase();
    const items = Array.isArray(body.items) ? body.items.map((item: any) => ({ productId: Number(item.productId), variantId: Number(item.variantId), quantity: Number(item.quantity) })) : [];
    if (!code || !items.length || items.some((item: any) => !Number.isInteger(item.productId) || !Number.isInteger(item.variantId) || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      return NextResponse.json({ error: 'Enter a valid promo code.' }, { status: 400 });
    }
    const response = await fetch(`${BUNDLE_API}/vouchers/preview`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ code, items, customerEmail: String(body.customerEmail || '').trim() || undefined }), cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: payload?.message || 'This promo code is not valid for the cart.' }, { status: response.status });
    return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Promo validation is temporarily unavailable.' }, { status: 502 });
  }
}
