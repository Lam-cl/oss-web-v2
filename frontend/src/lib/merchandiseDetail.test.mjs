import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogueRecordForSlug, catalogueSlugs, resolveMerchandiseDetailPage, resolveMerchandiseDetailProducts } from './merchandiseDetail.ts';
import { visibleBundleMerchandise } from './bundleMerchandise.ts';
import { mergeBundleMerchandiseProducts } from '../data/merchandise.ts';

import catalogue from '../data/merchandiseBootstrap.json' with { type: 'json' };
const first = catalogue.products[0];

test('catalogueRecordForSlug finds the raw published record and rejects unknown slugs', () => {
  assert.equal(catalogueRecordForSlug(catalogue, first.slug), first);
  assert.equal(catalogueRecordForSlug(catalogue, 'no-such-product'), null);
  assert.equal(catalogueRecordForSlug(null, first.slug), null);
});

test('catalogueSlugs lists every published slug once, in catalogue order', () => {
  const slugs = catalogueSlugs(catalogue);
  assert.equal(slugs[0], first.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(slugs.length, new Set(catalogue.products.map((product) => product.slug)).size);
});

test('server resolution (no live stock) uses the storefront adapter and holds no stock', () => {
  const { product } = resolveMerchandiseDetailProducts(first.slug, first, []);
  assert.ok(product);
  assert.equal(product.slug, first.slug);
  assert.equal(product.name, first.details.title.trim());
  assert.equal(product.inventory, 0);
  assert.equal(product.isPreOrder, false);
  assert.ok(product.gallery.length > 0);
  assert.equal(product.thumbnail, first.images[0].thumbnailUrl);
});

test('client resolution takes stock from the live Bundle products', () => {
  const variantId = first.combinations[0].variantId;
  const live = [{ id: 'live', slug: 'live', name: 'live', category: 'Other', price: 1, description: '', options: [], minimumOrderQuantity: 1,
    apiProductId: first.bundleProductId, variantInventoryById: { [variantId]: 7 }, inventory: 7 }];
  const { product } = resolveMerchandiseDetailProducts(first.slug, first, live);
  assert.equal(product.variantInventoryById[variantId], 7);
  assert.equal(product.soldOut, false);
});

test('unknown slugs resolve to null; static products fall back to the static list', () => {
  assert.equal(resolveMerchandiseDetailProducts('no-such-product', null, []).product, null);
  const staticProduct = resolveMerchandiseDetailProducts('tone-wow-cap', null, []).product;
  assert.equal(staticProduct?.slug, 'tone-wow-cap');
});

// A legacy product that exists only in Bundle (not in the catalogue or the static list).
const legacyBundle = { data: [
  { id: 9901, slug: 'legacy-lanyard', title: 'Legacy Lanyard', price: 8, description: 'Lanyard', isPreOrder: false,
    images: [{ id: 1, url: 'https://cdn.example.test/lanyard.webp', order: 0 }],
    options: [{ id: 1, name: 'Colour', values: [{ id: 11, value: 'Blue', imageUrl: null }] }],
    productVariants: [{ id: 77, price: 8, inventory: 4, selectedOptions: [{ option: { name: 'Colour' }, value: { value: 'Blue' } }] }] },
  { id: 9902, slug: 'flat-rate-delivery-fee', title: 'Delivery', price: 10, description: '', productVariants: [{ id: 78, price: 10, inventory: 1 }] },
] };
const liveProducts = () => mergeBundleMerchandiseProducts(visibleBundleMerchandise(legacyBundle, { products: {}, hiddenOptionValues: {} }).data);

test('page resolution finds a legacy Bundle-only slug from the live read', async () => {
  let reads = 0;
  const resolved = await resolveMerchandiseDetailPage('legacy-lanyard', null, async () => { reads += 1; return liveProducts(); });
  assert.equal(reads, 1);
  assert.equal(resolved?.product.slug, 'legacy-lanyard');
  assert.equal(resolved?.product.apiProductId, 9901);
  assert.equal(resolved?.catalogueRecord, null);
});

test('page resolution returns null (404) only when the live read succeeds without the slug', async () => {
  assert.equal(await resolveMerchandiseDetailPage('no-such-product', null, async () => liveProducts()), null);
  assert.equal(await resolveMerchandiseDetailPage('flat-rate-delivery-fee', null, async () => liveProducts()), null, 'filtered Bundle items stay hidden');
});

test('page resolution rejects when the live read fails, so no 404 is cached', async () => {
  await assert.rejects(resolveMerchandiseDetailPage('no-such-product', null, async () => { throw new Error('bundle down'); }), /bundle down/);
});

test('catalogue and static products never trigger the live read', async () => {
  const noRead = async () => { throw new Error('live read must not run'); };
  assert.equal((await resolveMerchandiseDetailPage(first.slug, first, noRead))?.catalogueRecord, first);
  assert.equal((await resolveMerchandiseDetailPage('tone-wow-cap', null, noRead))?.product.slug, 'tone-wow-cap');
});
