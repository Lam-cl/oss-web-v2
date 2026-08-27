#!/usr/bin/env node
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

function compile(rel) {
  const file = path.resolve(rel);
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const localRequire = request => request === '@/lib/dataApiClient.server' ? { dataApiEnabled:()=>false } : require(request);
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');
const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const operationId = 'a'.repeat(64);
const catalogueId = '018f47a2-a117-4c37-8a28-7f429768bea1';
const mediaId = '018f47a2-a117-4c37-8a28-7f429768bea2';
const fingerprint = 'b'.repeat(64);
const product = {
  catalogueId, slug: 'immutable-shirt', details: { title: 'Immutable Shirt', price: 42, description: 'Published copy', category: 'Apparel' },
  choices: [], combinations: [{ valueKeys: [], variantId: 91, price: 42, inventory: 7 }],
  images: [{ url: `/catalogue-products-api?catalogueId=${catalogueId}&mediaId=${mediaId}`, order: 0, assignment: 'all' }], bundleProductId: 501,
};
const input = { operationId, catalogueId, bundleProductId: 501, resultFingerprint64: fingerprint, product,
  media: [{ mediaId, originalName: 'hero.png', contentType: 'image/png', bytes: png.length, sha256: sha256(png), order: 0, assignment: 'all', body: png }] };

(async () => {
  const file = 'src/lib/cataloguePublishedSnapshot.server.ts';
  assert(fs.existsSync(file), `${file} missing`);
  const { createCataloguePublishedSnapshot, readCataloguePublishedSnapshot, readCataloguePublishedSnapshotMedia } = compile(file);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'catalogue-snapshot-'));
  const created = await createCataloguePublishedSnapshot(input, root);
  assert.equal(created.idempotent, false);
  assert.deepEqual(created.manifest.product, product);
  const disk = path.join(root, operationId);
  assert.equal(fs.existsSync(path.join(disk, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(disk, `${mediaId}.bin`)), true);
  assert.deepEqual(await readCataloguePublishedSnapshot(operationId, root), created.manifest);
  assert.deepEqual((await readCataloguePublishedSnapshotMedia(operationId, mediaId, root)).body, png);
  const retry = await createCataloguePublishedSnapshot(structuredClone(input), root);
  assert.equal(retry.idempotent, true);
  assert.deepEqual(retry.manifest, created.manifest);
  await assert.rejects(() => createCataloguePublishedSnapshot({ ...input, product: { ...product, slug: 'changed' } }, root), /conflict/i);
  await fsp.writeFile(path.join(disk, `${mediaId}.bin`), Buffer.from('tampered'));
  await assert.rejects(() => readCataloguePublishedSnapshot(operationId, root), /corrupt/i);

  const badRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'catalogue-snapshot-bad-'));
  await assert.rejects(() => createCataloguePublishedSnapshot({ ...input, media: [{ ...input.media[0], body: Buffer.from('not png'), bytes: 7, sha256: sha256(Buffer.from('not png')) }] }, badRoot), /signature/i);
  await assert.rejects(() => readCataloguePublishedSnapshot('../escape', badRoot), /operation ID/i);
  console.log('Catalogue published snapshot check passed');
})().catch(error => { console.error(error); process.exit(1); });
