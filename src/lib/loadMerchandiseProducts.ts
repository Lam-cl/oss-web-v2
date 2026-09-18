import { mergeBundleMerchandiseProducts, type BundleMerchandiseProduct } from '@/data/merchandise';
import { adaptCatalogueStorefrontPayload, CATALOGUE_STOREFRONT_ENDPOINT } from '@/lib/catalogueStorefront';
import { createMerchandiseDisplayCache } from '@/lib/merchandiseDisplayCache';

export async function loadMerchandiseProducts(signal?: AbortSignal) {
  // Independent reads start together; adaptation still requires live Bundle stock.
  const bundle = fetch('/bundle/merchandise', { cache: 'no-store', signal }).then(async response => {
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.data)) throw new Error('Unable to load merchandise');
    return mergeBundleMerchandiseProducts(result.data as BundleMerchandiseProduct[]);
  });
  const catalogue = fetch(CATALOGUE_STOREFRONT_ENDPOINT, { cache: 'no-store', signal })
    .then(response => response.ok ? response.json() : null).catch(() => null);
  const [fallback, payload] = await Promise.all([bundle, catalogue]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return adaptCatalogueStorefrontPayload(payload, fallback);
}

export const merchandiseDisplayCache = createMerchandiseDisplayCache(() => loadMerchandiseProducts());
export function prefetchMerchandiseProducts() {
  if (typeof window === 'undefined' || merchandiseDisplayCache.peek()?.fresh) return;
  void merchandiseDisplayCache.refresh().catch(() => { /* Mounted consumers expose errors and Retry. */ });
}
