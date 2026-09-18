import {
  merchandiseProducts,
  merchandiseVariantKey,
  resolveMerchandiseSwatch,
  UNKNOWN_MERCHANDISE_SWATCH,
  type MerchandiseOption,
  type MerchandiseProduct,
} from '@/data/merchandise';
import { parseProductDescription } from '@/lib/productDescription';

export const CATALOGUE_STOREFRONT_ENDPOINT = '/catalogue-products-api';

type Row = Record<string, unknown>;
type ChoiceValue = { key: string; label: string };
type Choice = { key: string; name: string; values: ChoiceValue[] };
type Combination = { valueKeys: string[]; variantId: number; price: number; inventory: number };
type ImageRecord = { url: string; order: number; assignment: string };

const row = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const visibleText = (value: unknown): value is string => typeof value === 'string'
  && Boolean(value.trim()) && !/\bCV-/i.test(value.trim()) && !/^Catalogue Variant$/i.test(value.trim());

function records(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!row(payload)) return null;
  if (Array.isArray(payload.products)) return payload.products;
  if (Array.isArray(payload.data)) return payload.data;
  return null;
}

function choicesFor(product: Row): Choice[] | null {
  const model = row(product.model) ? product.model : null;
  const source = Array.isArray(product.choices) ? product.choices : model?.choices;
  if (!Array.isArray(source) || source.length > 2) return null;
  const choices: Choice[] = [];
  const keys = new Set<string>();
  for (const rawChoice of source) {
    if (!row(rawChoice) || typeof rawChoice.key !== 'string' || !visibleText(rawChoice.name) || !Array.isArray(rawChoice.values)) return null;
    const values: ChoiceValue[] = [];
    for (const rawValue of rawChoice.values) {
      if (!row(rawValue) || rawValue.retired === true) continue;
      if (typeof rawValue.key !== 'string' || !rawValue.key || keys.has(rawValue.key) || !visibleText(rawValue.label)) return null;
      keys.add(rawValue.key);
      values.push({ key: rawValue.key, label: rawValue.label.trim() });
    }
    if (!values.length) return null;
    choices.push({ key: rawChoice.key, name: rawChoice.name.trim(), values });
  }
  return choices;
}

function combinationsFor(product: Row, choices: Choice[]): Combination[] | null {
  const model = row(product.model) ? product.model : null;
  const source = Array.isArray(product.combinations) ? product.combinations : model?.combinations;
  if (!Array.isArray(source)) return null;
  const expected = choices.reduce((count, choice) => count * choice.values.length, 1);
  if (source.length !== expected) return null;
  const choiceByValue = new Map(choices.flatMap((choice, index) => choice.values.map((value) => [value.key, index] as const)));
  const seen = new Set<string>();
  const variantIds = new Set<number>();
  const combinations: Combination[] = [];
  for (const raw of source) {
    if (!row(raw) || !Array.isArray(raw.valueKeys) || !positiveId(raw.variantId)
      || !finite(raw.price) || !finite(raw.inventory) || !Number.isSafeInteger(raw.inventory)) return null;
    const valueKeys = raw.valueKeys.filter((key): key is string => typeof key === 'string');
    if (valueKeys.length !== choices.length || variantIds.has(raw.variantId)) return null;
    const ordered = choices.map((_, index) => valueKeys.find((key) => choiceByValue.get(key) === index));
    if (ordered.some((key) => !key)) return null;
    const key = ordered.join('\u0000');
    if (seen.has(key)) return null;
    seen.add(key);
    variantIds.add(raw.variantId);
    combinations.push({ valueKeys: ordered as string[], variantId: raw.variantId, price: raw.price, inventory: raw.inventory });
  }
  return combinations;
}

function imagesFor(product: Row): ImageRecord[] | null {
  const source = Array.isArray(product.images) ? product.images : Array.isArray(product.media) ? product.media : null;
  if (!source?.length) return null;
  const images: ImageRecord[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const image = source[index];
    if (!row(image)) return null;
    const url = typeof image.url === 'string' ? image.url : typeof image.imageUrl === 'string' ? image.imageUrl : '';
    const assignment = typeof image.assignment === 'string' ? image.assignment : 'all';
    const order = typeof image.order === 'number' && Number.isSafeInteger(image.order) ? image.order : index;
    if (!url || order < 0) return null;
    images.push({ url, assignment, order });
  }
  return images.sort((left, right) => left.order - right.order);
}

