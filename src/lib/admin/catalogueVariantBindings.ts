import type { ProductEditorCombination, ProductEditorSpec } from './productEditor';

export type CatalogueVariantBindingRow = {
  valueKeys: string[];
  variantId: number;
  inventory?: number;
};

export type CatalogueInventoryChange = {
  valueKeys: string[];
  variantId: number;
  expectedInventory: number;
  inventory: number;
};

export class CatalogueInventoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogueInventoryConflictError';
  }
}

export function catalogueCombinationKey(valueKeys: readonly string[]) {
  return JSON.stringify(valueKeys);
}

export function catalogueVariantBindingMap<T extends CatalogueVariantBindingRow>(bindings: readonly T[]) {
  const byTuple = new Map<string, T>();
  const variantIds = new Set<number>();
  for (const binding of bindings) {
    if (!Array.isArray(binding.valueKeys)
      || binding.valueKeys.some((key) => typeof key !== 'string' || !key)
      || !Number.isSafeInteger(binding.variantId)
      || binding.variantId <= 0) {
      throw new Error('Catalogue variant binding evidence is invalid.');
    }
    const key = catalogueCombinationKey(binding.valueKeys);
    if (byTuple.has(key) || variantIds.has(binding.variantId)) {
      throw new Error('Catalogue variant binding evidence is ambiguous.');
    }
    byTuple.set(key, binding);
    variantIds.add(binding.variantId);
  }
  return byTuple;
}

export function rebindCatalogueModelVariantIds(
  model: ProductEditorSpec,
  bindings: readonly CatalogueVariantBindingRow[],
): ProductEditorSpec {
  const byTuple = catalogueVariantBindingMap(bindings);
  return {
    ...model,
    combinations: model.combinations.map((combination) => {
      const binding = byTuple.get(catalogueCombinationKey(combination.valueKeys));
      if (binding) return { ...combination, variantId: binding.variantId };
      const { variantId: _staleVariantId, ...withoutVariantId } = combination;
      return withoutVariantId;
    }),
  };
}

export function rebindPublishedCatalogueModelVariantIds(
  model: ProductEditorSpec,
  bindings: readonly CatalogueVariantBindingRow[],
): ProductEditorSpec {
  const byTuple = catalogueVariantBindingMap(bindings);
  const activeKeysByChoice = model.choices.map((choice) => new Set(
    choice.values.filter((value) => !value.retired).map((value) => value.key),
  ));
  const activeCombinationKeys = new Set(model.combinations
    .filter((combination) => combination.valueKeys.length === activeKeysByChoice.length
      && combination.valueKeys.every((key, index) => activeKeysByChoice[index].has(key)))
    .map((combination) => catalogueCombinationKey(combination.valueKeys)));
  if (activeCombinationKeys.size !== byTuple.size
    || Array.from(activeCombinationKeys).some((key) => !byTuple.has(key))
    || Array.from(byTuple.keys()).some((key) => !activeCombinationKeys.has(key))) {
    throw new Error('Published catalogue variant bindings do not exactly match the active combination matrix.');
  }
  return rebindCatalogueModelVariantIds(model, bindings);
}

export function catalogueInventoryChanges(
  combinations: readonly ProductEditorCombination[],
  touchedInventory: ReadonlySet<string>,
  liveBindings: ReadonlyMap<string, CatalogueVariantBindingRow & { inventory: number }> | undefined,
): CatalogueInventoryChange[] {
  if (!liveBindings) return [];
  return combinations.flatMap((combination) => {
    const key = catalogueCombinationKey(combination.valueKeys);
    const binding = liveBindings.get(key);
    return touchedInventory.has(key) && binding && combination.inventory !== binding.inventory
      ? [{
          valueKeys: [...combination.valueKeys],
          variantId: binding.variantId,
          expectedInventory: binding.inventory,
          inventory: combination.inventory,
        }]
      : [];
  });
}

export function reconcileCatalogueInventoryChanges(
  changes: readonly CatalogueInventoryChange[],
  latestBindings: readonly (CatalogueVariantBindingRow & { inventory: number })[],
) {
  const latest = catalogueVariantBindingMap(latestBindings);
  return changes.map((change) => {
    const current = latest.get(catalogueCombinationKey(change.valueKeys));
    if (!current) {
      throw new CatalogueInventoryConflictError('A product option changed after this editor was opened. Reload before saving.');
    }
    if (current.inventory !== change.expectedInventory && current.inventory !== change.inventory) {
      throw new CatalogueInventoryConflictError('Live stock changed after this editor was opened. Reload and review the latest stock before saving.');
    }
    return {
      ...change,
      variantId: current.variantId,
      expectedInventory: current.inventory,
    };
  });
}
