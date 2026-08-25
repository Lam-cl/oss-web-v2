import { BUNDLE_API, readUpstream, sanitizePayload } from './server';
import { PRODUCT_SETUP_DRAFT_TAG } from '@/lib/productSetup';

type SetupOption = { name: string; values: string[] };
type VariantOverride = { values: string[]; sku?: string; price?: number; inventory?: number };

export type CompleteProductSpec = {
  type: 'MOBILE' | 'MERCHANDISE';
  title: string;
  slug?: string;
  description: string;
  price: number;
  shippingCost: number;
  weight: number;
  categories: string[];
  tags: string[];
  defaultInventory: number;
  options: SetupOption[];
  variantOverrides?: VariantOverride[];
};

type ApiOptionValue = { id: number; value: string; imageUrl?: string | null };
type ApiOption = { id: number; name: string; values: ApiOptionValue[] };
type ApiVariant = {
  id: number;
  sku?: string;
  price?: number | string;
  inventory?: number;
  selectedOptions?: Array<{
    optionName?: string;
    optionValue?: string;
    value?: string;
    productOptionValue?: { value?: string; productOption?: { name?: string } };
  }>;
};
type ApiProduct = {
  id: number;
  title?: string;
  slug?: string;
  price?: number | string;
  options?: ApiOption[];
  productVariants?: ApiVariant[];
  categories?: Array<string | { name?: string | null }>;
  tags?: Array<string | { name?: string | null }>;
  images?: Array<{ id?: number; url?: string }>;
};

