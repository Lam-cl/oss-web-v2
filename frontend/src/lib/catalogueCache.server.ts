import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';
import { readCataloguePublicProjection } from '@/lib/cataloguePublicProjection.server';
import { withCachedDataApiReads } from '@/lib/dataApiClient.server';
import { readMerchandiseOrder } from '@/lib/merchandiseOrder.server';

export const CATALOGUE_TAG = 'catalogue-public';
export const CATALOGUE_REVALIDATE_SECONDS = 300;

/**
 * Published catalogue products plus the storefront display order: the same public payload
 * `/catalogue-products-api` served before caching. It holds no per-user data, so one shared
 * entry is safe. Invalidated by `invalidatePublicCatalogue()` after admin writes, otherwise
 * refreshed every 5 minutes (stale-while-revalidate).
 */
export const getPublicCatalogue = unstable_cache(
  async () => withCachedDataApiReads(async () => {
    const [catalogue, displayOrder] = await Promise.all([
      readCataloguePublicProjection(),
      readMerchandiseOrder().catch(() => ({ revision: 0, entries: [] })),
    ]);
    return { ...catalogue, displayOrder };
  }),
  ['catalogue-public-v1'],
  { revalidate: CATALOGUE_REVALIDATE_SECONDS, tags: [CATALOGUE_TAG] },
);

export type PublicCatalogue = Awaited<ReturnType<typeof getPublicCatalogue>>;

/**
 * Drops the cached public catalogue and the pages built from it. Call only after a write has
 * succeeded. Never throws: a failed invalidation must not fail the admin write (the cache
 * still expires on its own after CATALOGUE_REVALIDATE_SECONDS).
 */
export function invalidatePublicCatalogue() {
  const steps: Array<[string, () => void]> = [
    ['tag', () => revalidateTag(CATALOGUE_TAG)],
    ['product pages', () => revalidatePath('/merchandise/[slug]', 'page')],
    ['sitemap', () => revalidatePath('/sitemap.xml')],
  ];
  for (const [label, step] of steps) {
    try { step(); }
    catch (reason) { console.error(`Public catalogue invalidation failed (${label}).`, reason); }
  }
}

/** Invalidates the public catalogue when `response` is a success, then returns it unchanged. */
export function invalidatePublicCatalogueOnSuccess<T extends Response>(response: T): T {
  if (response.ok) invalidatePublicCatalogue();
  return response;
}
