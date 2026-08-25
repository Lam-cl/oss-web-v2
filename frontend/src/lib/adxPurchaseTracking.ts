'use client';

import { normalizeAdxPaymentRef } from '@/lib/adxPurchaseMarker';

const ADX_PURCHASE_STORAGE_KEY = 'tw_adx_purchase';
const ADX_TRACKED_PREFIX = 'tw_adx_purchase_tracked:';
const ADX_OUTCOME_TRACKED_PREFIX = 'tw_adx_payment_outcome_tracked:';

export { normalizeAdxPaymentRef } from '@/lib/adxPurchaseMarker';

export type AdxPurchaseMetadata = {
  refNo: string;
  paymentRefNo: string;
  value: number;
  currency: 'MYR';
  itemId: string;
  itemName: string;
  simType: 'physical' | 'esim';
};

export type AdxPaymentOutcome = 'failed' | 'pending';
type TrackingResult = 'tracked' | 'already-tracked' | 'not-ready';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function rememberAdxPurchase(metadata: AdxPurchaseMetadata) {
  try {
    localStorage.setItem(ADX_PURCHASE_STORAGE_KEY, JSON.stringify(metadata));
  } catch {
    // Payment routing uses signed callback context; browser storage is optional.
  }
}

export function getMatchingAdxPurchase(refNo: string): AdxPurchaseMetadata | null {
  const normalizedRef = normalizeAdxPaymentRef(refNo);
  if (!normalizedRef) return null;

  try {
    const raw = localStorage.getItem(ADX_PURCHASE_STORAGE_KEY);
    const metadata = raw ? JSON.parse(raw) as AdxPurchaseMetadata : null;
    if (
      metadata
      && (
        normalizeAdxPaymentRef(metadata.refNo) === normalizedRef
        || normalizeAdxPaymentRef(metadata.paymentRefNo) === normalizedRef
      )
    ) {
      return metadata;
    }
  } catch {
    // Ignore invalid or unavailable browser storage.
  }

  return null;
}

export function trackAdxPurchase(refNo: string): TrackingResult {
  const normalizedRef = normalizeAdxPaymentRef(refNo);
  if (!normalizedRef) return 'not-ready';

  const trackedKey = `${ADX_TRACKED_PREFIX}${normalizedRef}`;
  try {
    if (localStorage.getItem(trackedKey) === '1') return 'already-tracked';
  } catch {
    return 'not-ready';
  }
  if (typeof window.gtag !== 'function') return 'not-ready';

  const metadata = getMatchingAdxPurchase(refNo);
  if (!metadata) return 'not-ready';

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

  try {
    localStorage.setItem(trackedKey, '1');
    localStorage.removeItem(ADX_PURCHASE_STORAGE_KEY);
  } catch {
    // Tracking was sent; unavailable storage only prevents client-side deduplication.
  }
  return 'tracked';
}

export function trackAdxPaymentOutcome(refNo: string, outcome: AdxPaymentOutcome): TrackingResult {
  const normalizedRef = normalizeAdxPaymentRef(refNo);
  if (!normalizedRef) return 'not-ready';

  const trackedKey = `${ADX_OUTCOME_TRACKED_PREFIX}${outcome}:${normalizedRef}`;
  try {
    if (localStorage.getItem(trackedKey) === '1') return 'already-tracked';
  } catch {
    return 'not-ready';
  }
  if (typeof window.gtag !== 'function') return 'not-ready';

  const metadata = getMatchingAdxPurchase(refNo);
  if (!metadata) return 'not-ready';

  window.gtag('event', `payment_${outcome}`, {
    transaction_id: metadata.paymentRefNo || refNo,
    value: metadata.value,
    currency: metadata.currency,
    payment_status: outcome,
    items: [{
      item_id: metadata.itemId,
      item_name: metadata.itemName,
      item_category: 'ADX SIM',
      item_variant: metadata.simType,
      price: metadata.value,
      quantity: 1,
    }],
  });

  try { localStorage.setItem(trackedKey, '1'); } catch { /* tracking was already sent */ }
  return 'tracked';
}
