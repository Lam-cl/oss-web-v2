import { NextRequest, NextResponse } from 'next/server';
import { readCataloguePublicProjection, readCataloguePublicSnapshotMedia } from '@/lib/cataloguePublicProjection.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    return NextResponse.json(await readCataloguePublicProjection(), { headers: { 'cache-control': 'no-store' } });
  } catch {
    return catalogueId !== null || mediaId !== null
      ? new Response(null, { status: 404 })
      : NextResponse.json({ products: [] }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
