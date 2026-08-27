import { BUNDLE_API, readUpstream } from '@/lib/admin/server';
import { listCatalogueProducts } from '@/lib/admin/catalogueProduct.server';

type Row = Record<string, any>;

export class LegacyProductArchiveError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502 | 503 = 400) { super(message); }
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const object = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unwrap = (value: unknown) => object(value) && object(value.data) ? value.data : value;
const inventory = (product: Row) => Array.isArray(product.productVariants)
  ? product.productVariants.reduce((sum: number, variant: unknown) => sum + (object(variant) && Number.isSafeInteger(Number(variant.inventory)) ? Number(variant.inventory) : 0), 0)
  : 0;
const deleted = (product: unknown, id: number) => object(product) && product.id === id
  && (product.deleted === true || typeof product.deletedAt === 'string' && Boolean(product.deletedAt));

async function providerProduct(id: number, headers: Headers) {
  let response: Response;
  try { response = await fetch(`${BUNDLE_API}/products/${id}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) }); }
  catch { throw new LegacyProductArchiveError('Bundle product verification is temporarily unavailable.', 503); }
  const payload = await readUpstream(response);
  if (!response.ok) throw new LegacyProductArchiveError(response.status === 404 ? 'Legacy product was not found.' : 'Bundle product verification failed.', response.status === 404 ? 404 : 502);
  const product = unwrap(payload); if (!object(product) || product.id !== id) throw new LegacyProductArchiveError('Bundle product readback is invalid.', 502);
  return product;
}

export async function archiveLegacyProduct(id: unknown, input: unknown, token: string) {
  if (!positive(id) || !object(input) || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(['expectedInventory', 'expectedTitle', 'expectedUpdatedAt'])
    || typeof input.expectedTitle !== 'string' || !input.expectedTitle || input.expectedTitle.length > 240
    || typeof input.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(input.expectedUpdatedAt))
    || !Number.isSafeInteger(input.expectedInventory) || input.expectedInventory < 0) {
    throw new LegacyProductArchiveError('Exact legacy product confirmation is required.');
  }
  const productId = id as number;
  const headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' });
  const before = await providerProduct(productId, headers);
  if (deleted(before, productId)) return { productId, deletedAt: before.deletedAt, idempotent: true };
  if (before.type !== 'MERCHANDISE' || before.requiresSimAssignment === true) throw new LegacyProductArchiveError('SIM and non-merchandise products cannot use the legacy archive flow.', 409);
  if (before.title !== input.expectedTitle || before.updatedAt !== input.expectedUpdatedAt || inventory(before) !== input.expectedInventory) {
    throw new LegacyProductArchiveError('Legacy product changed after confirmation. Refresh and review it again.', 409);
  }
  const catalogue = await listCatalogueProducts();
  if (catalogue.some(product => product.currentBundleProductId === productId
    || product.bundleVersions.some(version => version.bundleProductId === productId))) {
    throw new LegacyProductArchiveError('This provider product is managed by Catalogue and must use the Catalogue lifecycle.', 409);
  }

  let mutationError: LegacyProductArchiveError | null = null;
  try {
    const response = await fetch(`${BUNDLE_API}/products/${productId}/soft-delete`, {
      method: 'DELETE', headers, cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) mutationError = new LegacyProductArchiveError('Bundle refused to archive the legacy product.', 502);
  } catch { mutationError = new LegacyProductArchiveError('Bundle product archive status is uncertain.', 503); }
  const after = await providerProduct(productId, headers);
  if (!deleted(after, productId)) throw mutationError || new LegacyProductArchiveError('Bundle did not confirm the legacy product archive.', 502);
  return { productId, deletedAt: after.deletedAt, idempotent: false };
}
