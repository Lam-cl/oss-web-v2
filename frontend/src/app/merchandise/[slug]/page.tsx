import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getMerchandiseProduct } from '@/data/merchandise';
import { getPublicCatalogue } from '@/lib/catalogueCache.server';
import { readLiveBundleMerchandiseProducts } from '@/lib/bundleMerchandiseRead.server';
import { catalogueRecordForSlug, resolveMerchandiseDetailPage } from '@/lib/merchandiseDetail';
import { absoluteSiteUrl } from '@/lib/siteUrl';
import MerchandiseDetailClient from './MerchandiseDetailClient';

// ISR: product content is served from the cached catalogue and refreshed every 5 minutes, or
// immediately after an admin catalogue write (revalidateTag/revalidatePath). Live stock is
// still fetched in the browser.
export const revalidate = 300;
export const dynamicParams = true;

type Props = { params: { slug: string } };

// One catalogue read per request, shared by generateMetadata and the page.
const readCatalogue = cache(() => getPublicCatalogue());

const resolveProduct = cache(async (slug: string) => {
  let catalogue: Awaited<ReturnType<typeof getPublicCatalogue>> | null = null;
  try {
    catalogue = await readCatalogue();
  } catch (reason) {
    // Without the catalogue we can still serve static products; anything else must not be
    // cached as a 404, so let the render fail (ISR keeps serving the previous page).
    if (!getMerchandiseProduct(slug)) throw reason;
  }
  const catalogueRecord = catalogue ? catalogueRecordForSlug(catalogue, slug) : null;
  // Falls back to an uncached live Bundle read for legacy Bundle-only products before answering
  // 404; if that read fails this throws, so no 404 is cached for a product that may exist.
  return resolveMerchandiseDetailPage(slug, catalogueRecord, readLiveBundleMerchandiseProducts);
});

// No build-time prerendering: a Data API hiccup during `next build` must not fail the deploy.
// With dynamicParams each product renders on first request and is then ISR-cached.
export function generateStaticParams() {
  return [];
}

function metadataDescription(text: string) {
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > 160 ? `${plain.slice(0, 157).trimEnd()}…` : plain;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await resolveProduct(params.slug);
  if (!resolved) return {};
  const { product } = resolved;
  const description = metadataDescription(product.description || product.unitLabel || `${product.name} from tone wow.`);
  const image = product.thumbnail || product.gallery?.[0] || product.options[0]?.image;
  const title = `${product.name} | tone wow Shop`;
  const url = absoluteSiteUrl(`/merchandise/${encodeURIComponent(product.slug)}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      ...(image ? { images: [{ url: absoluteSiteUrl(image), alt: product.name }] } : {}),
    },
  };
}

export default async function MerchandiseDetailPage({ params }: Props) {
  const resolved = await resolveProduct(params.slug);
  if (!resolved) notFound();
  return (
    <MerchandiseDetailClient
      key={params.slug}
      slug={params.slug}
      initialProduct={resolved.product}
      catalogueRecord={resolved.catalogueRecord}
    />
  );
}
