import type { NextRequest } from 'next/server';
import { getAdminSession, requestIsSameOrigin, safeError } from '@/lib/admin/server';
import { readCatalogueProduct, type CatalogueProductRecord } from '@/lib/admin/catalogueProduct.server';
import type { CatalogueMediaMetadata } from '@/lib/admin/catalogueMedia.server';
import { readCatalogueAdoptionByBundle } from '@/lib/admin/catalogueAdoption.server';

const MULTIPART_MAX_BYTES = 11 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class CatalogueMediaRequestError extends Error {
  constructor(readonly status: 400 | 413) {
    super(status === 413 ? 'Catalogue media request is too large.' : 'Catalogue media request is invalid.');
  }
}

export function publicCatalogueMedia(media: CatalogueMediaMetadata) {
  const { mediaId, catalogueId, originalName, contentType, bytes, order, assignment, createdAt } = media;
  return { mediaId, catalogueId, originalName, contentType, bytes, order, assignment, createdAt,
    url: `/catalogue-products-api?catalogueId=${encodeURIComponent(catalogueId)}&mediaId=${encodeURIComponent(mediaId)}` };
}

export function catalogueMediaError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : '';
  if (/Catalogue media .* was not found\.$/.test(message)) return safeError(404);
  if (/10 MB|100 MiB|at most 100 media items/.test(message)) return safeError(413);
  if (/^(?:A valid (?:catalogue|media)|A safe media|Media |Catalogue media (?:input|update|may use)|Duplicate catalogue media order)/.test(message)) {
    return safeError(400, { message });
  }
  return safeError(500, { message: 'Media katalog tidak dapat diproses. Sila cuba lagi.' });
}

export async function catalogueMediaAuthError(request: NextRequest, mutation: boolean) {
  if (!await getAdminSession(request)) return safeError(401);
  if (mutation && !requestIsSameOrigin(request)) return safeError(403);
  return null;
}

export async function readCatalogueMediaProduct(id: string): Promise<
  { product: CatalogueProductRecord; error: null } | { product: null; error: Response }
> {
  try {
    const product = await readCatalogueProduct(id);
    return product ? { product, error: null } : { product: null, error: safeError(404) };
  } catch (reason) {
    const error = /valid catalogue ID/i.test(reason instanceof Error ? reason.message : '')
      ? safeError(400)
      : safeError(500, { message: 'Produk katalog tidak dapat diproses. Sila cuba lagi.' });
    return { product: null, error };
  }
}

export async function activeSimMediaMutationError(product: CatalogueProductRecord) {
  if (product.currentBundleProductId === null) return null;
  const adoption = await readCatalogueAdoptionByBundle(product.currentBundleProductId);
  return adoption?.status === 'active' && adoption.catalogueId === product.catalogueId && adoption.managementProfile?.domain === 'SIM'
    ? safeError(409, { message: 'Active SIM adoption media is managed by the SIM workflow.' })
    : null;
}

export function isValidCatalogueMediaId(mediaId: unknown): mediaId is string {
  return typeof mediaId === 'string' && UUID_PATTERN.test(mediaId);
}

export function isActiveCatalogueMediaAssignment(product: CatalogueProductRecord, assignment: unknown): assignment is string {
  if (assignment === 'all') return true;
  if (typeof assignment !== 'string') return false;
  return product.model.choices.some((choice) => choice.values.some((value) => !value.retired && value.key === assignment));
}

export async function readBoundedCatalogueMediaForm(request: NextRequest) {
  const lengthHeader = request.headers.get('content-length');
  if (lengthHeader !== null) {
    if (!/^\d+$/.test(lengthHeader)) throw new CatalogueMediaRequestError(400);
    const declared = Number(lengthHeader);
    if (!Number.isSafeInteger(declared)) throw new CatalogueMediaRequestError(400);
    if (declared > MULTIPART_MAX_BYTES) throw new CatalogueMediaRequestError(413);
  }
  if (!request.body) throw new CatalogueMediaRequestError(400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new CatalogueMediaRequestError(400);
      total += value.byteLength;
      if (!Number.isSafeInteger(total) || total > MULTIPART_MAX_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new CatalogueMediaRequestError(413);
      }
      chunks.push(new Uint8Array(value));
    }
  } catch (reason) {
    if (reason instanceof CatalogueMediaRequestError) throw reason;
    throw new CatalogueMediaRequestError(400);
  } finally {
    reader.releaseLock();
  }

  const headers = new Headers(request.headers);
  headers.set('content-length', String(total));
  try {
    const bounded = new Request(request.url, {
      method: 'POST',
      headers,
      body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total),
    });
    return await bounded.formData();
  } catch {
    throw new CatalogueMediaRequestError(400);
  }
}

export function catalogueMediaRequestError(reason: unknown) {
  return reason instanceof CatalogueMediaRequestError ? safeError(reason.status) : catalogueMediaError(reason);
}

export function catalogueMediaBadRequest() {
  return safeError(400);
}
