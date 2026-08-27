'use client';

import { DragEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { AdminApiError, adminFetch } from '@/lib/admin/client';
import { productImageOrderPayload } from '@/lib/admin/imageOrder';
import { asLabel, Product, ProductOption, ProductVariant } from '@/lib/admin/types';
import { Icon } from './Icons';
import { Confirm } from './UI';
import { isProductSetupDraft, PRODUCT_SETUP_DRAFT_TAG, splitStockAllocation, visibleProductTags } from '@/lib/productSetup';
import { COURIER_GROUPS, type CourierGroup, type ShippingSettings } from '@/lib/shipping';
import { formatProductDescription, parseProductDescription } from '@/lib/productDescription';
import { buildVariantMatrix } from '@/lib/admin/variantMatrix';

type Props = {
  product: Product | null;
  createType?: 'MOBILE' | 'MERCHANDISE';
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
};

type ProductTab = 'details' | 'options' | 'variants';
type SetupOptionDraft = { name: string; values: string[] };
type SetupVariantDraft = { sku?: string; price?: number; inventory?: number };
type EditableProductVariant = Omit<ProductVariant, 'inventory'> & { inventory: number | '' };
type ImageColorAssignment = 'all' | number;

const CATEGORY_SUGGESTIONS = ['Apparel', 'Bottles', 'Marketing Material', 'Stationery'];
const TAG_SUGGESTIONS = ['accessories', 'apparel', 'drinkware', 'marketing', 'merchandise', 'tone wow'];
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function imageType(file: File) {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return '';
}

async function prepareBundleImage(file: File) {
  const detectedType = imageType(file);
  if (detectedType !== 'image/webp') {
    return file.type === detectedType
      ? file
      : new File([file], file.name, { type: detectedType, lastModified: file.lastModified });
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      element.src = sourceUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`Unable to prepare ${file.name}.`);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error(`Unable to convert ${file.name}.`)),
        'image/jpeg',
        0.92,
      );
    });
    return new File(
      [blob],
      file.name.replace(/\.webp$/i, '') + '.jpg',
      { type: 'image/jpeg', lastModified: file.lastModified },
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function labels(values: Product['categories'] | Product['tags'] | undefined = []) {
  const raw = values.map(asLabel).filter(Boolean);
  const joined = raw.join(',');
  let recovered = raw;
  if (joined.trim().startsWith('[') && joined.trim().endsWith(']')) {
    try {
      const parsed = JSON.parse(joined);
      if (Array.isArray(parsed)) recovered = parsed.map((value) => String(value));
    } catch { /* Clean individual malformed values below. */ }
  }
  const known = new Set<string>();
  return recovered.map((value) => value.replace(/^\s*[\["']+|[\]"']+\s*$/g, '').trim()).filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || known.has(key)) return false;
    known.add(key);
    return true;
  });
}

function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('');
  const selected = new Set(value.map((tag) => tag.toLocaleLowerCase()));
  const suggestions = TAG_SUGGESTIONS.filter((tag) => !selected.has(tag.toLocaleLowerCase()));

  function add(raw = input) {
    const additions = raw.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (!additions.length) {
      setInput('');
      return;
    }
    const next = [...value];
    const known = new Set(selected);
    additions.forEach((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!known.has(key)) {
        known.add(key);
        next.push(tag);
      }
    });
    onChange(next);
    setInput('');
  }

  function remove(tag: string) {
    onChange(value.filter((item) => item !== tag));
  }

  return <div className="adm-tag-control">
    <div className="adm-tag-box" onClick={(event) => (event.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {value.map((tag) => <span className="adm-tag-token" key={tag.toLocaleLowerCase()}>
        {tag}<button type="button" onClick={() => remove(tag)} aria-label={`Remove ${tag}`}>×</button>
      </span>)}
      <input
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onBlur={() => add()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add();
          } else if (event.key === 'Backspace' && !input && value.length) {
            remove(value[value.length - 1]);
          }
        }}
        placeholder={value.length ? 'Add another tag…' : 'Type a tag and press Enter…'}
        aria-label="Add a product tag"
      />
    </div>
    {suggestions.length > 0 && <div className="adm-tag-suggestions">
      <span>Suggestions</span>
      {suggestions.map((tag) => <button type="button" key={tag} onMouseDown={(event) => event.preventDefault()} onClick={() => add(tag)}>+ {tag}</button>)}
    </div>}
  </div>;
}

function VariationValueInput({ value, onChange, placeholder }: { value: string[]; onChange: (values: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('');

  function add(raw = input) {
    const next = raw.split(',').map((item) => item.trim()).filter(Boolean);
    if (next.length) {
      const known = new Set(value.map((item) => item.toLowerCase()));
      onChange([...value, ...next.filter((item) => {
        const key = item.toLowerCase();
        if (known.has(key)) return false;
        known.add(key);
        return true;
      })]);
    }
    setInput('');
  }

  return <div className="adm-tag-box adm-variation-values" onClick={(event) => (event.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
    {value.map((item) => <span className="adm-tag-token" key={item.toLowerCase()}>
      {item}<button type="button" onClick={() => onChange(value.filter((entry) => entry !== item))} aria-label={`Remove ${item}`}>×</button>
    </span>)}
    <input
      value={input}
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => add()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          add();
        }
      }}
      placeholder={value.length ? 'Add another…' : placeholder}
    />
  </div>;
}

function setupVariantKey(values: string[]) {
  return values.map((value) => value.trim().toLowerCase()).join('::');
}

function setupCombinations(options: SetupOptionDraft[]) {
  const combinations: string[][] = [];
  const walk = (index: number, values: string[]) => {
    if (index === options.length) combinations.push(values);
    else options[index].values.forEach((value) => walk(index + 1, [...values, value]));
  };
  if (options.length && options.every((option) => option.values.length)) walk(0, []);
  return combinations;
}

function normalizeProduct(value: any): Product {
  const product = value?.data || value;
  return {
    ...product,
    images: product?.images || [],
    options: product?.options || [],
    productVariants: product?.productVariants || [],
    categories: product?.categories || [],
    tags: product?.tags || [],
  };
}

function createNumericValue(value: number | null | undefined) {
  return value != null && Number(value) !== 0 ? String(value) : '';
}

function copyFormData(source: FormData) {
  const copy = new FormData();
  source.forEach((value, key) => copy.append(key, value));
  return copy;
}

export default function ProductDrawer({ product, createType = 'MOBILE', onClose, onSaved, onError }: Props) {
  const startedAsCreate = !product;
  const continuingDraft = Boolean(product && isProductSetupDraft(product));
  const normalizedInitialProduct = product ? normalizeProduct(product) : null;
  const guidedCreate = (startedAsCreate && createType === 'MERCHANDISE') || continuingDraft;
  const [createProductType, setCreateProductType] = useState<'MOBILE' | 'MERCHANDISE'>(
    normalizedInitialProduct?.type === 'MOBILE' ? 'MOBILE' : normalizedInitialProduct?.type === 'MERCHANDISE' ? 'MERCHANDISE' : createType,
  );
  const [createPriceInput, setCreatePriceInput] = useState(
    continuingDraft ? createNumericValue(normalizedInitialProduct?.price) : '',
  );
  const [hasVariations, setHasVariations] = useState(
    continuingDraft ? Boolean(normalizedInitialProduct?.options.length) : createType === 'MOBILE',
  );
  const [setupOptions, setSetupOptions] = useState<SetupOptionDraft[]>([
    ...(continuingDraft && normalizedInitialProduct?.options.length
      ? normalizedInitialProduct.options.map((option) => ({ name: option.name, values: option.values.map((value) => value.value) }))
      : [{ name: 'Color', values: [] }]),
  ]);
  const [setupVariantDrafts, setSetupVariantDrafts] = useState<Record<string, SetupVariantDraft>>({});
  const [setupValueImages, setSetupValueImages] = useState<Record<string, File>>({});
  const [draftProductId, setDraftProductId] = useState<number | null>(continuingDraft ? normalizedInitialProduct?.id || null : null);
  const [tab, setTab] = useState<ProductTab>('details');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<Product | null>(continuingDraft ? null : normalizedInitialProduct);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [setupStarted, setSetupStarted] = useState(continuingDraft);
  const [setupFinished, setSetupFinished] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [variantOption, setVariantOption] = useState('');
  const [variantValues, setVariantValues] = useState('');
  const [defaultInventory, setDefaultInventory] = useState(0);
  const [createDefaultInventoryInput, setCreateDefaultInventoryInput] = useState(
    continuingDraft ? String((normalizedInitialProduct?.productVariants || []).reduce((sum, variant) => sum + Math.max(0, Number(variant.inventory) || 0), 0)) : '',
  );
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [pendingOptionDelete, setPendingOptionDelete] = useState<ProductOption | null>(null);
  const [pricingOption, setPricingOption] = useState('');
  const [pricingValue, setPricingValue] = useState('');
  const [pricingAdjustment, setPricingAdjustment] = useState(0);
  const [pricingPercentage, setPricingPercentage] = useState(false);
  const [category, setCategory] = useState(() => labels(product?.categories)[0] || '');
  const [customCategory, setCustomCategory] = useState(false);
  const [tags, setTags] = useState(() => labels(visibleProductTags(product?.tags)));
  const [shippingSettings, setShippingSettings] = useState<ShippingSettings | null>(null);
  const [shippingGroup, setShippingGroup] = useState<CourierGroup | ''>('');
  const [editOptionId, setEditOptionId] = useState(0);
  const [editOptionValues, setEditOptionValues] = useState('');
  const [variants, setVariants] = useState<EditableProductVariant[]>(product?.productVariants || []);
  const [imageColorAssignments, setImageColorAssignments] = useState<Record<string, ImageColorAssignment>>({});
  const [pendingImageColors, setPendingImageColors] = useState<Record<string, ImageColorAssignment>>({});
  const [hiddenOptionValueIds, setHiddenOptionValueIds] = useState<number[]>([]);
  const filePreviews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );

  useEffect(() => () => {
    filePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [filePreviews]);

  useEffect(() => {
    const value = product ? normalizeProduct(product) : null;
    const draft = Boolean(value && isProductSetupDraft(value));
    setFresh(draft ? null : value);
    setDraftProductId(draft ? value?.id || null : null);
    if (draft && value) {
      setCreateProductType(value.type === 'MOBILE' ? 'MOBILE' : 'MERCHANDISE');
      setCreatePriceInput(createNumericValue(value.price));
      setCreateDefaultInventoryInput(String((value.productVariants || []).reduce((sum, variant) => sum + Math.max(0, Number(variant.inventory) || 0), 0)));
      setSetupStarted(true);
    }
    setVariants(value?.productVariants || []);
    setCategory(labels(value?.categories)[0] || '');
    setCustomCategory(false);
    setTags(labels(visibleProductTags(value?.tags)));
    setFiles([]);
    setPendingImageColors({});
    setImageColorAssignments({});
    setHiddenOptionValueIds([]);
  }, [product]);

  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation, true);
    window.addEventListener('drop', preventFileNavigation, true);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation, true);
      window.removeEventListener('drop', preventFileNavigation, true);
    };
  }, []);

  useEffect(() => {
    if (createProductType !== 'MERCHANDISE') return;
    adminFetch<ShippingSettings>('shipping-settings').then((value) => {
      setShippingSettings(value);
      setShippingGroup(product?.id ? value.productGroups[String(product.id)] || '' : '');
    }).catch(() => { setShippingSettings(null); });
  }, [createProductType, product?.id]);

  useEffect(() => {
    if (!fresh?.id) return;
    let active = true;
    adminFetch<{ assignments?: Record<string, ImageColorAssignment> }>(`products/${fresh.id}/image-colors`)
      .then((value) => { if (active) setImageColorAssignments(value.assignments || {}); })
      .catch(() => { if (active) setImageColorAssignments({}); });
    adminFetch<{ valueIds?: number[] }>(`products/${fresh.id}/hidden-option-values`)
      .then((value) => { if (active) setHiddenOptionValueIds(value.valueIds || []); })
      .catch(() => { if (active) setHiddenOptionValueIds([]); });
    return () => { active = false; };
  }, [fresh?.id]);

  async function saveShippingAssignment(productId: number) {
    if (createProductType !== 'MERCHANDISE') return;
    if (!shippingGroup) throw new Error('Select a shipping category for this merchandise product.');
    const latest = await adminFetch<ShippingSettings>('shipping-settings');
    latest.productGroups[String(productId)] = shippingGroup;
    await adminFetch('shipping-settings', { method: 'PUT', body: JSON.stringify(latest) });
  }

  const categoryOptions = useMemo(
    () => CATEGORY_SUGGESTIONS.includes(category) || !category ? CATEGORY_SUGGESTIONS : [...CATEGORY_SUGGESTIONS, category],
    [category],
  );
  const multiWarning = useMemo(
    () => (fresh?.options?.length || 0) > 0 || /color|size/i.test(variantOption),
    [fresh, variantOption],
  );
  const activeSetupOptions = useMemo(
    () => hasVariations ? setupOptions : [{ name: 'Style', values: ['Standard'] }],
    [hasVariations, setupOptions],
  );
  const variantCombinations = useMemo(
    () => setupCombinations(activeSetupOptions),
    [activeSetupOptions],
  );
  const allocatedStock = useMemo(() => variantCombinations.reduce((sum, values) => {
    const inventory = setupVariantDrafts[setupVariantKey(values)]?.inventory;
    return sum + Math.max(0, Math.floor(Number(inventory) || 0));
  }, 0), [variantCombinations, setupVariantDrafts]);
  const visibleOptions = useMemo(() => fresh?.options.map((option) => ({
    ...option,
    values: option.values.filter((value) => !hiddenOptionValueIds.includes(value.id)),
  })) || [], [fresh, hiddenOptionValueIds]);
  const variantMatrix = useMemo(() => fresh ? buildVariantMatrix(visibleOptions, variants) : null, [fresh, variants, visibleOptions]);
  const colorOption = useMemo(() => visibleOptions.find((option) => /^colou?r$/i.test(option.name)), [visibleOptions]);

  function splitStockEqually() {
    const total = Math.max(0, Math.floor(Number(createDefaultInventoryInput) || 0));
    if (!variantCombinations.length) return;
    const allocation = splitStockAllocation(total, variantCombinations.length);
    setSetupVariantDrafts((current) => Object.fromEntries(variantCombinations.map((values, index) => {
      const key = setupVariantKey(values);
      return [key, { ...current[key], inventory: allocation[index] }];
    })));
  }

  const needsVariantRepair = useMemo(() => {
    if (!fresh || visibleOptions.length !== 1) return false;
    const variants = fresh.productVariants || [];
    return visibleOptions[0].values.some((value) => {
      const needle = value.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return !variants.some((variant) => (variant.sku || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').includes(needle));
    });
  }, [fresh, visibleOptions]);

  async function reload(id: number) {
    const value = normalizeProduct(await adminFetch<any>(`products/${id}`));
    setFresh(value);
    setVariants(value.productVariants || []);
    return value;
  }

  function requestClose() {
    if (guidedCreate && setupStarted && !setupFinished) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  function addFiles(selected: FileList | null) {
    const incoming = Array.from(selected || []);
    const unsupported = incoming.filter((file) => !imageType(file));
    if (unsupported.length) {
      onError(`Unsupported image format: ${unsupported.map((file) => file.name).join(', ')}. Use JPG, PNG or WebP.`);
    }
    const oversized = incoming.filter((file) => imageType(file) && file.size > MAX_IMAGE_BYTES);
    if (oversized.length) {
      onError(`Image too large: ${oversized.map((file) => file.name).join(', ')}. Each image must be 10MB or smaller.`);
    }
    const supported = incoming.filter((file) => imageType(file) && file.size <= MAX_IMAGE_BYTES);
    setFiles((current) => {
      const known = new Set(current.map(fileKey));
      return [...current, ...supported.filter((file) => !known.has(fileKey(file)))];
    });
    setPendingImageColors((current) => ({
      ...current,
      ...Object.fromEntries(supported.map((file) => [fileKey(file), current[fileKey(file)] || 'all'])),
    }));
  }

  function handleImageDrag(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'dragenter' || event.type === 'dragover') setDragActive(true);
    if (
      event.type === 'dragleave'
      && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
    ) {
      setDragActive(false);
    }
  }

  function handleImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    addFiles(event.dataTransfer.files);
  }

  function moveFile(index: number, direction: -1 | 1) {
    setFiles((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  function removeFile(index: number) {
    const key = files[index] ? fileKey(files[index]) : '';
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
    if (key) setPendingImageColors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function saveImageColors(productValue: Product, assignments: Record<string, ImageColorAssignment>) {
    const currentImageIds = new Set(productValue.images.map((image) => String(image.id)));
    const completed = Object.fromEntries(productValue.images.map((image) => {
      const imageId = String(image.id);
      return [imageId, currentImageIds.has(imageId) ? assignments[imageId] || 'all' : 'all'];
    }));
    const result = await adminFetch<{ assignments?: Record<string, ImageColorAssignment> }>(`products/${productValue.id}/image-colors`, {
      method: 'PUT',
      body: JSON.stringify({ assignments: colorOption ? completed : {} }),
    });
    const saved = result.assignments || {};
    setImageColorAssignments(saved);
    return saved;
  }

  async function saveExistingImageColors() {
    if (!fresh || !colorOption) return;
    setBusy(true);
    try {
      await saveImageColors(fresh, imageColorAssignments);
      onSaved('Image colors updated.');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Image color save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const initialCreate = !fresh;
    const data = new FormData(event.currentTarget);
    data.set('description', formatProductDescription(
      String(data.get('description') || ''),
      String(data.get('productDetails') || ''),
    ));
    data.delete('productDetails');
    const requestedSlug = String(data.get('slug') || '').trim();
    if (initialCreate) data.delete('slug');

    try {
      const preparedFiles = await Promise.all(files.map(prepareBundleImage));
      const preparedValueImageEntries = await Promise.all(
        Object.entries(setupValueImages).map(async ([key, file]) => [key, await prepareBundleImage(file)] as const),
      );
      const preparedValueImages = Object.fromEntries(preparedValueImageEntries) as Record<string, File>;
      const oversizedPrepared = preparedFiles.filter((file) => file.size > MAX_IMAGE_BYTES);
      const oversizedValueImages = Object.values(preparedValueImages).filter((file) => file.size > MAX_IMAGE_BYTES);
      if (oversizedPrepared.length || oversizedValueImages.length) {
        throw new Error(`Prepared image too large: ${[...oversizedPrepared, ...oversizedValueImages].map((file) => file.name).join(', ')}. Each image must be 10MB or smaller.`);
      }

      if (initialCreate) {
        const parsedCreatePrice = Number(createPriceInput);
        const parsedDefaultInventory = createDefaultInventoryInput === ''
          ? 0
          : Math.max(0, Math.floor(Number(createDefaultInventoryInput) || 0));
        const hasSavedDraftImages = Boolean(draftProductId && sourceProduct?.images.length);
        if (!preparedFiles.length && !hasSavedDraftImages) {
          throw new Error('Add at least one product image before publishing.');
        }
        if (hasVariations && setupOptions.some((option) => !option.name.trim() || !option.values.length)) {
          throw new Error('Each variation needs a name and at least one value.');
        }
        if (hasVariations && allocatedStock !== parsedDefaultInventory) {
          throw new Error(`Variant stock allocation must equal total stock (${allocatedStock} / ${parsedDefaultInventory} allocated).`);
        }
        const specOptions = hasVariations
          ? setupOptions.map((option) => ({ name: option.name.trim(), values: option.values }))
          : [];
        const specCombinations = setupCombinations(specOptions.length ? specOptions : [{ name: 'Style', values: ['Standard'] }]);
        const spec = {
          type: createProductType,
          title: String(data.get('title') || ''),
          slug: requestedSlug,
          description: String(data.get('description') || ''),
          price: Number(data.get('price') || 0),
          shippingCost: Number(data.get('shippingCost') || 0),
          weight: Number(data.get('weight') || 0),
          categories: category.trim() ? [category.trim()] : [],
          tags,
          defaultInventory: hasVariations ? 0 : parsedDefaultInventory,
          options: specOptions,
          variantOverrides: specCombinations.map((values) => {
            const draft = setupVariantDrafts[setupVariantKey(values)] || {};
            return {
              values,
              sku: draft.sku?.trim() || undefined,
              price: draft.price ?? parsedCreatePrice,
              inventory: hasVariations ? Math.max(0, Math.floor(Number(draft.inventory) || 0)) : parsedDefaultInventory,
            };
          }),
        };
        const setupData = new FormData();
        setupData.append('spec', JSON.stringify(spec));
        preparedFiles.forEach((file) => setupData.append('images', file));
        specOptions.forEach((option, optionIndex) => option.values.forEach((value, valueIndex) => {
          const image = preparedValueImages[`${optionIndex}:${value}`];
          if (image) setupData.append(`valueImage:${optionIndex}:${valueIndex}`, image);
        }));
        const result = await adminFetch<{ product?: Product }>(draftProductId ? `products/${draftProductId}/complete-setup` : 'products/complete-setup', {
          method: draftProductId ? 'PUT' : 'POST',
          body: setupData,
        });
        const createdProductId = Number(result.product?.id || draftProductId);
        if (!createdProductId) throw new Error('Product was created but its shipping category could not be linked. Edit the product and try again.');
        await saveShippingAssignment(createdProductId);
        setSetupFinished(true);
        setFiles([]);
        onSaved('Product, images and variants created successfully.');
        onClose();
      } else {
        const previousPrice = Number(fresh.price);
        const nextPrice = Number(data.get('price'));
        const hasMismatchedVariantPrices = fresh.productVariants.some(
          (variant) => Number(variant.price) !== nextPrice,
        );
        const syncVariantPrices = fresh.type === 'MERCHANDISE'
          && fresh.productVariants.length > 0
          && Number.isFinite(previousPrice)
          && Number.isFinite(nextPrice)
          && (previousPrice !== nextPrice || hasMismatchedVariantPrices);

        await adminFetch(`products/${fresh.id}`, { method: 'PUT', body: data });
        if (syncVariantPrices) {
          const variantsAtPreviousPrice = fresh.productVariants.map(({ id, sku, price, inventory }) => ({
            id,
            sku,
            price: Number(price),
            inventory: Number(inventory),
          }));
          try {
            await adminFetch(`products/${fresh.id}/batch-update`, {
              method: 'POST',
              body: JSON.stringify({
                variants: variantsAtPreviousPrice.map((variant) => ({
                  ...variant,
                  price: nextPrice,
                })),
              }),
            });
          } catch {
            let rollbackFailed = false;
            try {
              await adminFetch(`products/${fresh.id}/batch-update`, {
                method: 'POST',
                body: JSON.stringify({ variants: variantsAtPreviousPrice }),
              });
            } catch {
              rollbackFailed = true;
            }

            try {
              const rollbackData = copyFormData(data);
              rollbackData.set('price', String(previousPrice));
              await adminFetch(`products/${fresh.id}`, { method: 'PUT', body: rollbackData });
            } catch {
              rollbackFailed = true;
            }

            throw new Error(rollbackFailed
              ? 'Variant price sync failed and the previous prices could not be fully restored. Review this product before publishing it.'
              : 'Variant price sync failed. The previous product and variant prices were restored.');
          }
        }
        let nextProduct = fresh;
        const nextAssignments = { ...imageColorAssignments };
        for (let index = 0; index < preparedFiles.length; index += 1) {
          const beforeIds = new Set(nextProduct.images.map((image) => image.id));
          const imageData = new FormData();
          imageData.append('images', preparedFiles[index]);
          await adminFetch(`products/${fresh.id}`, { method: 'PUT', body: imageData });
          nextProduct = await reload(fresh.id);
          const added = nextProduct.images.filter((image) => !beforeIds.has(image.id));
          if (added.length !== 1) throw new Error('The uploaded image could not be linked safely. Reload the product before assigning its color.');
          nextAssignments[String(added[0].id)] = pendingImageColors[fileKey(files[index])] || 'all';
        }
        if (!preparedFiles.length) nextProduct = await reload(fresh.id);
        else {
          setFiles([]);
          setPendingImageColors({});
        }
        await saveImageColors(nextProduct, nextAssignments);
        await saveShippingAssignment(fresh.id);
        onSaved(syncVariantPrices
          ? 'Product details, image colors and all merchandise variant prices updated.'
          : 'Product details and image colors updated.');
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Save failed.';
      if (initialCreate && reason instanceof AdminApiError && Number(reason.payload.productId)) {
        setDraftProductId(Number(reason.payload.productId));
        setSetupStarted(true);
      }
      onError(initialCreate && /internal server error/i.test(message) && !(reason instanceof AdminApiError && Number(reason.payload.productId))
        ? 'Bundle API could not create this product. Check the selected images and required fields, then try again.'
        : message);
    } finally {
      setBusy(false);
    }
  }

  async function mutate(path: string, init: RequestInit, success: string, reloadAfter = true) {
    setBusy(true);
    try {
      await adminFetch(path, init);
      if (fresh && reloadAfter) await reload(fresh.id);
      onSaved(success);
      return true;
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!fresh) return;
    setConfirmGenerate(false);
    const values = variantValues.split(',').map((value) => value.trim()).filter(Boolean).map((value) => ({ value }));
    if (!variantOption.trim() || !values.length) {
      onError('Option name and at least one value are required.');
      return;
    }
    const generated = await mutate(
      `products/${fresh.id}/variants`,
      {
        method: 'POST',
        body: JSON.stringify({
          optionName: variantOption.trim(),
          values,
          autoGenerateSku: true,
          defaultInventory,
        }),
      },
      'Options and variants generated.',
    );
    if (generated) {
      setVariantOption('');
      setVariantValues('');
    }
  }

  async function batchSave() {
    if (!fresh) return;
    await mutate(
      `products/${fresh.id}/batch-update`,
      {
        method: 'POST',
        body: JSON.stringify({
          variants: variants.map(({ id, sku, price, inventory }) => ({
            id,
            sku,
            price: Number(price),
            inventory: Number(inventory),
          })),
        }),
      },
      'Variant inventory and pricing updated.',
    );
  }

  async function orderImage(imageId: number, direction: -1 | 1) {
    if (!fresh) return;
    const sorted = [...fresh.images].sort((left, right) => left.order - right.order);
    const index = sorted.findIndex((image) => image.id === imageId);
    const next = index + direction;
    if (next < 0 || next >= sorted.length) return;
    [sorted[index], sorted[next]] = [sorted[next], sorted[index]];
    await mutate(
      `products/${fresh.id}/images/order`,
      {
        method: 'PATCH',
        body: JSON.stringify(productImageOrderPayload(sorted)),
      },
      'Image order updated.',
    );
  }

  async function uploadValueImage(valueId: number, file?: File) {
    if (!fresh || !file) return;
    const data = new FormData();
    data.append('image', file);
    await mutate(
      `products/${fresh.id}/option-values/${valueId}/image`,
      { method: 'POST', body: data },
      'Option image uploaded.',
    );
  }

  async function saveOptionPricing() {
    if (!fresh || !pricingOption || !pricingValue) {
      onError('Select an option and value for pricing.');
      return;
    }
    await mutate(
      `products/${fresh.id}/option-pricing`,
      {
        method: 'POST',
        body: JSON.stringify({
          optionName: pricingOption,
          optionValue: pricingValue,
          priceAdjustment: Number(pricingAdjustment),
          isPercentage: pricingPercentage,
        }),
      },
      'Option pricing updated.',
    );
  }

  async function updateOption() {
    if (!fresh || !editOptionId) {
      onError('Select an option to edit.');
      return;
    }
    const selectedOption = fresh.options.find((option) => option.id === editOptionId);
    if (!selectedOption) {
      onError('The selected option is no longer available. Reload this product and try again.');
      return;
    }
    const values = editOptionValues.split(',').map((value) => value.trim()).filter(Boolean).map((value) => ({ value }));
    if (!values.length) {
      onError('Enter at least one option value.');
      return;
    }
    const normalized = (value: string) => value.trim().toLowerCase();
    const desired = new Set(values.map((value) => normalized(value.value)));
    const activeValues = selectedOption.values.filter((value) => !hiddenOptionValueIds.includes(value.id));
    const removed = activeValues.filter((value) => !desired.has(normalized(value.value)));
    const reactivated = selectedOption.values.filter((value) => hiddenOptionValueIds.includes(value.id) && desired.has(normalized(value.value)));
    const existing = new Set(selectedOption.values.map((value) => normalized(value.value)));
    const added = values.filter((value) => !existing.has(normalized(value.value)));
    if (removed.length && fresh.options.length !== 1) {
      onError('Removing a value from a multi-option product needs verified combination cleanup. No changes were made.');
      return;
    }
    if (removed.length && !window.confirm(`Remove the selected value${removed.length > 1 ? 's' : ''} and its checkout variant${removed.length > 1 ? 's' : ''}?`)) return;
    setBusy(true);
    try {
      for (const value of removed) {
        const needle = normalized(value.value).replace(/[^a-z0-9]+/g, '-');
        const matching = variants.filter((variant) => normalized(variant.sku || '').replace(/[^a-z0-9]+/g, '-').includes(needle));
        for (const variant of matching) await adminFetch(`products/${fresh.id}/variants/${variant.id}`, { method: 'DELETE' });
      }
      if (added.length) {
        await adminFetch(`products/${fresh.id}/options/${editOptionId}`, {
          method: 'PUT',
          body: JSON.stringify({ name: selectedOption.name, values: [...selectedOption.values.map((value) => ({ value: value.value })), ...added] }),
        });
      }
      const hidden = new Set(hiddenOptionValueIds);
      removed.forEach((value) => hidden.add(value.id));
      reactivated.forEach((value) => hidden.delete(value.id));
      const nextHidden = Array.from(hidden);
      await adminFetch(`products/${fresh.id}/hidden-option-values`, {
        method: 'PUT',
        body: JSON.stringify({ valueIds: nextHidden }),
      });
      setHiddenOptionValueIds(nextHidden);
      if (fresh.options.length === 1 && (added.length || reactivated.length)) {
        await adminFetch(`products/${fresh.id}/repair-variants`, { method: 'POST' });
      }
      await reload(fresh.id);
      onSaved('Option values and variants updated.');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Option update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function repairVariants() {
    if (!fresh) return;
    await mutate(
      `products/${fresh.id}/repair-variants`,
      { method: 'POST' },
      'Missing variation mappings repaired.',
    );
  }

  async function deleteOption() {
    if (!fresh || !pendingOptionDelete) return;
    const removed = await mutate(
      `products/${fresh.id}/options/${pendingOptionDelete.id}`,
      { method: 'DELETE' },
      'Option and its values removed.',
    );
    if (removed) {
      if (editOptionId === pendingOptionDelete.id) {
        setEditOptionId(0);
        setEditOptionValues('');
      }
      setPendingOptionDelete(null);
    }
  }

  function finishSetup() {
    setSetupFinished(true);
    onSaved('Merchandise product setup completed.');
    onClose();
  }

  const initialCreate = !fresh;
  const showTabs = !initialCreate;
  const sourceProduct = fresh || (continuingDraft ? normalizedInitialProduct : null);
  const productContent = parseProductDescription(sourceProduct?.description || '');

  return <div className="adm-drawer-wrap">
    <button className="adm-modal-backdrop" onClick={requestClose} aria-label="Close editor" />
    <section className="adm-drawer" role="dialog" aria-modal="true">
      <header className="adm-drawer-head">
        <div>
          <h2>{continuingDraft ? `Continue setup for #${draftProductId}` : initialCreate ? 'Create product' : fresh?.title}</h2>
          <p>{continuingDraft ? 'Review the details, add images and complete all variants' : initialCreate ? `New ${createProductType.toLowerCase()} product · product and variants are saved together` : `Product #${fresh?.id} · ${fresh?.type}`}</p>
        </div>
        <button className="adm-icon-btn" onClick={requestClose} aria-label="Close editor"><Icon name="close" /></button>
      </header>

      {showTabs && <div className="adm-toolbar adm-product-tabs">
        <div className="adm-tabs">
          <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Details & images</button>
          <button disabled={!fresh} className={tab === 'options' ? 'active' : ''} onClick={() => setTab('options')}>Options</button>
          <button disabled={!fresh} className={tab === 'variants' ? 'active' : ''} onClick={() => setTab('variants')}>Variants ({variants.length})</button>
        </div>
      </div>}

      <div className="adm-drawer-body">
        {tab === 'details' && <form id="product-form" onSubmit={saveDetails}>
          <section className="adm-section">
            <h3 className="adm-section-title">Product information</h3>
            <div className="adm-form-grid">
              <label className="adm-field full">Title<input name="title" defaultValue={sourceProduct?.title || ''} required /></label>
              <label className="adm-field">Type{initialCreate ? <select name="type" value={createProductType} onChange={(event) => {
                const nextType = event.target.value as 'MOBILE' | 'MERCHANDISE';
                setCreateProductType(nextType);
                if (nextType === 'MOBILE') {
                  setHasVariations(true);
                  setSetupOptions((current) => [{ name: current[0]?.name || 'Color', values: current[0]?.values || [] }]);
                }
              }}><option value="MOBILE">Mobile</option><option value="MERCHANDISE">Merchandise</option></select> : <select name="type" defaultValue={fresh?.type || createType}><option value="MOBILE">Mobile</option><option value="MERCHANDISE">Merchandise</option></select>}</label>
              <label className="adm-field">Slug<input name="slug" defaultValue={sourceProduct?.slug || ''} placeholder="auto-generated-if-empty" /></label>
              <label className="adm-field">{createProductType === 'MOBILE' ? 'Device price, 24-month total (RM)' : 'Price (RM)'}{initialCreate
                ? <input name="price" type="number" min="0" step="0.01" value={createPriceInput} onChange={(event) => setCreatePriceInput(event.target.value)} placeholder="0" required />
                : <input name="price" type="number" min="0" step="0.01" defaultValue={sourceProduct?.price ?? 0} required />}{initialCreate && createProductType === 'MOBILE' && createPriceInput !== '' && Number.isFinite(Number(createPriceInput)) && <span className="adm-hint">Customer preview: approximately RM{Math.round(Number(createPriceInput) / 24)}/month.</span>}</label>
              {createProductType === 'MOBILE' ? <label className="adm-field">Shipping cost (RM)<input name="shippingCost" type="number" min="0" step="0.01" defaultValue={initialCreate ? createNumericValue(sourceProduct?.shippingCost) : sourceProduct?.shippingCost ?? 0} placeholder="0" /></label> : <label className="adm-field">Shipping category<select value={shippingGroup} onChange={(event) => setShippingGroup(event.target.value as CourierGroup | '')} required disabled={!shippingSettings}><option value="">{shippingSettings ? 'Select shipping category' : 'Loading shipping categories…'}</option>{shippingSettings && COURIER_GROUPS.map((group) => <option value={group} key={group}>{shippingSettings.groups[group].label}</option>)}</select><span className="adm-hint">Used by checkout to calculate the OPS courier rate.</span></label>}
              {createProductType === 'MOBILE' && <label className="adm-field">Weight<input name="weight" type="number" min="0" step="0.001" defaultValue={initialCreate ? createNumericValue(sourceProduct?.weight) : sourceProduct?.weight ?? 0} placeholder="0" /><span className="adm-hint">Use the unit expected by Bundle API.</span></label>}
              <div className="adm-field">
                <label htmlFor="product-category">Category</label>
                <select
                  id="product-category"
                  value={customCategory ? '__custom__' : category}
                  onChange={(event) => {
                    if (event.target.value === '__custom__') {
                      setCategory('');
                      setCustomCategory(true);
                    } else {
                      setCategory(event.target.value);
                      setCustomCategory(false);
                    }
                  }}
                >
                  <option value="">No category</option>
                  {categoryOptions.map((item) => <option value={item} key={item}>{item}</option>)}
                  <option value="__custom__">+ Add new category…</option>
                </select>
                {customCategory && <input className="adm-category-custom" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Enter new category name" autoFocus />}
                <input type="hidden" name="categories" value={JSON.stringify(category.trim() ? [category.trim()] : [])} />
                <span className="adm-hint">Choose the main category shown in the catalogue.</span>
              </div>
              <div className="adm-field">
                <span>Tags</span>
                <TagInput value={tags} onChange={setTags} />
                <input type="hidden" name="tags" value={JSON.stringify(fresh && isProductSetupDraft(fresh) ? [...tags, PRODUCT_SETUP_DRAFT_TAG] : tags)} />
                <span className="adm-hint">Select a suggestion or type a new tag.</span>
              </div>
              <label className="adm-field full">Description<textarea name="description" defaultValue={productContent.description} required /></label>
              <label className="adm-field full">Product details<textarea name="productDetails" defaultValue={productContent.details.join('\n')} placeholder="One detail per line" maxLength={2000} /><span className="adm-hint">One detail per line. Stored inside the Bundle description field.</span></label>
            </div>
          </section>
          <section className="adm-section">
            <h3 className="adm-section-title">Images</h3>
            <div
              className={`adm-images${dragActive ? ' is-dragging' : ''}`}
              onDragEnter={handleImageDrag}
              onDragOver={handleImageDrag}
              onDragLeave={handleImageDrag}
              onDrop={handleImageDrop}
            >
              <div className="adm-image-list">
              {[...(sourceProduct?.images || [])].sort((left, right) => left.order - right.order).map((image, index, images) => <div className="adm-image-card" key={image.id}>
                <img src={image.url} alt="" />
                <div><span>{index + 1}</span><span>
                  <button type="button" disabled={!fresh || index === 0 || busy} onClick={() => orderImage(image.id, -1)}>←</button>
                  <button type="button" disabled={!fresh || index === images.length - 1 || busy} onClick={() => orderImage(image.id, 1)}>→</button>
                  <button type="button" disabled={!fresh || busy} onClick={() => mutate(`products/${fresh?.id}/images/${image.id}`, { method: 'DELETE' }, 'Image removed.')}>×</button>
                </span></div>
                {colorOption && <label className="adm-image-color"><span>Assign color</span><select aria-label={`Assign color for image ${index + 1}`} value={imageColorAssignments[String(image.id)] || 'all'} onChange={(event) => setImageColorAssignments((current) => ({ ...current, [String(image.id)]: event.target.value === 'all' ? 'all' : Number(event.target.value) }))}><option value="all">All colors / General</option>{colorOption.values.map((value) => <option value={value.id} key={value.id}>{value.value}</option>)}</select></label>}
              </div>)}
              {filePreviews.map((preview, index) => <div className="adm-image-card adm-image-card--pending" key={fileKey(preview.file)}>
                <img src={preview.url} alt={`New upload ${index + 1}: ${preview.file.name}`} />
                <div><span>New {index + 1}</span><span>
                  <button type="button" className="adm-image-move" disabled={index === 0 || busy} onClick={() => moveFile(index, -1)} aria-label={`Move ${preview.file.name} left`}>←</button>
                  <button type="button" className="adm-image-move" disabled={index === filePreviews.length - 1 || busy} onClick={() => moveFile(index, 1)} aria-label={`Move ${preview.file.name} right`}>→</button>
                  <button type="button" disabled={busy} onClick={() => removeFile(index)} aria-label={`Remove ${preview.file.name}`}>×</button>
                </span></div>
                <small title={preview.file.name}>
                  {imageType(preview.file) === 'image/webp' ? 'WebP → JPG' : preview.file.name}
                </small>
                {colorOption && <label className="adm-image-color"><span>Assign color</span><select aria-label={`Assign color for ${preview.file.name}`} value={pendingImageColors[fileKey(preview.file)] || 'all'} onChange={(event) => setPendingImageColors((current) => ({ ...current, [fileKey(preview.file)]: event.target.value === 'all' ? 'all' : Number(event.target.value) }))}><option value="all">All colors / General</option>{colorOption.values.map((value) => <option value={value.id} key={value.id}>{value.value}</option>)}</select></label>}
              </div>)}
              </div>
              <label className="adm-image-upload">
                <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }} />
                <span className="adm-image-upload-icon">+</span>
                <span><strong>{dragActive ? 'Drop images now' : files.length ? 'Add more photos' : 'Drop photos here'}</strong><br />
                  {files.length ? `${files.length} ready · or browse for more` : 'Drag directly from your folder, or click to browse'}
                </span>
                <small>JPG, PNG or WebP · max 10MB each</small>
              </label>
              <p className="adm-image-picker-note">When the file picker is open, select the files and press <strong>Open</strong>. For instant preview, close the picker and drag files directly onto this box.</p>
              {fresh && colorOption && <div className="adm-image-color-save"><span>Several images can use the same color. General images appear for every color.</span><button type="button" className="adm-button" disabled={busy} onClick={saveExistingImageColors}>Save image colors</button></div>}
            </div>
          </section>
          {initialCreate && <section className="adm-section adm-setup-variations">
            <div className="adm-section-heading-row">
              <div>
                <h3 className="adm-section-title">Variations & stock</h3>
                <p className="adm-hint">Choose the simple setup. The server will create options, variants and SKUs automatically.</p>
              </div>
              <div className="adm-choice-toggle" role="group" aria-label="Variation mode">
                <button type="button" className={!hasVariations ? 'active' : ''} onClick={() => setHasVariations(false)}>No variations</button>
                <button type="button" className={hasVariations ? 'active' : ''} onClick={() => setHasVariations(true)}>Has variations</button>
              </div>
            </div>

            {!hasVariations ? <div className="adm-form-grid">
              <label className="adm-field">Stock<input type="number" min="0" value={createDefaultInventoryInput} onChange={(event) => setCreateDefaultInventoryInput(event.target.value)} placeholder="0" /><span className="adm-hint">A hidden Standard variant will be created automatically.</span></label>
            </div> : <>
              <div className="adm-setup-option-list">
                {setupOptions.map((option, optionIndex) => <div className="adm-option-card adm-setup-option" key={`setup-option-${optionIndex}`}>
                  <div className="adm-option-head">
                    <label className="adm-field">Variation name<input value={option.name} onChange={(event) => setSetupOptions((current) => current.map((item, index) => index === optionIndex ? { ...item, name: event.target.value } : item))} placeholder={optionIndex === 0 ? 'Color, Style or Pack' : 'Size'} /></label>
                    {optionIndex > 0 && <button type="button" className="adm-icon-btn" onClick={() => setSetupOptions((current) => current.filter((_, index) => index !== optionIndex))} aria-label="Remove variation group"><Icon name="trash" /></button>}
                  </div>
                  <label className="adm-field">Values<VariationValueInput value={option.values} onChange={(values) => setSetupOptions((current) => current.map((item, index) => index === optionIndex ? { ...item, values } : item))} placeholder={optionIndex === 0 ? 'Type a value and press Enter' : 'S, M, L…'} /></label>
                  {option.values.length > 0 && <div className="adm-value-image-list">
                    {option.values.map((value) => <label key={value} className="adm-value-image-row">
                      <span>{value}</span>
                      <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) setSetupValueImages((current) => ({ ...current, [`${optionIndex}:${value}`]: file }));
                      }} />
                      <small>{setupValueImages[`${optionIndex}:${value}`]?.name || 'Optional variation image'}</small>
                    </label>)}
                  </div>}
                </div>)}
              </div>
              {createProductType === 'MERCHANDISE' && setupOptions.length < 2 && <button type="button" className="adm-button secondary adm-add-option-group" onClick={() => setSetupOptions((current) => [...current, { name: 'Size', values: [] }])}>+ Add second variation</button>}
              {setupOptions.length === 2 && <div className="adm-warning"><strong>Color + Size:</strong> the backend will verify every generated combination before publishing.</div>}

              <div className="adm-form-grid adm-default-stock">
                <label className="adm-field">Total stock<input type="number" min="0" value={createDefaultInventoryInput} onChange={(event) => setCreateDefaultInventoryInput(event.target.value)} placeholder="0" /><span className="adm-hint">Allocate this total across every variant below.</span></label>
                <div className={`adm-stock-allocation ${allocatedStock === Math.max(0, Math.floor(Number(createDefaultInventoryInput) || 0)) ? 'is-valid' : 'is-invalid'}`}><strong>Allocated {allocatedStock} / {Math.max(0, Math.floor(Number(createDefaultInventoryInput) || 0))}</strong><button type="button" className="adm-button secondary small" onClick={splitStockEqually}>Split equally</button></div>
              </div>

              {variantCombinations.length > 0 && <details className="adm-variant-customizer">
                <summary>Customize individual variants ({variantCombinations.length})</summary>
                <div className="adm-variant-customizer-list">
                  {variantCombinations.map((values) => {
                    const key = setupVariantKey(values);
                    const draft = setupVariantDrafts[key] || {};
                    return <div className="adm-variant-row" key={key}>
                      <strong>{values.join(' · ')}</strong>
                      <div className="adm-variant-grid">
                        <label className="adm-field">SKU<input value={draft.sku || ''} onChange={(event) => setSetupVariantDrafts((current) => ({ ...current, [key]: { ...current[key], sku: event.target.value } }))} placeholder="Auto-generated" /></label>
                        <label className="adm-field">Price (RM)<input type="number" min="0" step="0.01" value={draft.price ?? ''} placeholder={createPriceInput || '0'} onChange={(event) => {
                          const value = event.target.value;
                          setSetupVariantDrafts((current) => ({ ...current, [key]: { ...current[key], price: value === '' ? undefined : Number(value) } }));
                        }} /><span className="adm-hint">Leave blank to use the product price.</span></label>
                        <label className="adm-field">Stock<input type="number" min="0" value={draft.inventory ?? ''} placeholder={createDefaultInventoryInput || '0'} onChange={(event) => {
                          const value = event.target.value;
                          setSetupVariantDrafts((current) => ({ ...current, [key]: { ...current[key], inventory: value === '' ? undefined : Number(value) } }));
                        }} /><span className="adm-hint">Required. All variant stock must equal Total stock.</span></label>
                      </div>
                    </div>;
                  })}
                </div>
              </details>}
            </>}
          </section>}
        </form>}

        {tab === 'options' && fresh && <>
          {(needsVariantRepair || isProductSetupDraft(fresh)) && <section className="adm-section">
            <div className="adm-warning"><strong>{isProductSetupDraft(fresh) ? 'Draft product:' : 'Setup incomplete:'}</strong> {needsVariantRepair ? 'Some option values do not have checkout variants. Repair will create the missing mappings without duplicating the product.' : 'Complete verification to publish this product in the catalogue.'}</div>
            <button type="button" className="adm-button" style={{ marginTop: 10 }} disabled={busy} onClick={repairVariants}>{busy ? 'Checking setup…' : isProductSetupDraft(fresh) ? 'Complete & publish setup' : 'Repair missing variants'}</button>
          </section>}
          <section className="adm-section">
            <h3 className="adm-section-title">Current options</h3>
            {!fresh.options.length && <p className="adm-hint">No options created yet. Options are optional; continue if this product does not need variants.</p>}
            {visibleOptions.map((option) => <div className="adm-option-card" key={option.id}>
              <div className="adm-option-head">
                <strong>{option.name}</strong>
                <button type="button" className="adm-icon-btn" disabled={busy} onClick={() => setPendingOptionDelete(option)} aria-label={`Remove ${option.name}`}><Icon name="trash" /></button>
              </div>
              <div className="adm-option-values">{option.values.map((value) => <span className="adm-chip" key={value.id}>
                {value.value} <label title="Upload option image" style={{ cursor: 'pointer' }}>📷<input style={{ display: 'none' }} type="file" accept="image/*" onChange={(event) => uploadValueImage(value.id, event.target.files?.[0])} /></label>
                {value.imageUrl && <button style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => mutate(`products/${fresh.id}/option-values/${value.id}/image`, { method: 'DELETE' }, 'Option image removed.')}>×</button>}
              </span>)}</div>
            </div>)}
          </section>
          <section className="adm-section">
            <h3 className="adm-section-title">Add a variation</h3>
            {multiWarning && <div className="adm-warning"><strong>Known Bundle API limitation:</strong> generating a second option such as Color + Size can produce incomplete selected-option mappings. Verify every generated SKU, price and inventory before publishing.</div>}
            <div className="adm-inline-form">
              <label className="adm-field">Variation name<input value={variantOption} onChange={(event) => setVariantOption(event.target.value)} placeholder="Color or Size" /></label>
              <label className="adm-field">Values<VariationValueInput value={variantValues.split(',').map((value) => value.trim()).filter(Boolean)} onChange={(values) => setVariantValues(values.join(', '))} placeholder="Type a value and press Enter" /></label>
              <label className="adm-field">Default stock<input type="number" min="0" value={defaultInventory} onChange={(event) => setDefaultInventory(Number(event.target.value))} /></label>
            </div>
            <button className="adm-button" style={{ marginTop: 10 }} disabled={busy} onClick={() => multiWarning ? setConfirmGenerate(true) : generate()}>Add values & variants</button>
          </section>
          {fresh.options.length > 0 && <section className="adm-section">
            <h3 className="adm-section-title">Option pricing</h3>
            <div className="adm-form-grid">
              <label className="adm-field">Option<select value={pricingOption} onChange={(event) => { setPricingOption(event.target.value); setPricingValue(''); }}><option value="">Select option</option>{fresh.options.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}</select></label>
              <label className="adm-field">Value<select value={pricingValue} onChange={(event) => setPricingValue(event.target.value)}><option value="">Select value</option>{visibleOptions.find((option) => option.name === pricingOption)?.values.map((value) => <option key={value.id} value={value.value}>{value.value}</option>)}</select></label>
              <label className="adm-field">Adjustment<input type="number" step=".01" value={pricingAdjustment} onChange={(event) => setPricingAdjustment(Number(event.target.value))} /><span className="adm-hint">Positive or negative amount.</span></label>
              <label className="adm-field">Pricing mode<select value={pricingPercentage ? 'percent' : 'fixed'} onChange={(event) => setPricingPercentage(event.target.value === 'percent')}><option value="fixed">Fixed amount (RM)</option><option value="percent">Percentage (%)</option></select></label>
            </div>
            <button className="adm-button" style={{ marginTop: 10 }} disabled={busy} onClick={saveOptionPricing}>Apply option pricing</button>
          </section>}
          {fresh.options.length > 0 && <section className="adm-section">
            <h3 className="adm-section-title">Edit option values</h3>
            <div className="adm-form-grid">
              <label className="adm-field">Option<select value={editOptionId} onChange={(event) => { const option = visibleOptions.find((item) => item.id === Number(event.target.value)); setEditOptionId(Number(event.target.value)); setEditOptionValues(option?.values.map((value) => value.value).join(', ') || ''); }}><option value="0">Select option</option>{fresh.options.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>
              <label className="adm-field full">Values<VariationValueInput value={editOptionValues.split(',').map((value) => value.trim()).filter(Boolean)} onChange={(values) => setEditOptionValues(values.join(', '))} placeholder="Type a value and press Enter" /><span className="adm-hint">Add a value here, or remove its chip to remove the matching checkout variant. The option name stays unchanged.</span></label>
            </div>
            <button className="adm-button" style={{ marginTop: 10 }} disabled={busy || !editOptionId} onClick={updateOption}>Update values</button>
          </section>}
        </>}

        {tab === 'variants' && fresh && <section className="adm-section">
          <h3 className="adm-section-title">{variantMatrix?.title || 'Inventory by variant'}</h3>
          {variantMatrix ? <>
            <p className="adm-hint">Update stock directly in the matching color and size cell.</p>
            <div className="adm-variant-matrix-wrap">
              <table className={`adm-variant-matrix${variantMatrix.showTotals ? '' : ' compact'}`}>
                <thead><tr><th>{variantMatrix.rowLabel} / {variantMatrix.columnLabel}</th>{variantMatrix.columns.map((column) => <th key={column}>{column}</th>)}{variantMatrix.showTotals && <th>Total</th>}</tr></thead>
                <tbody>{variantMatrix.rows.map((row) => <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell) => <td key={cell.label}><input aria-label={`${row.label} ${cell.label} inventory`} type="number" min="0" value={cell.variant.inventory} onChange={(event) => setVariants((current) => current.map((item) => item.id === cell.variant.id ? { ...item, inventory: event.target.value === '' ? '' : Number(event.target.value) } : item))} /></td>)}
                  {variantMatrix.showTotals && <td className="adm-variant-total">{row.cells.reduce((sum, cell) => sum + Math.max(0, Number(cell.variant.inventory) || 0), 0)}</td>}
                </tr>)}</tbody>
              </table>
            </div>
          </> : <div className="adm-warning">Color and size mapping is incomplete. Use the advanced list below instead of guessing variant relationships.</div>}
          {variants.length ? <>
            <details className="adm-variant-advanced" open={!variantMatrix}>
              <summary>Advanced SKU &amp; Price{variantMatrix?.unmapped.length ? ` · ${variantMatrix.unmapped.length} legacy variants` : ''}</summary>
              <div className="adm-variant-customizer-list">{variants.map((variant, index) => <div className="adm-variant-row" key={variant.id}>
                <div className="adm-variant-grid">
                  <label className="adm-field">SKU<input value={variant.sku || ''} onChange={(event) => setVariants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sku: event.target.value } : item))} /></label>
                  <label className="adm-field">Price (RM)<input type="number" step=".01" value={variant.price} onChange={(event) => setVariants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price: Number(event.target.value) } : item))} /></label>
                  {(!variantMatrix || variantMatrix.unmapped.some((item) => item.id === variant.id)) && <label className="adm-field">Inventory<input type="number" value={variant.inventory} onChange={(event) => setVariants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, inventory: event.target.value === '' ? '' : Number(event.target.value) } : item))} /></label>}
                </div>
              </div>)}</div>
            </details>
            <button className="adm-button" disabled={busy} onClick={batchSave}>Save inventory &amp; variants</button>
          </> : <p className="adm-hint">No variants available. Generate an option first, or finish setup without variants.</p>}
        </section>}
      </div>

      <footer className="adm-drawer-foot">
        <button className="adm-button secondary" onClick={requestClose}>Close</button>
        {tab === 'details' && <button className="adm-button" form="product-form" disabled={busy}>{busy ? (initialCreate ? 'Creating product & variants…' : 'Saving…') : initialCreate ? draftProductId ? `Retry setup for #${draftProductId}` : 'Create product' : 'Save changes'}</button>}
      </footer>
    </section>

    <Confirm
      open={confirmGenerate}
      title="Generate multi-option variants?"
      message="Bundle API has a known Color + Size mapping issue. Continue only if you will verify every generated variant."
      confirmLabel="Generate anyway"
      busy={busy}
      onClose={() => setConfirmGenerate(false)}
      onConfirm={generate}
    />
    <Confirm
      open={!!pendingOptionDelete}
      title="Remove product option?"
      message={`“${pendingOptionDelete?.name || 'This option'}” and its ${pendingOptionDelete?.values.length || 0} value(s) will be removed. Variants using these values may also be affected.`}
      confirmLabel="Remove option"
      danger
      busy={busy}
      onClose={() => setPendingOptionDelete(null)}
      onConfirm={deleteOption}
    />
    <Confirm
      open={confirmClose}
      title="Exit product setup?"
      message="The product has already been created. It will be kept in the catalogue and you can continue later using Edit."
      confirmLabel="Keep and exit"
      busy={busy}
      onClose={() => setConfirmClose(false)}
      onConfirm={onClose}
    />
  </div>;
}
