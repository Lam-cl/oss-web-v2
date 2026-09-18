import type { ProductEditorSpec } from './productEditor';
import type { NormalizedBundleProduct } from './productBundleState';
import type { ProductControlRecord } from './productControl.server';

export type ProductImageUpload = { key: string; name: string; order: number };
export type ProductImageReference = { imageId: number } | { uploadKey: string };
export type ProductControlMetadata = {
  productId: number;
  category?: string;
  choices: Array<{
    key: string;
    optionId?: number;
    values: Array<{ key: string; valueId?: number; retired: boolean }>;
  }>;
  images: Array<{ ref: ProductImageReference; assignment: string | null }>;
  variantBindings: Array<{ valueKeys: string[]; variantId?: number }>;
};
export type ProductSaveOperation =
  | { kind: 'upload-images'; scope: 'bundle'; uploads: ProductImageUpload[] }
  | { kind: 'create-option'; scope: 'bundle'; choice: { choiceKey: string; name: string; values: Array<{ valueKey: string; label: string }> } }
  | { kind: 'add-option-values'; scope: 'bundle'; optionId: number; choiceKey: string; values: Array<{ valueKey: string; label: string }> }
  | { kind: 'create-variants'; scope: 'bundle'; variants: Array<{ valueKeys: string[]; price: number; inventory: number; sku?: string }> }
  | { kind: 'update-variants'; scope: 'bundle'; variants: Array<{ variantId: number; price?: number; inventory?: number; sku?: string | null }> }
  | { kind: 'remove-images'; scope: 'bundle'; imageIds: number[] }
  | { kind: 'order-images'; scope: 'bundle'; images: ProductImageReference[] }
  | { kind: 'update-control'; scope: 'local'; metadata: ProductControlMetadata }
  | { kind: 'update-product'; scope: 'bundle'; payload: { title?: string; price?: number; description?: string } };

export type ProductSavePlanInput = {
  current: NormalizedBundleProduct;
  control: ProductControlRecord;
  spec: ProductEditorSpec;
  uploads?: ProductImageUpload[];
};

type CurrentVariant = { id: number; price?: number; inventory?: number; sku?: string | null };
type CurrentOption = { id: number; name?: string; values?: Array<{ id: number; value?: string }> };
const numericKey = (ids: number[]) => JSON.stringify([...ids].sort((left, right) => left - right));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function orderedValueKeys(valueKeys: string[], choiceByValue: Map<string, number>) {
  return [...valueKeys]
    .sort((left, right) => (choiceByValue.get(left) ?? Number.MAX_SAFE_INTEGER) - (choiceByValue.get(right) ?? Number.MAX_SAFE_INTEGER));
}

const semanticKey = (valueKeys: string[], choiceByValue: Map<string, number>) => JSON.stringify(orderedValueKeys(valueKeys, choiceByValue));

function cartesian(choices: ProductEditorSpec['choices']): string[][] {
  return choices.reduce<string[][]>(
    (rows, choice) => rows.flatMap((row) => choice.values
      .filter((value) => !value.retired)
      .map((value) => [...row, value.key])),
    [[]],
  );
}

function currentArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function planProductSave({ current, control, spec, uploads = [] }: ProductSavePlanInput): ProductSaveOperation[] {
  const structural: ProductSaveOperation[] = [];
  const variants: ProductSaveOperation[] = [];
  const media: ProductSaveOperation[] = [];
  const local: ProductSaveOperation[] = [];
  const metadata: ProductSaveOperation[] = [];

  const currentOptions = new Map(currentArray<CurrentOption>(current.options).map((option) => [option.id, option]));
  for (const choice of spec.choices) {
    if (choice.optionId === undefined) {
      const existingValue = choice.values.find((value) => value.valueId !== undefined);
      if (existingValue) throw new Error(`Existing value ID ${existingValue.valueId} requires an existing option ID.`);
      continue;
    }
    const currentOption = currentOptions.get(choice.optionId);
    if (!currentOption) throw new Error(`Existing option ID ${choice.optionId} does not exist in current Bundle options.`);
    if (!control.optionOrder.includes(choice.optionId)) throw new Error(`Existing option ID ${choice.optionId} is absent from verified control order.`);
    if (currentOption.name !== choice.name) throw new Error(`V1 cannot rename existing option ID ${choice.optionId}.`);
    const currentValues = new Map(currentArray<{ id: number; value?: string }>(currentOption.values).map((value) => [value.id, value]));
    const controlledValueIds = control.valueOrder[String(choice.optionId)] || [];
    for (const value of choice.values) {
      if (value.valueId === undefined) continue;
      const currentValue = currentValues.get(value.valueId);
      if (!currentValue) throw new Error(`Existing value ID ${value.valueId} does not exist under current Bundle option ID ${choice.optionId}.`);
      if (!controlledValueIds.includes(value.valueId)) throw new Error(`Existing value ID ${value.valueId} is absent from verified control value order for option ID ${choice.optionId}.`);
      if (currentValue.value !== value.label) throw new Error(`V1 cannot rename existing value ID ${value.valueId}.`);
    }
  }
  const bundleImageIds = new Set(currentArray<{ id: number }>(current.images).map((image) => image.id));
  const controlledImageIds = new Set(control.imageAssignments.map((image) => image.imageId));
  for (const image of spec.existingImages) {
    if (!bundleImageIds.has(image.imageId)) throw new Error(`Existing image ID ${image.imageId} does not exist in current Bundle images.`);
    if (!controlledImageIds.has(image.imageId)) throw new Error(`Existing image ID ${image.imageId} is absent from verified control image assignments.`);
  }

  const uploadKeys = uploads.map((upload) => upload.key);
  if (new Set(uploadKeys).size !== uploadKeys.length) throw new Error('Duplicate upload key.');
  if (uploads.length) structural.push({ kind: 'upload-images', scope: 'bundle', uploads: uploads.map((upload) => ({ ...upload })) });

  for (const choice of spec.choices.filter((candidate) => candidate.optionId === undefined)) {
    structural.push({
      kind: 'create-option',
      scope: 'bundle',
      choice: {
        choiceKey: choice.key,
        name: choice.name,
        values: choice.values
          .filter((value) => !value.retired)
          .map((value) => ({ valueKey: value.key, label: value.label })),
      },
    });
  }
  for (const choice of spec.choices.filter((candidate) => candidate.optionId !== undefined)) {
    const values = choice.values
      .filter((value) => value.valueId === undefined && !value.retired)
      .map((value) => ({ valueKey: value.key, label: value.label }));
    if (values.length) structural.push({
      kind: 'add-option-values', scope: 'bundle', optionId: choice.optionId!, choiceKey: choice.key, values,
    });
  }

  const choiceByValue = new Map<string, number>();
  const valueIdByKey = new Map<string, number>();
  spec.choices.forEach((choice, choiceIndex) => choice.values.forEach((value) => {
    choiceByValue.set(value.key, choiceIndex);
    if (value.valueId !== undefined) valueIdByKey.set(value.key, value.valueId);
  }));
  const combinations = new Map(spec.combinations.map((combination) => [semanticKey(combination.valueKeys, choiceByValue), combination]));
  const controlBindings = new Map(control.variantBindings.map((binding) => [numericKey(binding.valueIds), binding.variantId]));
  const currentVariants = new Map(currentArray<CurrentVariant>(current.productVariants).map((variant) => [variant.id, variant]));
  for (const combination of spec.combinations) {
    if (combination.variantId === undefined) continue;
    const orderedKeys = orderedValueKeys(combination.valueKeys, choiceByValue);
    const valueIds = orderedKeys.map((valueKey) => valueIdByKey.get(valueKey));
    const boundVariantId = valueIds.every((valueId): valueId is number => valueId !== undefined)
      ? controlBindings.get(numericKey(valueIds))
      : undefined;
    if (boundVariantId !== combination.variantId || !currentVariants.has(combination.variantId)) {
      throw new Error(`Existing combination ${orderedKeys.join(':')} lacks a verified Bundle variant binding.`);
    }
  }
  const resolvedVariantIds = new Map<string, number>();
  const createVariants: Extract<ProductSaveOperation, { kind: 'create-variants' }>['variants'] = [];
  const updateById = new Map<number, Extract<ProductSaveOperation, { kind: 'update-variants' }>['variants'][number]>();

  for (const valueKeys of cartesian(spec.choices)) {
    const combinationKey = semanticKey(valueKeys, choiceByValue);
    const combination = combinations.get(combinationKey);
    if (!combination) throw new Error(`Missing Cartesian combination ${valueKeys.join(':')}.`);

    const valueIds = valueKeys.map((valueKey) => valueIdByKey.get(valueKey));
    const allValuesExist = valueIds.every((valueId): valueId is number => valueId !== undefined);
    const boundVariantId = allValuesExist ? controlBindings.get(numericKey(valueIds)) : undefined;
    const verifiedVariantId = boundVariantId !== undefined && currentVariants.has(boundVariantId) ? boundVariantId : undefined;

    if (combination.variantId !== undefined
      && (verifiedVariantId === undefined || verifiedVariantId !== combination.variantId)) {
      throw new Error(`Existing combination ${valueKeys.join(':')} lacks a verified Bundle variant binding.`);
    }

    const variantId = combination.variantId ?? verifiedVariantId;
    if (variantId === undefined) {
      createVariants.push({
        valueKeys: [...valueKeys],
        price: combination.price,
        inventory: combination.inventory,
        ...(combination.sku === undefined ? {} : { sku: combination.sku }),
      });
      continue;
    }

    resolvedVariantIds.set(combinationKey, variantId);
    const currentVariant = currentVariants.get(variantId)!;
    const update: Extract<ProductSaveOperation, { kind: 'update-variants' }>['variants'][number] = { variantId };
    if (currentVariant.price !== combination.price) update.price = combination.price;
    if (currentVariant.inventory !== combination.inventory) update.inventory = combination.inventory;
    if ((currentVariant.sku ?? undefined) !== combination.sku) update.sku = combination.sku ?? null;
    if (Object.keys(update).length > 1) updateById.set(variantId, update);
  }
  if (createVariants.length) variants.push({ kind: 'create-variants', scope: 'bundle', variants: createVariants });

  const retiredValueIds = new Set(spec.choices.flatMap((choice) => choice.values
    .filter((value) => value.retired && value.valueId !== undefined)
    .map((value) => value.valueId!)));
  for (const binding of control.variantBindings) {
    if (!binding.valueIds.some((valueId) => retiredValueIds.has(valueId))) continue;
    const currentVariant = currentVariants.get(binding.variantId);
    if (!currentVariant || currentVariant.inventory === 0) continue;
    updateById.set(binding.variantId, { variantId: binding.variantId, inventory: 0 });
  }
  if (updateById.size) variants.push({ kind: 'update-variants', scope: 'bundle', variants: Array.from(updateById.values()) });

  const removedImageIds = spec.existingImages.filter((image) => image.remove).map((image) => image.imageId);
  if (removedImageIds.length) media.push({ kind: 'remove-images', scope: 'bundle', imageIds: removedImageIds });

  const desiredImages = [
    ...spec.existingImages.filter((image) => !image.remove).map((image) => ({
      order: image.order,
      ref: { imageId: image.imageId } as ProductImageReference,
      assignment: image.assignment === 'all' ? null : image.assignment,
    })),
    ...uploads.map((upload) => ({ order: upload.order, ref: { uploadKey: upload.key } as ProductImageReference, assignment: null })),
  ].sort((left, right) => left.order - right.order);
  if (new Set(desiredImages.map((image) => image.order)).size !== desiredImages.length) throw new Error('Duplicate desired image order.');

  const desiredImageRefs = desiredImages.map((image) => image.ref);
  const remainingCurrentImageIds = currentArray<{ id: number; order?: number }>(current.images)
    .filter((image) => !removedImageIds.includes(image.id))
    .map((image) => image.id);
  const desiredExistingIds = desiredImageRefs.flatMap((ref) => 'imageId' in ref ? [ref.imageId] : []);
  if (uploads.length || removedImageIds.length || !same(remainingCurrentImageIds, desiredExistingIds)) {
    media.push({ kind: 'order-images', scope: 'bundle', images: desiredImageRefs });
  }

  const controlMetadata: ProductControlMetadata = {
    productId: control.productId,
    ...(spec.details.category === undefined ? {} : { category: spec.details.category }),
    choices: spec.choices.map((choice) => ({
      key: choice.key,
      ...(choice.optionId === undefined ? {} : { optionId: choice.optionId }),
      values: choice.values.map((value) => ({
        key: value.key,
        ...(value.valueId === undefined ? {} : { valueId: value.valueId }),
        retired: value.retired,
      })),
    })),
    images: desiredImages.map((image) => ({ ref: image.ref, assignment: image.assignment })),
    variantBindings: spec.combinations.map((combination) => {
      const orderedKeys = orderedValueKeys(combination.valueKeys, choiceByValue);
      const resolved = combination.variantId ?? resolvedVariantIds.get(semanticKey(orderedKeys, choiceByValue));
      return { valueKeys: orderedKeys, ...(resolved === undefined ? {} : { variantId: resolved }) };
    }),
  };

  const allChoicesResolved = spec.choices.every((choice) => choice.optionId !== undefined
    && choice.values.every((value) => value.valueId !== undefined));
  const desiredOptionOrder = spec.choices.flatMap((choice) => choice.optionId === undefined ? [] : [choice.optionId]);
  const desiredValueOrder = Object.fromEntries(spec.choices.flatMap((choice) => choice.optionId === undefined ? [] : [[
    String(choice.optionId), choice.values.flatMap((value) => value.valueId === undefined ? [] : [value.valueId]),
  ]]));
  const desiredHiddenIds = spec.choices.flatMap((choice) => choice.values
    .filter((value) => value.retired && value.valueId !== undefined)
    .map((value) => value.valueId!));
  const allAssignmentsResolved = desiredImages.every((image) => 'imageId' in image.ref
    && (image.assignment === null || valueIdByKey.has(image.assignment)));
  const desiredAssignments = desiredImages.flatMap((image) => 'imageId' in image.ref ? [{
    imageId: image.ref.imageId,
    valueId: image.assignment === null ? null : valueIdByKey.get(image.assignment)!,
  }] : []);
  const allVariantsResolved = controlMetadata.variantBindings.every((binding) => binding.variantId !== undefined
    && binding.valueKeys.every((valueKey) => valueIdByKey.has(valueKey)));
  const desiredBindings = controlMetadata.variantBindings.flatMap((binding) => binding.variantId === undefined ? [] : [{
    valueIds: binding.valueKeys.map((valueKey) => valueIdByKey.get(valueKey)!),
    variantId: binding.variantId,
  }]);
  const currentCategory = currentArray<string>(current.categories)[0];
  const controlChanged = !allChoicesResolved
    || !same(control.optionOrder, desiredOptionOrder)
    || !same(control.valueOrder, desiredValueOrder)
    || !same(control.hiddenValueIds, desiredHiddenIds)
    || !allAssignmentsResolved
    || !same(control.imageAssignments, desiredAssignments)
    || !allVariantsResolved
    || !same(control.variantBindings, desiredBindings)
    || (spec.details.category !== undefined && currentCategory !== spec.details.category);
  if (controlChanged) local.push({ kind: 'update-control', scope: 'local', metadata: controlMetadata });

  const payload: Extract<ProductSaveOperation, { kind: 'update-product' }>['payload'] = {};
  if (current.title !== spec.details.title) payload.title = spec.details.title;
  if (current.price !== spec.details.price) payload.price = spec.details.price;
  if (current.description !== spec.details.description) payload.description = spec.details.description;
  if (Object.keys(payload).length) metadata.push({ kind: 'update-product', scope: 'bundle', payload });

  return [...structural, ...variants, ...media, ...local, ...metadata];
}
