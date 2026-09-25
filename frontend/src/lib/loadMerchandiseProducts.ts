import { mergeBundleMerchandiseProducts, type BundleMerchandiseProduct, type MerchandiseProduct } from '@/data/merchandise';
import { adaptCatalogueStorefrontPayload, CATALOGUE_STOREFRONT_ENDPOINT } from '@/lib/catalogueStorefront';
import { createMerchandiseDisplayCache } from '@/lib/merchandiseDisplayCache';
import bootstrapCatalogue from '@/data/merchandiseBootstrap.json';

// A published, browse-only snapshot gives first-time visitors cards immediately.
// Live Catalogue replaces it, and Bundle must confirm stock before cart actions.
export const merchandiseBootstrapProducts = adaptCatalogueStorefrontPayload(bootstrapCatalogue, []);

export async function loadMerchandiseProducts(signal?: AbortSignal, onPublished?: (products: ReturnType<typeof adaptCatalogueStorefrontPayload>) => void) {
  // Independent reads start together; adaptation still requires live Bundle stock.
  const bundle = fetch('/bundle/merchandise', { cache: 'no-store', signal }).then(async response => {
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.data)) throw new Error('Unable to load merchandise');
    return mergeBundleMerchandiseProducts(result.data as BundleMerchandiseProduct[]);
  });
  const catalogue = fetch(CATALOGUE_STOREFRONT_ENDPOINT, { cache: 'no-store', signal })
    .then(async response => {
      const payload = response.ok ? await response.json() : null;
      if (payload && !signal?.aborted && onPublished) {
        const published = adaptCatalogueStorefrontPayload(payload, []);
        if (published.length) onPublished(published);
      }
      return payload;
    }).catch(() => null);
  const [fallback, payload] = await Promise.all([bundle, catalogue]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return adaptCatalogueStorefrontPayload(payload, fallback);
}

export const merchandiseDisplayCache = createMerchandiseDisplayCache<MerchandiseProduct[]>(preview => loadMerchandiseProducts(undefined, preview));
export function prefetchMerchandiseProducts() {
  if (typeof window === 'undefined' || merchandiseDisplayCache.peek()?.fresh) return;
  void merchandiseDisplayCache.refresh().catch(() => { /* Mounted consumers expose errors and Retry. */ });
}
