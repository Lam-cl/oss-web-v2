import { isProductSetupDraft } from '@/lib/productSetup';

export const BUNDLE_MERCHANDISE_URL = 'https://bundleapi.tonewow.com/api/products?type=MERCHANDISE&limit=100';
const SHIPPING_FEE_SLUG = 'flat-rate-delivery-fee';
const HIDDEN_SLUGS = new Set(['pen-2-0']);

type ImageColorSettings = {
  products: Record<string, unknown>;
  hiddenOptionValues: Record<string, number[] | undefined>;
};
type BundleRow = { id: number; slug?: string; options?: Array<{ values?: Array<{ id: number }> }>; [key: string]: unknown };

/**
 * The storefront-visible Bundle merchandise payload: drops the shipping-fee and hidden products
 * and setup drafts, removes hidden option values and attaches image-colour assignments.
 * Shared by `/api/bundle/merchandise` and the server-rendered product page.
 */
export function visibleBundleMerchandise<T extends { data?: unknown }>(data: T, imageColors: ImageColorSettings): T {
  if (!Array.isArray(data?.data)) return data;
  return { ...data, data: (data.data as BundleRow[])
    .filter((product) => product.slug !== SHIPPING_FEE_SLUG && !HIDDEN_SLUGS.has(product.slug || '') && !isProductSetupDraft(product as Parameters<typeof isProductSetupDraft>[0]))
    .map((product) => {
      const hiddenOptionValues = new Set(imageColors.hiddenOptionValues[String(product.id)] || []);
      return {
        ...product,
        options: product.options?.map((option) => ({
          ...option,
          values: option.values?.filter((value) => !hiddenOptionValues.has(Number(value.id))),
        })),
        imageColorAssignments: imageColors.products[String(product.id)] || {},
      };
    }) };
}
