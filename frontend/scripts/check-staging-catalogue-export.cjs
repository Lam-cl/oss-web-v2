#!/usr/bin/env node
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const script = 'scripts/export-staging-catalogue.mjs';
const exportFile = 'test-reports/staging-catalogue-export-2026-08-23.json';
const manifestFile = 'test-reports/staging-catalogue-migration-2026-08-23.md';
const source = fs.readFileSync(script, 'utf8');
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

assert(!/method\s*:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/i.test(source), 'export must not contain an API mutation method');
assert.deepEqual([...source.matchAll(/method\s*:\s*['"`]([A-Z]+)['"`]/g)].map((match) => match[1]), ['GET'], 'all explicit request methods must be GET');
assert(!/\/checkout|batch-update|option-values\//.test(source), 'export must not address mutation endpoints');

execFileSync(process.execPath, [script], { stdio: 'pipe' });
const first = { export: hash(exportFile), manifest: hash(manifestFile) };
execFileSync(process.execPath, [script], { stdio: 'pipe' });
const second = { export: hash(exportFile), manifest: hash(manifestFile) };
assert.deepEqual(second, first, 'two live GET exports must be byte-for-byte stable');

const data = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
assert.equal(data.summary.activeProducts, 15);
assert.deepEqual(data.summary.productIds, [23, 24, 25, 26, 27, 28, 29, 32, 33, 34, 35, 36, 39, 40, 41]);
assert(!data.summary.productIds.includes(56) && !data.summary.productIds.includes(57));
assert.deepEqual(data.source.methods, ['GET']);
assert.equal(data.products.length, 15);
for (const product of data.products) {
  assert.equal(product.deletedAt, null);
  assert.match(product.fingerprint, /^sha256:[a-f0-9]{64}$/);
  for (const field of ['id', 'name', 'slug', 'description', 'price', 'categories', 'tags', 'images', 'options', 'variants', 'deletedAt']) assert(Object.hasOwn(product, field), `product ${product.id} missing ${field}`);
  for (const image of product.images) for (const field of ['id', 'order', 'url']) assert(Object.hasOwn(image, field), `product ${product.id} image missing ${field}`);
  for (const option of product.options) for (const value of option.values) for (const field of ['id', 'label', 'imageUrl']) assert(Object.hasOwn(value, field), `product ${product.id} option value missing ${field}`);
  for (const variant of product.variants) for (const field of ['id', 'sku', 'price', 'inventory', 'selectedOptions']) assert(Object.hasOwn(variant, field), `product ${product.id} variant missing ${field}`);
}
const serialized = JSON.stringify(data);
assert(!/(private.?key|authorization|bearer|token|secret|createdById|vendorId)/i.test(serialized), 'export must not contain credentials or unrelated ownership fields');
const manifest = fs.readFileSync(manifestFile, 'utf8');
assert.equal((manifest.match(/\| no-choice \|/g) || []).length, 8);
assert.equal((manifest.match(/\| one-choice \|/g) || []).length, 5);
assert.equal((manifest.match(/\| two-choice \|/g) || []).length, 2);
for (const text of ['no-choice', 'one-choice', 'two-choice', 'Missing combinations', 'Orphan variants', 'Null prices', 'Legacy image assignments', 'Recommended clean rebuild order', 'No implementation, cleanup, mutation, or migration was performed.']) assert(manifest.includes(text), `manifest missing ${text}`);
console.log(JSON.stringify({ passed: true, products: data.products.length, hashes: second }, null, 2));
