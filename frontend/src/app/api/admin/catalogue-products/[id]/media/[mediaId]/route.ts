import { NextRequest, NextResponse } from 'next/server';
import { readVerifiedCatalogueMedia, removeCatalogueMedia, updateCatalogueMedia } from '@/lib/admin/catalogueMedia.server';
import {
  activeSimMediaMutationError,
  catalogueMediaAuthError,
  catalogueMediaBadRequest,
  catalogueMediaRequestError,
  isActiveCatalogueMediaAssignment,
  isValidCatalogueMediaId,
  publicCatalogueMedia,
  readCatalogueMediaProduct,
} from '@/lib/admin/catalogueMediaRoute.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: { id: string; mediaId: string } };

export async function GET(request: NextRequest, { params }: Context) {
  const denied = await catalogueMediaAuthError(request, false);
  if (denied) return denied;
  if (!isValidCatalogueMediaId(params.mediaId)) return catalogueMediaBadRequest();
  const { error } = await readCatalogueMediaProduct(params.id);
  if (error) return error;
  try {
    const media = await readVerifiedCatalogueMedia(params.id, params.mediaId);
    return new Response(new Uint8Array(media.body), {
      headers: {
        'cache-control': 'private, no-store, max-age=0',
        'content-type': media.contentType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (reason) { return catalogueMediaRequestError(reason); }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const denied = await catalogueMediaAuthError(request, true);
  if (denied) return denied;
  if (!isValidCatalogueMediaId(params.mediaId)) return catalogueMediaBadRequest();
  const { product, error } = await readCatalogueMediaProduct(params.id);
  if (error) return error;
  const simDenied = await activeSimMediaMutationError(product);
  if (simDenied) return simDenied;

  let patch: unknown;
  try { patch = await request.json(); } catch { return catalogueMediaBadRequest(); }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return catalogueMediaBadRequest();
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => key !== 'order' && key !== 'assignment')) return catalogueMediaBadRequest();
  const assignment = (patch as { assignment?: unknown }).assignment;
  if (Object.prototype.hasOwnProperty.call(patch, 'assignment')
    && !isActiveCatalogueMediaAssignment(product, assignment)) return catalogueMediaBadRequest();

  try {
    const media = await updateCatalogueMedia(params.id, params.mediaId, patch as { order?: number; assignment?: string });
    return NextResponse.json({ media: publicCatalogueMedia(media) }, { headers: { 'cache-control': 'no-store' } });
  } catch (reason) { return catalogueMediaRequestError(reason); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const denied = await catalogueMediaAuthError(request, true);
  if (denied) return denied;
  if (!isValidCatalogueMediaId(params.mediaId)) return catalogueMediaBadRequest();
  const { product, error } = await readCatalogueMediaProduct(params.id);
  if (error) return error;
  const simDenied = await activeSimMediaMutationError(product);
  if (simDenied) return simDenied;
  try {
    const media = await removeCatalogueMedia(params.id, params.mediaId);
    return NextResponse.json({ media: publicCatalogueMedia(media) }, { headers: { 'cache-control': 'no-store' } });
  } catch (reason) { return catalogueMediaRequestError(reason); }
}
