'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  mergeBundleMerchandiseProducts,
  type BundleMerchandiseProduct,
  type MerchandiseProduct,
} from '@/data/merchandise';
import { useCartStore } from '@/store/cartStore';

export function useMerchandiseProducts() {
  const [products, setProducts] = useState<MerchandiseProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);
  const reconcileMerchandiseCatalog = useCartStore((state) => state.reconcileMerchandiseCatalog);
  const retry = useCallback(() => setRequestVersion((version) => version + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProducts() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/bundle/merchandise', {
          signal: controller.signal,
          cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.data)) {
          throw new Error(result.error || 'Unable to load merchandise');
        }
        const nextProducts = mergeBundleMerchandiseProducts(result.data as BundleMerchandiseProduct[]);
        setProducts(nextProducts);
        reconcileMerchandiseCatalog(nextProducts);
        setError('');
      } catch (loadError) {
        if ((loadError as Error).name === 'AbortError') return;
        setProducts([]);
        setError('Merchandise is temporarily unavailable. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadProducts();
    return () => controller.abort();
  }, [reconcileMerchandiseCatalog, requestVersion]);

  return { products, loading, error, retry };
}
