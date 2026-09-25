/** Browser-memory display cache only. Checkout callers do not use this cache. */
export function createMerchandiseDisplayCache<T>(load: (preview: (value: T) => void) => Promise<T>, now = Date.now) {
  let saved: { value: T; at: number } | null = null;
  let preview: { value: T; at: number } | null = null;
  let pending: Promise<T> | null = null;
  const listeners = new Set<(value: T) => void>();
  return {
    peek() {
      if (!saved || now() - saved.at >= 300_000) return null;
      return { value: saved.value, fresh: now() - saved.at < 30_000 };
    },
    peekPreview() {
      return preview && now() - preview.at < 300_000 ? preview.value : null;
    },
    subscribePreview(listener: (value: T) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh() {
      if (pending) return pending;
      pending = load(value => {
        preview = { value, at: now() };
        listeners.forEach(listener => listener(value));
      }).then(value => { saved = { value, at: now() }; preview = null; return value; }).finally(() => { pending = null; });
      return pending;
    },
  };
}
