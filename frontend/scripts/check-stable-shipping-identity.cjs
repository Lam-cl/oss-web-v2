#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('src/lib/shipping.ts', 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function('exports', 'require', 'module', output)(mod.exports, require, mod);
const settings = structuredClone(mod.exports.DEFAULT_SHIPPING_SETTINGS);
settings.productGroups['26a311f1-6cdf-4cc1-9c11-e22f62f229f7'] = 'small';
assert.equal(mod.exports.calculateCourierCharge([{ catalogueId: '26a311f1-6cdf-4cc1-9c11-e22f62f229f7', bundleProductId: 105, name: 'Renamed item', quantity: 2 }], 'Johor', settings).amount, 10);
assert.equal(mod.exports.calculateCourierCharge([{ productId: '26a311f1-6cdf-4cc1-9c11-e22f62f229f7', bundleProductId: 999, name: 'Renamed item', quantity: 2 }], 'Sabah', settings).amount, 20);
const server = fs.readFileSync('src/lib/shippingSettings.server.ts', 'utf8');
const publication = fs.readFileSync('src/lib/admin/catalogueAdminRoute.server.ts', 'utf8');
assert.match(server, /inheritShippingProductGroup/);
assert.match(server, /settings\.productGroups\[input\.catalogueId\.toLowerCase\(\)\] = group/);
assert.match(publication, /await inheritShippingProductGroup\(\{catalogueId:id,previousBundleProductId:product\.currentBundleProductId,bundleProductId:publication\.bundleProductId,slug:product\.slug\}\)/);
console.log('stable shipping identity check passed');
