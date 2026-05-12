/**
 * OSS REST base (`/devices`, `/orders`, `/proxy`, …).
 * - Empty NEXT_PUBLIC_API_URL → uses `/api` (Next.js API routes or current domain).
 * - Relative path (e.g. `/api-proxy`) → prepends current origin.
 * - Absolute URL → used directly (NestJS backend).
 */
export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (raw) {
    const base = raw.replace(/\/$/, '');
    if (base.startsWith('http://') || base.startsWith('https://')) {
      return base;
    }
    const path = base.startsWith('/') ? base : `/${base}`;
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
    return `${origin}${path}`;
  }
  return '/api';
}

/** True when API base is Next `/api-proxy` rewrite → tonewow tgpayment (no Nest `/proxy` route). */
export function isTgpaymentSameOriginRewrite(): boolean {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '') || '';
  return raw === '/api-proxy';
}

export const MALAYSIAN_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan',
  'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah',
  'Sarawak', 'Selangor', 'Terengganu',
  'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya',
];

export const SPECIAL_PRICING = {
  PREMIUM: { price: 988, plan: 'biz' },
  VIP: { price: 2298, plan: 'biz' },
  VVIP: { price: 3088, plan: 'biz' },
};
