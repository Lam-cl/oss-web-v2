import { createHash } from 'crypto';
import { normalizeAdxPaymentRef } from '@/lib/adxPurchaseMarker';
import { readTokenRecord, writeTokenRecord } from '@/lib/tokenStore';
import type { AdxPurchaseMode } from '@/lib/adxCheckoutProof';

export type ServerAdxPaymentMarker = {
  flow: 'adx';
  prodDesc: 'OSSPaymentADX';
  refNo: string;
  paymentRefNo: string;
  simType: 'physical' | 'esim';
  purchaseMode: AdxPurchaseMode;
  createdAt: string;
};

const STORE_TYPE = 'adx-payment';
const MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;

function markerId(refNo: string) {
  const normalized = normalizeAdxPaymentRef(refNo);
  if (!normalized) return '';
  return createHash('sha256').update(normalized).digest('base64url');
}

export async function rememberAdxPaymentReference(marker: ServerAdxPaymentMarker) {
  const id = markerId(marker.paymentRefNo);
  if (!id || normalizeAdxPaymentRef(marker.refNo) !== normalizeAdxPaymentRef(marker.paymentRefNo)) {
    throw new Error('Invalid ADX payment reference');
  }
  await writeTokenRecord(STORE_TYPE, id, marker, MARKER_TTL_SECONDS);
}

export async function readAdxPaymentReference(refNo: string) {
  const id = markerId(refNo);
  if (!id) return null;
  try {
    const marker = await readTokenRecord<ServerAdxPaymentMarker>(STORE_TYPE, id);
    if (!marker || marker.flow !== 'adx' || marker.prodDesc !== 'OSSPaymentADX') return null;
    if (normalizeAdxPaymentRef(marker.paymentRefNo) !== normalizeAdxPaymentRef(refNo)) return null;
    return marker;
  } catch {
    return null;
  }
}
