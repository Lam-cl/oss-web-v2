export const PRODUCT_SETUP_DRAFT_TAG = '_tonewow_setup_draft';

export type ProductTagLike = string | { name?: string | null };

export function productTagName(tag: ProductTagLike) {
  return typeof tag === 'string' ? tag : tag?.name || '';
}

export function isProductSetupDraft(product: {
  tags?: ProductTagLike[];
  images?: unknown[];
  options?: Array<{ values?: unknown[] }>;
  productVariants?: Array<{ price?: unknown; selectedOptions?: unknown[] }>;
} | null | undefined) {
  const matchingTags = product?.tags?.map((tag) => productTagName(tag).trim().toLowerCase())
    .filter((tag) => tag.includes(PRODUCT_SETUP_DRAFT_TAG)) || [];
  const options = product?.options || [];
  const variants = product?.productVariants || [];
  const combinationCount = options.length === 2
    ? (options[0].values?.length || 0) * (options[1].values?.length || 0)
    : 0;
  const hasIncompleteGeneratedVariants = Boolean(
    combinationCount
    && variants.length === (options[0].values?.length || 0) + combinationCount
    && variants.every((variant) => !(variant.selectedOptions || []).length)
    && variants.every((variant) => variant.price == null || variant.price === ''),
  );
  if (!matchingTags.length) return hasIncompleteGeneratedVariants;
  if (matchingTags.some((tag) => tag === PRODUCT_SETUP_DRAFT_TAG)) return true;
  // Older Bundle versions split JSON tags into malformed fragments and cannot
  // always remove those relations on update. Once all setup entities exist,
  // the malformed legacy fragment is no longer treated as active draft state.
  return hasIncompleteGeneratedVariants
    || !(product?.images?.length && product?.options?.length && product?.productVariants?.length);
}

export function visibleProductTags<T extends ProductTagLike>(tags: T[] | undefined = []) {
  return tags.filter(
    (tag) => !productTagName(tag).trim().toLowerCase().includes(PRODUCT_SETUP_DRAFT_TAG),
  );
}
