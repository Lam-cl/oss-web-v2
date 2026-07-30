export interface MerchandiseOption {
  name: string;
  image: string;
  swatch?: string;
  sizes?: string[];
  gallery?: string[];
}

export interface MerchandiseProduct {
  id: string;
  slug: string;
  name: string;
  category: 'Apparel' | 'Drinkware' | 'Accessories' | 'Marketing';
  price: number;
  description: string;
  optionLabel?: 'Colour' | 'Design';
  options: MerchandiseOption[];
  sizes?: string[];
  gallery?: string[];
  features?: string[];
  unitLabel?: string;
  soldOut?: boolean;
}

const IMAGE_ROOT = '/images/merchandise';

export const merchandiseProducts: MerchandiseProduct[] = [
  {
    id: 'merch-cap',
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
    slug: 'tone-wow-ball-pen',
    name: 'tone wow Ball Pen',
    category: 'Accessories',
    price: 3,
    description: 'Everyday writing pen with tone wow branding.',
    options: [{ name: 'Standard', image: `${IMAGE_ROOT}/ball-pen.webp` }],
    gallery: [`${IMAGE_ROOT}/ball-pen-lifestyle.webp`],
  },
  {
    id: 'merch-lanyard',
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
