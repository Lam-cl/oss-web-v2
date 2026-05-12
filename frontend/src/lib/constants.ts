const LOCAL_NEST = 'http://localhost:4000/api';

function resolvePublicApiBase(raw: string): string {
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

/**
<<<<<<< HEAD
 * Tonewow tgpayment same-origin base (`/verifyPromoter`, `/saveRefAllocation`, …).
 * Use with `NEXT_PUBLIC_API_URL=/api-proxy` + rewrite to `OSS_API_UPSTREAM`.
=======
 * OSS REST base (`/devices`, `/orders`, `/proxy`, …).
 * - Empty NEXT_PUBLIC_API_URL → uses `/api` (Next.js API routes or current domain).
 * - Relative path (e.g. `/api-proxy`) → prepends current origin.
 * - Absolute URL → used directly (NestJS backend).
>>>>>>> 79706a8f17beae6c421168e6f265ebe44c3d9b3f
 */
export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (raw) {
    return resolvePublicApiBase(raw);
  }
<<<<<<< HEAD
  return LOCAL_NEST;
}

/**
 * Nest OSS API (`/numbers`, `/devices`, `/proxy`, `/payment`, …).
 * When using `/api-proxy` for tgpayment only, set `NEXT_PUBLIC_NEST_API_URL=/oss-nest-proxy` and `OSS_NEST_UPSTREAM` in `next.config` rewrites.
 * Otherwise defaults to the same base as `NEXT_PUBLIC_API_URL` or local Nest.
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
  return LOCAL_NEST;
=======
  return '/api';
>>>>>>> 79706a8f17beae6c421168e6f265ebe44c3d9b3f
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
