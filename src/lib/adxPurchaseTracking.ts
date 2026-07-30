'use client';

import {
  ADX_PURCHASE_COOKIE_KEY,
  normalizeAdxPaymentRef,
  serializeAdxPurchaseMarker,
} from '@/lib/adxPurchaseMarker';

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
  localStorage.setItem(ADX_PURCHASE_STORAGE_KEY, JSON.stringify(metadata));
  const marker = serializeAdxPurchaseMarker({
    refNo: metadata.refNo,
    paymentRefNo: metadata.paymentRefNo,
    simType: metadata.simType,
  });
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${ADX_PURCHASE_COOKIE_KEY}=${marker}; Path=/; Max-Age=7200; SameSite=Lax${secure}`;
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
  if (localStorage.getItem(trackedKey) === '1') return 'already-tracked';
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

  localStorage.setItem(trackedKey, '1');
  localStorage.removeItem(ADX_PURCHASE_STORAGE_KEY);
  return 'tracked';
}

export function trackAdxPaymentOutcome(refNo: string, outcome: AdxPaymentOutcome): TrackingResult {
  const normalizedRef = normalizeAdxPaymentRef(refNo);
  if (!normalizedRef) return 'not-ready';

  const trackedKey = `${ADX_OUTCOME_TRACKED_PREFIX}${outcome}:${normalizedRef}`;
  if (localStorage.getItem(trackedKey) === '1') return 'already-tracked';
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

  localStorage.setItem(trackedKey, '1');
  return 'tracked';
}
