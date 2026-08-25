'use client';

import { DragEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { AdminApiError, adminFetch } from '@/lib/admin/client';
import { asLabel, Product, ProductOption, ProductVariant } from '@/lib/admin/types';
import { Icon } from './Icons';
import { Confirm } from './UI';
import { isProductSetupDraft, PRODUCT_SETUP_DRAFT_TAG, visibleProductTags } from '@/lib/productSetup';

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

const CATEGORY_SUGGESTIONS = ['Accessories', 'Apparel', 'Drinkware', 'Marketing'];
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
    continuingDraft ? createNumericValue(normalizedInitialProduct?.productVariants?.[0]?.inventory) : '',
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
  const [editOptionId, setEditOptionId] = useState(0);
  const [editOptionName, setEditOptionName] = useState('');
  const [editOptionValues, setEditOptionValues] = useState('');
  const [variants, setVariants] = useState<ProductVariant[]>(product?.productVariants || []);
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
      setCreateDefaultInventoryInput(createNumericValue(value.productVariants?.[0]?.inventory));
      setSetupStarted(true);
    }
    setVariants(value?.productVariants || []);
    setCategory(labels(value?.categories)[0] || '');
    setCustomCategory(false);
    setTags(labels(visibleProductTags(value?.tags)));
    setFiles([]);
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
  const needsVariantRepair = useMemo(() => {
    if (!fresh || fresh.options.length !== 1) return false;
    const variants = fresh.productVariants || [];
    return fresh.options[0].values.some((value) => {
      const needle = value.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return !variants.some((variant) => (variant.sku || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').includes(needle));
    });
  }, [fresh]);

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
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const initialCreate = !fresh;
    const data = new FormData(event.currentTarget);
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
          defaultInventory: parsedDefaultInventory,
          options: specOptions,
          variantOverrides: specCombinations.map((values) => {
            const draft = setupVariantDrafts[setupVariantKey(values)] || {};
            return {
              values,
              sku: draft.sku?.trim() || undefined,
              price: draft.price ?? parsedCreatePrice,
              inventory: draft.inventory ?? parsedDefaultInventory,
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
        await adminFetch(draftProductId ? `products/${draftProductId}/complete-setup` : 'products/complete-setup', {
          method: draftProductId ? 'PUT' : 'POST',
          body: setupData,
        });
        setSetupFinished(true);
        setFiles([]);
        onSaved('Product, images and variants created successfully.');
        onClose();
      } else {
        await adminFetch(`products/${fresh.id}`, { method: 'PUT', body: data });
        for (const file of preparedFiles) {
          const imageData = new FormData();
          imageData.append('images', file);
          await adminFetch(`products/${fresh.id}`, { method: 'PUT', body: imageData });
        }
        await reload(fresh.id);
        setFiles([]);
        onSaved('Product details updated.');
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
      { method: 'PATCH', body: JSON.stringify(sorted.map((image) => String(image.id))) },
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
    if (!fresh || !editOptionId || !editOptionName.trim()) {
      onError('Select an option to edit.');
      return;
    }
    const values = editOptionValues.split(',').map((value) => value.trim()).filter(Boolean).map((value) => ({ value }));
    if (!values.length) {
      onError('Enter at least one option value.');
      return;
    }
    setBusy(true);
    try {
      await adminFetch(`products/${fresh.id}/options/${editOptionId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editOptionName.trim(), values }),
      });
      if (fresh.options.length === 1) {
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
        setEditOptionName('');
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
              <label className="adm-field">Shipping cost (RM)<input name="shippingCost" type="number" min="0" step="0.01" defaultValue={initialCreate ? createNumericValue(sourceProduct?.shippingCost) : sourceProduct?.shippingCost ?? 0} placeholder="0" /></label>
              <label className="adm-field">Weight<input name="weight" type="number" min="0" step="0.001" defaultValue={initialCreate ? createNumericValue(sourceProduct?.weight) : sourceProduct?.weight ?? 0} placeholder="0" /><span className="adm-hint">Use the unit expected by Bundle API.</span></label>
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
                <input type="hidden" name="categories" value={category.trim()} />
                <span className="adm-hint">Choose the main category shown in the catalogue.</span>
              </div>
              <div className="adm-field">
                <span>Tags</span>
                <TagInput value={tags} onChange={setTags} />
                <input type="hidden" name="tags" value={(fresh && isProductSetupDraft(fresh) ? [...tags, PRODUCT_SETUP_DRAFT_TAG] : tags).join(',')} />
                <span className="adm-hint">Select a suggestion or type a new tag.</span>
              </div>
              <label className="adm-field full">Description<textarea name="description" defaultValue={sourceProduct?.description || ''} required /></label>
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
                <label className="adm-field">Default stock<input type="number" min="0" value={createDefaultInventoryInput} onChange={(event) => setCreateDefaultInventoryInput(event.target.value)} placeholder="0" /><span className="adm-hint">Applied to every combination unless customized below.</span></label>
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
                        }} /><span className="adm-hint">Leave blank to use default stock.</span></label>
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
            {fresh.options.map((option) => <div className="adm-option-card" key={option.id}>
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
              <label className="adm-field">Value<select value={pricingValue} onChange={(event) => setPricingValue(event.target.value)}><option value="">Select value</option>{fresh.options.find((option) => option.name === pricingOption)?.values.map((value) => <option key={value.id} value={value.value}>{value.value}</option>)}</select></label>
              <label className="adm-field">Adjustment<input type="number" step=".01" value={pricingAdjustment} onChange={(event) => setPricingAdjustment(Number(event.target.value))} /><span className="adm-hint">Positive or negative amount.</span></label>
              <label className="adm-field">Pricing mode<select value={pricingPercentage ? 'percent' : 'fixed'} onChange={(event) => setPricingPercentage(event.target.value === 'percent')}><option value="fixed">Fixed amount (RM)</option><option value="percent">Percentage (%)</option></select></label>
            </div>
            <button className="adm-button" style={{ marginTop: 10 }} disabled={busy} onClick={saveOptionPricing}>Apply option pricing</button>
          </section>}
          {fresh.options.length > 0 && <section className="adm-section">
            <h3 className="adm-section-title">Edit variation</h3>
            <div className="adm-form-grid">
              <label className="adm-field">Option<select value={editOptionId} onChange={(event) => { const option = fresh.options.find((item) => item.id === Number(event.target.value)); setEditOptionId(Number(event.target.value)); setEditOptionName(option?.name || ''); setEditOptionValues(option?.values.map((value) => value.value).join(', ') || ''); }}><option value="0">Select option</option>{fresh.options.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>
              <label className="adm-field">Name<input value={editOptionName} onChange={(event) => setEditOptionName(event.target.value)} /></label>
              <label className="adm-field full">Values<VariationValueInput value={editOptionValues.split(',').map((value) => value.trim()).filter(Boolean)} onChange={(values) => setEditOptionValues(values.join(', '))} placeholder="Type a value and press Enter" /><span className="adm-hint">The backend will repair missing variants after this update.</span></label>
            </div>
            <button className="adm-button" style={{ marginTop: 10 }} disabled={busy || !editOptionId} onClick={updateOption}>Update option</button>
          </section>}
        </>}

        {tab === 'variants' && fresh && <section className="adm-section">
          <h3 className="adm-section-title">SKU, price & inventory</h3>
          {variants.map((variant, index) => <div className="adm-variant-row" key={variant.id}>
            <div className="adm-variant-grid">
              <label className="adm-field">SKU<input value={variant.sku || ''} onChange={(event) => setVariants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sku: event.target.value } : item))} /></label>
              <label className="adm-field">Price (RM)<input type="number" step=".01" value={variant.price} onChange={(event) => setVariants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price: Number(event.target.value) } : item))} /></label>
              <label className="adm-field">Inventory<input type="number" value={variant.inventory} onChange={(event) => setVariants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, inventory: Number(event.target.value) } : item))} /></label>
            </div>
          </div>)}
          {variants.length ? <button className="adm-button" disabled={busy} onClick={batchSave}>Save all variants</button> : <p className="adm-hint">No variants available. Generate an option first, or finish setup without variants.</p>}
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
