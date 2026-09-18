export type ReferralPrefix = 'TWE' | 'TWP';

export interface StoredReferralContext {
  prefix: ReferralPrefix;
  code: string;
  memberID: string;
  name: string;
  twpReferenceID: string;
  alloReferenceID: string;
  capturedAt: number;
}

export const REFERRAL_STORAGE_KEY = 'tw_referral_context';

export function normalizeReferralCode(prefix: ReferralPrefix, value: string): string {
  return value.replace(prefix, '').replace('-', '').replace(/\D/g, '');
}

export function buildMemberID(prefix: ReferralPrefix, code: string): string {
  return `${prefix}-${normalizeReferralCode(prefix, code)}`;
}

export function readReferralContext(): StoredReferralContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredReferralContext;
    if (!parsed?.prefix || !parsed?.code || !parsed?.memberID) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveReferralContext(context: StoredReferralContext): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(context));
}
