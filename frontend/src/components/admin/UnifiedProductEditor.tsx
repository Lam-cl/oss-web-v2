'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeProductEditorSpec } from '@/lib/admin/productEditor';
import type { ProductEditorChoice, ProductEditorCombination, ProductEditorSpec } from '@/lib/admin/productEditor';
import { formatProductDescription, parseProductDescription } from '@/lib/productDescription';
import { adminMediaUrl } from '@/lib/admin/mediaUrl';
import styles from './UnifiedProductEditor.module.css';

export type UnifiedProductEditorExistingPhoto = {
  imageId?: number;
  mediaId?: string;
  url: string;
  alt?: string;
  assignment?: 'all' | string;
  removed?: boolean;
  order?: number;
};

export type UnifiedProductEditorPendingPhoto = {
  key: string;
  file: File;
  previewUrl: string;
  alt?: string;
  assignment?: 'all' | string;
  removed?: boolean;
  order?: number;
};

export type UnifiedProductEditorPhotoRow = {
  key: string;
  kind: 'existing' | 'pending';
  imageId?: number;
  mediaId?: string;
  file?: File;
  url: string;
  alt: string;
  assignment: 'all' | string;
  removed: boolean;
};

export type UnifiedProductEditorSaveIntent = {
  spec: ProductEditorSpec;
  inventoryChanges: Array<{
    valueKeys: string[];
    variantId: number;
    expectedInventory: number;
    inventory: number;
  }>;
  existingMedia: Array<{
    mediaId: string;
    url: string;
    order: number;
    assignment: 'all' | string;
    remove: boolean;
  }>;
  pendingPhotos: Array<{
    key: string;
    file: File;
    order: number;
    assignment: 'all' | string;
  }>;
};

type SimPublishTarget = { currentBundleProductId: number | null; providerFingerprint?: string };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const SIM_IDENTITIES = {
  39: { legacyVariantId: 106, title: 'SUPERLITE SIM', optionId: 36 },
  40: { legacyVariantId: 107, title: 'BIZ SIM', optionId: 37 },
} as const;

export async function publishSimProduct(target: SimPublishTarget, intent: UnifiedProductEditorSaveIntent, fetcher: Fetcher = fetch) {
  const productId = target.currentBundleProductId;
  if (productId !== 39 && productId !== 40) throw new Error('SIM save requires the locked same-ID product identity.');
  if (!target.providerFingerprint || !/^[a-f0-9]{64}$/.test(target.providerFingerprint)) throw new Error('The current SIM provider fingerprint is unavailable. Reload before saving.');
  const identity = SIM_IDENTITIES[productId], { spec } = intent, choice = spec.choices[0];
  const activeValues = choice?.values.filter((value) => !value.retired) || [];
  if (spec.details.title !== identity.title || !/^SIM(?: Card)?$/i.test(spec.details.category?.trim() || '') || spec.choices.length !== 1
    || choice?.optionId !== identity.optionId || choice.name !== 'Variant'
    || JSON.stringify(activeValues.map((value) => value.label)) !== '["Tone Excel","Tone Plus"]'
    || activeValues.some((value) => !value.valueId)
    || spec.combinations.length !== 2) throw new Error('Locked SIM identity or exact Tone Excel/Tone Plus matrix changed. Reload before saving.');
  const variants = activeValues.map((value) => {
    const combination = spec.combinations.find((row) => JSON.stringify(row.valueKeys) === JSON.stringify([value.key]));
    if (!combination?.variantId || combination.variantId === identity.legacyVariantId || !combination.sku
      || !Number.isFinite(combination.price) || combination.price < 0
      || !Number.isSafeInteger(combination.inventory) || combination.inventory < 0) throw new Error(`Complete the authoritative ${value.label} price and inventory row.`);
    return { label: value.label, valueId: value.valueId!, variantId: combination.variantId, sku: combination.sku, price: combination.price, inventory: combination.inventory };
  });
  if (new Set(variants.map((row) => row.valueId)).size !== 2 || new Set(variants.map((row) => row.variantId)).size !== 2) throw new Error('SIM provider value and variant IDs must be unique.');
  if (intent.pendingPhotos.length || intent.existingMedia.some((photo) => photo.remove || photo.assignment !== 'all')) throw new Error('The SIM image is locked read-only for this release and cannot be changed.');
  const content = parseProductDescription(spec.details.description), description = content.description, productDetails = content.details.join('\n');
  if (description.length > 10000 || productDetails.length > 10000) throw new Error('SIM description or product details are too long.');
  const form = new FormData();
  form.set('expectedFingerprint', target.providerFingerprint); form.set('description', description); form.set('productDetails', productDetails);
  form.set('price', String(spec.details.price)); form.set('variants', JSON.stringify(variants));
  const response = await fetcher(`/admin-api/sim-products/${productId}/publish`, { method: 'POST', body: form, cache: 'no-store', credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : 'The SIM product could not be saved.');
  return payload as { fingerprint: string };
}

export type UnifiedProductEditorProps = {
  editorKey: string;
  availableCategories?: string[];
  managementDomain?: 'SIM' | string;
  minimumOrderQuantity?: number;
  lockedFields?: string[];
  saveMode?: 'product' | 'sim' | 'local-draft';
  model: ProductEditorSpec;
  liveInventory?: Record<string, number>;
  existingPhotos: UnifiedProductEditorExistingPhoto[];
  pendingPhotos: UnifiedProductEditorPendingPhoto[];
  onModelChange: (model: ProductEditorSpec) => void;
  onPhotosChange: (
    existingPhotos: UnifiedProductEditorExistingPhoto[],
    pendingPhotos: UnifiedProductEditorPendingPhoto[],
  ) => void;
  onSave: (intent: UnifiedProductEditorSaveIntent) => void | Promise<void>;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
};

const CHOICE_PRESETS = ['Color', 'Size', 'Style', 'Pack', 'Custom'] as const;
const PRODUCT_CATEGORIES = ['Apparel', 'Bottles', 'Marketing Material', 'Stationary', 'SIM Card'] as const;
const CUSTOM_CATEGORY = '__custom__';
const money = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' });

export function mergeProductCategories(categories: string[]) {
  const options: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...PRODUCT_CATEGORIES, ...categories]) {
    const category = raw.trim();
    const key = category.toLowerCase();
    if (!category || seen.has(key)) continue;
    seen.add(key);
    options.push(category);
  }
  return options;
}

