/** @type {import('next').NextConfig} */
const upstream =
  process.env.OSS_API_UPSTREAM?.replace(/\/$/, '') ||
  'https://www.tonewow.net/tgpayment';
/** Extra path between upstream host and :path* (e.g. `/api` for Nest global prefix). */
const upstreamPathPrefix = (process.env.OSS_API_PATH_PREFIX || '').replace(/\/$/, '');

/** Nest OSS API host (no `/api` suffix). Required on Vercel when `NEXT_PUBLIC_NEST_API_URL=/oss-nest-proxy`. */
const nestUpstream = process.env.OSS_NEST_UPSTREAM?.replace(/\/$/, '') || '';
const nestGlobalPrefix = (process.env.OSS_NEST_PATH_PREFIX || 'api').replace(/\/$/, '');

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.prod.website-files.com',
      },
    ],
  },
  // Same-origin `/api-proxy/*` → tgpayment (verifyPromoter, …). `/oss-nest-proxy/*` → Nest (`/numbers/search`, `/proxy`, …).
  async rewrites() {
    const prefix = upstreamPathPrefix ? `${upstreamPathPrefix}/` : '';
    const rules = [
      {
        source: '/api-proxy/:path*',
        destination: `${upstream}/${prefix}:path*`,
      },
    ];
    if (nestUpstream) {
      rules.push({
        source: '/oss-nest-proxy/:path*',
        destination: `${nestUpstream}/${nestGlobalPrefix}/:path*`,
      });
    }
    return rules;
  },
};

export default nextConfig;
