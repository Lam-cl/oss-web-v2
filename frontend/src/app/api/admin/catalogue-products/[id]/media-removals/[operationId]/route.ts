import { NextRequest, NextResponse } from 'next/server';
import { finalizeCatalogueMediaRemoval, getCatalogueMediaRemoval } from '@/lib/admin/catalogueMedia.server';
import { catalogueAdminError, readBoundedCatalogueJson } from '@/lib/admin/catalogueAdminRoute.server';
import {
  activeSimMediaMutationError,
  catalogueMediaAuthError,
  catalogueMediaBadRequest,
  catalogueMediaRequestError,
  isValidCatalogueMediaId,
  readCatalogueMediaProduct,
} from '@/lib/admin/catalogueMediaRoute.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: { id: string; operationId: string } };
const response = (operation: NonNullable<Awaited<ReturnType<typeof getCatalogueMediaRemoval>>>) => NextResponse.json({
  operation: { operationId: operation.operationId, status: operation.status },
}, { headers: { 'cache-control': 'no-store' } });

export async function GET(request: NextRequest, { params }: Context) {
  // Reconciliation may durably commit a prepared operation, so GET is mutation-protected.
  const denied = await catalogueMediaAuthError(request, true);
  if (denied) return denied;
  if (!isValidCatalogueMediaId(params.operationId)) return catalogueMediaBadRequest();
  const { error } = await readCatalogueMediaProduct(params.id);
  if (error) return error;
  try {
    const operation = await getCatalogueMediaRemoval(params.id, params.operationId);
    if (!operation) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
    return response(operation);
  } catch (reason) { return catalogueMediaRequestError(reason); }
}

export async function POST(request: NextRequest, { params }: Context) {
  const denied = await catalogueMediaAuthError(request, true);
  if (denied) return denied;
  if (!isValidCatalogueMediaId(params.operationId)) return catalogueMediaBadRequest();
  const { product, error } = await readCatalogueMediaProduct(params.id);
  if (error) return error;
  const simDenied = await activeSimMediaMutationError(product);
  if (simDenied) return simDenied;
  let body: unknown;
  try { body = await readBoundedCatalogueJson(request); }
  catch (reason) { return catalogueAdminError(reason); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Object.prototype.hasOwnProperty.call(body, 'mediaIds')) return catalogueMediaBadRequest();
  const mediaIds = (body as { mediaIds?: unknown }).mediaIds;
  if (!Array.isArray(mediaIds) || mediaIds.length === 0 || mediaIds.length > 100
    || mediaIds.some(mediaId => !isValidCatalogueMediaId(mediaId)) || new Set(mediaIds).size !== mediaIds.length) return catalogueMediaBadRequest();
  try { return response(await finalizeCatalogueMediaRemoval(params.id, params.operationId, mediaIds)); }
  catch (reason) { return catalogueMediaRequestError(reason); }
}