function keyFrom(label: string, used: Set<string>, prefix: string) {
  const base = `${prefix}-${label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'}`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}-${suffix++}`;
  return key;
}

function cartesian(choices: ProductEditorChoice[], includeRetired: boolean) {
  if (!choices.length) return [[]] as string[][];
  return choices.reduce<string[][]>((rows, choice) => {
    const values = choice.values.filter((value) => includeRetired || !value.retired);
    return rows.flatMap((row) => values.map((value) => [...row, value.key]));
  }, [[]]);
}

function combinationKey(valueKeys: string[]) {
  return valueKeys.join('|');
}

/** Keep every still-representable combination, including retired rows. */
export function reconcileCombinations(model: ProductEditorSpec): ProductEditorSpec {
  if (model.choices.some((choice) => choice.values.length === 0)) return model;
  const previous = new Map(model.combinations.map((combination) => [combinationKey(combination.valueKeys), combination]));
  const combinations = cartesian(model.choices, true).map((valueKeys) => {
    const exact = previous.get(combinationKey(valueKeys));
    if (exact) return exact;
    return { valueKeys, price: model.details.price, inventory: 0 };
  });
  return { ...model, combinations };
}

export function removeChoiceFromModel(model: ProductEditorSpec, choiceKey: string): ProductEditorSpec {
  const choices = model.choices.filter((choice) => choice.key !== choiceKey);
  if (!choices.length) {
    const existing = model.combinations.find((combination) => combination.valueKeys.length === 0);
    return {
      ...model,
      choices,
      combinations: [{ valueKeys: [], price: model.details.price, inventory: existing?.inventory ?? 0 }],
    };
  }
  const validKeys = new Set(choices.flatMap((choice) => choice.values.map((value) => value.key)));
  const exact = model.combinations.filter((combination) =>
    combination.valueKeys.length === choices.length && combination.valueKeys.every((key) => validKeys.has(key)));
  return reconcileCombinations({ ...model, choices, combinations: exact });
}


export function buildPhotoRows(
  model: ProductEditorSpec,
  existingPhotos: UnifiedProductEditorExistingPhoto[],
  pendingPhotos: UnifiedProductEditorPendingPhoto[],
): UnifiedProductEditorPhotoRow[] {
  const imageState = new Map(model.existingImages.map((image) => [image.imageId, image]));
  const rows = [
    ...existingPhotos.map((photo, index) => {
      const state = photo.imageId === undefined ? undefined : imageState.get(photo.imageId);
      return {
        row: {
          key: photo.mediaId ? `media-${photo.mediaId}` : `existing-${photo.imageId}`,
          kind: 'existing' as const,
          imageId: photo.imageId,
          mediaId: photo.mediaId,
          url: photo.url,
          alt: photo.alt ?? '',
          assignment: photo.assignment ?? state?.assignment ?? 'all',
          removed: photo.removed ?? state?.remove ?? false,
        },
        order: photo.order ?? state?.order ?? index,
      };
    }),
    ...pendingPhotos.map((photo, index) => ({
      row: {
        key: photo.key,
        kind: 'pending' as const,
        file: photo.file,
        url: photo.previewUrl,
        alt: photo.alt ?? '',
        assignment: photo.assignment ?? 'all',
        removed: photo.removed ?? false,
      },
      order: photo.order ?? existingPhotos.length + index,
    })),
  ];
  return rows.sort((left, right) => left.order - right.order).map(({ row }) => row);
}

export function visiblePhotoRows(photos: UnifiedProductEditorPhotoRow[]) {
  return photos.filter((photo) => !photo.removed);
}

function splitPhotoRows(photos: UnifiedProductEditorPhotoRow[]) {
  const existingPhotos: UnifiedProductEditorExistingPhoto[] = [];
  const pendingPhotos: UnifiedProductEditorPendingPhoto[] = [];
  photos.forEach((photo, order) => {
    if (photo.kind === 'existing' && (photo.imageId !== undefined || photo.mediaId !== undefined)) {
      existingPhotos.push({
        imageId: photo.imageId,
        mediaId: photo.mediaId,
        url: photo.url,
        alt: photo.alt,
        assignment: photo.assignment,
        removed: photo.removed,
        order,
      });
    } else if (photo.kind === 'pending' && photo.file) {
      pendingPhotos.push({
        key: photo.key,
        file: photo.file,
        previewUrl: photo.url,
        alt: photo.alt,
        assignment: photo.assignment,
        removed: photo.removed,
        order,
      });
    }
  });
  return { existingPhotos, pendingPhotos };
}

export function toggleValueRetirement(
  model: ProductEditorSpec,
  photos: UnifiedProductEditorPhotoRow[],
  choiceKey: string,
  valueKey: string,
) {
  let isRetiring = false;
  const choices = model.choices.map((choice) => choice.key === choiceKey
    ? {
        ...choice,
        values: choice.values.map((value) => {
          if (value.key !== valueKey) return value;
          isRetiring = !value.retired;
          return { ...value, retired: !value.retired };
        }),
      }
    : choice);
  return {
    model: { ...model, choices },
    photos: isRetiring
      ? photos.map((photo) => photo.assignment === valueKey ? { ...photo, assignment: 'all' as const } : photo)
      : photos,
  };
}

export function validateProductEditorDraft(
  model: ProductEditorSpec,
  photos?: UnifiedProductEditorPhotoRow[],
  emptyNumericFields: ReadonlySet<string> = new Set(),
): string | null {
  if (!model.details.title.trim()) return 'Add a product name before saving.';
  if (emptyNumericFields.size) {
    const field = emptyNumericFields.values().next().value!;
    if (field === 'base-price') return 'Base price is required.';
    if (field === 'minimum-order-quantity') return 'Minimum order quantity is required.';
    const [kind, key] = field.split(':', 2);
    const combination = key === 'standard'
      ? model.combinations.find((row) => row.valueKeys.length === 0)
      : model.combinations.find((row) => combinationKey(row.valueKeys) === key);
    if (combination) return `${kind === 'inventory' ? 'Stock' : 'Variant price'} for ${combinationLabel(combination, model.choices)} is required.`;
    return 'Complete every price and stock field before saving.';
  }
  if (model.details.category !== undefined && !model.details.category.trim()) return 'Category cannot contain only spaces. Clear it or enter a category.';
  if (model.choices.length > 2) return 'Use no more than two product choices.';
  const names = new Set<string>();
  for (const choice of model.choices) {
    const name = choice.name.trim().toLowerCase();
    if (!name) return 'Every choice needs a name.';
    if (names.has(name)) return 'Choice names must be different.';
    names.add(name);
    if (!choice.values.length) return `Add at least one value for ${choice.name.trim() || 'this choice'}.`;
    if (!choice.values.some((value) => !value.retired)) return `Keep at least one active value for ${choice.name.trim()}.`;
    const labels = new Set<string>();
    for (const value of choice.values) {
      const label = value.label.trim().toLowerCase();
      if (!label) return `Every ${choice.name.trim()} value needs a label.`;
      if (labels.has(label)) return `${choice.name.trim()} value labels must be different.`;
      labels.add(label);
    }
  }
  try {
    const existingImages = photos?.flatMap((photo, order) => photo.kind === 'existing' && photo.imageId !== undefined
      ? [{ imageId: photo.imageId, order, assignment: photo.assignment, remove: photo.removed }]
      : []);
    normalizeProductEditorSpec(existingImages ? { ...model, existingImages } : model);
  } catch (problem) {
    return friendlySpecError(problem);
  }
  return null;
}

export function friendlySpecError(problem: unknown) {
  const message = problem instanceof Error ? problem.message : '';
  if (/live stock|stock variant|active product changed/i.test(message)) return message;
  if (/^Combination (?:inventory|price) must /i.test(message)) return message;
  if (/duplicate/i.test(message)) return 'Remove duplicate choice names, values, SKUs, or IDs before saving.';
  if (/combination/i.test(message)) return 'Complete every price and stock combination before saving.';
  if (/category/i.test(message)) return 'Enter a category or clear the category field.';
  if (/required|text/i.test(message)) return 'Complete the highlighted product information before saving.';
  return 'Some product details are not valid yet. Review the choices, prices, stock, and photos.';
}

export function buildStockMatrix(model: ProductEditorSpec) {
  const rows = model.choices[0]?.values.filter((value) => !value.retired) ?? [];
  const columns = model.choices[1]?.values.filter((value) => !value.retired) ?? [];
  const byKey = new Map(model.combinations.map((combination) => [combinationKey(combination.valueKeys), combination]));
  const cells = rows.map((row) => columns.map((column) => {
    const valueKeys = [row.key, column.key];
    return {
      key: combinationKey(valueKeys),
      valueKeys,
      combination: byKey.get(combinationKey(valueKeys)) ?? { valueKeys, price: model.details.price, inventory: 0 },
    };
  }));
  return { rows, columns, cells };
}

export function buildSaveIntent(
  model: ProductEditorSpec,
  photos: UnifiedProductEditorPhotoRow[],
  normalize: (input: unknown) => ProductEditorSpec = normalizeProductEditorSpec,
  persistDefaultMinimumOrderQuantity = true,
): UnifiedProductEditorSaveIntent {
  const savedOrder = new Map<UnifiedProductEditorPhotoRow, number>();
  let nextSavedOrder = 0;
  for (const photo of photos) {
    if (!photo.removed && ((photo.kind === 'existing' && (photo.imageId !== undefined || photo.mediaId))
      || (photo.kind === 'pending' && photo.file))) {
      savedOrder.set(photo, nextSavedOrder);
      nextSavedOrder += 1;
    }
  }
  let nextRemovedOrder = nextSavedOrder;
  const orderFor = (photo: UnifiedProductEditorPhotoRow) => savedOrder.get(photo) ?? nextRemovedOrder++;
  const existingOrders = new Map(photos.filter((photo) => photo.kind === 'existing').map((photo) => [photo, orderFor(photo)]));
  const existingImages = photos.flatMap((photo) => photo.kind === 'existing' && photo.imageId !== undefined
    ? [{ imageId: photo.imageId, order: existingOrders.get(photo)!, assignment: photo.assignment, remove: photo.removed }]
    : []);
  const saveModel = persistDefaultMinimumOrderQuantity && model.details.minimumOrderQuantity === undefined
    ? { ...model, details: { ...model.details, minimumOrderQuantity: 1 } }
    : model;
  const spec = normalize({ ...saveModel, existingImages });
  return {
    spec,
    inventoryChanges: [],
    existingMedia: photos.flatMap((photo) => photo.kind === 'existing' && photo.mediaId
      ? [{ mediaId: photo.mediaId, url: photo.url, order: existingOrders.get(photo)!, assignment: photo.assignment, remove: photo.removed }]
      : []),
    pendingPhotos: photos.flatMap((photo) => photo.kind === 'pending' && photo.file && !photo.removed
      ? [{ key: photo.key, file: photo.file, order: savedOrder.get(photo)!, assignment: photo.assignment }]
      : []),
  };
}

function combinationLabel(combination: ProductEditorCombination, choices: ProductEditorChoice[]) {
  if (!combination.valueKeys.length) return 'Product inventory';
  return combination.valueKeys.map((key) => choices.flatMap((choice) => choice.values).find((value) => value.key === key)?.label ?? key).join(' / ');
}

function NumericInput({ value, onChange, resetToken, step = 1, min = 0 }: { value: number; onChange: (value: number | '') => void; resetToken: number; step?: number; min?: number }) {
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => { setDraft(String(value)); }, [resetToken, value]);
  return <input
    min={min}
    step={step}
    type="number"
    inputMode={step === 1 ? 'numeric' : 'decimal'}
    placeholder="0"
    value={draft}
    onChange={(event) => {
      const raw = event.target.value;
      setDraft(raw);
      if (!raw.trim()) {
        onChange('');
        return;
      }
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric >= min) onChange(numeric);
    }}
  />;
}

export default function UnifiedProductEditor({
  editorKey,
  availableCategories = [],
  managementDomain,
  minimumOrderQuantity,
  lockedFields = [],
  saveMode = 'product',
  model,
  liveInventory,
  existingPhotos,
  pendingPhotos,
  onModelChange,
  onPhotosChange,
  onSave,
  onCancel,
  saving = false,
  error,
}: UnifiedProductEditorProps) {
  const simManaged = managementDomain === 'SIM';
  const saveLabel = saveMode === 'sim' ? 'Save SIM changes' : saveMode === 'local-draft' ? 'Save local draft' : 'Save product';
  const savingLabel = saveMode === 'local-draft' ? 'Saving draft…' : 'Saving…';
  const categoryOptions = useMemo(() => mergeProductCategories(availableCategories), [availableCategories]);
  const selectedCategory = categoryOptions.find((category) => category.toLowerCase() === model.details.category?.toLowerCase())
    ?? model.details.category ?? '';
  const initialProductContent = parseProductDescription(model.details.description);
  const [choiceDrafts, setChoiceDrafts] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState(initialProductContent.description);
  const [productDetailsDraft, setProductDetailsDraft] = useState(initialProductContent.details.join('\n'));
  const [emptyNumericFields, setEmptyNumericFields] = useState<Set<string>>(() => new Set());
  const [touchedInventory, setTouchedInventory] = useState<Set<string>>(() => new Set());
  const [numericResetToken, setNumericResetToken] = useState(0);
  const [customCategoryMode, setCustomCategoryMode] = useState(() => Boolean(
    model.details.category && !categoryOptions.some((category) => category.toLowerCase() === model.details.category!.toLowerCase()),
  ));
  const customChoiceRef = useRef<HTMLInputElement>(null);
  const createdObjectUrls = useRef(new Set<string>());
  useEffect(() => {
    const content = parseProductDescription(model.details.description);
    setDescriptionDraft(content.description);
    setProductDetailsDraft(content.details.join('\n'));
    setCustomCategoryMode(Boolean(
      model.details.category && !categoryOptions.some((category) => category.toLowerCase() === model.details.category!.toLowerCase()),
    ));
    setChoiceDrafts({});
    setEmptyNumericFields(new Set());
    setTouchedInventory(new Set());
    setNumericResetToken((current) => current + 1);
  }, [editorKey]);
  useEffect(() => () => {
    createdObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    createdObjectUrls.current.clear();
  }, []);
  const photos = useMemo(() => buildPhotoRows(model, existingPhotos, pendingPhotos), [model, existingPhotos, pendingPhotos]);
  const visiblePhotos = visiblePhotoRows(photos);
  const removedPhotos = photos.filter((photo) => photo.removed);
  const previewPhoto = visiblePhotos[0];
  const previewDetails = productDetailsDraft.split('\n').map((detail) => detail.trim()).filter(Boolean);
  const validationError = validateProductEditorDraft(model, photos, emptyNumericFields);
  const activeValues = model.choices.flatMap((choice) => choice.values.filter((value) => !value.retired).map((value) => ({ key: value.key, label: `${choice.name}: ${value.label}` })));
  const matrix = model.choices.length === 2 ? buildStockMatrix(model) : null;
  const shownInventory = (combination: ProductEditorCombination) => {
    const key = combinationKey(combination.valueKeys);
    return !touchedInventory.has(key) && liveInventory?.[key] !== undefined
      ? liveInventory[key]
      : combination.inventory;
  };
  const changeInventory = (combination: ProductEditorCombination, value: number | '') => {
    const key = combinationKey(combination.valueKeys);
    setTouchedInventory((current) => new Set(current).add(key));
    updateNumeric(`inventory:${key || 'standard'}`, value, (inventory) => updateCombination(combination.valueKeys, { inventory }));
  };

  const emitPhotos = (next: UnifiedProductEditorPhotoRow[]) => {
    const split = splitPhotoRows(next);
    onPhotosChange(split.existingPhotos, split.pendingPhotos);
  };
  const updateDetails = (field: keyof ProductEditorSpec['details'], value: string | number) => {
    onModelChange({ ...model, details: { ...model.details, [field]: value } });
  };
  const updateNumeric = (key: string, value: number | '', commit: (numeric: number) => void) => {
    setEmptyNumericFields((current) => {
      const next = new Set(current);
      if (value === '') next.add(key);
      else next.delete(key);
      return next;
    });
    if (value !== '') commit(value);
  };
  const updateBasePrice = (price: number) => {
    onModelChange({
      ...model,
      details: { ...model.details, price },
      combinations: model.choices.length === 0
        ? model.combinations.map((combination) => ({ ...combination, price }))
        : model.combinations,
    });
  };
  const clearCategory = () => {
    const { category: _category, ...details } = model.details;
    onModelChange({ ...model, details });
  };
  const selectCategory = (value: string) => {
    if (value === CUSTOM_CATEGORY) {
      setCustomCategoryMode(true);
      clearCategory();
      return;
    }
    setCustomCategoryMode(false);
    if (value) updateDetails('category', value);
    else clearCategory();
  };
  const updateDescription = (description: string) => {
    setDescriptionDraft(description);
    updateDetails('description', formatProductDescription(description, productDetailsDraft));
  };
  const updateProductDetails = (details: string) => {
    setProductDetailsDraft(details);
    updateDetails('description', formatProductDescription(descriptionDraft, details));
  };
  const addChoice = (preset: typeof CHOICE_PRESETS[number]) => {
    if (model.choices.length >= 2) return;
    const requestedName = preset === 'Custom' ? customChoiceRef.current?.value.trim() : preset;
    if (!requestedName) return;
    const used = new Set(model.choices.map((choice) => choice.key));
    onModelChange({ ...model, choices: [...model.choices, { key: keyFrom(requestedName, used, 'choice'), name: requestedName, values: [] }] });
    setEmptyNumericFields((current) => new Set(current.has('base-price') ? ['base-price'] : []));
    if (customChoiceRef.current) customChoiceRef.current.value = '';
  };
  const addValue = (choiceKey: string) => {
    const label = choiceDrafts[choiceKey]?.trim();
    if (!label) return;
    const choice = model.choices.find((item) => item.key === choiceKey);
    if (!choice || choice.values.some((value) => value.label.trim().toLowerCase() === label.toLowerCase())) return;
    const used = new Set(model.choices.flatMap((item) => item.values.map((value) => value.key)));
    const choices = model.choices.map((item) => item.key === choiceKey
      ? { ...item, values: [...item.values, { key: keyFrom(label, used, 'value'), label, retired: false }] }
      : item);
    onModelChange(reconcileCombinations({ ...model, choices }));
    setChoiceDrafts((current) => ({ ...current, [choiceKey]: '' }));
  };
  const handleValueKey = (event: KeyboardEvent<HTMLInputElement>, choiceKey: string) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addValue(choiceKey);
    }
  };
  const toggleValue = (choiceKey: string, valueKey: string) => {
    const next = toggleValueRetirement(model, photos, choiceKey, valueKey);
    onModelChange(next.model);
    if (next.photos !== photos) emitPhotos(next.photos);
  };
  const removeChoice = (choiceKey: string) => {
    const removed = model.choices.find((choice) => choice.key === choiceKey);
    const removedKeys = new Set(removed?.values.map((value) => value.key) ?? []);
    onModelChange(removeChoiceFromModel(model, choiceKey));
    setEmptyNumericFields((current) => new Set(current.has('base-price') ? ['base-price'] : []));
    emitPhotos(photos.map((photo) => removedKeys.has(photo.assignment) ? { ...photo, assignment: 'all' } : photo));
  };
  const updateCombination = (valueKeys: string[], patch: Partial<ProductEditorCombination>) => {
    const key = combinationKey(valueKeys);
    const found = model.combinations.some((combination) => combinationKey(combination.valueKeys) === key);
    onModelChange({
      ...model,
      combinations: found
        ? model.combinations.map((combination) => combinationKey(combination.valueKeys) === key ? { ...combination, ...patch } : combination)
        : [...model.combinations, { valueKeys, price: model.details.price, inventory: 0, ...patch }],
    });
  };
  const moveVisiblePhoto = (visibleIndex: number, direction: -1 | 1) => {
    const target = visibleIndex + direction;
    if (target < 0 || target >= visiblePhotos.length) return;
    const left = photos.findIndex((photo) => photo.key === visiblePhotos[visibleIndex].key);
    const right = photos.findIndex((photo) => photo.key === visiblePhotos[target].key);
    const next = [...photos];
    [next[left], next[right]] = [next[right], next[left]];
    emitPhotos(next);
  };
  const patchPhoto = (key: string, patch: Partial<UnifiedProductEditorPhotoRow>) => {
    emitPhotos(photos.map((photo) => photo.key === key ? { ...photo, ...patch } : photo));
  };
  const removePhoto = (photo: UnifiedProductEditorPhotoRow) => {
    if (photo.kind === 'pending') {
      URL.revokeObjectURL(photo.url);
      createdObjectUrls.current.delete(photo.url);
      emitPhotos(photos.filter((candidate) => candidate.key !== photo.key));
      return;
    }
    patchPhoto(photo.key, { removed: true });
  };
  const addPhotoFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const supported = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const selected = Array.from(files);
    if (selected.some((file) => !supported.has(file.type))) {
      setSubmitError('Choose JPG, PNG, or WebP photos.');
      return;
    }
    if (selected.some((file) => file.size > 10 * 1024 * 1024)) {
      setSubmitError('Each photo must be 10 MB or smaller.');
      return;
    }
    setSubmitError(null);
    emitPhotos([
      ...photos,
      ...selected.map((file) => {
        const url = URL.createObjectURL(file);
        createdObjectUrls.current.add(url);
        return {
          key: `pending-${crypto.randomUUID()}`,
          kind: 'pending' as const,
          file,
          url,
          alt: file.name.replace(/\.[^.]+$/, ''),
          assignment: 'all' as const,
          removed: false,
        };
      }),
    ]);
  };
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    if (saveMode === 'sim' && (pendingPhotos.length > 0 || existingPhotos.some((photo) => photo.removed || photo.assignment !== 'all'))) {
      setSubmitError('The SIM image is locked read-only for this release and cannot be changed.');
      return;
    }
    try {
      const intent = buildSaveIntent(model, photos, normalizeProductEditorSpec, !simManaged);
      intent.inventoryChanges = intent.spec.combinations.flatMap((combination) => {
        const key = combinationKey(combination.valueKeys);
        const expectedInventory = liveInventory?.[key];
        return touchedInventory.has(key)
          && combination.variantId !== undefined
          && expectedInventory !== undefined
          && combination.inventory !== expectedInventory
          ? [{ valueKeys: [...combination.valueKeys], variantId: combination.variantId, expectedInventory, inventory: combination.inventory }]
          : [];
      });
      await onSave(intent);
      createdObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      createdObjectUrls.current.clear();
    } catch (problem) {
      setSubmitError(friendlySpecError(problem));
    }
  };
  const liveError = submitError || error || validationError;

  return (
    <form className={styles.editor} onSubmit={handleSubmit} aria-label="Product editor">
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>Tone Wow catalogue</span><h1>Edit product</h1><p>Everything shoppers need, arranged in one easy flow.</p></div>
        <button className={styles.closeButton} type="button" onClick={onCancel} aria-label="Close product editor">×</button>
      </header>

      {simManaged && <aside className={styles.simBanner} aria-label="SIM management policy">
        <div><strong>Managed by SIM workflow</strong><p>Identity, choices, product codes and minimum order quantity are controlled by the SIM workflow.</p></div>
        <dl><div><dt>Minimum order quantity</dt><dd>{minimumOrderQuantity ?? 'Managed by SIM'}</dd></div><div><dt>Save destination</dt><dd>{saveMode === 'sim' ? 'SIM workflow' : 'Local catalogue draft'}</dd></div></dl>
        {lockedFields.length > 0 && <small>Locked fields: {lockedFields.join(', ')}</small>}
      </aside>}

      <main className={styles.flow}>
        <section className={styles.section} aria-labelledby="product-information-title">
          <div className={styles.sectionHeading}><span>01</span><div><h2 id="product-information-title">Product information</h2><p>Keep the name clear and the description useful.</p></div></div>
          <div className={styles.fields}>
            {simManaged ? <><div className={`${styles.fullField} ${styles.lockedField}`}><span>Product name</span><strong className={styles.lockedValue}>{model.details.title}</strong><small>Managed by SIM workflow</small></div><div className={styles.lockedField}><span>Category</span><strong className={styles.lockedValue}>{model.details.category || 'SIM Card'}</strong><small>Managed by SIM workflow</small></div></> : <>
              <label className={styles.fullField}>Product name<input required value={model.details.title} onChange={(event) => updateDetails('title', event.target.value)} /></label>
              <label>Category<select value={customCategoryMode ? CUSTOM_CATEGORY : selectedCategory} onChange={(event) => selectCategory(event.target.value)}><option value="">Select category</option>{categoryOptions.map((category) => <option value={category} key={category.toLowerCase()}>{category}</option>)}<option value={CUSTOM_CATEGORY}>Add new category…</option></select><small className={styles.fieldHint}>Choose a category, or select Add new category for future products.</small></label>
              {customCategoryMode && <label>New category<input autoFocus value={model.details.category ?? ''} onChange={(event) => updateDetails('category', event.target.value)} placeholder="New category name" /></label>}
              <label>Minimum order quantity<NumericInput resetToken={numericResetToken} min={1} step={1} value={model.details.minimumOrderQuantity ?? 1} onChange={(value) => updateNumeric('minimum-order-quantity', value, (minimumOrderQuantity) => updateDetails('minimumOrderQuantity', minimumOrderQuantity))} /></label>
            </>}
            <label className={styles.fullField}>Description<textarea rows={4} value={descriptionDraft} onChange={(event) => updateDescription(event.target.value)} /></label>
            <label className={styles.fullField}>Product details<textarea name="productDetails" rows={5} value={productDetailsDraft} onChange={(event) => updateProductDetails(event.target.value)} placeholder={'One detail per line\nExample: Material: Cotton\nSize: 6 ft × 2 ft'} /><small className={styles.fieldHint}>Enter one detail per line. These appear separately from the main description.</small></label>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="photos-choices-title">
          <div className={styles.sectionHeading}><span>02</span><div><h2 id="photos-choices-title">Choices and photos</h2><p>{simManaged ? 'SIM choices and the current General image are locked for this release.' : 'Set up product choices first, then upload and assign each photo to a choice or General.'}</p></div></div>
          {simManaged ? <div className={styles.lockedChoices}>
            <div className={styles.subheading}><h3>Product choices</h3><span>Managed by SIM workflow</span></div>
            {model.choices.length === 0 ? <p>No product choices.</p> : model.choices.map((choice) => <div key={choice.key}><strong>{choice.name}</strong><div className={styles.readOnlyChips}>{choice.values.filter((value) => !value.retired).map((value) => <span key={value.key}>{value.label}</span>)}</div></div>)}
          </div> : <div className={styles.choiceBuilder}>
            <div className={styles.subheading}><h3>Product choices</h3><span>{model.choices.length}/2 choices</span></div>
            <div className={styles.presets} aria-label="Choice presets">
              {CHOICE_PRESETS.filter((preset) => preset !== 'Custom').map((preset) => <button type="button" key={preset} disabled={model.choices.length >= 2} onClick={() => addChoice(preset)}>+ {preset}</button>)}
              <div className={styles.customChoice}><label htmlFor="custom-choice">Custom</label><input id="custom-choice" ref={customChoiceRef} placeholder="e.g. Material" /><button type="button" disabled={model.choices.length >= 2} onClick={() => addChoice('Custom')}>Add</button></div>
            </div>
            {model.choices.map((choice) => (
              <div className={styles.choicePanel} key={choice.key}>
                <div className={styles.choiceTop}><label>Choice name<input value={choice.name} disabled={choice.optionId !== undefined} title={choice.optionId !== undefined ? 'Existing choice names cannot be renamed.' : undefined} onChange={(event) => onModelChange({ ...model, choices: model.choices.map((item) => item.key === choice.key ? { ...item, name: event.target.value } : item) })} /></label><button type="button" onClick={() => removeChoice(choice.key)}>Remove choice</button></div>
                <div className={styles.chips} aria-label={`${choice.name} values`}>
                  {choice.values.map((value) => <span className={`${styles.chip} ${value.retired ? styles.isRetired : ''}`} key={value.key}><span>{value.label}</span>{value.valueId !== undefined && <small>Existing</small>}<button type="button" onClick={() => toggleValue(choice.key, value.key)} aria-label={`${value.retired ? 'Undo hiding of' : 'Hide'} ${value.label}`}>{value.retired ? 'Undo' : 'Hide'}</button></span>)}
                </div>
                <div className={styles.addValue}><label htmlFor={`value-${choice.key}`}>Add a {choice.name.toLowerCase()} value</label><div><input id={`value-${choice.key}`} value={choiceDrafts[choice.key] ?? ''} onChange={(event) => setChoiceDrafts((current) => ({ ...current, [choice.key]: event.target.value }))} onKeyDown={(event) => handleValueKey(event, choice.key)} placeholder="Type a value and press Enter" /><button type="button" onClick={() => addValue(choice.key)}>Add value</button></div></div>
                {(!choice.values.length || !choice.values.some((value) => !value.retired)) && <p className={styles.validationMessage} role="alert">{!choice.values.length ? 'Add at least one value to continue.' : 'Undo or add at least one active value to continue.'}</p>}
              </div>
            ))}
          </div>}

          {simManaged ? null : <label className={styles.photoUpload}>
            <span><strong>Add product photos</strong><small>JPG, PNG, or WebP · up to 10 MB each</small></span>
            <span aria-hidden="true">Choose photos</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => { addPhotoFiles(event.target.files); event.target.value = ''; }} />
          </label>}
          <div className={styles.photoGrid} aria-label="Ordered visible product photos">
            {visiblePhotos.length === 0 && <p className={styles.empty}>Add your cover photo and any choice-specific photos here.</p>}
            {visiblePhotos.map((photo, index) => (
              <article className={styles.photoCard} key={photo.key}>
                {/* eslint-disable-next-line @next/next/no-img-element */}<img src={adminMediaUrl(photo.url)} alt={photo.alt || `Product photo ${index + 1}`} />
                <div className={styles.photoBody}>
                  <strong>{index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</strong>
                  {simManaged ? <div className={styles.simManagedPhoto}><span>Current General image · Locked read-only</span></div> : <><label>Show for<select value={photo.assignment} onChange={(event) => patchPhoto(photo.key, { assignment: event.target.value })}><option value="all">General</option>{activeValues.map((value) => <option value={value.key} key={value.key}>{value.label}</option>)}</select></label>
                    <div className={styles.photoActions}>
                      <button type="button" onClick={() => moveVisiblePhoto(index, -1)} disabled={index === 0} aria-label={`Move photo ${index + 1} earlier`}>↑</button>
                      <button type="button" onClick={() => moveVisiblePhoto(index, 1)} disabled={index === visiblePhotos.length - 1} aria-label={`Move photo ${index + 1} later`}>↓</button>
                      <button type="button" onClick={() => removePhoto(photo)}>Remove</button>
                    </div></>}
                </div>
              </article>
            ))}
            {removedPhotos.map((photo) => (
              <article className={`${styles.photoCard} ${styles.isRetired}`} key={photo.key}>
                {/* eslint-disable-next-line @next/next/no-img-element */}<img src={adminMediaUrl(photo.url)} alt={photo.alt || 'Removed product photo'} />
                <div className={styles.photoBody}><strong>Removed photo</strong>{simManaged && photo.assignment !== 'all' ? <span className={styles.fieldHint}>Managed by SIM workflow</span> : <div className={styles.photoActions}><button type="button" onClick={() => patchPhoto(photo.key, { removed: false })}>Undo</button></div>}</div>
              </article>
            ))}
          </div>

        </section>

        <section className={styles.section} aria-labelledby="price-stock-title">
          <div className={styles.sectionHeading}><span>03</span><div><h2 id="price-stock-title">Price and stock</h2><p>{model.choices.length === 0 ? 'No choices added. Set one price and stock quantity for the whole product.' : model.choices.length === 2 ? 'Enter stock for every choice combination.' : `Enter stock for each ${model.choices[0].name.toLowerCase()} option.`}</p></div></div>
          <label className={styles.basePrice}>{model.choices.length === 0 ? 'Price (RM)' : 'Base price (RM)'}<NumericInput resetToken={numericResetToken} step={0.01} value={model.details.price} onChange={(value) => updateNumeric('base-price', value, updateBasePrice)} /></label>
          {model.choices.length === 0 && <p className={styles.noChoicesNote}>Stock below applies to the whole product. To manage stock separately by Color, Size, or another option, add Product choices in Step 02.</p>}
          {matrix ? (
            <div className={styles.matrixScroll} tabIndex={0} aria-label="Stock matrix, scroll horizontally when needed">
              <table className={styles.stockMatrix}>
                <caption>Stock by {model.choices[0].name} and {model.choices[1].name}</caption>
                <thead><tr><th scope="col">{model.choices[0].name} / {model.choices[1].name}</th>{matrix.columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}<th scope="col">Row total</th></tr></thead>
                <tbody>{matrix.rows.map((row, rowIndex) => {
                  const total = matrix.cells[rowIndex].reduce((sum, cell) => sum + shownInventory(cell.combination), 0);
                  return <tr key={row.key}><th scope="row">{row.label}</th>{matrix.cells[rowIndex].map((cell) => <td key={cell.key}><label><span className={styles.srOnly}>Stock for {row.label} / {matrix.columns.find((column) => cell.valueKeys.includes(column.key))?.label}</span><NumericInput resetToken={numericResetToken} value={shownInventory(cell.combination)} onChange={(value) => changeInventory(cell.combination, value)} /></label>{simManaged ? <label>Variant Price (RM)<NumericInput resetToken={numericResetToken} step={0.01} value={cell.combination.price} onChange={(value) => updateNumeric(`price:${cell.key}`, value, (price) => updateCombination(cell.valueKeys, { price }))} /></label> : <details className={styles.cellAdvanced}><summary>Variant Price / Product Code</summary><label>Variant Price (RM)<NumericInput resetToken={numericResetToken} step={0.01} value={cell.combination.price} onChange={(value) => updateNumeric(`price:${cell.key}`, value, (price) => updateCombination(cell.valueKeys, { price }))} /><small className={styles.fieldHint}>Defaults to Base price. Change only when this option has a different price.</small></label><label>Product Code<input value={cell.combination.sku ?? ''} onChange={(event) => updateCombination(cell.valueKeys, { sku: event.target.value })} placeholder="Auto-generated if blank" /><small className={styles.fieldHint}>Internal item reference. Leave blank to create one automatically.</small></label></details>}</td>)}<td className={styles.rowTotal}>{total}</td></tr>;
                })}</tbody>
              </table>
            </div>
          ) : (
            <div className={styles.variantList}>
              {model.combinations.filter((combination) => combination.valueKeys.every((key) => model.choices.some((choice) => choice.values.some((value) => value.key === key && !value.retired)))).map((combination) => (
                <div className={styles.variantRow} key={combinationKey(combination.valueKeys) || 'standard'}>
                  <strong>{combinationLabel(combination, model.choices)}</strong>
                  <label>{combination.valueKeys.length === 0 ? 'Stock quantity' : 'Stock'}<NumericInput resetToken={numericResetToken} value={shownInventory(combination)} onChange={(value) => changeInventory(combination, value)} /></label>
                  {combination.valueKeys.length === 0
                    ? simManaged ? null : <label className={styles.standardSku}>Product Code<input value={combination.sku ?? ''} onChange={(event) => updateCombination(combination.valueKeys, { sku: event.target.value })} placeholder="Auto-generated if blank" /><small className={styles.fieldHint}>Internal item reference. Leave blank to create one automatically.</small></label>
                    : simManaged ? <label>Variant Price (RM)<NumericInput resetToken={numericResetToken} step={0.01} value={combination.price} onChange={(value) => updateNumeric(`price:${combinationKey(combination.valueKeys)}`, value, (price) => updateCombination(combination.valueKeys, { price }))} /></label> : <details className={styles.advanced}><summary>Advanced</summary><div><label>Variant Price (RM)<NumericInput resetToken={numericResetToken} step={0.01} value={combination.price} onChange={(value) => updateNumeric(`price:${combinationKey(combination.valueKeys)}`, value, (price) => updateCombination(combination.valueKeys, { price }))} /><small className={styles.fieldHint}>Defaults to Base price. Change only when this option has a different price.</small></label><label>Product Code<input value={combination.sku ?? ''} onChange={(event) => updateCombination(combination.valueKeys, { sku: event.target.value })} placeholder="Auto-generated if blank" /><small className={styles.fieldHint}>Internal item reference. Leave blank to create one automatically.</small></label></div></details>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={`${styles.section} ${styles.previewSection}`} aria-labelledby="storefront-preview-title">
          <div className={styles.sectionHeading}><span>04</span><div><h2 id="storefront-preview-title">Storefront preview</h2><p>A calm final check before you save your changes.</p></div></div>
          <article className={styles.previewCard}>
            <div className={styles.previewMedia}>{previewPhoto ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={adminMediaUrl(previewPhoto.url)} alt={previewPhoto.alt || ''} /></> : <span>Photo preview</span>}</div>
            <div className={styles.previewCopy}><span>{model.details.category?.trim() || 'Product'}</span><h3>{model.details.title || 'Untitled product'}</h3><strong>{money.format(model.details.price || 0)}</strong><p>{descriptionDraft || 'Your product description will appear here.'}</p>{previewDetails.length > 0 && <ul className={styles.previewDetails}>{previewDetails.map((detail) => <li key={detail}>{detail}</li>)}</ul>}{model.choices.map((choice) => <div key={choice.key}><small>{choice.name}</small><div className={styles.previewChoices}>{choice.values.filter((value) => !value.retired).map((value) => <span key={value.key}>{value.label}</span>)}</div></div>)}</div>
          </article>
        </section>
      </main>

      <footer className={styles.saveBar}>
        <div aria-live="polite" aria-atomic="true">{liveError ? <p className={styles.error}>{liveError}</p> : <p className={styles.neutralHelper}>{saveMode === 'local-draft' ? 'Changes are saved to this catalogue draft only. The SIM workflow is not updated.' : 'Changes stay here until you save.'}</p>}</div>
        <div><button className={styles.cancelButton} type="button" onClick={onCancel} disabled={saving}>Cancel</button><button className={styles.saveButton} type="submit" disabled={saving || Boolean(validationError)}>{saving ? savingLabel : saveLabel}</button></div>
      </footer>
    </form>
  );
}