function adaptProduct(value: unknown, fallback: MerchandiseProduct[]): MerchandiseProduct | null {
  if (!row(value)) return null;
  const model = row(value.model) ? value.model : null;
  const details = row(value.details) ? value.details : row(model?.details) ? model.details : value;
  const bundleProductId = value.bundleProductId ?? value.currentBundleProductId;
  if (!positiveId(bundleProductId) || !visibleText(value.slug) || !visibleText(details.title)
    || !finite(details.price) || typeof details.description !== 'string') return null;
  const title = details.title as string;
  const price = details.price as number;
  const productContent = parseProductDescription(details.description as string);
  const description = productContent.description;
  const choices = choicesFor(value);
  if (!choices) return null;
  const combinations = combinationsFor(value, choices);
  const imageRecords = imagesFor(value);
  if (!combinations || !imageRecords) return null;
  const activeValueKeys = new Set(choices.flatMap((choice) => choice.values.map((item) => item.key)));
  if (imageRecords.some((image) => image.assignment !== 'all' && !activeValueKeys.has(image.assignment))) return null;

  const primaryChoiceIndex = Math.max(0, choices.findIndex((choice) => !/^size$/i.test(choice.name)));
  const primaryChoice = choices[primaryChoiceIndex];
  const sizeChoice = choices.find((choice, index) => index !== primaryChoiceIndex && /^size$/i.test(choice.name));
  const primaryValues = primaryChoice?.values || [{ key: 'standard', label: 'Standard' }];
  const sizes = sizeChoice?.values.map((item) => item.label) || [];
  const allImages = imageRecords.map((image) => image.url);
  const enrichment = fallback.find((item) => item.slug === value.slug || item.name.toLowerCase() === title.toLowerCase());
  // ponytail: small storefront list; index fallback by Bundle ID if catalogue size grows.
  const liveProduct = fallback.find((item) => item.apiProductId === bundleProductId);
  const colourOption = /^colou?r$/i.test(primaryChoice?.name || '');
  const options: MerchandiseOption[] = primaryValues.map((primary) => {
    const assigned = imageRecords.filter((image) => image.assignment === primary.key);
    const optionGallery = imageRecords.filter((image) => image.assignment === 'all' || image.assignment === primary.key).map((image) => image.url);
    const existing = enrichment?.options.find((option) => option.name.toLowerCase() === primary.label.toLowerCase());
    const swatch = existing?.swatch || (colourOption
      ? resolveMerchandiseSwatch(primary.label) || UNKNOWN_MERCHANDISE_SWATCH
      : undefined);
    return {
      name: primary.label,
      image: assigned[0]?.url || optionGallery[0] || allImages[0],
      ...(swatch ? { swatch } : {}),
      ...(sizes.length ? { sizes } : {}),
      gallery: optionGallery,
    };
  });
  const variantIds: Record<string, number> = {};
  const variantPrices: Record<string, number> = {};
  const variantInventoryById: Record<number, number> = {};
  for (const combination of combinations) {
    const labels = combination.valueKeys.map((key, index) => choices[index].values.find((value) => value.key === key)?.label || '');
    const primary = labels[primaryChoiceIndex] || 'Standard';
    const size = sizeChoice ? labels[choices.indexOf(sizeChoice)] : undefined;
    const key = merchandiseVariantKey(primary, size);
    variantIds[key] = combination.variantId;
    variantPrices[key] = combination.price;
    variantInventoryById[combination.variantId] = Math.max(
      0,
      Number(liveProduct?.variantInventoryById?.[combination.variantId]) || 0,
    );
  }
  const inventory = Object.values(variantInventoryById).reduce((total, quantity) => total + quantity, 0);
  const category = value.managementDomain === 'SIM'
    ? 'SIM Card'
    : typeof details.category === 'string' && details.category.trim()
      ? details.category.trim()
      : enrichment?.category || 'Other';
  return {
    id: typeof value.catalogueId === 'string' && value.catalogueId ? value.catalogueId : String(bundleProductId),
    apiProductId: bundleProductId,
    slug: value.slug.trim(),
    name: title.trim(),
    category,
    price,
    description,
    optionLabel: primaryChoice?.name,
    options,
    ...(sizes.length ? { sizes } : {}),
    gallery: allImages,
    features: productContent.details.length ? productContent.details : enrichment?.features,
    unitLabel: enrichment?.unitLabel,
    soldOut: inventory === 0,
    inventory,
    variantIds,
    variantPrices,
    variantInventoryById,
    minimumOrderQuantity: positiveId(value.minimumOrderQuantity) ? value.minimumOrderQuantity : enrichment?.minimumOrderQuantity || 1,
    hasColorImageAssignments: imageRecords.some((image) => image.assignment !== 'all'),
  };
}

export function adaptCatalogueStorefrontPayload(payload: unknown, fallback = merchandiseProducts): MerchandiseProduct[] {
  const visibleFallback = fallback.some((product) => product.providerBindingOnly)
    ? fallback.filter((product) => !product.providerBindingOnly)
    : fallback;
  const source = records(payload);
  if (!source?.length) return visibleFallback;
  const projected = source.map((product) => adaptProduct(product, fallback));
  if (!projected.every((product): product is MerchandiseProduct => Boolean(product))) return visibleFallback;
  const bundleIds = new Set(projected.flatMap((product) => positiveId(product.apiProductId) ? [product.apiProductId] : []));
  const slugs = new Set(projected.map((product) => product.slug));
  const names = new Set(projected.map((product) => product.name.toLowerCase()));
  const legacy = visibleFallback.filter((product) => !bundleIds.has(product.apiProductId ?? -1)
    && !slugs.has(product.slug) && !names.has(product.name.toLowerCase()));
  return [...projected, ...legacy];
}

export async function fetchCatalogueStorefrontProducts(fallback: MerchandiseProduct[]): Promise<MerchandiseProduct[]> {
  try {
    const response = await fetch(CATALOGUE_STOREFRONT_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) return fallback.filter((product) => !product.providerBindingOnly);
    return adaptCatalogueStorefrontPayload(await response.json(), fallback);
  } catch {
    return fallback.filter((product) => !product.providerBindingOnly);
  }
}
