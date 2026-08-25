#!/usr/bin/env node
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const catalogueId = '018f47a2-a117-4c37-8a28-7f429768bea1';
let operationId;
const resultFingerprint64 = 'b'.repeat(64);
const mediaId = '018f47a2-a117-4c37-8a28-7f429768bea2';
const model = {
  details: { title: 'Catalogue Shirt', price: 42, description: 'Soft cotton', category: 'Apparel' },
  choices: [
    { key: 'colour', name: 'Color', values: [{ key: 'black', label: 'Black', retired: false }, { key: 'white', label: 'White', retired: false }] },
    { key: 'size', name: 'Size', values: [{ key: 's', label: 'S', retired: false }, { key: 'm', label: 'M', retired: true }] },
  ],
  combinations: [
    { valueKeys: ['black', 's'], price: 42, inventory: 3, sku: 'PRIVATE-BLACK' },
    { valueKeys: ['black', 'm'], price: 43, inventory: 0 },
    { valueKeys: ['white', 's'], price: 44, inventory: 5 },
    { valueKeys: ['white', 'm'], price: 45, inventory: 0 },
  ],
  existingImages: [],
};
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const codeFor = keys => `CV-${hash(canonical(keys)).slice(0, 24)}`;
const media = [{ mediaId, catalogueId, originalName: 'shirt.webp', contentType: 'image/webp', bytes: 20, sha256: 'c'.repeat(64), order: 0, assignment: 'black', createdAt: '2026-08-24T00:00:00.000Z' }];
const modelFingerprint64 = hash(canonical({
  catalogueId,
  spec: model,
  previous: null,
  versionOrdinal: 2,
  uploads: media.map(item => ({ key: item.mediaId, name: item.originalName, contentType: item.contentType, order: item.order, sha256: item.sha256 })),
}));
operationId = modelFingerprint64;
const product = {
  version: 1, catalogueId, revision: 2, status: 'published', slug: 'catalogue-shirt', model,
  currentBundleProductId: 501,
  bundleVersions: [
    { bundleProductId: 499, fingerprint: 'a'.repeat(64), publishedAt: '2026-08-23T00:00:00.000Z', retiredAt: '2026-08-23T12:00:00.000Z' },
    { bundleProductId: 501, fingerprint: resultFingerprint64, publishedAt: '2026-08-24T00:00:00.000Z', retiredAt: null },
  ],
  createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
};
const bindings = [
  { valueKeys: [codeFor(['black', 's'])], variantId: 9001 },
  { valueKeys: [codeFor(['white', 's'])], variantId: 9003 },
];
const job = {
  version: 1, operationId, catalogueId, revision: 9, phase: 'complete', modelFingerprint64,
  previousBundleProductId: null, draftBundleProductId: 501, completedSteps: [],
  resolved: { options: { 'catalogue-variant': 1 }, values: Object.fromEntries(bindings.map((binding, i) => [binding.valueKeys[0], i + 10])), images: { [mediaId]: 70 }, variants: Object.fromEntries(bindings.map(binding => [binding.valueKeys[0], binding.variantId])) },
  bindings, resultFingerprint64, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
};
const snapshotProduct = {
  catalogueId,
  slug: 'catalogue-shirt',
  details: model.details,
  choices: [
    { key: 'colour', name: 'Color', values: [{ key: 'black', label: 'Black' }, { key: 'white', label: 'White' }] },
    { key: 'size', name: 'Size', values: [{ key: 's', label: 'S' }] },
  ],
  combinations: [
    { valueKeys: ['black', 's'], variantId: 9001, price: 42, inventory: 3 },
    { valueKeys: ['white', 's'], variantId: 9003, price: 44, inventory: 5 },
  ],
  images: [{ url: `/catalogue-products-api?catalogueId=${catalogueId}&mediaId=${mediaId}`, order: 0, assignment: 'black' }],
  bundleProductId: 501,
};
const snapshot = { version:1,operationId,catalogueId,bundleProductId:501,resultFingerprint64,createdAt:'2026-08-24T00:00:00.000Z',product:snapshotProduct,media:[] };

let productRecords = new Map([[catalogueId, product]]);
let publicationJobs = new Map([[operationId, job]]);
let mediaRecords = new Map([[catalogueId, media]]);
let fetchCalls = 0;
global.fetch = async () => { fetchCalls += 1; throw new Error('network forbidden'); };

function load(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const stubs = {
    'node:fs/promises': { readdir: async directory => directory.endsWith('catalogue-products')
      ? [...productRecords.keys()].map(id => ({ name: `${id}.json`, isFile: () => true }))
      : [...publicationJobs.keys()].map(id => ({ name: `${id}.json`, isFile: () => true })) },
    '@/lib/admin/catalogueProduct.server': { readCatalogueProduct: async id => productRecords.get(id) || null },
    '@/lib/admin/cataloguePublication.server': { readPublicationJob: async id => publicationJobs.get(id) || null },
    '@/lib/admin/catalogueMedia.server': { readVerifiedCatalogueMedia: async () => { throw new Error('ordinary snapshot must not read mutable media'); } },
    '@/lib/admin/catalogueAdoption.server': { readCatalogueAdoptionByBundle: async () => null },
    '@/lib/cataloguePublishedSnapshot.server': { readCataloguePublishedSnapshot: async id => id === operationId ? structuredClone(snapshot) : null, readCataloguePublishedSnapshotMedia: async () => null },
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(module.exports, id => stubs[id] || require(id), module, file, path.dirname(file));
  return module.exports;
}

(async () => {
  const file = path.resolve('src/lib/cataloguePublicProjection.server.ts');
  const projection = load(file);
  assert.deepEqual(Object.keys(projection).sort(), ['readCataloguePublicProjection','readCataloguePublicSnapshotMedia'].sort());
  const payload = await projection.readCataloguePublicProjection();
  assert.deepEqual(payload, { products: [snapshotProduct] });
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['CV-', 'Catalogue Variant', 'PRIVATE-BLACK', 'sha256', 'revision', 'operationId', 'fingerprint', '.data']) assert(!serialized.includes(forbidden), `leaked ${forbidden}`);
  assert.equal(fetchCalls, 0);

  publicationJobs = new Map([[operationId, { ...job, modelFingerprint64: 'd'.repeat(64) }]]);
  assert.deepEqual(await projection.readCataloguePublicProjection(), { products: [snapshotProduct] }, 'later job-model drift cannot mutate the immutable snapshot');
  publicationJobs = new Map([[operationId, job]]);
  mediaRecords = new Map([[catalogueId, [...media, { ...media[0], mediaId: '018f47a2-a117-4c37-8a28-7f429768bea3', order: 1 }]]]);
  assert.deepEqual(await projection.readCataloguePublicProjection(), { products: [snapshotProduct] }, 'later media-store drift cannot mutate the immutable snapshot');
  mediaRecords = new Map([[catalogueId, media]]);
  productRecords = new Map([[catalogueId, { ...product, model: { ...model, details: { ...model.details, title: 'CV-secret' } } }]]);
  assert.deepEqual(await projection.readCataloguePublicProjection(), { products: [snapshotProduct] }, 'later draft edits cannot mutate the immutable snapshot');

  const route = fs.readFileSync('src/app/api/catalogue-products/route.ts', 'utf8');
  assert.match(route, /readCataloguePublicProjection/);
  assert.match(route, /cache-control['"]?\s*:\s*['"]no-store/i);
  assert.doesNotMatch(route, /getAdminSession|BUNDLE_API|fetch\s*\(/);
  console.log('Catalogue public projection check passed');
})().catch(error => { console.error(error); process.exit(1); });
