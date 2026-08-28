type VariantModel = {
  details?: { price: number };
  choices: Array<{ name?: string; values: Array<{ key: string; retired?: boolean }> }>;
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
  const activeKeysByChoice = activeChoices.map((values) => new Set(values.map((value) => value.key)));
  const activeCombinations = model.combinations.filter((combination) =>
    combination.valueKeys.length === activeKeysByChoice.length
      && combination.valueKeys.every((key, index) => activeKeysByChoice[index].has(key)),
  );
  const combinations = new Set(activeCombinations.map((combination) => JSON.stringify(combination.valueKeys)));
  return combinations.size === activeCombinations.length
    && combinations.size === expectedTuples.length
    && expectedTuples.every((tuple) => combinations.has(JSON.stringify(tuple)));
}

export function catalogueChoiceSummary(model: VariantModel) {
  const activeChoices = model.choices.map((choice) => ({
    name: choice.name?.trim() || 'Choice',
    values: choice.values.filter((value) => !value.retired),
  }));
  if (!activeChoices.length) return { primary: 'Standard', secondary: '1 combination', incomplete: model.combinations.length !== 1 };
  const activeKeysByChoice = activeChoices.map((choice) => new Set(choice.values.map((value) => value.key)));
  const actual = model.combinations.filter((combination) => combination.valueKeys.length === activeChoices.length
    && combination.valueKeys.every((key, index) => activeKeysByChoice[index].has(key))).length;
  const expected = activeChoices.reduce((total, choice) => total * choice.values.length, 1);
  return {
    primary: activeChoices.map((choice) => `${choice.name} ${choice.values.length}`).join(' · '),
    secondary: actual === expected ? `${actual} ${actual === 1 ? 'combination' : 'combinations'}` : `${actual} of ${expected} combinations`,
    incomplete: actual !== expected,
  };
}

export function catalogueHazardReason(model: VariantModel) {
  if (!hasValidCatalogueVariants(model)) return 'Complete every active variant before publishing or archiving.';
  const retiredKeys = new Set(model.choices.flatMap((choice) => choice.values.filter((value) => value.retired).map((value) => value.key)));
  const hasInvalidRm0Variant = (model.details?.price ?? 0) > 0
    && model.combinations.some((combination) => combination.price === 0 && combination.valueKeys.every((key) => !retiredKeys.has(key)));
  if (hasInvalidRm0Variant) return 'Set the base price to RM0 or correct the RM0 variant before publishing or archiving.';
  return null;
}

const RESUMABLE_PUBLICATION_PHASES = new Set([
  'building',
  'bundle-published',
  'activation-uncertain',
  'activated',
  'retirement-uncertain',
  'previous-retired',
]);

export function publicationRecoveryPresentation(publication: { phase: string } | null | undefined) {
  if (publication === undefined) return {
    pending: false,
    label: 'Publish',
    disabledReason: 'Provider operation status could not be loaded. Reload before publishing or archiving.',
  } as const;
  if (publication === null || publication.phase === 'complete') return {
    pending: false,
    label: 'Publish',
    disabledReason: null,
  } as const;
  if (RESUMABLE_PUBLICATION_PHASES.has(publication.phase)) return {
    pending: true,
    label: 'Resume publication',
    disabledReason: null,
  } as const;
  return {
    pending: true,
    label: 'Resume publication',
    disabledReason: 'Provider operation state is invalid. Reload or repair its evidence before continuing.',
  } as const;
}

export function isSimCatalogueCategory(category: string | undefined) {
  return /^sim(?:\s+card)?$/i.test(category?.trim() || '');
}

export function genericCatalogueLifecycleAllowed(_simManaged: boolean) {
  return true;
}

export function publicationActionPresentation(input: {
  state: 'clean' | 'dirty' | 'unknown';
  localDraft: boolean;
  simManaged: boolean;
  unknownReason?: string;
}) {
  if (input.state === 'clean' && !input.localDraft) return { visible: false } as const;
  return {
    visible: true,
    label: input.localDraft ? 'Publish' : 'Publish changes',
    disabledReason: input.state === 'unknown'
      ? input.unknownReason || 'Publication evidence is incomplete. Reload or repair the evidence before publishing.'
      : null,
  } as const;
}
