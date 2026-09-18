import { canonicalCatalogueSku } from './types';

type Row = Record<string, any>;
export type AdminOrderItemPresentation = {
  title: string;
  variantLabels: string[];
  productCode: string;
};

const providerTitleSuffix = / \[TW-[0-9a-f]{8}-a[1-9][0-9]*\]$/;
const key = (productId: unknown, variantId: unknown) => `${Number(productId)}:${Number(variantId)}`;
const record = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};

export function indexAdminOrderItemPresentations(payload: unknown) {
  const products = Array.isArray(record(payload).products) ? record(payload).products : [];
  const index = new Map<string, Pick<AdminOrderItemPresentation, 'title' | 'variantLabels'>>();
  for (const value of products) {
    const product = record(value);
    const details = record(product.details || record(product.model).details);
    const choices = Array.isArray(product.choices) ? product.choices : record(product.model).choices;
    for (const value of Array.isArray(product.combinations) ? product.combinations : record(product.model).combinations || []) {
      const combination = record(value);
      const valueKeys = Array.isArray(combination.valueKeys) ? combination.valueKeys : [];
      const variantLabels = (Array.isArray(choices) ? choices : []).flatMap((choiceValue: unknown) => {
        const choice = record(choiceValue);
        const match = (Array.isArray(choice.values) ? choice.values : []).find((entry: unknown) => valueKeys.includes(record(entry).key));
        return typeof record(match).label === 'string' ? [record(match).label] : [];
      });
      index.set(key(product.bundleProductId, combination.variantId), {
        title: String(details.title || '').trim(),
        variantLabels,
      });
    }
  }
  return index;
}

export function resolveAdminOrderItemPresentation(
  value: unknown,
  index: ReturnType<typeof indexAdminOrderItemPresentations>,
  itemIndex: number,
): AdminOrderItemPresentation {
  const item = record(value);
  const product = record(item.product);
  const variant = record(item.productVariant ?? item.variant);
  const canonical = index.get(key(item.bundleProductId ?? item.productId ?? product.id, variant.id ?? item.variantId));
  const fallbackTitle = String(product.title || product.name || item.productName || item.name || `Item ${itemIndex + 1}`);
  return {
    title: canonical?.title || fallbackTitle.replace(providerTitleSuffix, ''),
    variantLabels: canonical?.variantLabels || [],
    productCode: canonicalCatalogueSku(variant.sku ?? ''),
  };
}
