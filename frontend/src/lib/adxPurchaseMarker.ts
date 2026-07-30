export const ADX_PURCHASE_COOKIE_KEY = 'tw_adx_purchase';

export type AdxPurchaseMarker = {
  refNo: string;
  paymentRefNo: string;
  simType: 'physical' | 'esim';
};

export function normalizeAdxPaymentRef(value: string) {
  return value.replace(/^(16|2|3)(twoss)/i, '$2').trim().toLowerCase();
}

export function serializeAdxPurchaseMarker(marker: AdxPurchaseMarker) {
  return encodeURIComponent(JSON.stringify(marker));
}

export function parseAdxPurchaseMarker(value: string | undefined): AdxPurchaseMarker | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<AdxPurchaseMarker>;
    if (
      typeof parsed.refNo !== 'string'
      || typeof parsed.paymentRefNo !== 'string'
      || (parsed.simType !== 'physical' && parsed.simType !== 'esim')
    ) {
      return null;
    }

    return parsed as AdxPurchaseMarker;
  } catch {
    return null;
  }
}

export function matchesAdxPurchaseMarker(marker: AdxPurchaseMarker | null, refNo: string) {
  const normalizedRef = normalizeAdxPaymentRef(refNo);
  if (!marker || !normalizedRef) return false;

  return normalizeAdxPaymentRef(marker.refNo) === normalizedRef
    || normalizeAdxPaymentRef(marker.paymentRefNo) === normalizedRef;
}
