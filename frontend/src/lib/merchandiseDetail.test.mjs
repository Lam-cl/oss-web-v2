import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogueRecordForSlug, catalogueSlugs, resolveMerchandiseDetailProducts } from './merchandiseDetail.ts';

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
