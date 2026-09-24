const assert = require('node:assert/strict');
const { compile } = require('./test-source-helpers.cjs');

const documents = new Map();
class Conflict extends Error { constructor() { super('revision conflict'); this.status = 409; } }
const fakeDataApi = {
  ToneWowDataApiError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } },
  remoteDocument: async (_, key) => documents.get(key) || null,
  createRemoteDocument: async (_, key, value, metadata) => {
    if (documents.has(key)) throw new Conflict();
    const document = { value, ...metadata };
    documents.set(key, document);
    return document;
  },
  replaceRemoteDocument: async (_, key, expected, value, metadata) => {
    if (documents.get(key)?.revision !== expected) throw new Conflict();
    const document = { value, ...metadata };
    documents.set(key, document);
    return document;
  },
};
const settings = compile('src/lib/merchandiseOrder.server.ts', { '@/lib/dataApiClient.server': fakeDataApi });
const basics = { catalogueId: 'e6c11fca-97bf-4aa6-a644-e52d25d98895', bundleProductId: 132 };
const action = { catalogueId: '160b913b-c01c-424c-92f0-75380e941909', bundleProductId: null };

(async () => {
  assert.deepEqual(await settings.readMerchandiseOrder(), { revision: 0, entries: [] });
  assert.deepEqual(await settings.saveMerchandiseOrder(0, [basics, action]), { revision: 1, entries: [basics, action] });
  assert.deepEqual(await settings.readMerchandiseOrder(), { revision: 1, entries: [basics, action] });
  await assert.rejects(() => settings.saveMerchandiseOrder(0, [action, basics]), /changed/i);
  assert.deepEqual(await settings.saveMerchandiseOrder(1, [action, basics]), { revision: 2, entries: [action, basics] });
  assert.throws(() => settings.validateMerchandiseOrderEntries([basics, basics]), /duplicate/i);
  assert.throws(() => settings.validateMerchandiseOrderEntries([{ ...action, title: 'injected' }]), /invalid/i);
  console.log('Merchandise order settings: persisted readback, revision conflict and invalid entries passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
