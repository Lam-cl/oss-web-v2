/**
 * Resolves a public API base. Relative paths (`/api`, `/api-proxy`, …) stay path-only on the
 * server so Next.js can resolve them against the **incoming request host** (shop.tonewow.com,
 * oss.tonewow.com, oss.tonewow.net). Never use `VERCEL_URL` here — it is not the visitor’s host.
 */
function resolvePublicApiBase(raw: string): string {
  const base = raw.replace(/\/$/, '');
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return base;
  }
  const path = base.startsWith('/') ? base : `/${base}`;
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path}`;
  }
  return path;
}

/**
 * Tonewow tgpayment same-origin base (`/verifyPromoter`, …) when `NEXT_PUBLIC_API_URL=/api-proxy`.
 */
export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (raw) {
    return resolvePublicApiBase(raw);
  }
  return '/api';
}

/**
 * Nest OSS API (`/numbers`, `/devices`, `/proxy`, …).
 * - Default `/api` on the same host: implement proxies under `src/app/api/…` or set `NEST_API_BASE_URL` for server-side forwarding.
 * - Or `NEXT_PUBLIC_NEST_API_URL` / `NEXT_PUBLIC_API_URL` as absolute Nest URL.
 */
export function getNestApiBaseUrl(): string {
  const nest = process.env.NEXT_PUBLIC_NEST_API_URL?.trim();
  if (nest) {
    return resolvePublicApiBase(nest);
  }
  const main = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (main) {
    return resolvePublicApiBase(main);
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
