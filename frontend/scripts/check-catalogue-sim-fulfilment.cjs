#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

function load(file, mocks = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, (id) => mocks[id] || require(id), mod, file, path.dirname(file));
  return mod.exports;
}

(async () => {
  const core = load('src/lib/admin/simAssignments.ts');
  const projection = [{ bundleProductId: 114, details: { category: 'SIM Card' }, combinations: [{ variantId: 350 }] }];
  const order = { items: [{ id: 328, productId: 114, variantId: 350, productName: 'Opaque provider title', slug: 'generated-version', quantity: 2 }] };
  const units = core.deriveSimUnits(order, {}, projection);
  assert.equal(units.length, 2, 'published SIM Card identity must create one fulfilment unit per quantity');
  assert.equal(core.deriveSimUnits(order).length, 0, 'provider data alone demonstrates the missing category failure');
  assert.equal(core.deriveSimUnits({ items: [{ ...order.items[0], productName: 'SIM-looking ordinary product', productId: 999, variantId: 999 }] }, {}, projection).length, 0, 'names must not activate SIM fulfilment');

  process.env.ADMIN_SESSION_SECRET = 'test-only-secret-that-is-longer-than-thirty-two-characters';
  const store = load('src/lib/admin/simAssignments.server.ts', {
    '@/lib/dataApiClient.server': { dataApiEnabled: () => false },
    './simAssignments': core,
  });
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tonewow-sim-fulfilment-'));
  const file = path.join(directory, 'assignments.json');
  const saved = await store.saveOrderSimAssignments(194, units, units.map((unit, index) => ({
    unitKey: unit.unitKey, prefixId: '1', prefix: '896016180', serial: `1234567890${index}`, puk: '12345678',
  })), file);
  assert.equal(saved.complete, 2);
  assert(saved.units.every((unit) => !Object.hasOwn(unit, 'puk') && !Object.hasOwn(unit, 'pukCiphertext')), 'PUK must never be returned');
  const raw = await fsp.readFile(file, 'utf8');
  assert.equal(JSON.parse(raw).orders['194'].assignments.some((unit) => unit.puk === '12345678' || unit.pukCiphertext === '12345678'), false, 'PUK must be encrypted at rest');
  assert.match(raw, /pukCiphertext/);
  await store.assertOrderSimAssignmentsComplete(194, units, file);
  await fsp.rm(directory, { recursive: true, force: true });

  const route = fs.readFileSync('src/app/api/admin/[...path]/route.ts', 'utf8');
  assert.match(route, /requestedStatus === 'SHIPPED'/);
  assert.match(route, /assertOrderSimAssignmentsComplete/);
  assert.match(route, /nativeAssignmentTotal\(currentPayload\) === 0/);
  const drawer = fs.readFileSync('src/components/admin/OrderDrawer.tsx', 'utf8');
  assert.doesNotMatch(drawer, /deriveSimUnits\(value\)\.length\s*\?/);
  console.log('Catalogue-classified SIM fulfilment fallback passed');
})().catch((error) => { console.error(error); process.exit(1); });
