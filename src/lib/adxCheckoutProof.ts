import { createSignedToken, verifySignedToken } from '@/lib/registerToken';

export type AdxPurchaseMode = 'superlite' | 'superliteplus';

const PROOF_TYPE = 'tonewow_adx_checkout';
const PROOF_TTL_SECONDS = 2 * 60 * 60;

export function isAdxPurchaseMode(value: unknown): value is AdxPurchaseMode {
  return value === 'superlite' || value === 'superliteplus';
}

export function createAdxCheckoutProof(purchaseMode: AdxPurchaseMode) {
  const now = Math.floor(Date.now() / 1000);
  return createSignedToken({
    typ: PROOF_TYPE,
    purchaseMode,
    iat: now,
    exp: now + PROOF_TTL_SECONDS,
  });
}

export function verifyAdxCheckoutProof(token: string, expectedMode: AdxPurchaseMode) {
  const payload = verifySignedToken(token);
  if (payload.typ !== PROOF_TYPE || payload.purchaseMode !== expectedMode) {
    throw new Error('Invalid ADX checkout proof');
  }
  return true;
}
