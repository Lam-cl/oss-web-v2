import { getProductMinimumOrderQuantity } from '@/lib/minimumOrderQuantity';

export interface MerchandiseOption {
  name: string;
  image: string;
  swatch?: string;
  sizes?: string[];
  gallery?: string[];
}

export interface MerchandiseProduct {
  id: string;
  apiProductId?: number;
  slug: string;
  name: string;
  category: string;
  price: number;
  description: string;
  optionLabel?: string;
  options: MerchandiseOption[];
  sizes?: string[];
  gallery?: string[];
  features?: string[];
  unitLabel?: string;
  soldOut?: boolean;
  inventory?: number;
  variantIds?: Record<string, number>;
  variantPrices?: Record<string, number>;
  variantInventoryById?: Record<number, number>;
  minimumOrderQuantity: number;
}

export interface BundleMerchandiseProduct {
  id: number;
  title?: string;
  name?: string;
  description?: string;
  slug: string;
  price: number | string;
  shippingCost?: number | string;
  images?: Array<{ id?: number; imageUrl?: string; url?: string; order?: number }>;
  categories?: Array<{ id?: number; name: string }>;
  tags?: Array<string | { id?: number; name?: string | null }>;
  options?: Array<{
    name: string;
    values?: Array<{ id?: number; value: string; imageUrl?: string | null; order?: number }>;
  }>;
  productVariants?: Array<{
    id: number;
    sku?: string;
    inventory: number;
    price: number | string;
    selectedOptions?: Array<{
      optionName?: string;
      optionValue?: string;
      value?: string;
      productOptionValue?: {
        value?: string;
        productOption?: { name?: string };
      };
    }>;
  }>;
}

export function merchandiseVariantKey(option: string, size?: string) {
  return `${option.trim().toLowerCase()}::${(size || '').trim().toLowerCase()}`;
}

export function getMerchandiseVariantId(
  product: MerchandiseProduct,
  option: string,
  size?: string,
) {
  return product.variantIds?.[merchandiseVariantKey(option, size)];
}

export function getMerchandiseVariantInventory(product: MerchandiseProduct, variantId?: number) {
  if (!variantId) return 0;
  return Math.max(0, Number(product.variantInventoryById?.[variantId]) || 0);
}

function normaliseProductName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const SWATCHES: Record<string, string> = {
  black: '#111827',
  white: '#ffffff',
  grey: '#9ca3af',
  gray: '#9ca3af',
  navy: '#172554',
  'navy blue': '#19376d',
  sand: '#d6c3a5',
  cream: '#f1e4c9',
  green: '#315d45',
  'olive green': '#66744a',
  orange: '#f97316',
  purple: '#8b5cf6',
  'sky blue': '#6ec6e8',
  stoney: '#7d7b78',
  midnight: '#111827',
  'blue & black': 'linear-gradient(135deg, #2563eb 0 50%, #111827 50%)',
  'blue & pink': 'linear-gradient(135deg, #2563eb 0 50%, #ec4899 50%)',
};

function selectedOptionMap(variant: NonNullable<BundleMerchandiseProduct['productVariants']>[number]) {
  const selected = new Map<string, string>();
  for (const option of variant.selectedOptions || []) {
    const name = option.optionName || option.productOptionValue?.productOption?.name;
    const value = option.optionValue || option.value || option.productOptionValue?.value;
    if (name && value) selected.set(name.toLowerCase(), value);
  }
  return selected;
}

function skuContainsOptionValue(sku: string, value: string) {
  const tokens = normaliseProductName(sku).replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean);
  const valueTokens = normaliseProductName(value).replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean);
  if (!valueTokens.length || valueTokens.length > tokens.length) return false;
  return tokens.some((_, index) => valueTokens.every(
    (token, valueIndex) => tokens[index + valueIndex] === token,
  ));
}

