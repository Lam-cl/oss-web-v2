import type { ProductEditorSpec } from './productEditor';
import type { Product } from './types';

type CatalogueStock = {
  catalogueId?: string;
  publicationOperationId?: string;
  status: 'draft' | 'published';
  currentBundleProductId: number | null;
  model: ProductEditorSpec;
};
type CatalogueSkuIdentity = { catalogueId?: string; operationId?: string };

const localInventory = (model: ProductEditorSpec) => model.combinations.reduce(
  (sum, combination) => sum + Number(combination.inventory || 0),
  0,
);
const providerInventory = (product: Product) => (product.productVariants || []).reduce(
  (sum, variant) => sum + Number(variant.inventory || 0),
  0,
);

export function productInventory(catalogue: CatalogueStock | null, product?: Product) {
  return catalogue?.status === 'published' && product?.id === catalogue.currentBundleProductId
    ? Object.values(liveCombinationInventory(catalogue.model, product, {
      catalogueId: catalogue.catalogueId, operationId: catalogue.publicationOperationId,
    })).reduce((sum, inventory) => sum + inventory, 0)
    : catalogue ? localInventory(catalogue.model) : product ? providerInventory(product) : 0;
}

const canonicalSku = (value: string) => value.trim().toUpperCase()
  .replace(/[^A-Z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

function isVersionedSkuFor(providerSku: string | undefined, canonical: string, identity?: CatalogueSkuIdentity) {
  const value = String(providerSku || '');
  const suffix = value.match(/-TW([a-f0-9]{8})V([1-9][0-9]*)(?:-([a-f0-9]{16}))?$/i);
  if (!suffix || !Number.isSafeInteger(Number(suffix[2]))
    || identity?.catalogueId && suffix[1].toLowerCase() !== identity.catalogueId.slice(0, 8).toLowerCase()
    || identity?.operationId && suffix[3] !== undefined && suffix[3].toLowerCase() !== identity.operationId.slice(0, 16).toLowerCase()) return false;
  return value.toLowerCase() === `${canonical.slice(0, 100 - suffix[0].length)}${suffix[0]}`.toLowerCase();
}

function selectedValueIds(selectedOptions: unknown[] | undefined) {
  return (selectedOptions || []).flatMap((selection) => {
    if (!selection || typeof selection !== 'object') return [];
    const value = (selection as { productOptionValue?: { id?: unknown } }).productOptionValue?.id;
    return typeof value === 'number' && Number.isSafeInteger(value) ? [value] : [];
  }).sort((left, right) => left - right);
}

export function liveCombinationInventory(model: ProductEditorSpec, product: Product, identity?: CatalogueSkuIdentity) {
  const variants = product.productVariants || [];
  const valueIds = new Map(model.choices.flatMap((choice) => choice.values.flatMap((value) =>
    value.valueId === undefined ? [] : [[value.key, value.valueId] as const],
  )));
  const labels = new Map(model.choices.flatMap((choice) => choice.values.map((value) => [value.key, value.label] as const)));
  return Object.fromEntries(model.combinations.flatMap((combination, index) => {
    const direct = variants.find((variant) => variant.id === combination.variantId);
    const expected = combination.valueKeys.flatMap((key) => valueIds.has(key) ? [valueIds.get(key)!] : []).sort((left, right) => left - right);
    const byOptions = expected.length === combination.valueKeys.length
      ? variants.filter((variant) => JSON.stringify(selectedValueIds(variant.selectedOptions)) === JSON.stringify(expected))
      : [];
    const sku = canonicalSku(combination.sku || [model.details.title, ...combination.valueKeys.map((key) => labels.get(key) || key)].join('-')) || `PRODUCT-${index + 1}`;
    const bySku = variants.filter((variant) => isVersionedSkuFor(variant.sku, sku, identity));
    const matches = direct ? [direct] : byOptions.length === 1 ? byOptions : byOptions.length === 0 ? bySku : [];
    return [[combination.valueKeys.join('|'), matches.length === 1 ? Number(matches[0].inventory || 0) : 0] as const];
  }));
}
