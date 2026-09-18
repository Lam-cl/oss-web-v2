import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import { dataApiEnabled, mutateRemoteSingleton, readRemoteSingleton } from './dataApiClient.server';

export type ProductImageColorAssignment = 'all' | number;
export type ProductImageColorSettings = {
  products: Record<string, Record<string, ProductImageColorAssignment>>;
  hiddenOptionValues: Record<string, number[]>;
};

const file = path.join(process.cwd(), '.data', 'product-image-colors.json');

function positiveId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

export function validateProductImageColorAssignments(value: unknown) {
  const input = value && typeof value === 'object' && 'assignments' in value
    ? (value as { assignments?: unknown }).assignments
    : value;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Image color assignments are required.');
  }
  const entries = Object.entries(input);
  if (entries.length > 500) throw new Error('Too many image color assignments.');
  const assignments: Record<string, ProductImageColorAssignment> = {};
  for (const [imageId, color] of entries) {
    if (!positiveId(imageId)) throw new Error('Each assignment needs a valid image ID.');
    if (color !== 'all' && !positiveId(color)) throw new Error('Each image needs a valid color or All colors.');
    assignments[String(positiveId(imageId))] = color === 'all' ? 'all' : positiveId(color);
  }
  return assignments;
}

export function validateHiddenOptionValueIds(value: unknown) {
  const input = value && typeof value === 'object' && 'valueIds' in value
    ? (value as { valueIds?: unknown }).valueIds
    : value;
  if (!Array.isArray(input)) throw new Error('Option value IDs are required.');
  const valueIds = Array.from(new Set(input.map(positiveId)));
  if (valueIds.some((id) => !id)) throw new Error('Each hidden option value needs a valid option value ID.');
  if (valueIds.length > 500) throw new Error('Too many hidden option values.');
  return valueIds;
}

export async function readProductImageColorSettings(): Promise<ProductImageColorSettings> {
  if (dataApiEnabled()) return normalizeSettings(await readRemoteSingleton('product-image-colors', emptySettings));
  try {
    return normalizeSettings(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return emptySettings();
  }
}

const emptySettings = (): ProductImageColorSettings => ({ products: {}, hiddenOptionValues: {} });
function normalizeSettings(value: unknown): ProductImageColorSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Product image color storage is corrupt.');
    const input = value as Partial<ProductImageColorSettings>;
    const products: ProductImageColorSettings['products'] = {};
    for (const [productId, assignments] of Object.entries(input.products || {})) {
      if (!positiveId(productId)) continue;
      products[String(positiveId(productId))] = validateProductImageColorAssignments(assignments);
    }
    const hiddenOptionValues: ProductImageColorSettings['hiddenOptionValues'] = {};
    for (const [productId, valueIds] of Object.entries(input.hiddenOptionValues || {})) {
      if (!positiveId(productId)) continue;
      hiddenOptionValues[String(positiveId(productId))] = validateHiddenOptionValueIds(valueIds);
    }
    return { products, hiddenOptionValues };
}

async function updateSettings(mutate: (settings: ProductImageColorSettings) => void) {
  if (dataApiEnabled()) return mutateRemoteSingleton('product-image-colors', emptySettings, value => { const settings = normalizeSettings(value); mutate(settings); return settings; });
  const settings = await readProductImageColorSettings();
  mutate(settings);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await rename(temp, file);
  return settings;
}

export async function readProductImageColors(productId: number) {
  if (!positiveId(productId)) throw new Error('A valid product ID is required.');
  const settings = await readProductImageColorSettings();
  return settings.products[String(productId)] || {};
}

export async function readProductHiddenOptionValues(productId: number) {
  if (!positiveId(productId)) throw new Error('A valid product ID is required.');
  const settings = await readProductImageColorSettings();
  return settings.hiddenOptionValues[String(productId)] || [];
}

export async function saveProductHiddenOptionValues(productId: number, value: unknown) {
  if (!positiveId(productId)) throw new Error('A valid product ID is required.');
  const valueIds = validateHiddenOptionValueIds(value);
  await updateSettings(settings => {
    if (valueIds.length) settings.hiddenOptionValues[String(productId)] = valueIds;
    else delete settings.hiddenOptionValues[String(productId)];
  });
  return valueIds;
}

export async function saveProductImageColors(productId: number, value: unknown) {
  if (!positiveId(productId)) throw new Error('A valid product ID is required.');
  const assignments = validateProductImageColorAssignments(value);
  await updateSettings(settings => {
    if (Object.keys(assignments).length) settings.products[String(productId)] = assignments;
    else delete settings.products[String(productId)];
  });
  return assignments;
}
