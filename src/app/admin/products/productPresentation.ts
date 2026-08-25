type VariantModel = {
  details?: { price: number };
  choices: Array<{ values: Array<{ key: string; retired?: boolean }> }>;
  combinations: Array<{ valueKeys: string[]; sku?: string; price?: number }>;
};

type ProviderProduct = {
  id: number;
  title?: string;
  name?: string;
  slug?: string;
  productVariants?: Array<{ sku?: string }>;
};

type CatalogueProduct = {
  catalogueId: string;
  currentBundleProductId: number | null;
  slug: string;
  model: VariantModel & { details: { title: string } };
};

type ProductRow =
  | { kind: 'catalogue'; catalogue: CatalogueProduct; product?: ProviderProduct }
  | { kind: 'legacy'; product: ProviderProduct };

export function isSystemCatalogueProduct(product: Pick<ProviderProduct, 'id' | 'title' | 'name'>) {
  return product.id === 41 || /^RM\s*10\s+Flat Rate Delivery Fee$/i.test((product.title || product.name || '').trim());
}

export function productSearchText(row: ProductRow) {
  if (row.kind === 'legacy') {
    const product = row.product;
    return [product.id, product.title, product.name, product.slug, ...(product.productVariants || []).map((variant) => variant.sku)].join(' ');
  }
  const { catalogue, product } = row;
  return [
    catalogue.catalogueId,
    catalogue.currentBundleProductId,
    product?.id,
    catalogue.model.details.title,
    catalogue.slug,
    ...catalogue.model.combinations.map((combination) => combination.sku),
    ...(product?.productVariants || []).map((variant) => variant.sku),
  ].join(' ');
}

export function sanitizeProviderTitle(value: string) {
  return value.replace(/\s+\[TW-[a-f0-9]{8}-a[1-9][0-9]*\]\s*$/i, '').trim();
}

export function sanitizeProviderDescription(value: string) {
  return value.replace(/\s*\[\[TW-CATALOGUE-DRAFT:[^\]]*\]\]\s*/gi, '\n').trim();
}

export function hasValidCatalogueVariants(model: VariantModel) {
  if (model.choices.length > 2) return false;
  const activeChoices = model.choices.map((choice) => choice.values.filter((value) => !value.retired));
  if (activeChoices.some((values) => values.length === 0)) return false;
  const expectedTuples = activeChoices.reduce<string[][]>(
    (tuples, values) => tuples.flatMap((tuple) => values.map((value) => [...tuple, value.key])),
    [[]],
  );
  const combinations = new Set(model.combinations.map((combination) => JSON.stringify(combination.valueKeys)));
  return combinations.size === model.combinations.length
    && combinations.size === expectedTuples.length
    && expectedTuples.every((tuple) => combinations.has(JSON.stringify(tuple)));
}

export function catalogueHazardReason(model: VariantModel, providerOperationUnresolved: boolean) {
  if (!hasValidCatalogueVariants(model)) return 'Complete every active variant before publishing or archiving.';
  const retiredKeys = new Set(model.choices.flatMap((choice) => choice.values.filter((value) => value.retired).map((value) => value.key)));
  const hasInvalidRm0Variant = (model.details?.price ?? 0) > 0
    && model.combinations.some((combination) => combination.price === 0 && combination.valueKeys.every((key) => !retiredKeys.has(key)));
  if (hasInvalidRm0Variant) return 'Set the base price to RM0 or correct the RM0 variant before publishing or archiving.';
  if (providerOperationUnresolved) return 'Provider operation unresolved. Wait for it to finish, then reload.';
  return null;
}

export function unresolvedPublication(publication: { phase: string } | null | undefined) {
  return publication === undefined || publication !== null && publication.phase !== 'complete';
}

export function isSimCatalogueCategory(category: string | undefined) {
  return /^sim(?:\s+card)?$/i.test(category?.trim() || '');
}

export function genericCatalogueLifecycleAllowed(simManaged: boolean) {
  return !simManaged;
}

export function publicationActionPresentation(input: {
  state: 'clean' | 'dirty' | 'unknown';
  localDraft: boolean;
  simManaged: boolean;
  unknownReason?: string;
}) {
  if (input.simManaged || input.state === 'clean' && !input.localDraft) return { visible: false } as const;
  return {
    visible: true,
    label: input.localDraft ? 'Publish' : 'Publish changes',
    disabledReason: input.state === 'unknown'
      ? input.unknownReason || 'Publication evidence is incomplete. Reload or repair the evidence before publishing.'
      : null,
  } as const;
}
