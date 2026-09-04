const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(rel, injected = {}) {
  const file = path.join(process.cwd(), rel);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (name) => name in injected ? injected[name] : require(name);
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, localRequire, mod, file, path.dirname(file));
  return mod.exports;
}

const response = (body, status = 200) => Response.json(body, { status });
let liveOrder = { id: 42, status: 'PAID', deliveryOption: 'PICKUP', collectionDate: null };
const providerCalls = [];

global.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  providerCalls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null });
  if (method === 'GET') return response(liveOrder);
  if (method === 'PATCH') {
    const body = JSON.parse(init.body);
    liveOrder = { ...liveOrder, collectionDate: body.collectionDate };
    return response(liveOrder);
  }
  throw new Error(`Unexpected provider call: ${method} ${url}`);
};

const route = load('src/app/api/admin/[...path]/route.ts', {
  'next/server': { NextResponse: { json: (body, init = {}) => response(body, init.status || 200) } },
  '@/lib/admin/server': {
    BUNDLE_API: 'https://bundle.test/api',
    getAdminSession: async () => ({ token: 'secret' }),
    readUpstream: async (upstream) => upstream.json(),
    requestIsSameOrigin: () => true,
    safeError: (status, body = {}) => response(body, status),
    sanitizePayload: (body) => body,
  },
  '@/lib/shippingSettings.server': {},
  '@/lib/admin/productSetup.server': { ProductSetupError: class extends Error {} },
  '@/lib/admin/simPrefixes.server': { SimPrefixError: class extends Error {} },
  '@/lib/admin/simRange.server': { SimRangeError: class extends Error {} },
  '@/lib/admin/orderMetadata.server': { OrderMetadataError: class extends Error {} },
  '@/lib/productImageColors.server': {},
  '@/lib/admin/readyCollectionEmail.server': { ReadyCollectionEmailError: class extends Error {} },
  '@/lib/admin/simAssignments': { deriveSimUnits: () => [] },
  '@/lib/admin/simAssignments.server': { SimAssignmentValidationError: class extends Error {} },
  '@/lib/cataloguePublicProjection.server': { readCatalogueSimFulfilmentProducts: async () => [] },
  '@/lib/pickup': { isKualaLumpurWorkingDay: (date) => date !== '2026-09-06', malaysiaDate: () => '2026-09-04' },
  '@/lib/admin/types': {
    orderDeliveryOption: (order) => order.deliveryOption,
    orderPickupDate: (order) => order.collectionDate || '',
  },
});

const request = (body) => {
  const value = new Request('https://admin.test/admin-api/orders/42/collection-date', {
    method: 'PUT',
    headers: { origin: 'https://admin.test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  Object.defineProperty(value, 'nextUrl', { value: new URL(value.url) });
  return value;
};
const context = { params: { path: ['orders', '42', 'collection-date'] } };

(async () => {
  delete process.env.BUNDLE_COLLECTION_DATE_ENABLED;
  let result = await route.PUT(request({ collectionDate: '2026-09-07', expectedCollectionDate: null }), context);
  assert.equal(result.status, 200, 'official Bundle support must be enabled by default');
  assert.deepEqual(providerCalls.at(-1).body, { collectionDate: '2026-09-07', expectedCollectionDate: null });
  assert.equal(liveOrder.collectionDate, '2026-09-07');

  const callsBeforeStale = providerCalls.length;
  result = await route.PUT(request({ collectionDate: '2026-09-08', expectedCollectionDate: null }), context);
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), {
    message: 'The collection date changed after this order was opened. Review the latest date and try again.',
    currentCollectionDate: '2026-09-07',
  });
  assert.equal(providerCalls.length, callsBeforeStale + 1, 'a stale edit may read but must not PATCH Bundle');

  liveOrder = { ...liveOrder, deliveryOption: 'DELIVER' };
  result = await route.PUT(request({ collectionDate: '2026-09-08', expectedCollectionDate: '2026-09-07' }), context);
  assert.equal(result.status, 400);

  liveOrder = { ...liveOrder, deliveryOption: 'PICKUP' };
  for (const invalid of ['2026-09-03', '2026-09-06', '09/07/2026']) {
    result = await route.PUT(request({ collectionDate: invalid, expectedCollectionDate: '2026-09-07' }), context);
    assert.equal(result.status, 400, `${invalid} must be rejected`);
  }

  process.env.BUNDLE_COLLECTION_DATE_ENABLED = 'false';
  result = await route.PUT(request({ collectionDate: '2026-09-08', expectedCollectionDate: '2026-09-07' }), context);
  assert.equal(result.status, 503, 'explicit false must remain an emergency kill switch');
  delete process.env.BUNDLE_COLLECTION_DATE_ENABLED;
  console.log('admin collection-date contract check passed');
})().catch((problem) => {
  console.error(problem);
  process.exitCode = 1;
});
