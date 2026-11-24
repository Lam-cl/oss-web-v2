import { request } from 'node:https';
import { mergeBundleMerchandiseProducts, type BundleMerchandiseProduct, type MerchandiseProduct } from '@/data/merchandise';
import { BUNDLE_MERCHANDISE_URL, visibleBundleMerchandise } from '@/lib/bundleMerchandise';
import { withCachedDataApiReads } from '@/lib/dataApiClient.server';
import { readProductImageColorSettings } from '@/lib/productImageColors.server';

const TIMEOUT_MS = 10_000;

// Deliberately bypasses Next's patched `fetch`: inside an ISR page render a `cache: 'no-store'`
// fetch throws DynamicServerError, and at runtime Next 14.2 turns that into a 500
// ("Page changed from static to dynamic at runtime"). node:https is invisible to Next, so this
// read is always fresh and the page stays ISR.
function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers: { accept: 'application/json' }, timeout: TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) { reject(new Error(`Bundle merchandise request failed (${status}).`)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (reason) { reject(reason); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Bundle merchandise request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fresh, uncached read of live Bundle merchandise, filtered exactly like `/api/bundle/merchandise`
 * and merged like the storefront client does. Rejects when Bundle cannot be read, so callers can
 * avoid caching a 404 for a product that may exist.
 */
export async function readLiveBundleMerchandiseProducts(): Promise<MerchandiseProduct[]> {
  // Image colours only hide option values / assign images; a stale or missing copy is corrected
  // by the client's live read, so read it via the cached path and never fail on it.
  const imageColorsRead = withCachedDataApiReads(() => readProductImageColorSettings())
    .catch(() => ({ products: {}, hiddenOptionValues: {} }));
  const data = await getJson(BUNDLE_MERCHANDISE_URL) as { data?: unknown };
  if (!Array.isArray(data?.data)) throw new Error('Bundle merchandise response is invalid.');
  const visible = visibleBundleMerchandise(data, await imageColorsRead);
  return mergeBundleMerchandiseProducts(visible.data as BundleMerchandiseProduct[]);
}
