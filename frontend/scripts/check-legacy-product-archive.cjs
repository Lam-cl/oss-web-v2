const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = process.cwd();
const helperPath = path.join(root, 'src/lib/admin/legacyProductArchive.server.ts');
const routePath = path.join(root, 'src/app/api/admin/legacy-products/[id]/archive/route.ts');
const aliasPath = path.join(root, 'src/app/admin-api/legacy-products/[id]/archive/route.ts');
const pagePath = path.join(root, 'src/app/admin/products/page.tsx');

function compile(file, injected) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => Object.hasOwn(injected, name) ? injected[name] : require(name);
  new Function('exports', 'require', 'module', output)(module.exports, localRequire, module);
  return module.exports;
}

const now = '2026-08-27T05:03:54.759Z';
const current = (overrides = {}) => ({
  id: 133,
  title: 'Baseball Caps [TW-61813221-a2]',
  updatedAt: now,
  type: 'MERCHANDISE',
  requiresSimAssignment: false,
  deletedAt: null,
  productVariants: [{ inventory: 0 }, { inventory: 0 }],
  ...overrides,
});
const requestBody = { expectedInventory: 0, expectedTitle: current().title, expectedUpdatedAt: now };

function harness({ before = current(), after = current({ deletedAt: '2026-08-27T09:00:00.000Z' }), catalogue = [], mutationStatus = 200, mutationThrows = false } = {}) {
  const calls = [];
  let reads = 0;
  const fetch = async (url, init = {}) => {
    calls.push([url, init.method || 'GET']);
    if (String(url).endsWith('/soft-delete')) {
      if (mutationThrows) throw new Error('network');
      return Response.json({}, { status: mutationStatus });
    }
    const body = reads++ === 0 ? before : after;
    return Response.json({ data: body });
  };
  const helper = compile(helperPath, {
    '@/lib/admin/server': { BUNDLE_API: 'https://bundle.test', readUpstream: async (response) => response.json() },
    '@/lib/admin/catalogueProduct.server': { listCatalogueProducts: async () => catalogue },
  });
  return { helper, calls, run: () => {
    const originalFetch = global.fetch;
    global.fetch = fetch;
    return helper.archiveLegacyProduct(133, requestBody, 'secret').finally(() => { global.fetch = originalFetch; });
  } };
}

(async () => {
  for (const file of [helperPath, routePath, aliasPath, pagePath]) assert(fs.existsSync(file), `${file} missing`);

  let test = harness();
  await assert.rejects(() => test.helper.archiveLegacyProduct('133', requestBody, 'secret'), /confirmation/i);
  await assert.rejects(() => test.helper.archiveLegacyProduct(133, { ...requestBody, extra: true }, 'secret'), /confirmation/i);

  for (const stale of [
    current({ title: 'Changed' }),
    current({ updatedAt: '2026-08-27T06:00:00.000Z' }),
    current({ productVariants: [{ inventory: 1 }] }),
  ]) {
    test = harness({ before: stale });
    await assert.rejects(test.run, (error) => error.status === 409 && /changed/i.test(error.message));
    assert.equal(test.calls.some(([url]) => url.endsWith('/soft-delete')), false, 'stale confirmation must not mutate');
  }

  test = harness({ catalogue: [{ currentBundleProductId: null, bundleVersions: [{ bundleProductId: 133 }] }] });
  await assert.rejects(test.run, (error) => error.status === 409 && /Catalogue/.test(error.message));
  assert.equal(test.calls.some(([url]) => url.endsWith('/soft-delete')), false, 'Catalogue-owned product must not mutate');

  test = harness({ before: current({ requiresSimAssignment: true }) });
  await assert.rejects(test.run, (error) => error.status === 409 && /SIM/.test(error.message));

  test = harness();
  assert.deepEqual(await test.run(), { productId: 133, deletedAt: '2026-08-27T09:00:00.000Z', idempotent: false });
  assert.deepEqual(test.calls.map(([, method]) => method), ['GET', 'DELETE', 'GET']);

  test = harness({ before: current({ deletedAt: '2026-08-27T09:00:00.000Z' }) });
  assert.deepEqual(await test.run(), { productId: 133, deletedAt: '2026-08-27T09:00:00.000Z', idempotent: true });
  assert.deepEqual(test.calls.map(([, method]) => method), ['GET']);

  test = harness({ after: current(), mutationStatus: 502 });
  await assert.rejects(test.run, (error) => error.status === 502 && /refused/i.test(error.message));
  test = harness({ after: current(), mutationThrows: true });
  await assert.rejects(test.run, (error) => error.status === 503 && /uncertain/i.test(error.message));

  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.match(routeSource, /getAdminSession/);
  assert.match(routeSource, /requestIsSameOrigin/);
  assert.match(routeSource, /archiveLegacyProduct\(Number\(params\.id\), body, session\.token\)/);
  assert.match(fs.readFileSync(aliasPath, 'utf8'), /@\/app\/api\/admin\/legacy-products\/\[id\]\/archive\/route/);

  const pageSource = fs.readFileSync(pagePath, 'utf8');
  assert.match(pageSource, /window\.confirm\(`Delete \$\{sanitizeProviderTitle\(product\.title\)\} \(#\$\{product\.id\}\)\?/);
  assert.match(pageSource, /legacy-products\/\$\{product\.id\}\/archive/);
  assert.match(pageSource, /expectedTitle:\s*product\.title[\s\S]*expectedUpdatedAt:\s*product\.updatedAt[\s\S]*expectedInventory/);
  assert.doesNotMatch(pageSource, /soft-delete/, 'the browser must never call the provider mutation directly');
  console.log('Legacy product archive check passed');
})().catch((error) => { console.error(error); process.exit(1); });
