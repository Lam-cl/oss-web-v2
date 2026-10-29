const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function compile(relative, stubs = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  const load = (name) => name in stubs ? stubs[name] : name.startsWith('node:') ? require(name) : {};
  new Function('exports', 'require', 'module', output)(mod.exports, load, mod);
  return mod.exports;
}
const { pendingPublicationDraftIds } = compile('src/lib/admin/catalogueAdminRoute.server.ts', {
  '@/lib/admin/catalogueMutationLock.server': require('./helpers/catalogueMutationLockMock.cjs'),
});
const { catalogueProviderRows } = compile('src/lib/admin/catalogueProductRows.ts');

// Actual failed ACTION publication identities, not a title/slug similarity rule.
const catalogueId = 'cf764a8a-0688-4423-a549-ea2a64b057e5';
const operationId = 'afd350cf4a74724fc7ed9e33684e8df0ac18b8845bff094c314d0b133ac9ae5c';
const otherCatalogueId = '8c5e8762-973a-44f1-8645-53e67d6a319f';
const marker = (operation = operationId) => `Shirt description\n[[TW-CATALOGUE-DRAFT:${operation}]]`;
function fixture() {
  const source = { catalogueId, currentBundleProductId: 207, bundleVersions: [
    { bundleProductId: 206, retiredAt: '2026-10-28T00:00:00.000Z' },
    { bundleProductId: 207, retiredAt: null },
  ] };
  const job = { catalogueId, operationId, phase: 'building', revision: 6,
    previousBundleProductId: 207, draftBundleProductId: 208 };
  const products = [
    { id: 207, title: 'Pre-Order ACTION Shirt BLK (RM69) ONLY RM59!', description: 'Shirt description' },
    { id: 208, title: 'Pre-Order ACTION Shirt BLK (RM69) ONLY RM59!', description: marker(), deletedAt: null },
    { id: 888, title: 'Pre-Order ACTION Shirt BLK (RM69) ONLY RM59!', description: 'A genuine separate legacy item' },
  ];
  return { records: [source], jobs: { byCatalogue: new Map([[catalogueId, [job]]]), uncertain: false },
    providers: new Map(products.map((product) => [product.id, product])), products };
}
function visible(evidence) {
  const ids = pendingPublicationDraftIds(evidence.records, evidence.jobs, evidence.providers);
  const sources = evidence.records.map((record) => ({ ...record, pendingBundleProductIds: ids.get(record.catalogueId) ?? [] }));
  return catalogueProviderRows(sources, evidence.products);
}
const evidence = fixture();
const untouched = structuredClone(evidence);
assert.deepEqual(pendingPublicationDraftIds(evidence.records, evidence.jobs, evidence.providers), new Map([[catalogueId, [208]]]));
assert.deepEqual(visible(evidence).map((row) => [row.product.id, row.kind]), [[207, 'catalogue'], [888, 'legacy']],
  'only the exact durable pending draft disappears; the active catalogue and identical-title legacy item remain');
assert.deepEqual(evidence, untouched, 'list presentation must not mutate source, provider, or publication evidence');

const ambiguousCases = [
  ['missing provider index', (e) => { e.providers = null; }],
  ['uncertain job index', (e) => { e.jobs.uncertain = true; }],
  ['no durable job', (e) => { e.jobs.byCatalogue.clear(); }],
  ['missing provider marker', (e) => { e.providers.get(208).description = 'Shirt description'; }],
  ['different provider operation', (e) => { e.providers.get(208).description = marker('b'.repeat(64)); }],
  ['malformed marker', (e) => { e.providers.get(208).description = marker() + ' extra'; }],
  ['duplicate marker token', (e) => { e.providers.get(208).description = marker() + '\n' + marker(); }],
  ['two provider IDs share operation', (e) => { e.providers.set(209, { id: 209, description: marker() }); }],
  ['two durable owners share provider', (e) => { e.jobs.byCatalogue.get(catalogueId).push({ ...e.jobs.byCatalogue.get(catalogueId)[0] }); }],
  ['wrong indexed catalogue owner', (e) => { e.jobs.byCatalogue.get(catalogueId)[0].catalogueId = otherCatalogueId; }],
  ['completed publication', (e) => { e.jobs.byCatalogue.get(catalogueId)[0].phase = 'complete'; }],
  ['unknown publication phase', (e) => { e.jobs.byCatalogue.get(catalogueId)[0].phase = 'invalid'; }],
  ['stale previous active identity', (e) => { e.jobs.byCatalogue.get(catalogueId)[0].previousBundleProductId = 206; }],
  ['missing draft identity', (e) => { e.jobs.byCatalogue.get(catalogueId)[0].draftBundleProductId = null; }],
  ['deleted provider', (e) => { e.providers.get(208).deletedAt = '2026-10-29T00:00:00.000Z'; }],
  ['duplicate catalogue identity', (e) => { e.records.push(structuredClone(e.records[0])); }],
  ['historical version owns candidate', (e) => { e.records[0].bundleVersions.unshift({ bundleProductId: 208, retiredAt: '2026-10-28T00:00:00.000Z' }); }],
  ['another catalogue owns candidate', (e) => { e.records.push({ catalogueId: otherCatalogueId, currentBundleProductId: 208, bundleVersions: [] }); }],
];
for (const [label, mutate] of ambiguousCases) {
  const e = fixture(); mutate(e);
  assert.equal(visible(e).some((row) => row.product.id === 208), true, `${label}: candidate stays visible without exact unambiguous pending evidence`);
}

const newDraft = fixture();
newDraft.records[0].currentBundleProductId = null;
newDraft.records[0].bundleVersions = [];
newDraft.jobs.byCatalogue.get(catalogueId)[0].previousBundleProductId = null;
assert.deepEqual(pendingPublicationDraftIds(newDraft.records, newDraft.jobs, newDraft.providers), new Map([[catalogueId, [208]]]),
  'a first-time catalogue draft owns its exact provider work without creating a Legacy row');
assert.deepEqual(catalogueProviderRows([{ currentBundleProductId: 207, pendingBundleProductIds: [207, 208] }], evidence.products)
  .map((row) => [row.product.id, row.kind]), [[207, 'catalogue'], [888, 'legacy']],
  'client mapping defensively preserves an active row even if pending metadata accidentally includes it');
assert.deepEqual(catalogueProviderRows([{ currentBundleProductId: 207 }], evidence.products)
  .map((row) => [row.product.id, row.kind]), [[207, 'catalogue'], [208, 'legacy'], [888, 'legacy']],
  'old or absent server metadata never causes title-based hiding');
const page = fs.readFileSync(path.join(root, 'src/app/admin/products/page.tsx'), 'utf8');
assert.match(page, /catalogueProviderRows\(catalogue,/, 'the tested row builder is wired into the real admin page');
console.log(`Catalogue pending draft row check passed (${ambiguousCases.length} fail-visible cases, actual 207/208 identities)`);
