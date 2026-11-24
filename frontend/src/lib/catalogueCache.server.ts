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
async function loadPublicCatalogue() {
  return withCachedDataApiReads(async () => {
    const [catalogue, displayOrder] = await Promise.all([
      readCataloguePublicProjection(),
      readMerchandiseOrder().catch(() => ({ revision: 0, entries: [] })),
    ]);
    return { ...catalogue, displayOrder };
  });
}

const cachedPublicCatalogue = unstable_cache(
  loadPublicCatalogue,
  ['catalogue-public-v1'],
  { revalidate: CATALOGUE_REVALIDATE_SECONDS, tags: [CATALOGUE_TAG] },
);

const NO_INCREMENTAL_CACHE = 'Invariant: incrementalCache missing in unstable_cache';

export async function getPublicCatalogue(): Promise<Awaited<ReturnType<typeof loadPublicCatalogue>>> {
  try {
    return await cachedPublicCatalogue();
  } catch (reason) {
    // Outside a Next server (scripts, node harnesses) there is no incremental cache; read directly.
    if (reason instanceof Error && reason.message.startsWith(NO_INCREMENTAL_CACHE)) return loadPublicCatalogue();
    throw reason;
  }
}

export type PublicCatalogue = Awaited<ReturnType<typeof getPublicCatalogue>>;

/**
 * Drops the cached public catalogue and the pages built from it. Call after every attempted
 * admin write. Never throws: a failed invalidation must not fail the admin write (the cache
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

/**
 * Runs an admin catalogue mutation and always invalidates the public catalogue afterwards,
 * whether it succeeded, failed or threw: a write can commit and then fail a later step (e.g.
 * publish succeeding before a follow-up step throws), so success alone is not a safe signal.
 * Invalidation itself never throws, so it cannot change the mutation's response or error.
 */
export async function withPublicCatalogueInvalidation<T>(mutation: () => Promise<T>): Promise<T> {
  try { return await mutation(); }
  finally { invalidatePublicCatalogue(); }
}
