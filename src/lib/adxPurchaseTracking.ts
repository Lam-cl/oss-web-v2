'use client';

const ADX_PURCHASE_STORAGE_KEY = 'tw_adx_purchase';
const ADX_TRACKED_PREFIX = 'tw_adx_purchase_tracked:';

export type AdxPurchaseMetadata = {
  refNo: string;
  paymentRefNo: string;
  value: number;
  currency: 'MYR';
  itemId: string;
  itemName: string;
  simType: 'physical' | 'esim';
};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function normalizeAdxPaymentRef(value: string) {
  return value.replace(/^(16|2|3)(twoss)/i, '$2').trim().toLowerCase();
}

export function rememberAdxPurchase(metadata: AdxPurchaseMetadata) {
  localStorage.setItem(ADX_PURCHASE_STORAGE_KEY, JSON.stringify(metadata));
}

export function trackAdxPurchase(refNo: string): 'tracked' | 'already-tracked' | 'not-ready' {
  const normalizedRef = normalizeAdxPaymentRef(refNo);
  if (!normalizedRef) return 'not-ready';

  const trackedKey = `${ADX_TRACKED_PREFIX}${normalizedRef}`;
  if (localStorage.getItem(trackedKey) === '1') return 'already-tracked';
  if (typeof window.gtag !== 'function') return 'not-ready';

  let metadata: AdxPurchaseMetadata | null = null;
  try {
    const raw = localStorage.getItem(ADX_PURCHASE_STORAGE_KEY);
    metadata = raw ? JSON.parse(raw) as AdxPurchaseMetadata : null;
  } catch {
    return 'not-ready';
  }

  if (
    !metadata
    || (
      normalizeAdxPaymentRef(metadata.refNo) !== normalizedRef
      && normalizeAdxPaymentRef(metadata.paymentRefNo) !== normalizedRef
    )
  ) {
    return 'not-ready';
  }

  window.gtag('event', 'purchase', {
    transaction_id: metadata.paymentRefNo || refNo,
    value: metadata.value,
    currency: metadata.currency,
    items: [{
      item_id: metadata.itemId,
      item_name: metadata.itemName,
      item_category: 'ADX SIM',
      item_variant: metadata.simType,
      price: metadata.value,
      quantity: 1,
    }],
  });

  localStorage.setItem(trackedKey, '1');
  localStorage.removeItem(ADX_PURCHASE_STORAGE_KEY);
  return 'tracked';
}
