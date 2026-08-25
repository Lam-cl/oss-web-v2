#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file, stubs = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', js)(module.exports, (id) => stubs[id] || require(id), module);
  return module.exports;
}

const merchandise = load('src/data/merchandise.ts', {
  '@/lib/minimumOrderQuantity': { getProductMinimumOrderQuantity: () => 1 },
  '@/lib/productDescription': { parseProductDescription: () => ({ description: '', details: [] }) },
});
const adapter = load('src/lib/catalogueStorefront.ts', {
  '@/data/merchandise': merchandise,
  '@/lib/productDescription': load('src/lib/productDescription.ts'),
});
const fallback = [{ id: 'staging', slug: 'staging', name: 'Staging' }];
const payload = { products: [{
  catalogueId: '018f47a2-a117-4c37-8a28-7f429768bea1',
  slug: 'catalogue-shirt',
  bundleProductId: 501,
  details: { title: 'Catalogue Shirt', price: 42, description: 'Soft cotton\n\nProduct details:\n- Breathable\n- Machine washable', category: 'Apparel' },
  images: [
    { url: '/all.webp', order: 0, assignment: 'all' },
    { url: '/black-front.webp', order: 1, assignment: 'black' },
    { url: '/black-back.webp', order: 2, assignment: 'black' },
    { url: '/white-front.webp', order: 3, assignment: 'white' },
  ],
  choices: [
    { key: 'colour', name: 'Color', values: [{ key: 'black', label: 'Black' }, { key: 'white', label: 'White' }] },
    { key: 'size', name: 'Size', values: [{ key: 's', label: 'S' }, { key: 'm', label: 'M' }] },
  ],
  combinations: [
    { valueKeys: ['black', 's'], variantId: 9001, price: 42, inventory: 3 },
    { valueKeys: ['black', 'm'], variantId: 9002, price: 43, inventory: 4 },
    { valueKeys: ['white', 's'], variantId: 9003, price: 42, inventory: 5 },
    { valueKeys: ['white', 'm'], variantId: 9004, price: 43, inventory: 6 },
  ],
}] };

const products = adapter.adaptCatalogueStorefrontPayload(payload, fallback);
assert.equal(products.length, 2, 'published Catalogue products must merge with established OSS merchandise');
const product = products[0];
assert.equal(product.apiProductId, 501);
assert.equal(product.category, 'Apparel');
assert.equal(product.description, 'Soft cotton');
assert.deepEqual(product.features, ['Breathable', 'Machine washable']);
assert.deepEqual(product.gallery, ['/all.webp', '/black-front.webp', '/black-back.webp', '/white-front.webp']);
assert.equal(product.options[0].image, '/black-front.webp');
assert.equal(product.options[1].image, '/white-front.webp');
assert.equal(merchandise.getMerchandiseGalleryIndexForOption(product, 1), 3);
assert.equal(merchandise.getMerchandiseOptionIndexForImage(product, '/black-back.webp'), 0);
assert.equal(merchandise.getMerchandiseOptionIndexForImage(product, '/white-front.webp'), 1);
assert.equal(merchandise.getMerchandiseOptionIndexForImage(product, '/all.webp'), -1);
assert.equal(merchandise.getMerchandiseVariantId(product, 'Black', 'M'), 9002);
assert.equal(product.variantInventoryById[9004], 0, 'missing live provider product must fail projected variants sold-out');
assert.equal(product.inventory, 0);
assert.equal(product.soldOut, true);
assert(!JSON.stringify(product).includes('Catalogue Variant'));
assert(!JSON.stringify(product).includes('CV-'));
assert.equal(products[1], fallback[0], 'legacy OSS products and categories must remain available');
const replacedFallback = [{ ...fallback[0], apiProductId: 501, slug: 'old-slug', name: 'Old provider title' }];
const replaced = adapter.adaptCatalogueStorefrontPayload(payload, replacedFallback);
assert.equal(replaced.length, 1, 'a Catalogue projection must replace the matching Bundle product instead of duplicating it');
assert.equal(replaced[0].apiProductId, 501);
const liveProvider = [{
  ...replacedFallback[0],
  variantInventoryById: { 9001: 0, 9002: 8, 9003: 2 },
  inventory: 10,
  soldOut: false,
}];
const liveOverlay = adapter.adaptCatalogueStorefrontPayload(payload, liveProvider)[0];
assert.deepEqual(liveOverlay.variantInventoryById, { 9001: 0, 9002: 8, 9003: 2, 9004: 0 }, 'each projected choice must use matching live variant stock and fail missing variants sold-out');
assert.equal(liveOverlay.inventory, 10);
assert.equal(liveOverlay.soldOut, false);
assert.equal(liveOverlay.variantPrices[merchandise.merchandiseVariantKey('Black', 'M')], 43, 'Catalogue price conventions remain unchanged');
assert.equal(liveOverlay.variantIds[merchandise.merchandiseVariantKey('White', 'M')], 9004, 'checkout variant bindings remain unchanged');
const stalePositive = structuredClone(payload);
stalePositive.products[0].combinations.forEach((combination) => { combination.inventory = 1; });
const liveZero = [{ ...liveProvider[0], variantInventoryById: { 9001: 0, 9002: 0, 9003: 0, 9004: 0 }, inventory: 0, soldOut: true }];
const reconciledZero = adapter.adaptCatalogueStorefrontPayload(stalePositive, liveZero)[0];
assert.equal(reconciledZero.inventory, 0, 'stale positive Catalogue inventory must not create phantom stock');
assert.equal(reconciledZero.soldOut, true);
assert.deepEqual(reconciledZero.variantInventoryById, { 9001: 0, 9002: 0, 9003: 0, 9004: 0 });
const customCategory = structuredClone(payload);
customCategory.products[0].details.category = 'Event Kit';
assert.equal(adapter.adaptCatalogueStorefrontPayload(customCategory, fallback)[0].category, 'Event Kit');

