/** Browser-memory display cache only. Checkout callers do not use this cache. */
export function createMerchandiseDisplayCache<T>(load: () => Promise<T>, now = Date.now) {
  let saved: { value: T; at: number } | null = null;
  let pending: Promise<T> | null = null;
  return {
    peek() {
      if (!saved || now() - saved.at >= 300_000) return null;
      return { value: saved.value, fresh: now() - saved.at < 30_000 };
    },
    refresh() {
      if (pending) return pending;
      pending = load().then(value => { saved = { value, at: now() }; return value; }).finally(() => { pending = null; });
      return pending;
    },
  };
}
