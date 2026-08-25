import { NextResponse } from 'next/server';
import { isProductSetupDraft } from '@/lib/productSetup';
import { readProductImageColorSettings } from '@/lib/productImageColors.server';

const BUNDLE_API = 'https://bundleapi.tonewow.com/api';
const SHIPPING_FEE_SLUG = 'flat-rate-delivery-fee';
const HIDDEN_SLUGS = new Set(['pen-2-0']);

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

    const imageColors = await readProductImageColorSettings();
    const visibleData = Array.isArray(data?.data)
      ? { ...data, data: data.data
        .filter((product: { slug?: string; tags?: Array<string | { name?: string | null }> }) => product.slug !== SHIPPING_FEE_SLUG && !HIDDEN_SLUGS.has(product.slug || '') && !isProductSetupDraft(product))
        .map((product: { id: number; options?: Array<{ values?: Array<{ id: number }> }> }) => {
          const hiddenOptionValues = new Set(imageColors.hiddenOptionValues[String(product.id)] || []);
          return {
            ...product,
            options: product.options?.map((option) => ({
              ...option,
              values: option.values?.filter((value) => !hiddenOptionValues.has(Number(value.id))),
            })),
            imageColorAssignments: imageColors.products[String(product.id)] || {},
          };
        }) }
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
