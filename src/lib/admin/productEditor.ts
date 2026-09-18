export type ProductEditorDetails = {
  title: string;
  price: number;
  description: string;
  category?: string;
  minimumOrderQuantity?: number;
};

export type ProductEditorValue = {
  key: string;
  valueId?: number;
  label: string;
  retired: boolean;
};
export type ProductEditorChoice = {
  key: string;
  optionId?: number;
  name: string;
  values: ProductEditorValue[];
};
export type ProductEditorCombination = {
  valueKeys: string[];
  variantId?: number;
  price: number;
  inventory: number;
  sku?: string;
};
export type ProductEditorExistingImage = {
  imageId: number;
  order: number;
  assignment: 'all' | string;
  remove: boolean;
};
export type ProductEditorSpec = {
  details: ProductEditorDetails;
  choices: ProductEditorChoice[];
  combinations: ProductEditorCombination[];
  existingImages: ProductEditorExistingImage[];
};

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
};
const array = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
};
const text = (value: unknown, label: string, allowEmpty = false) => {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new Error(`${label} is required.`);
  return normalized;
};
const stableKey = (value: unknown, label: string) => {
  const normalized = text(value, label);
  if (normalized.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new Error(`${label} must be a stable key of at most 128 letters, numbers, dots, underscores, colons, or hyphens.`);
  }
  return normalized;
};
const id = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer ID.`);
  return value;
};
const optionalId = (value: unknown, label: string) => value === undefined ? undefined : id(value, label);
const positiveInteger = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
  return value;
};
const amount = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and nonnegative.`);
  return Object.is(value, -0) ? 0 : value;
};
const bool = (value: unknown, label: string) => {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
};
const order = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer.`);
  return value;
};
const unique = (values: unknown[], label: string) => {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
};

export function normalizeProductEditorSpec(input: unknown): ProductEditorSpec {
  const source = object(input, 'Product editor spec');
  const rawDetails = object(source.details, 'Product details');
  const details: ProductEditorDetails = {
    title: text(rawDetails.title, 'Product title'),
    price: amount(rawDetails.price, 'Product price'),
    description: text(rawDetails.description, 'Product description', true),
    ...(rawDetails.category === undefined ? {} : { category: text(rawDetails.category, 'Product category') }),
    ...(rawDetails.minimumOrderQuantity === undefined
      ? {}
      : { minimumOrderQuantity: positiveInteger(rawDetails.minimumOrderQuantity, 'Minimum order quantity') }),
  };

  const choices = array(source.choices, 'Product choices').map((rawChoice): ProductEditorChoice => {
    const choice = object(rawChoice, 'Choice');
    const values = array(choice.values, 'Choice values').map((rawValue): ProductEditorValue => {
      const value = object(rawValue, 'Choice value');
      const valueId = optionalId(value.valueId, 'Value');
      return {
        key: stableKey(value.key, 'Value key'),
        ...(valueId === undefined ? {} : { valueId }),
        label: text(value.label, 'Choice value label'),
        retired: bool(value.retired, 'Retired flag'),
      };
    });
    unique(values.map((value) => value.label.toLowerCase()), 'choice value label');
    const optionId = optionalId(choice.optionId, 'Option');
    return {
      key: stableKey(choice.key, 'Choice key'),
      ...(optionId === undefined ? {} : { optionId }),
      name: text(choice.name, 'Choice name'),
      values,
    };
  });
  unique(choices.map((choice) => choice.key), 'choice key');
  unique(choices.map((choice) => choice.name.toLowerCase()), 'choice name');
  unique(choices.flatMap((choice) => choice.values.map((value) => value.key)), 'value key');
  unique(choices.flatMap((choice) => choice.optionId === undefined ? [] : [choice.optionId]), 'option ID');
  unique(choices.flatMap((choice) => choice.values.flatMap((value) => value.valueId === undefined ? [] : [value.valueId])), 'value ID');

  const valueChoice = new Map<string, number>();
  choices.forEach((choice, choiceIndex) => choice.values.forEach((value) => valueChoice.set(value.key, choiceIndex)));
  const combinationKeys = new Set<string>();
  const variantIds: number[] = [];
  const combinations = array(source.combinations, 'Product combinations').map((rawCombination): ProductEditorCombination => {
    const combination = object(rawCombination, 'Combination');
    const valueKeys = array(combination.valueKeys, 'Combination value keys').map((value) => stableKey(value, 'Combination value key'));
    unique(valueKeys, 'combination value key');
    if (valueKeys.some((valueKey) => !valueChoice.has(valueKey))) throw new Error('Combination must reference a valid value key.');
    if (choices.some((_, choiceIndex) => valueKeys.filter((valueKey) => valueChoice.get(valueKey) === choiceIndex).length !== 1)) {
      throw new Error('Combination must contain exactly one value from every choice.');
    }
    const normalizedKeys = [...valueKeys].sort((left, right) => valueChoice.get(left)! - valueChoice.get(right)!);
    const combinationKey = JSON.stringify(normalizedKeys);
    if (combinationKeys.has(combinationKey)) throw new Error('Duplicate combination.');
    combinationKeys.add(combinationKey);
    const variantId = optionalId(combination.variantId, 'Variant');
    if (variantId !== undefined) variantIds.push(variantId);
    const sku = combination.sku === undefined ? undefined : text(combination.sku, 'Combination SKU');
    return {
      valueKeys: normalizedKeys,
      ...(variantId === undefined ? {} : { variantId }),
      price: amount(combination.price, 'Combination price'),
      inventory: order(combination.inventory, 'Combination inventory'),
      ...(sku === undefined ? {} : { sku }),
    };
  });
  unique(variantIds, 'variant ID');

  const imageIds: number[] = [];
  const imageOrders: number[] = [];
  const existingImages = array(source.existingImages, 'Existing images').map((rawImage): ProductEditorExistingImage => {
    const image = object(rawImage, 'Existing image');
    const imageId = id(image.imageId, 'Image');
    const imageOrder = order(image.order, 'Image order');
    imageIds.push(imageId);
    imageOrders.push(imageOrder);
    if (typeof image.assignment !== 'string') throw new Error('Image assignment must be all or a valid value key.');
    const assignment = image.assignment === 'all' ? 'all' : stableKey(image.assignment, 'Image assignment');
    if (assignment !== 'all' && !valueChoice.has(assignment)) throw new Error('Image assignment must reference a valid value key.');
    return { imageId, order: imageOrder, assignment, remove: bool(image.remove, 'Image remove flag') };
  });
  unique(imageIds, 'image ID');
  unique(imageOrders, 'image order');

  return { details, choices, combinations, existingImages };
}
