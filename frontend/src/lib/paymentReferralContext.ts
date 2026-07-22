import { createSignedToken, verifySignedToken } from '@/lib/registerToken';

export type PaymentReferralContext = {
  refNo: string;
  prefix: 'TWP';
  code: string;
  memberID: string;
  referenceID: string;
  name: string;
};

const CONTEXT_TYPE = 'tonewow_payment_referral';
const CONTEXT_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createPaymentReferralContext(context: PaymentReferralContext) {
  const now = Math.floor(Date.now() / 1000);
  return createSignedToken({
    typ: CONTEXT_TYPE,
    ...context,
    iat: now,
    exp: now + CONTEXT_TTL_SECONDS,
  });
}

export function verifyPaymentReferralContext(token: string, expectedRefNo: string): PaymentReferralContext {
  const payload = verifySignedToken(token);
  if (payload.typ !== CONTEXT_TYPE) throw new Error('Invalid payment referral context type');
  if (payload.refNo !== expectedRefNo) throw new Error('Payment reference mismatch');

  const prefix = payload.prefix;
  const code = typeof payload.code === 'string' ? payload.code.trim() : '';
  const memberID = typeof payload.memberID === 'string' ? payload.memberID.trim().toUpperCase() : '';
  const referenceID = typeof payload.referenceID === 'string' ? payload.referenceID.trim() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';

  if (prefix !== 'TWP' || !/^\d+$/.test(code) || memberID !== `TWP-${code}` || !referenceID) {
    throw new Error('Invalid payment referral context');
  }

  return { refNo: expectedRefNo, prefix, code, memberID, referenceID, name };
}
