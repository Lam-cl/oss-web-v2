/** @type {import('next').NextConfig} */
const upstream =
  process.env.OSS_API_UPSTREAM?.replace(/\/$/, '') ||
  'https://www.tonewow.net/tgpayment';
/** Extra path between upstream host and :path* (e.g. `/api` for Nest global prefix). */
const upstreamPathPrefix = (process.env.OSS_API_PATH_PREFIX || '').replace(/\/$/, '');

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.prod.website-files.com',
      },
    ],
  },
  // Same-origin `/api-proxy/*` → upstream OSS API (avoids browser CORS to tonewow.net).
  async rewrites() {
    const prefix = upstreamPathPrefix ? `${upstreamPathPrefix}/` : '';
    return [
      {
        source: '/api-proxy/:path*',
        destination: `${upstream}/${prefix}:path*`,
      },
    ];
  },
};

export default nextConfig;
