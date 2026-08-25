import { NextResponse } from 'next/server';
import { isProductSetupDraft } from '@/lib/productSetup';

const BUNDLE_API = 'https://bundleapi.tonewow.com/api';
const SHIPPING_FEE_SLUG = 'flat-rate-delivery-fee';

export async function GET() {
  try {
    const response = await fetch(`${BUNDLE_API}/products?type=MERCHANDISE&limit=100`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const body = await response.text();
    const data = body ? JSON.parse(body) : {};

    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Bundle API request failed' },
        { status: response.status },
      );
    }

    const visibleData = Array.isArray(data?.data)
      ? { ...data, data: data.data.filter((product: { slug?: string; tags?: Array<string | { name?: string | null }> }) => product.slug !== SHIPPING_FEE_SLUG && !isProductSetupDraft(product)) }
      : data;

    return NextResponse.json(visibleData, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bundle API request failed' },
      { status: 502 },
    );
  }
}
