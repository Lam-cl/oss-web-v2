import type { MetadataRoute } from 'next';
import { getPublicCatalogue } from '@/lib/catalogueCache.server';
import { catalogueSlugs } from '@/lib/merchandiseDetail';
import { absoluteSiteUrl } from '@/lib/siteUrl';

export const revalidate = 3600;

const STATIC_PAGES = ['/', '/sim/plans', '/sim-replacement-tnc'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = STATIC_PAGES.map((path) => ({ url: absoluteSiteUrl(path) }));
  // Merchandise pages redirect home when the storefront is switched off (see middleware).
  if (process.env.NEXT_PUBLIC_ENABLE_MERCHANDISE?.trim().toLowerCase() !== 'true') return pages;
  let slugs: string[] = [];
  try { slugs = catalogueSlugs(await getPublicCatalogue()); }
  catch { /* Catalogue unavailable: list the static pages only until the next revalidation. */ }
  return [...pages, ...slugs.map((slug) => ({ url: absoluteSiteUrl(`/merchandise/${encodeURIComponent(slug)}`) }))];
}