const invalid = structuredClone(payload);
invalid.products[0].combinations.pop();
assert.strictEqual(adapter.adaptCatalogueStorefrontPayload(invalid, fallback), fallback);
const leaked = structuredClone(payload);
leaked.products[0].choices[0].values[0].label = 'Black CV-secret';
assert.strictEqual(adapter.adaptCatalogueStorefrontPayload(leaked, fallback), fallback);
const unboundImage = structuredClone(payload);
unboundImage.products[0].images[0].assignment = 'missing-value';
assert.strictEqual(adapter.adaptCatalogueStorefrontPayload(unboundImage, fallback), fallback);
assert.strictEqual(adapter.adaptCatalogueStorefrontPayload({ products: [] }, fallback), fallback);
const hiddenBundle = merchandise.mergeBundleMerchandiseProducts([{ id: 501, title: 'Catalogue Shirt', slug: 'catalogue-shirt', price: 42, images: [{ url: '/image.webp' }], options: [{ name: 'Catalogue Variant', values: [{ value: 'CV-secret' }] }], productVariants: [{ id: 9001, price: 42, inventory: 1 }] }]);
assert.equal(hiddenBundle.length, 1, 'normalization must retain a non-rendered live provider binding');
assert.equal(hiddenBundle[0].providerBindingOnly, true);
assert.deepEqual(hiddenBundle[0].variantInventoryById, { 9001: 1 });
assert(!JSON.stringify(hiddenBundle).includes('CV-'));
const retainedLiveOverlay = adapter.adaptCatalogueStorefrontPayload(payload, hiddenBundle)[0];
assert.equal(retainedLiveOverlay.variantInventoryById[9001], 1, 'projected inventory must resolve through retained live provider bindings');
assert.equal(adapter.adaptCatalogueStorefrontPayload({ products: [] }, hiddenBundle).length, 0, 'provider bindings must never render without a valid public projection');
const draftOp = 'a'.repeat(64);
for (const description of [
  `Safe copy\n[[TW-CATALOGUE-DRAFT:${draftOp}]]`,
  'Safe copy [[TW-CATALOGUE-DRAFT:not-a-valid-operation]]',
  `Safe copy\n[[TW-CATALOGUE-DRAFT:${draftOp}]]\n[[TW-CATALOGUE-DRAFT:${draftOp}]]`,
]) {
  const hiddenDraft = merchandise.mergeBundleMerchandiseProducts([{ id: 777, title: 'Provider Draft', description, slug: 'provider-draft', price: 42, images: [{ url: '/image.webp' }], options: [{ name: 'Colour', values: [{ value: 'Black' }] }], productVariants: [{ id: 9001, price: 42, inventory: 1 }] }]);
  assert.equal(hiddenDraft.length, 0, 'valid or malformed publication markers must never leak through Bundle fallback');
}
const publishedFallback = merchandise.mergeBundleMerchandiseProducts([{
  id: 778,
  title: 'Customer Mug [TW-1234abcd-a12]',
  description: 'Visible product',
  slug: 'customer-mug',
  price: 42,
  images: [{ url: '/image.webp' }],
  options: [{ name: 'Colour', values: [{ value: 'Black' }] }],
  productVariants: [{ id: 9002, sku: 'CUSTOMER-MUG-BLACK', price: 42, inventory: 1 }],
}]);
assert.equal(publishedFallback.length, 1);
assert.equal(publishedFallback[0].name, 'Customer Mug');
assert(!JSON.stringify(publishedFallback).includes('[TW-1234abcd-a12]'));

const section = fs.readFileSync('src/components/home/MerchandiseSection.tsx', 'utf8');
const hook = fs.readFileSync('src/hooks/useMerchandiseProducts.ts', 'utf8');
const detail = fs.readFileSync('src/app/merchandise/[slug]/page.tsx', 'utf8');
const cartEditor = fs.readFileSync('src/components/merchandise/CartMerchandiseEditor.tsx', 'utf8');
assert(section.includes('fetchCatalogueStorefrontProducts'), 'home catalogue must consume the public projection');
assert(hook.includes("import { fetchCatalogueStorefrontProducts } from '@/lib/catalogueStorefront';"), 'shared merchandise loader must resolve the public Catalogue projection');
assert(hook.indexOf('await fetchCatalogueStorefrontProducts') < hook.indexOf('reconcileMerchandiseCatalog(nextProducts)'), 'cart reconciliation must use current Catalogue Bundle IDs before checkout');
assert(section.indexOf('<summary>Description</summary>') < section.indexOf('<summary>Product details</summary>'), 'product modal must render Product details as a separate section below Description');
assert(cartEditor.indexOf('<summary>Description</summary>') < cartEditor.indexOf('<summary>Product details</summary>'), 'cart editor must keep Product details below Description');
assert(section.includes("new Set(merchandiseProducts.map((product) => product.category))"), 'OSS category tabs must derive from live Catalogue categories');
assert(section.includes('product.category === activeCategory'), 'OSS category selection must filter the displayed products');
assert(detail.includes('fetchCatalogueStorefrontProducts'), 'detail page must consume the public projection');
assert(cartEditor.includes('fetchCatalogueStorefrontProducts'), 'cart editor must resolve the public projection');
for (const field of ['bundleProductId: product.apiProductId', 'bundleVariantId', 'availableQuantity']) {
  assert(detail.includes(field), `detail cart wiring missing ${field}`);
}
console.log('catalogue storefront wiring check passed');