function applyGeneratedVariantFallback(
  variantIds: Record<string, number>,
  variants: NonNullable<BundleMerchandiseProduct['productVariants']>,
  primaryValues: Array<{ value: string }>,
  sizes: string[],
) {
  if (primaryValues.length === 0) return false;
  const nativeRelationshipsMissing = variants.every((variant) => !(variant.selectedOptions || []).length);
  // Never replace native API relationships with inferred mappings.
  if (!nativeRelationshipsMissing) return false;

  if (sizes.length === 0) {
    if (variants.length !== primaryValues.length) return false;
    Object.keys(variantIds).forEach((key) => delete variantIds[key]);
    primaryValues.forEach((value, index) => {
      variantIds[merchandiseVariantKey(value.value)] = variants[index].id;
    });
    return true;
  }

  const combinationCount = primaryValues.length * sizes.length;
  let combinationVariants = variants;

  // The current Bundle API retains one orphan variant per primary option before
  // appending the complete primary-option x size combinations.
  if (variants.length === primaryValues.length + combinationCount) {
    combinationVariants = variants.slice(primaryValues.length);
  } else if (variants.length !== combinationCount) {
    return false;
  }

  Object.keys(variantIds).forEach((key) => delete variantIds[key]);
  primaryValues.forEach((value, primaryIndex) => {
    sizes.forEach((size, sizeIndex) => {
      const variant = combinationVariants[(primaryIndex * sizes.length) + sizeIndex];
      if (variant) variantIds[merchandiseVariantKey(value.value, size)] = variant.id;
    });
  });
  return true;
}

