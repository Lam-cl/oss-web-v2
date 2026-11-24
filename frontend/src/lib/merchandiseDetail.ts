import { getMerchandiseProduct, type MerchandiseProduct } from '@/data/merchandise';
import { adaptCatalogueStorefrontPayload } from '@/lib/catalogueStorefront';

type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The raw published catalogue record for `slug`, or null. */
export function catalogueRecordForSlug(payload: unknown, slug: string): Row | null {
  const products = row(payload) && Array.isArray(payload.products) ? payload.products : [];
  return (products.find((product) => row(product) && typeof product.slug === 'string' && product.slug.trim() === slug) as Row | undefined) || null;
}

/** Published catalogue slugs (raw records), de-duplicated, in catalogue order. */
export function catalogueSlugs(payload: unknown): string[] {
  const products = row(payload) && Array.isArray(payload.products) ? payload.products : [];
  const slugs = products.flatMap((product) => row(product) && typeof product.slug === 'string' && product.slug.trim() ? [product.slug.trim()] : []);
  return Array.from(new Set(slugs));
}

/**
 * Resolves the product shown on /merchandise/[slug] with the same adapter the storefront uses.
 * `liveProducts` is the merged live Bundle list (stock, pre-order). The server passes [] (no
 * stock yet); the client passes live data once `/bundle/merchandise` has loaded. Falls back to
 * the live Bundle list, then to the static product list.
 */
export function resolveMerchandiseDetailProducts(
  slug: string,
  catalogueRecord: unknown,
  liveProducts: MerchandiseProduct[],
): { product: MerchandiseProduct | null; products: MerchandiseProduct[] } {
  const products = adaptCatalogueStorefrontPayload({ products: catalogueRecord ? [catalogueRecord] : [] }, liveProducts);
  return { product: products.find((item) => item.slug === slug) || getMerchandiseProduct(slug) || null, products };
}
