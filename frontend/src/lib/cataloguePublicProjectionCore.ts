// Dependency-free helpers for the public catalogue projection (unit-tested with node:test).

export const PROJECTION_READ_CONCURRENCY = 8;

/**
 * Runs `project` for every item with at most `limit` calls in flight and resolves with the
 * non-null results in the original item order. The first rejection rejects the whole call
 * (like the sequential loop it replaces) and stops scheduling further items.
 */
export async function mapInOrder<T, R>(
  items: readonly T[],
  project: (item: T, index: number) => Promise<R | null | undefined>,
  limit = PROJECTION_READ_CONCURRENCY,
): Promise<R[]> {
  const results: Array<R | null | undefined> = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await project(items[index], index); }
      catch (reason) { failed = true; throw reason; }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results.filter((value): value is R => value !== null && value !== undefined);
}