export function mergeBundleMerchandiseProducts(
  products: BundleMerchandiseProduct[],
): MerchandiseProduct[] {
  const enrichmentByName = new Map(merchandiseProducts.map((product) => [
    normaliseProductName(product.name),
    product,
  ]));

  return products.map((apiProduct) => {
    const name = apiProduct.title || apiProduct.name || `Product ${apiProduct.id}`;
    const enrichment = enrichmentByName.get(normaliseProductName(name));
    const variants = [...(apiProduct.productVariants || [])].sort((a, b) => a.id - b.id);
    const variantIds: Record<string, number> = {};
    const apiOptions = apiProduct.options || [];
    const sizeOption = apiOptions.find((option) => option.name.toLowerCase() === 'size');
    const primaryOption = apiOptions.find((option) => option.name.toLowerCase() !== 'size');
    const sizes = sizeOption?.values?.map((value) => value.value) || [];
    const primaryValues = primaryOption?.values?.length
      ? primaryOption.values
      : [{ value: 'Standard', imageUrl: null }];
    const images = [...(apiProduct.images || [])]
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((image) => image.url || image.imageUrl || '')
      .filter(Boolean);

    for (const variant of variants) {
      const selected = selectedOptionMap(variant);
      const optionValue = primaryOption
        ? selected.get(primaryOption.name.toLowerCase())
        : 'Standard';
      const sizeValue = sizeOption ? selected.get('size') : undefined;
      if (optionValue && (!sizeOption || sizeValue)) {
        variantIds[merchandiseVariantKey(optionValue, sizeValue)] = variant.id;
      }
    }

    const structurallyMapped = applyGeneratedVariantFallback(variantIds, variants, primaryValues, sizes);

    // Bundle API often returns an empty selectedOptions array. Match a variant
    // only when its SKU identifies exactly one visible option combination.
    for (const variant of structurallyMapped ? [] : variants) {
      if (Object.values(variantIds).includes(variant.id)) continue;
      const sku = normaliseProductName(variant.sku || '').replace(/[^a-z0-9]+/g, '-');
      const candidates: Array<{ option: string; size?: string }> = [];
      primaryValues.forEach((value) => {
        const optionKey = normaliseProductName(value.value).replace(/[^a-z0-9]+/g, '-');
        if (!optionKey || !skuContainsOptionValue(sku, value.value)) return;
        if (!sizes.length) candidates.push({ option: value.value });
        else sizes.forEach((size) => {
          const sizeKey = normaliseProductName(size).replace(/[^a-z0-9]+/g, '-');
          if (sizeKey && skuContainsOptionValue(sku, size)) candidates.push({ option: value.value, size });
        });
      });
      if (candidates.length === 1) {
        variantIds[merchandiseVariantKey(candidates[0].option, candidates[0].size)] = variant.id;
      }
    }

    // A single backend variant is unambiguous even when the API omits selectedOptions.
    if (variants.length === 1 && primaryValues.length === 1 && sizes.length <= 1) {
      variantIds[merchandiseVariantKey(primaryValues[0].value, sizes[0])] = variants[0].id;
    }

    if (!structurallyMapped) applyGeneratedVariantFallback(variantIds, variants, primaryValues, sizes);
    const variantPrices: Record<string, number> = {};
    Object.entries(variantIds).forEach(([key, id]) => {
      const variant = variants.find((item) => item.id === id);
      const price = Number(variant?.price);
      if (Number.isFinite(price)) variantPrices[key] = price;
    });
    const variantInventoryById = Object.fromEntries(
      variants.map((variant) => [variant.id, Math.max(0, Number(variant.inventory) || 0)]),
    );

    const mappedVariantIds = new Set(Object.values(variantIds));
    const inventoryVariants = mappedVariantIds.size > 0
      ? variants.filter((variant) => mappedVariantIds.has(variant.id))
      : variants;
    const inventory = inventoryVariants.reduce(
      (total, variant) => total + Math.max(0, variant.inventory),
      0,
    );
    const fallbackImage = images[0] || '/favicon.ico';
    const options: MerchandiseOption[] = primaryValues.map((value) => ({
      name: value.value,
      image: value.imageUrl || fallbackImage,
      swatch: SWATCHES[value.value.toLowerCase()],
      sizes: sizes.length ? sizes : undefined,
      gallery: images.filter((image) => image !== value.imageUrl),
    }));

    return {
      id: String(apiProduct.id),
      apiProductId: apiProduct.id,
      slug: apiProduct.slug || String(apiProduct.id),
      name,
      category: apiProduct.categories?.[0]?.name
        ?.replace(/^\s*[\["']+|[\]"']+\s*$/g, '')
        .trim() || (/\bsim\b/i.test(name) ? 'SIM Cards' : 'Other'),
      price: Number(apiProduct.price),
      description: apiProduct.description || '',
      optionLabel: primaryOption?.name,
      options,
      sizes: sizes.length ? sizes : undefined,
      gallery: images,
      features: enrichment?.features,
      unitLabel: enrichment?.unitLabel,
      soldOut: variants.length === 0 || inventory === 0,
      inventory,
      variantIds,
      variantPrices,
      variantInventoryById,
      minimumOrderQuantity: getProductMinimumOrderQuantity(apiProduct),
    };
  });
}

const IMAGE_ROOT = '/images/merchandise';

export const merchandiseProducts: MerchandiseProduct[] = [
  {
    id: 'merch-cap',
    minimumOrderQuantity: 1,
    slug: 'tone-wow-cap',
    name: 'tone wow Cap',
    category: 'Apparel',
    price: 39,
    description: 'A structured snapback cap finished with the embroidered tone wow mark.',
    optionLabel: 'Colour',
    options: [
      {
        name: 'Black',
        image: `${IMAGE_ROOT}/cap-black-gpt-transparent.webp`,
        swatch: '#111827',
        gallery: [`${IMAGE_ROOT}/cap-lifestyle.webp`],
      },
      { name: 'Grey', image: `${IMAGE_ROOT}/cap-grey-gpt-transparent.webp`, swatch: '#9ca3af' },
      { name: 'Navy', image: `${IMAGE_ROOT}/cap-navy-gpt-transparent.webp`, swatch: '#172554' },
      { name: 'Sand', image: `${IMAGE_ROOT}/cap-sand-gpt-transparent.webp`, swatch: '#d6c3a5' },
    ],
    features: ['Structured snapback', 'Adjustable fit', 'Embroidered tone wow branding'],
  },
  {
    id: 'merch-bottle-500',
    minimumOrderQuantity: 1,
    slug: 'water-bottle-500ml',
    name: 'Water Bottle 500ml',
    category: 'Drinkware',
    price: 29,
    description: 'Compact stainless-steel bottle for cold or room-temperature drinks.',
    optionLabel: 'Colour',
    options: [
      {
        name: 'Cream',
        image: `${IMAGE_ROOT}/bottle-500-cream-gpt-transparent.webp`,
        swatch: '#f1e4c9',
        gallery: [`${IMAGE_ROOT}/bottle-500-lifestyle.webp`],
      },
      { name: 'Green', image: `${IMAGE_ROOT}/bottle-500-green-gpt-transparent.webp`, swatch: '#315d45' },
      { name: 'Navy Blue', image: `${IMAGE_ROOT}/bottle-500-navy-gpt-transparent.webp`, swatch: '#19376d' },
      { name: 'Orange', image: `${IMAGE_ROOT}/bottle-500-orange-gpt-transparent.webp`, swatch: '#f97316' },
    ],
    features: ['500ml capacity', 'Stainless steel', 'Leak-proof lid'],
  },
  {
    id: 'merch-bottle-975',
    minimumOrderQuantity: 1,
    slug: 'water-bottle-975ml',
    name: 'Water Bottle 975ml',
    category: 'Drinkware',
    price: 39,
    description: 'Large gradient stainless-steel bottle with a secure carry lid.',
    optionLabel: 'Colour',
    options: [
      {
        name: 'Blue & Black',
        image: `${IMAGE_ROOT}/bottle-975-blue-black.webp`,
        swatch: 'linear-gradient(135deg, #2563eb 0 50%, #111827 50%)',
        gallery: [`${IMAGE_ROOT}/bottle-975-lifestyle.webp`],
      },
      {
        name: 'Blue & Pink',
        image: `${IMAGE_ROOT}/bottle-975-blue-pink.webp`,
        swatch: 'linear-gradient(135deg, #2563eb 0 50%, #ec4899 50%)',
      },
    ],
    features: ['975ml capacity', 'Stainless steel', 'Leak-proof carry lid'],
  },
  {
    id: 'merch-tumbler-1180',
    minimumOrderQuantity: 1,
    slug: 'tumbler-1180ml',
    name: 'Tumbler 1180ml',
    category: 'Drinkware',
    price: 39,
    description: 'Double-wall insulated tumbler with a straw lid and ergonomic handle.',
    optionLabel: 'Colour',
    options: [
      {
        name: 'Sky Blue',
        image: `${IMAGE_ROOT}/tumbler-sky-blue.webp`,
        swatch: '#6ec6e8',
        gallery: [`${IMAGE_ROOT}/tumbler-lifestyle.webp`],
      },
      { name: 'Purple', image: `${IMAGE_ROOT}/tumbler-purple-gpt-transparent.webp`, swatch: '#8b5cf6' },
    ],
    features: [
      '1180ml large capacity',
      'Double-wall insulated stainless steel',
      'Leak-proof straw lid',
      'Strong ergonomic handle',
      'Wide mouth for easy cleaning',
    ],
  },
  {
    id: 'merch-bunting',
    minimumOrderQuantity: 1,
    slug: 'tone-wow-bunting',
    name: 'tone wow Bunting',
    category: 'Marketing',
    price: 45,
    description: 'Freestanding tone wow display bunting for events, booths and promotions.',
    optionLabel: 'Design',
    options: ['Blue', 'Gradient', 'Logo', 'White'].map((name) => ({
      name,
      image: `${IMAGE_ROOT}/bunting-gpt-transparent.webp`,
    })),
    gallery: [`${IMAGE_ROOT}/bunting-lifestyle.webp`],
  },
  {
    id: 'merch-button-badge',
    minimumOrderQuantity: 1,
    slug: 'tone-wow-button-badge',
    name: 'tone wow Button Badge',
    category: 'Accessories',
    price: 5,
    description: 'Compact branded button badge for bags, lanyards and apparel.',
    soldOut: true,
    options: [{ name: 'Standard', image: `${IMAGE_ROOT}/button-badge.webp` }],
    gallery: [`${IMAGE_ROOT}/button-badge-lifestyle.webp`],
  },
  {
    id: 'merch-ball-pen',
    minimumOrderQuantity: 1,
    slug: 'tone-wow-ball-pen',
    name: 'tone wow Yellow Pen',
    category: 'Accessories',
    price: 3,
    description: 'Everyday writing pen with tone wow branding.',
    options: [{ name: 'Standard', image: `${IMAGE_ROOT}/ball-pen.webp` }],
    gallery: [`${IMAGE_ROOT}/ball-pen-lifestyle.webp`],
  },
  {
    id: 'merch-lanyard',
    minimumOrderQuantity: 1,
    slug: 'tone-wow-lanyard',
    name: 'tone wow Lanyard',
    category: 'Accessories',
    price: 3,
    description: 'Branded lanyard suitable for passes, keys and event use.',
    options: [{ name: 'Standard', image: `${IMAGE_ROOT}/lanyard.webp` }],
    gallery: [`${IMAGE_ROOT}/lanyard-lifestyle.webp`],
  },
  {
    id: 'merch-non-woven-bag',
    minimumOrderQuantity: 1,
    slug: 'tone-wow-non-woven-bag',
    name: 'tone wow Non-Woven Bag',
    category: 'Accessories',
    price: 2.5,
    description: 'Reusable non-woven carry bag sized for merchandise and event packs.',
    options: [{ name: 'Standard', image: `${IMAGE_ROOT}/non-woven-bag-gpt-transparent.webp` }],
    gallery: [`${IMAGE_ROOT}/non-woven-bag-lifestyle.webp`],
    features: ['Non-woven material', '20 × 23 × 8cm'],
  },
  {
    id: 'merch-flyers',
    minimumOrderQuantity: 1,
    slug: 'tone-wow-flyers-50pcs',
    name: 'tone wow Flyers',
    category: 'Marketing',
    price: 20,
    description: 'A ready-to-distribute bundle of 50 tone wow promotional flyers.',
    options: [{ name: 'Standard', image: `${IMAGE_ROOT}/flyers-gpt-transparent.webp` }],
    gallery: [`${IMAGE_ROOT}/flyers-lifestyle.webp`],
    unitLabel: '50 pcs per bundle',
  },
  {
    id: 'merch-comix-shirt',
    minimumOrderQuantity: 1,
    slug: 'comix-shirt',
    name: 'tone wow Comix Shirt',
    category: 'Apparel',
    price: 69,
    description: 'Oversized cotton round-neck tee with the tone wow Comix graphic.',
    optionLabel: 'Colour',
    options: [
      {
        name: 'White',
        image: `${IMAGE_ROOT}/comix-white-front-gpt-transparent.webp`,
        swatch: '#ffffff',
        sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
        gallery: [
          `${IMAGE_ROOT}/comix-white-back-gpt-transparent.webp`,
          `${IMAGE_ROOT}/comix-white-lifestyle.webp`,
        ],
      },
      {
        name: 'Black',
        image: `${IMAGE_ROOT}/comix-black-front-gpt-transparent.webp`,
        swatch: '#111827',
        sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
        gallery: [
          `${IMAGE_ROOT}/comix-black-back.webp`,
          `${IMAGE_ROOT}/comix-black-lifestyle.webp`,
        ],
      },
    ],
    features: ['Cotton oversized fit', 'Unisex round neck'],
  },
  {
    id: 'merch-tone-wow-shirt',
    minimumOrderQuantity: 1,
    slug: 'tone-wow-shirt',
    name: 'tone wow Shirt',
    category: 'Apparel',
    price: 39,
    description: 'tone wow unisex cotton round-neck tee in four colourways.',
    optionLabel: 'Colour',
    options: [
      {
        name: 'Stoney',
        image: `${IMAGE_ROOT}/stoney-front.webp`,
        swatch: '#7d7b78',
        sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '5XL'],
        gallery: [
          `${IMAGE_ROOT}/stoney-back.webp`,
          `${IMAGE_ROOT}/stoney-lifestyle.webp`,
        ],
      },
      {
        name: 'Midnight',
        image: `${IMAGE_ROOT}/midnight-front.webp`,
        swatch: '#111827',
        sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '5XL'],
        gallery: [
          `${IMAGE_ROOT}/midnight-back.webp`,
          `${IMAGE_ROOT}/midnight-lifestyle.webp`,
        ],
      },
      {
        name: 'Olive Green',
        image: `${IMAGE_ROOT}/olive-green-front.webp`,
        swatch: '#66744a',
        sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '4XL'],
        gallery: [
          `${IMAGE_ROOT}/olive-green-back.webp`,
          `${IMAGE_ROOT}/olive-green-lifestyle.webp`,
        ],
      },
      {
        name: 'Sand',
        image: `${IMAGE_ROOT}/sand-front.webp`,
        swatch: '#d6c3a5',
        sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '4XL'],
        gallery: [
          `${IMAGE_ROOT}/sand-back.webp`,
          `${IMAGE_ROOT}/sand-lifestyle.webp`,
        ],
      },
    ],
    features: ['Cotton tee', 'Unisex round neck'],
  },
];

export function getMerchandiseProduct(slug: string) {
  return merchandiseProducts.find((product) => product.slug === slug);
}
