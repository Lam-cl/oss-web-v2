'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MerchandiseProduct } from '@/data/merchandise';
import { loadMerchandiseProducts, merchandiseDisplayCache } from '@/lib/loadMerchandiseProducts';
import { useCartStore } from '@/store/cartStore';

export function useMerchandiseProducts({ displayCache = false } = {}) {
  const [products, setProducts] = useState<MerchandiseProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);
  const reconcileMerchandiseCatalog = useCartStore((state) => state.reconcileMerchandiseCatalog);
  const retry = useCallback(() => setRequestVersion((version) => version + 1), []);

  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();

    async function loadProducts(force = false) {
      if (running) return;
      const cached = displayCache ? merchandiseDisplayCache.peek() : null;
      if (cached) setProducts(cached.value);
      else if (displayCache) setProducts([]);
      if (cached?.fresh && !force) { setLoading(false); setError(''); return; }
      running = true;
      setLoading(true);
      setError('');
      try {
        const nextProducts = await (displayCache ? merchandiseDisplayCache.refresh() : loadMerchandiseProducts(controller.signal));
        if (!active) return;
        setProducts(nextProducts);
        reconcileMerchandiseCatalog(nextProducts);
        setError('');
      } catch (loadError) {
        if (!active || (loadError as Error).name === 'AbortError') return;
        if (!displayCache || !merchandiseDisplayCache.peek()) setProducts([]);
        setError('Merchandise could not be refreshed. Please try again.');
      } finally {
        running = false;
        if (active) setLoading(false);
      }
    }

    void loadProducts(requestVersion > 0);
    const refresh = () => { if (document.visibilityState === 'visible') void loadProducts(); };
    const timer = displayCache ? window.setInterval(refresh, 30_000) : undefined;
    if (displayCache) window.addEventListener('focus', refresh);
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [displayCache, reconcileMerchandiseCatalog, requestVersion]);

  const isCurrent = () => !loading && !error && (!displayCache || Boolean(merchandiseDisplayCache.peek()?.fresh));
  return { products, loading, error, retry, isCurrent };
}
