export type CheckoutPolicy = {
  enabled: boolean;
  message: string;
  paymentOrigin: string | null;
};

export const CHECKOUT_PAUSED_MESSAGE = 'Merchandise checkout is temporarily unavailable while we prepare our payment service. Your cart is saved. Please try again later.';
const STAGING_ORIGIN = 'https://api-staging.pay.asia';

/** Server-owned configuration only; never trust a checkout payload for this policy. */
export function merchandiseCheckoutPolicy(
  env: Record<string, string | undefined>,
  authenticatedTester = false,
): CheckoutPolicy {
  const environment = env.GKASH_ENVIRONMENT?.trim().toLowerCase();
  const mode = env.MERCHANDISE_CHECKOUT_MODE?.trim().toLowerCase();
  let paymentOrigin: string | null = null;
  if (environment === 'staging' && env.VERCEL_ENV !== 'production') {
    paymentOrigin = STAGING_ORIGIN;
  } else if (environment === 'production') {
    try {
      const url = new URL(env.GKASH_PRODUCTION_PAYMENT_ORIGIN?.trim() || '');
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port
        && url.pathname === '/' && !url.search && !url.hash
        && !/staging|sandbox|localhost/i.test(url.hostname)) paymentOrigin = url.origin;
    } catch { /* Missing or malformed evidence/configuration fails closed. */ }
  }
  const enabled = Boolean(paymentOrigin && (mode === 'open' || (mode === 'qa' && authenticatedTester)));
  return { enabled, paymentOrigin, message: enabled ? '' : CHECKOUT_PAUSED_MESSAGE };
}

export function isAllowedMerchandisePaymentUrl(value: string, policy: CheckoutPolicy) {
  if (!policy.enabled || !policy.paymentOrigin) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && url.origin === policy.paymentOrigin;
  } catch { return false; }
}
