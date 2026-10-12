const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

class DataError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const held = new Map();
let remoteEnabled = true, releaseFailure = false, badLease = false, acquisitions = 0;
const api = {
  dataApiEnabled: () => remoteEnabled,
  ToneWowDataApiError: DataError,
  dataApiRequest: async (key, init) => {
    if (init.method === 'POST') {
      acquisitions++;
      assert.equal(JSON.parse(init.body).ttlSeconds, 600);
      if (held.has(key)) throw new DataError('LEASE_HELD');
      if (badLease) return {};
      const token = randomUUID(); held.set(key, token); return { token };
    }
    assert.equal(init.method, 'DELETE');
    assert.equal(init.headers['x-lease-token'], held.get(key));
    if (releaseFailure) throw new Error('Release unavailable');
    held.delete(key);
  },
};
function instance() {
  const code = ts.transpileModule(fs.readFileSync('src/lib/admin/catalogueMutationLock.server.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  new Function('exports', 'require', 'module', code)(m.exports, name => {
    if (name === '@/lib/dataApiClient.server') return api;
    return require(name);
  }, m);
  return m.exports;
}
(async () => {
  const first = instance(), second = instance(), id = randomUUID();
  let unblock, started, mutations = 0;
  const entered = new Promise(resolve => { started = resolve; });
  const barrier = new Promise(resolve => { unblock = resolve; });
  const publish = first.withCatalogueMutationLock(id, async () => { started(); await barrier; return 'published'; });
  await entered;
  await assert.rejects(() => first.withCatalogueMutationLock(id, async () => { mutations++; }), first.CatalogueMutationBusyError);
  await assert.rejects(() => second.withCatalogueMutationLock(id, async () => { mutations++; }), second.CatalogueMutationBusyError);
  assert.equal(await second.withCatalogueMutationLock(randomUUID(), async () => 'other product'), 'other product');
  assert.equal(mutations, 0);
  unblock(); assert.equal(await publish, 'published'); assert.equal(held.size, 0);
  assert.equal(await second.withCatalogueMutationLock(id, async () => 'edit after publish'), 'edit after publish');
  await assert.rejects(() => first.withCatalogueMutationLock(id, async () => { throw new Error('Publish failed'); }), /Publish failed/);
  assert.equal(held.size, 0, 'failed actions release the lock');
  const before = acquisitions;
  await assert.rejects(() => first.withCatalogueMutationLock('invalid', async () => {}), /valid catalogue ID/);
  assert.equal(acquisitions, before);
  badLease = true;
  await assert.rejects(() => first.withCatalogueMutationLock(id, async () => { mutations++; }), /lock could not be verified/);
  assert.equal(mutations, 0); badLease = false;
  releaseFailure = true;
  assert.equal(await first.withCatalogueMutationLock(id, async () => 'committed'), 'committed');
  await assert.rejects(() => second.withCatalogueMutationLock(id, async () => { mutations++; }), second.CatalogueMutationBusyError);
  assert.equal(mutations, 0); held.clear(); releaseFailure = false;
  remoteEnabled = false;
  const wrapped = first.serializeCatalogueMutation(async (key, value) => ({ key, value }));
  assert.deepEqual(await wrapped(id, 42), { key: id, value: 42 });
  for (const file of [
    'src/app/api/admin/catalogue-products/[id]/media/route.ts',
    'src/app/api/admin/catalogue-products/[id]/media/[mediaId]/route.ts',
    'src/app/api/admin/catalogue-products/[id]/media-removals/[operationId]/route.ts',
  ]) assert.match(fs.readFileSync(file, 'utf8'), /withCatalogueMutationLock/);
  const admin = fs.readFileSync('src/lib/admin/catalogueAdminRoute.server.ts', 'utf8');
  for (const action of ['update', 'updateInventory', 'archive', 'unpublish', 'publish']) {
    assert.match(admin, new RegExp(`${action}:serializeCatalogueMutation\\(catalogueAdminActions\\.${action}\\)`));
  }
  const page = fs.readFileSync('src/app/admin/products/page.tsx', 'utf8');
  assert.match(page, /Wait for publication to finish before editing/);
  assert.match(page, /publishingCatalogueIdRef\.current === row\.catalogue\.catalogueId/);
  for(const path of ['src/app/api/admin/catalogue-products/[id]/publish/route.ts','src/app/admin-api/catalogue-products/[id]/publish/route.ts']) {
    assert.match(fs.readFileSync(path,'utf8'), /maxDuration\s*=\s*300/);
  }
  console.log('Catalogue cross-instance mutation lock, busy responses, releases and edit guard: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
