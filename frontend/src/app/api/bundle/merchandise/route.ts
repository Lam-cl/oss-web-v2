import { NextResponse } from 'next/server';
import { BUNDLE_MERCHANDISE_URL, visibleBundleMerchandise } from '@/lib/bundleMerchandise';
import { readProductImageColorSettings } from '@/lib/productImageColors.server';

export async function GET() {
  try {
    // The image-colour read starts alongside the Bundle fetch. The fetch stays `no-store` (live
    // stock, and it keeps this handler dynamic); the short shared CDN cache below absorbs repeats.
    const imageColorsRead = readProductImageColorSettings();
    imageColorsRead.catch(() => { /* awaited below; avoids an unhandled rejection on early return */ });
    const response = await fetch(BUNDLE_MERCHANDISE_URL, {
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

    const imageColors = await imageColorsRead;
    const visibleData = visibleBundleMerchandise(data, imageColors);

    return NextResponse.json(visibleData, {
      // Public, non-user data. Displayed stock may be up to ~75 s old (s-maxage + SWR);
      // the checkout POST re-checks stock and prices against a fresh Bundle read.
      headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bundle API request failed' },
      { status: 502 },
    );
  }
}
