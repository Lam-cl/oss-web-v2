import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasValidCatalogueVariants,
  isSystemCatalogueProduct,
  productSearchText,
  publicationActionPresentation,
  sanitizeProviderDescription,
  sanitizeProviderTitle,
  unresolvedPublication,
} from './productPresentation.ts';

const legacy = {
  id: 99,
  title: 'PRO orphan [TW-deadbeef-a2]',
  slug: 'pro-orphan',
  description: 'Visible copy\n[[TW-CATALOGUE-DRAFT:abc123]]',
  productVariants: [{ sku: 'PRO-SKU-01' }],
};
const catalogue = {
  catalogueId: '123e4567-e89b-42d3-a456-426614174000',
  currentBundleProductId: 88,
  slug: 'catalogue-product',
  model: {
    details: { title: 'Catalogue title' },
    choices: [{ key: 'colour', values: [{ key: 'red', retired: false }, { key: 'old', retired: true }] }],
    combinations: [{ valueKeys: ['red'], sku: 'CAT-SKU-01' }],
  },
};

test('hides the provider delivery fee system product only', () => {
  assert.equal(isSystemCatalogueProduct({ id: 41, title: 'RM10 Flat Rate Delivery Fee' }), true);
  assert.equal(isSystemCatalogueProduct({ id: 42, title: 'RM10 Flat Rate Delivery Fee' }), true);
  assert.equal(isSystemCatalogueProduct({ id: 41, title: 'Customer product' }), true);
  assert.equal(isSystemCatalogueProduct({ id: 42, title: 'Customer product' }), false);
});

test('search text covers catalogue UUID, provider ID, title, slug, and SKU', () => {
  const text = productSearchText({ kind: 'catalogue', catalogue, product: legacy }).toLowerCase();
  for (const value of [catalogue.catalogueId, '88', 'catalogue title', 'catalogue-product', 'cat-sku-01']) {
    assert.ok(text.includes(value), `missing ${value}`);
  }
  const legacyText = productSearchText({ kind: 'legacy', product: legacy }).toLowerCase();
  for (const value of ['99', 'pro orphan', 'pro-orphan', 'pro-sku-01']) assert.ok(legacyText.includes(value));
});

test('legacy viewer strips provider-only title and draft description markers', () => {
  assert.equal(sanitizeProviderTitle(legacy.title), 'PRO orphan');
  assert.equal(sanitizeProviderDescription(legacy.description), 'Visible copy');
});

test('variant validation rejects incomplete and duplicate active tuples', () => {
  assert.equal(hasValidCatalogueVariants(catalogue.model), true);
  assert.equal(hasValidCatalogueVariants({ ...catalogue.model, combinations: [] }), false);
  assert.equal(hasValidCatalogueVariants({ ...catalogue.model, combinations: [
    { valueKeys: ['red'], sku: 'A' },
    { valueKeys: ['red'], sku: 'B' },
  ] }), false);
});

test('unknown or incomplete provider publication state is unresolved', () => {
  assert.equal(unresolvedPublication(undefined), true);
  assert.equal(unresolvedPublication(null), false);
  assert.equal(unresolvedPublication({ phase: 'building' }), true);
  assert.equal(unresolvedPublication({ phase: 'complete' }), false);
});

test('publication actions follow evidence state and keep SIM on its dedicated workflow', () => {
  assert.deepEqual(publicationActionPresentation({ state: 'clean', localDraft: false, simManaged: false }), { visible: false });
  assert.deepEqual(publicationActionPresentation({ state: 'dirty', localDraft: false, simManaged: false }), {
    visible: true, label: 'Publish changes', disabledReason: null,
  });
  const unresolved = publicationActionPresentation({ state: 'unknown', localDraft: false, simManaged: false, unknownReason: 'Snapshot missing.' });
  assert.equal(unresolved.visible, true);
  assert.equal(unresolved.disabledReason, 'Snapshot missing.');
  assert.deepEqual(publicationActionPresentation({ state: 'dirty', localDraft: false, simManaged: true }), { visible: false });
});