export class ProductSetupError extends Error {
  constructor(message: string, public status = 422, public productId?: number) {
    super(message);
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalise(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function variantKey(values: string[]) {
  return values.map(normalise).join('::');
}

function skuContainsValue(sku: string, value: string) {
  const skuTokens = normalise(sku).split('-').filter(Boolean);
  const valueTokens = normalise(value).split('-').filter(Boolean);
  if (!valueTokens.length || valueTokens.length > skuTokens.length) return false;
  return skuTokens.some((_, index) => valueTokens.every(
    (token, valueIndex) => skuTokens[index + valueIndex] === token,
  ));
}

function cleanSpec(raw: unknown): CompleteProductSpec {
  if (!raw || typeof raw !== 'object') throw new ProductSetupError('Product information is missing.', 400);
  const input = raw as Partial<CompleteProductSpec>;
  const type = input.type === 'MOBILE' ? 'MOBILE' : input.type === 'MERCHANDISE' ? 'MERCHANDISE' : null;
  const title = text(input.title);
  const description = text(input.description);
  const price = Number(input.price);
  if (!type || !title || !description || !Number.isFinite(price) || price < 0) {
    throw new ProductSetupError('Complete the product type, title, description and price.', 400);
  }

  const maximumOptions = type === 'MOBILE' ? 1 : 2;
  const options = (Array.isArray(input.options) ? input.options : []).map((option) => ({
    name: text(option?.name),
    values: Array.from(new Set((Array.isArray(option?.values) ? option.values : []).map(text).filter(Boolean))),
  })).filter((option) => option.name && option.values.length);
  if (options.length > maximumOptions) {
    throw new ProductSetupError(type === 'MOBILE'
      ? 'Mobile products support one variation group.'
      : 'Merchandise supports up to two variation groups.', 400);
  }
  if (options.some((option) => option.values.length > 30)) {
    throw new ProductSetupError('Each variation group supports up to 30 values.', 400);
  }

  const uniqueOptionNames = new Set(options.map((option) => option.name.toLowerCase()));
  if (uniqueOptionNames.size !== options.length) throw new ProductSetupError('Variation names must be different.', 400);

  return {
    type,
    title,
    slug: text(input.slug),
    description,
    price,
    shippingCost: Math.max(0, Number(input.shippingCost) || 0),
    weight: Math.max(0, Number(input.weight) || 0),
    categories: Array.from(new Set((Array.isArray(input.categories) ? input.categories : []).map(text).filter(Boolean))),
    tags: Array.from(new Set((Array.isArray(input.tags) ? input.tags : []).map(text).filter(Boolean)))
      .filter((tag) => tag.toLowerCase() !== PRODUCT_SETUP_DRAFT_TAG),
    defaultInventory: Math.max(0, Math.floor(Number(input.defaultInventory) || 0)),
    options,
    variantOverrides: Array.isArray(input.variantOverrides) ? input.variantOverrides : [],
  };
}

function authHeaders(token: string, json = false) {
  const headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' });
  if (json) headers.set('content-type', 'application/json');
  return headers;
}

function taxonomyNames(values: Array<string | { name?: string | null }> = []) {
  const raw = values.map((value) => typeof value === 'string' ? value : value.name || '').filter(Boolean);
  const joined = raw.join(',');
  if (joined.trim().startsWith('[') && joined.trim().endsWith(']')) {
    try {
      const parsed = JSON.parse(joined);
      if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
    } catch { /* Recover each malformed Bundle value below. */ }
  }
  return raw.map((value) => value.replace(/^\s*[\["']+|[\]"']+\s*$/g, '').trim()).filter(Boolean);
}

function hasExactDraftTag(product: ApiProduct) {
  return Boolean(product.tags?.some((tag) => {
    const value = typeof tag === 'string' ? tag : tag.name || '';
    return value.trim().toLowerCase() === PRODUCT_SETUP_DRAFT_TAG;
  }));
}

function appendProductFields(form: FormData, spec: CompleteProductSpec, tags: string[], includeSlug = true) {
  form.append('type', spec.type);
  form.append('title', spec.title);
  form.append('description', spec.description);
  form.append('price', String(spec.price));
  form.append('shippingCost', String(spec.shippingCost));
  form.append('weight', String(spec.weight));
  if (includeSlug && spec.slug) form.append('slug', spec.slug);
  // Bundle documents these multipart fields as JSON strings. Some releases
  // return the stored values in fragments; the read-side normaliser handles
  // that without changing the write contract.
  form.append('categories', JSON.stringify(spec.categories));
  form.append('tags', JSON.stringify(tags));
}

async function updateProductMetadata(productId: number, spec: CompleteProductSpec, tags: string[], token: string, image?: File) {
  const body = new FormData();
  appendProductFields(body, spec, tags);
  if (image) body.append('images', image);
  await upstream(`products/${productId}`, token, {
    method: 'PUT',
    headers: authHeaders(token),
    body,
  });
}

async function uploadImagesOneAtATime(
  productId: number,
  spec: CompleteProductSpec,
  tags: string[],
  images: File[],
  token: string,
  existingCount: number,
) {
  for (const image of images) {
    await updateProductMetadata(productId, spec, tags, token, image);
  }
  const product = await getProduct(productId, token);
  if ((product.images?.length || 0) < existingCount + images.length) {
    throw new ProductSetupError('Bundle API did not save every selected product image.', 502, productId);
  }
  return product;
}

async function upstream(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${BUNDLE_API}/${path}`, {
    ...init,
    headers: init.headers || authHeaders(token),
    cache: 'no-store',
  });
  const payload = await readUpstream(response);
  if (!response.ok) {
    const native = payload && typeof payload === 'object' ? (payload as { message?: unknown }).message : null;
    const message = typeof native === 'string' && native.length < 240 && !/password|token|secret|hash|sql|stack|query/i.test(native)
      ? native
      : `Bundle API could not complete ${path}.`;
    throw new ProductSetupError(message, response.status);
  }
  return payload;
}

function unwrapProduct(payload: unknown): ApiProduct {
  const value = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data?: unknown }).data
    : payload;
  if (!value || typeof value !== 'object' || !Number((value as { id?: unknown }).id)) {
    throw new ProductSetupError('Bundle API did not return the saved product.', 502);
  }
  return value as ApiProduct;
}

async function getProduct(productId: number, token: string) {
  return unwrapProduct(await upstream(`products/${productId}`, token, { headers: authHeaders(token) }));
}

function selectedMap(variant: ApiVariant) {
  const result = new Map<string, string>();
  for (const selected of variant.selectedOptions || []) {
    const name = selected.optionName || selected.productOptionValue?.productOption?.name;
    const value = selected.optionValue || selected.value || selected.productOptionValue?.value;
    if (name && value) result.set(normalise(name), value);
  }
  return result;
}

export function mapProductVariants(product: ApiProduct, requestedOptions?: SetupOption[]) {
  const options = requestedOptions?.length
    ? requestedOptions
    : (product.options || []).map((option) => ({ name: option.name, values: option.values.map((value) => value.value) }));
  const variants = [...(product.productVariants || [])].sort((a, b) => a.id - b.id);
  const mapped = new Map<string, ApiVariant>();
  if (!options.length) return mapped;

  for (const variant of variants) {
    const selected = selectedMap(variant);
    const values = options.map((option) => selected.get(normalise(option.name)) || '');
    if (values.every(Boolean)) mapped.set(variantKey(values), variant);
  }

  const combinations = expectedCombinations(options);
  const nativeRelationshipsMissing = variants.every((variant) => !(variant.selectedOptions || []).length);
  if (nativeRelationshipsMissing) {
    let combinationVariants: ApiVariant[] | null = null;
    if (variants.length === combinations.length) {
      combinationVariants = variants;
    } else if (
      options.length === 2
      && variants.length === options[0].values.length + combinations.length
    ) {
      // Bundle retains one orphan variant per primary-option value before
      // appending the full primary x secondary combinations.
      combinationVariants = variants.slice(options[0].values.length);
    }
    if (combinationVariants?.length === combinations.length) {
      mapped.clear();
      combinations.forEach((values, index) => mapped.set(variantKey(values), combinationVariants![index]));
      return mapped;
    }
  }

  // Bundle frequently omits selectedOptions. A uniquely matching SKU remains
  // a safer fallback than disabling an otherwise valid variation.
  for (const variant of variants) {
    if (Array.from(mapped.values()).some((item) => item.id === variant.id)) continue;
    const sku = normalise(variant.sku || '');
    const candidates: string[][] = [];
    const walk = (index: number, values: string[]) => {
      if (index === options.length) {
        if (values.every((value) => skuContainsValue(sku, value))) candidates.push(values);
        return;
      }
      options[index].values.forEach((value) => walk(index + 1, [...values, value]));
    };
    walk(0, []);
    if (candidates.length === 1) mapped.set(variantKey(candidates[0]), variant);
  }

  if (mapped.size === 0) {
    if (variants.length === combinations.length) {
      combinations.forEach((values, index) => mapped.set(variantKey(values), variants[index]));
    }
  }
  return mapped;
}

function expectedCombinations(options: SetupOption[]) {
  const result: string[][] = [];
  const walk = (index: number, values: string[]) => {
    if (index === options.length) result.push(values);
    else options[index].values.forEach((value) => walk(index + 1, [...values, value]));
  };
  walk(0, []);
  return result;
}

function generatedSku(spec: CompleteProductSpec, values: string[], index: number) {
  const prefix = normalise(spec.slug || spec.title).toUpperCase() || `PRODUCT-${index + 1}`;
  const suffix = values.map((value) => normalise(value).toUpperCase()).filter(Boolean).join('-');
  return `${prefix}${suffix ? `-${suffix}` : ''}`;
}

async function updateVariantDetails(product: ApiProduct, spec: CompleteProductSpec, options: SetupOption[], token: string) {
  const mapped = mapProductVariants(product, options);
  const combinations = expectedCombinations(options);
  const overrides = new Map((spec.variantOverrides || []).map((override) => [variantKey(override.values || []), override]));
  if (mapped.size < combinations.length) {
    throw new ProductSetupError('Some variation values do not have a matching Bundle variant.', 422, product.id);
  }
  const variants = combinations.map((values, index) => {
    const variant = mapped.get(variantKey(values));
    const override = overrides.get(variantKey(values));
    if (!variant) throw new ProductSetupError('A variation mapping is incomplete.', 422, product.id);
    return {
      id: variant.id,
      sku: text(override?.sku) || generatedSku(spec, values, index),
      price: Number.isFinite(Number(override?.price)) ? Number(override?.price) : spec.price,
      inventory: Number.isFinite(Number(override?.inventory))
        ? Math.max(0, Math.floor(Number(override?.inventory)))
        : spec.defaultInventory,
    };
  });
  await upstream(`products/${product.id}/batch-update`, token, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ variants }),
  });
}

async function uploadValueImages(product: ApiProduct, form: FormData, options: SetupOption[], token: string) {
  for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
    const apiOption = product.options?.find((option) => normalise(option.name) === normalise(options[optionIndex].name));
    if (!apiOption) continue;
    for (let valueIndex = 0; valueIndex < options[optionIndex].values.length; valueIndex += 1) {
      const file = form.get(`valueImage:${optionIndex}:${valueIndex}`);
      if (!(file instanceof File) || file.size === 0) continue;
      const apiValue = apiOption.values.find(
        (value) => normalise(value.value) === normalise(options[optionIndex].values[valueIndex]),
      );
      if (!apiValue) continue;
      const payload = new FormData();
      payload.append('image', file);
      await upstream(`products/${product.id}/option-values/${apiValue.id}/image`, token, {
        method: 'POST',
        headers: authHeaders(token),
        body: payload,
      });
    }
  }
}

async function publishRepairedProduct(product: ApiProduct, token: string) {
  if (!product.images?.length) throw new ProductSetupError('Add at least one image before publishing this draft.', 422, product.id);
  const tags = taxonomyNames(product.tags).filter((tag) => !tag.toLowerCase().includes(PRODUCT_SETUP_DRAFT_TAG));
  const body = new FormData();
  body.append('tags', tags.join(','));
  await upstream(`products/${product.id}`, token, { method: 'PUT', headers: authHeaders(token), body });
  return getProduct(product.id, token);
}

export async function completeProductSetup(form: FormData, token: string) {
  const rawSpec = form.get('spec');
  let parsed: unknown;
  try { parsed = JSON.parse(String(rawSpec || '')); } catch { throw new ProductSetupError('Product setup data is invalid.', 400); }
  const spec = cleanSpec(parsed);
  const images = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
  if (!images.length) throw new ProductSetupError('Add at least one product image before publishing.', 400);

  const draftTags = [...spec.tags, PRODUCT_SETUP_DRAFT_TAG];
  const metadata = new FormData();
  appendProductFields(metadata, spec, draftTags, false);
  metadata.append('images', images[0]);

  let productId: number | undefined;
  try {
    const created = unwrapProduct(await upstream('products/upload', token, {
      method: 'POST',
      headers: authHeaders(token),
      body: metadata,
    }));
    productId = created.id;

    let product = await getProduct(productId, token);
    if (!product.images?.length) {
      throw new ProductSetupError('Bundle API did not save the first selected product image.', 502, productId);
    }
    product = await uploadImagesOneAtATime(
      productId,
      spec,
      draftTags,
      images.slice(1),
      token,
      product.images.length,
    );

    const options = spec.options.length ? spec.options : [{ name: 'Style', values: ['Standard'] }];
    for (const option of options) {
      await upstream(`products/${productId}/variants`, token, {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify({
          optionName: option.name,
          values: option.values.map((value) => ({ value })),
          autoGenerateSku: true,
          defaultInventory: spec.defaultInventory,
        }),
      });
    }

    product = await getProduct(productId, token);
    await updateVariantDetails(product, spec, options, token);
    product = await getProduct(productId, token);
    await uploadValueImages(product, form, options, token);

    await updateProductMetadata(productId, spec, spec.tags, token);
    product = await getProduct(productId, token);
    if (hasExactDraftTag(product)) {
      throw new ProductSetupError('Product setup finished, but Bundle API could not publish the draft.', 502, productId);
    }
    return { product: sanitizePayload(product), setupState: 'complete' as const };
  } catch (reason) {
    if (reason instanceof ProductSetupError) {
      reason.productId ||= productId;
      if (productId) reason.message = `${reason.message} Product #${productId} was kept as a draft; retry from Edit.`;
      throw reason;
    }
    throw new ProductSetupError('Product setup could not be completed.', 502, productId);
  }
}

export async function resumeProductSetup(productId: number, form: FormData, token: string) {
  const rawSpec = form.get('spec');
  let parsed: unknown;
  try { parsed = JSON.parse(String(rawSpec || '')); } catch { throw new ProductSetupError('Product setup data is invalid.', 400, productId); }
  const spec = cleanSpec(parsed);
  const options = spec.options.length ? spec.options : [{ name: 'Style', values: ['Standard'] }];

  try {
    let product = await getProduct(productId, token);
    await updateProductMetadata(productId, spec, [...spec.tags, PRODUCT_SETUP_DRAFT_TAG], token);
    product = await getProduct(productId, token);
    const images = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
    if (!product.images?.length) {
      if (!images.length) throw new ProductSetupError('Add at least one product image before publishing.', 400, productId);
      product = await uploadImagesOneAtATime(
        productId,
        spec,
        [...spec.tags, PRODUCT_SETUP_DRAFT_TAG],
        images,
        token,
        0,
      );
    }

    for (const option of options) {
      const existing = product.options?.find((item) => normalise(item.name) === normalise(option.name));
      const existingValues = new Set((existing?.values || []).map((value) => normalise(value.value)));
      const missingValues = option.values.filter((value) => !existingValues.has(normalise(value)));
      if (!existing || missingValues.length) {
        await upstream(`products/${productId}/variants`, token, {
          method: 'POST',
          headers: authHeaders(token, true),
          body: JSON.stringify({
            optionName: option.name,
            values: (existing ? missingValues : option.values).map((value) => ({ value })),
            autoGenerateSku: true,
            defaultInventory: spec.defaultInventory,
          }),
        });
        product = await getProduct(productId, token);
      }
    }

    await updateVariantDetails(product, spec, options, token);
    product = await getProduct(productId, token);
    await uploadValueImages(product, form, options, token);
    await updateProductMetadata(productId, spec, spec.tags, token);
    product = await getProduct(productId, token);
    if (hasExactDraftTag(product)) {
      throw new ProductSetupError('Product setup finished, but Bundle API could not publish the draft.', 502, productId);
    }
    return { product: sanitizePayload(product), setupState: 'complete' as const };
  } catch (reason) {
    if (reason instanceof ProductSetupError) {
      reason.productId ||= productId;
      throw reason;
    }
    throw new ProductSetupError('Draft setup could not be completed.', 502, productId);
  }
}

export async function repairProductVariants(productId: number, token: string) {
  let product = await getProduct(productId, token);
  const options = product.options || [];
  if (options.length !== 1) {
    const requestedOptions = options.map((option) => ({ name: option.name, values: option.values.map((value) => value.value) }));
    const expected = expectedCombinations(requestedOptions);
    const mapped = mapProductVariants(product, requestedOptions);
    if (!expected.length || mapped.size < expected.length) {
      throw new ProductSetupError('This multi-option draft is incomplete. Recreate the missing combinations before publishing.', 422, productId);
    }
    product = await publishRepairedProduct(product, token);
    return { product: sanitizePayload(product), repaired: 0 };
  }
  const option = options[0];
  const requested = [{ name: option.name, values: option.values.map((value) => value.value) }];
  const mapped = mapProductVariants(product, requested);
  const missing = option.values.filter((value) => !mapped.has(variantKey([value.value])));
  if (!missing.length) {
    product = await publishRepairedProduct(product, token);
    return { product: sanitizePayload(product), repaired: 0 };
  }

  for (const value of missing) {
    await upstream(`products/${productId}/options/${option.id}/values/${value.id}`, token, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
  }
  const defaultVariant = product.productVariants?.[0];
  await upstream(`products/${productId}/variants`, token, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      optionName: option.name,
      values: missing.map((value) => ({ value: value.value })),
      autoGenerateSku: true,
      defaultInventory: Math.max(0, Number(defaultVariant?.inventory) || 0),
    }),
  });
  product = await getProduct(productId, token);
  const repairedMap = mapProductVariants(product, requested);
  if (repairedMap.size < requested[0].values.length) {
    throw new ProductSetupError('Bundle API created variants but their mapping is still incomplete.', 422, productId);
  }
  product = await publishRepairedProduct(product, token);
  return { product: sanitizePayload(product), repaired: missing.length };
}
