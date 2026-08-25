import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePublicationChangeState } from './cataloguePublicationChangeState.server.ts';

const catalogueId = 'c890e931-ac30-46ef-b996-992d2ab96b58';
const fingerprint = 'a'.repeat(64);
const operationId = 'b'.repeat(64);
const mediaId = '70934896-760d-4001-9bd0-7f5907a08702';

function fixture(generation = 1) {
  const product = {
    version: 1, catalogueId, revision: 27, status: 'published', slug: 'water-bottle-975ml',
    currentBundleProductId: 501,
    model: {
      details: { title: 'Water Bottle 975ml', price: 39, description: 'Large bottle', category: 'Bottles', minimumOrderQuantity: 1 },
      choices: [{ key: 'colour', optionId: 74, name: 'Colour', values: [
        { key: 'blue-black', valueId: 177, label: 'Blue & Black', retired: false },
        { key: 'blue-pink', valueId: 178, label: 'Blue & Pink', retired: false },
      ] }],
      combinations: [
        { valueKeys: ['blue-black'], variantId: 101, sku: 'WATER-BLUE-BLACK', price: 39, inventory: 1 },
        { valueKeys: ['blue-pink'], variantId: 102, sku: 'WATER-BLUE-PINK', price: 39, inventory: 1 },
      ],
      existingImages: [],
    },
    bundleVersions: Array.from({ length: generation }, (_, index) => ({
      bundleProductId: index === generation - 1 ? 501 : 400 + index,
      fingerprint: index === generation - 1 ? fingerprint : String(index + 1).padStart(64, '0'),
      publishedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      retiredAt: index === generation - 1 ? null : `2026-08-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
    })),
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  };
  const job = {
    version: 1, operationId, catalogueId, revision: 9, phase: 'complete', modelFingerprint64: operationId,
    previousBundleProductId: generation === 1 ? null : 499, draftBundleProductId: 501,
    completedSteps: [], resolved: { options: { 'catalogue-variant': 74 }, values: {
      'CV-036661490fced89b7c5c2c3e': 177, 'CV-3ad27df2c76c3d8c7e44d0fa': 178,
    }, images: { [mediaId]: 901 }, variants: { 'v:0': 230, 'v:1': 231 } },
    // Production jobs bind compiled CV codes. The snapshot variant IDs, not
    // these provider-only codes, bind back to stable catalogue choice keys.
    bindings: [
      { valueKeys: ['CV-036661490fced89b7c5c2c3e'], variantId: 230 },
      { valueKeys: ['CV-3ad27df2c76c3d8c7e44d0fa'], variantId: 231 },
    ],
    resultFingerprint64: fingerprint, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:01:00.000Z',
  };
  const snapshot = {
    version: 1, operationId, catalogueId, bundleProductId: 501, resultFingerprint64: fingerprint,
    createdAt: '2026-08-20T00:01:00.000Z',
    product: {
      catalogueId, slug: product.slug, details: { title: 'Water Bottle 975ml', price: 39, description: 'Large bottle', category: 'Bottles' }, minimumOrderQuantity: 1,
      choices: [{ key: 'colour', name: 'Colour', values: [
        { key: 'blue-black', label: 'Blue & Black' }, { key: 'blue-pink', label: 'Blue & Pink' },
      ] }],
      combinations: [
        { valueKeys: ['blue-black'], variantId: 230, price: 39, inventory: 1 },
        { valueKeys: ['blue-pink'], variantId: 231, price: 39, inventory: 1 },
      ],
      images: [{ url: `/catalogue-products-api?catalogueId=${catalogueId}&mediaId=${mediaId}`, order: 0, assignment: 'blue-black' }],
      bundleProductId: 501,
    },
    media: [{ mediaId, originalName: 'bottle.png', contentType: 'image/png', bytes: 100, sha256: 'c'.repeat(64), order: 0, assignment: 'blue-black', file: `${mediaId}.bin` }],
  };
  const media = [{ catalogueId, mediaId, originalName: 'bottle.png', contentType: 'image/png', bytes: 100, sha256: 'c'.repeat(64), order: 0, assignment: 'blue-black', createdAt: '2026-08-19T00:00:00.000Z' }];
  const providerProduct = { id: 501, productVariants: [
    { id: 230, sku: `WATER-BLUE-BLACK-TW${catalogueId.slice(0, 8)}V${generation}` },
    { id: 231, sku: `WATER-BLUE-PINK-TW${catalogueId.slice(0, 8)}V${generation}` },
  ] };
  return { product, jobs: [job], snapshot, media, providerProduct } as any;
}

for (const generation of [1, 2, 5, 8]) test(`generation ${generation}: clean publish evidence stays clean`, () => {
  assert.deepEqual(evaluatePublicationChangeState(fixture(generation)), { publicationChangeState: 'clean' });
});

test('save changes are dirty and a matching republish becomes clean again', () => {
  const first = fixture(2);
  first.product.model.details.title = 'Bottle updated';
  assert.equal(evaluatePublicationChangeState(first).publicationChangeState, 'dirty');
  const republished = fixture(5);
  republished.product.model.details.title = 'Bottle updated';
  republished.snapshot.product.details.title = 'Bottle updated';
  assert.equal(evaluatePublicationChangeState(republished).publicationChangeState, 'clean');
  republished.product.model.details.description = 'Saved after republish';
  assert.equal(evaluatePublicationChangeState(republished).publicationChangeState, 'dirty');
});

test('all publication-visible model and media changes are dirty', () => {
  const mutations = [
    (x: any) => { x.product.model.details.title = 'Changed'; },
    (x: any) => { x.product.model.details.description = 'Changed'; },
    (x: any) => { x.product.slug = 'changed'; },
    (x: any) => { x.product.model.combinations[0].sku = 'CHANGED-SKU'; },
    (x: any) => { x.product.model.combinations[0].inventory = 9; },
    (x: any) => { x.product.model.combinations[0].price = 40; },
    (x: any) => { x.product.model.choices[0].values[0].label = 'Navy'; },
    (x: any) => { x.media[0].assignment = 'blue-pink'; },
    (x: any) => { x.media[0].sha256 = 'd'.repeat(64); },
  ];
  for (const mutate of mutations) { const evidence = fixture(5); mutate(evidence); assert.equal(evaluatePublicationChangeState(evidence).publicationChangeState, 'dirty'); }
});

test('missing, corrupt, duplicate, and ambiguous evidence is unknown', () => {
  const cases = [
    { ...fixture(), jobs: [] },
    { ...fixture(), snapshot: null },
    { ...fixture(), storageUncertain: true },
    (() => { const x = fixture(); x.jobs.push(structuredClone(x.jobs[0])); return x; })(),
    (() => { const x = fixture(); x.providerProduct.productVariants.pop(); return x; })(),
    (() => { const x = fixture(); x.jobs[0].bindings[0].variantId = 999; return x; })(),
  ];
  for (const evidence of cases) assert.equal(evaluatePublicationChangeState(evidence as any).publicationChangeState, 'unknown');
});
