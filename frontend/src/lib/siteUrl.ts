/** Canonical public origin for absolute URLs (sitemap, robots, Open Graph). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://shop.tonewow.com').replace(/\/+$/, '');

/** Absolute URL for a site path; absolute http(s) URLs are returned unchanged. */
export function absoluteSiteUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
