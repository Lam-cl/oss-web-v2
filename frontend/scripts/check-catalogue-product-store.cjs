const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

let syncLog = null;
let syncDirectory = null;
let failRenameTo = null;

const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = (request) => {
    if (request === '@/lib/dataApiClient.server') return { dataApiEnabled:()=>false };
    if (request === 'fs/promises') return {
      ...fsp,
      open: async (...args) => {
        const handle = await fsp.open(...args);
        return syncLog ? {
          writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
          sync: async () => { syncLog.push(String(args[0]) === syncDirectory ? 'directory' : 'file'); await handle.sync(); },
          close: () => handle.close(),
        } : handle;
      },
      rename: async (from, to) => {
        if (to === failRenameTo) throw new Error('injected rename failure');
        return fsp.rename(from, to);
      },
    };
    if (request.startsWith('.')) {
      const target = path.resolve(path.dirname(file), request);
      for (const candidate of [target, `${target}.ts`, `${target}.js`]) if (fs.existsSync(candidate)) return candidate.endsWith('.ts') ? load(candidate) : require(candidate);
    }
    return require(request);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}

const store = load('src/lib/admin/catalogueProduct.server.ts');
const model = (title = 'Travel Mug') => ({
  details: { title: ` ${title} `, price: 29.9, description: ' Warm ' },
  choices: [{ key: ' colour ', name: ' Colour ', values: [{ key: 'red', label: ' Red ', retired: false }] }],
  combinations: [{ valueKeys: ['red'], price: 29.9, inventory: 4 }],
  existingImages: [],
});
const version = (bundleProductId, overrides = {}) => ({
  bundleProductId,
  fingerprint: String(bundleProductId % 10).repeat(64),
  publishedAt: new Date().toISOString(),
  retiredAt: null,
  ...overrides,
});

