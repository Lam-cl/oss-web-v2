import { NextRequest, NextResponse } from 'next/server';
import { readCataloguePublicSnapshotMedia } from '@/lib/cataloguePublicProjection.server';
import { getPublicCatalogue } from '@/lib/catalogueCache.server';

// Not `force-dynamic`: the handler reads `request.nextUrl.searchParams`, which already makes it
// dynamic per request, while the catalogue itself comes from the shared unstable_cache entry.
export const runtime = 'nodejs';
const PUBLIC_CATALOGUE_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=300';

export async function GET(request: NextRequest) {
  const catalogueId = request.nextUrl.searchParams.get('catalogueId');
  const mediaId = request.nextUrl.searchParams.get('mediaId');
  try {
    if (catalogueId !== null || mediaId !== null) {
      if (!catalogueId || !mediaId) return new Response(null, { status: 404 });
      const media = await readCataloguePublicSnapshotMedia(catalogueId, mediaId);
      if (!media) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(media.body), {
        headers: {
          'cache-control': 'no-store',
          'content-type': media.contentType,
          'x-content-type-options': 'nosniff',
        },
      });
    }
    return NextResponse.json(await getPublicCatalogue(), { headers: { 'cache-control': PUBLIC_CATALOGUE_CACHE_CONTROL } });
  } catch {
    return catalogueId !== null || mediaId !== null
      ? new Response(null, { status: 404 })
      : NextResponse.json({ products: [] }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
