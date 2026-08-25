type ProductTag = string | { name?: string | null };

export function getMinimumOrderQuantity(tags?: ProductTag[] | null) {
  for (const tag of tags || []) {
    const name = typeof tag === 'string' ? tag : tag?.name;
    const match = name?.trim().match(/^moq\s*:\s*(\d+)$/i);
    if (!match) continue;

    const quantity = Number(match[1]);
    if (Number.isSafeInteger(quantity) && quantity >= 1) return quantity;
  }

  return 1;
}

type MinimumOrderProduct = {
  tags?: ProductTag[] | null;
  slug?: string | null;
  title?: string | null;
  name?: string | null;
  description?: string | null;
};

export function getProductMinimumOrderQuantity(product: MinimumOrderProduct) {
  const taggedQuantity = getMinimumOrderQuantity(product.tags);
  if (taggedQuantity > 1 || (product.tags || []).some((tag) => {
    const name = typeof tag === 'string' ? tag : tag?.name;
    return /^moq\s*:\s*1$/i.test(name?.trim() || '');
  })) return taggedQuantity;

  const slug = product.slug?.trim().toLowerCase();
  const name = (product.title || product.name || '').trim().toLowerCase();
  if (slug === 'superlite-sim' || name === 'superlite sim') return 10;

  const descriptionMatch = product.description?.match(/minimum order\s*:\s*(\d+)\s*units?/i);
  const describedQuantity = Number(descriptionMatch?.[1]);
  return Number.isSafeInteger(describedQuantity) && describedQuantity >= 1
    ? describedQuantity
    : 1;
}

export function minimumOrderLabel(quantity: number) {
  return quantity > 1
    ? `Minimum order: ${quantity} units`
    : 'No minimum order';
}