(async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tw-catalogue-product-'));
  await fsp.chmod(directory, 0o755);
  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => { fetchCalls++; throw new Error('network forbidden'); };
  try {
    assert.deepEqual(Object.keys(store).sort(), ['createCatalogueProduct', 'listCatalogueProducts', 'readCatalogueProduct', 'updateCatalogueProduct']);

    const created = await store.createCatalogueProduct(model(), '  Travel MUG  ', directory);
    assert.match(created.catalogueId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(created.version, 1);
    assert.equal(created.revision, 1);
    assert.equal(created.status, 'draft');
    assert.equal(created.slug, 'travel-mug');
    assert.equal(created.currentBundleProductId, null);
    assert.deepEqual(created.bundleVersions, []);
    assert.deepEqual(created.model, {
      details: { title: 'Travel Mug', price: 29.9, description: 'Warm' },
      choices: [{ key: 'colour', name: 'Colour', values: [{ key: 'red', label: 'Red', retired: false }] }],
      combinations: [{ valueKeys: ['red'], price: 29.9, inventory: 4 }],
      existingImages: [],
    });
    assert.equal(created.createdAt, created.updatedAt);
    assert.equal(new Date(created.createdAt).toISOString(), created.createdAt);
    assert.deepEqual(await store.readCatalogueProduct(created.catalogueId, directory), created);
    assert.equal((await fsp.stat(directory)).mode & 0o777, 0o700);
    assert.equal((await fsp.stat(path.join(directory, `${created.catalogueId}.json`))).mode & 0o777, 0o600);

    const updated = await store.updateCatalogueProduct(created.catalogueId, 1, (record) => ({
      ...record,
      slug: ' New Slug ',
      model: model('Updated Mug'),
    }), directory);
    assert.equal(updated.revision, 2);
    assert.equal(updated.slug, 'new-slug');
    assert.equal(updated.model.details.title, 'Updated Mug');
    assert.equal(updated.createdAt, created.createdAt);
    assert(new Date(updated.updatedAt) >= new Date(created.updatedAt));
    assert.deepEqual(await store.readCatalogueProduct(created.catalogueId, directory), updated);
    await assert.rejects(() => store.updateCatalogueProduct(created.catalogueId, 1, (record) => record, directory), /revision.*conflict/i);

    for (const bad of ['', 'not-a-uuid', '../escape', `${created.catalogueId}/x`, created.catalogueId.toUpperCase()]) {
      await assert.rejects(() => store.readCatalogueProduct(bad, directory), /catalogue ID/i);
      await assert.rejects(() => store.updateCatalogueProduct(bad, 1, (record) => record, directory), /catalogue ID/i);
    }
    assert.equal(await store.readCatalogueProduct('11111111-1111-4111-8111-111111111111', directory), null);
    for (const slug of ['', '---', 'x'.repeat(129), 12]) await assert.rejects(() => store.createCatalogueProduct(model(), slug, directory), /slug/i);

    const draft = await store.createCatalogueProduct(model(), 'draft', directory);
    await assert.rejects(() => store.updateCatalogueProduct(draft.catalogueId, 1, (record) => ({ ...record, status: 'published' }), directory), /valid catalogue product/i);
    const published = await store.updateCatalogueProduct(draft.catalogueId, 1, (record) => ({
      ...record,
      status: 'published',
      currentBundleProductId: 77,
      bundleVersions: [version(77)],
    }), directory);
    assert.equal(published.status, 'published');
    assert.equal(published.currentBundleProductId, 77);

    const badUpdates = [
      (r) => ({ ...r, version: 2 }),
      (r) => { const { version: _version, ...withoutVersion } = r; return withoutVersion; },
      (r) => ({ ...r, currentBundleProductId: 78 }),
      (r) => ({ ...r, bundleVersions: [version(77), version(77, { retiredAt: '2026-08-23T01:02:04.000Z' })] }),
      (r) => ({ ...r, bundleVersions: [version(77, { retiredAt: '2026-08-23T01:02:02.000Z' })] }),
      (r) => ({ ...r, bundleVersions: [version(77, { retiredAt: 'bad' })] }),
      (r) => ({ ...r, bundleVersions: [version(77, { extra: true })] }),
      (r) => ({ ...r, extra: true }),
    ];
    for (const change of badUpdates) await assert.rejects(() => store.updateCatalogueProduct(published.catalogueId, published.revision, change, directory), /valid catalogue product/i);

    const lifecycle = await store.createCatalogueProduct(model(), 'lifecycle', directory);
    const lifecycleFailures = [
      (r) => ({ ...r, currentBundleProductId: 81, bundleVersions: [version(81)] }),
      (r) => ({ ...r, bundleVersions: [version(81)] }),
      (r) => ({ ...r, status: 'published', currentBundleProductId: 81, bundleVersions: [version(81), version(82)] }),
      (r) => ({ ...r, status: 'published', currentBundleProductId: 81, bundleVersions: [version(81, { retiredAt: '2026-08-23T01:02:04.000Z' })] }),
    ];
    for (const change of lifecycleFailures) await assert.rejects(() => store.updateCatalogueProduct(lifecycle.catalogueId, 1, change, directory), /valid catalogue product/i);

    const chronologyFailures = [
      (r) => ({ ...r, bundleVersions: [version(91, {
        publishedAt: new Date(new Date(r.createdAt).getTime() - 1).toISOString(),
        retiredAt: r.createdAt,
      })] }),
      (r) => ({ ...r, bundleVersions: [version(91, {
        publishedAt: new Date(new Date(r.createdAt).getTime() - 2).toISOString(),
        retiredAt: new Date(new Date(r.createdAt).getTime() - 1).toISOString(),
      })] }),
      (r) => ({ ...r, bundleVersions: [
        version(91, { publishedAt: '2020-01-02T00:00:00.000Z', retiredAt: '2020-01-03T00:00:00.000Z' }),
        version(92, { publishedAt: '2020-01-01T00:00:00.000Z', retiredAt: '2020-01-02T00:00:00.000Z' }),
      ] }),
      (r) => ({ ...r, bundleVersions: [version(91, { publishedAt: '9999-01-01T00:00:00.000Z', retiredAt: '9999-01-02T00:00:00.000Z' })] }),
      (r) => ({ ...r, bundleVersions: [version(91, { publishedAt: '2020-01-01T00:00:00.000Z', retiredAt: '9999-01-01T00:00:00.000Z' })] }),
      (r) => ({ ...r, bundleVersions: [
        version(91, { publishedAt: '2020-01-01T00:00:00.000Z', retiredAt: '2020-01-04T00:00:00.000Z' }),
        version(92, { publishedAt: '2020-01-03T00:00:00.000Z', retiredAt: '2020-01-05T00:00:00.000Z' }),
      ] }),
    ];
    for (const change of chronologyFailures) await assert.rejects(() => store.updateCatalogueProduct(lifecycle.catalogueId, 1, change, directory), /valid catalogue product/i);
    const normalizedUpdate = await store.updateCatalogueProduct(published.catalogueId, published.revision, (r) => ({ ...r, model: { ...r.model, extra: true } }), directory);
    assert.equal('extra' in normalizedUpdate.model, false, 'unknown model fields must never be stored');

    const detached = await store.createCatalogueProduct(model(), 'detached', directory);
    let retained;
    const detachedUpdate = await store.updateCatalogueProduct(detached.catalogueId, 1, (record) => {
      retained = { ...record, slug: 'safe', bundleVersions: [] };
      setTimeout(() => {
        retained.slug = 'mutated';
        retained.model.details.title = 'Mutated';
        retained.bundleVersions.push(version(99));
      }, 0);
      return retained;
    }, directory);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(detachedUpdate.slug, 'safe');
    assert.equal(detachedUpdate.model.details.title, 'Travel Mug');
    assert.deepEqual(detachedUpdate.bundleVersions, []);
    assert.deepEqual(await store.readCatalogueProduct(detached.catalogueId, directory), detachedUpdate);

    const concurrent = await store.createCatalogueProduct(model(), 'concurrent', directory);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let entered = false;
    const first = store.updateCatalogueProduct(concurrent.catalogueId, 1, async (record) => { entered = true; await gate; return { ...record, slug: 'first' }; }, directory);
    while (!entered) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = store.updateCatalogueProduct(concurrent.catalogueId, 1, (record) => ({ ...record, slug: 'second' }), directory);
    release();
    assert.equal((await first).slug, 'first');
    await assert.rejects(() => second, /revision.*conflict/i);
    assert.equal((await store.readCatalogueProduct(concurrent.catalogueId, directory)).slug, 'first');

    syncLog = [];
    syncDirectory = directory;
    await store.updateCatalogueProduct(detached.catalogueId, detachedUpdate.revision, (record) => ({ ...record, slug: 'synced' }), directory);
    assert.deepEqual(syncLog, ['file', 'directory']);
    syncLog = null;

    failRenameTo = path.join(directory, `${detached.catalogueId}.json`);
    await assert.rejects(() => store.updateCatalogueProduct(detached.catalogueId, detachedUpdate.revision + 1, (record) => ({ ...record, slug: 'blocked' }), directory), /rename failure/);
    failRenameTo = null;
    assert.deepEqual((await fsp.readdir(directory)).filter((name) => name.startsWith(`${detached.catalogueId}.json.`) && name.endsWith('.tmp')), []);

    await fsp.writeFile(path.join(directory, `${created.catalogueId}.json`), '{broken', 'utf8');
    await assert.rejects(() => store.readCatalogueProduct(created.catalogueId, directory), /corrupt/i);
    assert.equal(fetchCalls, 0, 'store must make no network calls');
    const source = fs.readFileSync('src/lib/admin/catalogueProduct.server.ts', 'utf8');
    assert(!/\b(?:fetch|axios|bundleClient|BundleApi)\b/.test(source), 'store must not contain Bundle/network calls');
    assert.match(source, /one Node process[\s\S]*before clustering/i);
    assert.deepEqual((await fsp.readdir(directory)).filter((name) => name.includes('.tmp')), []);
  } finally {
    global.fetch = originalFetch;
    await fsp.rm(directory, { recursive: true, force: true });
  }
  console.log('Catalogue product store check passed');
})().catch((error) => { console.error(error); process.exit(1); });
