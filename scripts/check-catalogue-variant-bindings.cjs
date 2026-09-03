'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.resolve('src/lib/admin/catalogueVariantBindings.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'require', 'module', output)(loaded.exports, require, loaded);
const bindings = loaded.exports;

const model = {
  details: { title: 'Shirt', description: '', price: 25 },
  choices: [{ key: 'colour', name: 'Colour', values: [
    { key: 'black', label: 'Black', retired: false },
    { key: 'green', label: 'Green', retired: true },
  ] }],
  combinations: [
    { valueKeys: ['black'], variantId: 101, sku: 'SHIRT-BLACK', price: 25, inventory: 12 },
    { valueKeys: ['green'], variantId: 102, sku: 'SHIRT-GREEN', price: 25, inventory: 4 },
  ],
  existingImages: [],
};

const live = [{ valueKeys: ['black'], variantId: 501, inventory: 25 }];
const rebound = bindings.rebindCatalogueModelVariantIds(model, live);
assert.equal(rebound.combinations[0].variantId, 501);
assert.equal('variantId' in rebound.combinations[1], false);
assert.equal(model.combinations[0].variantId, 101, 'rebind must not mutate the editor model');

const intended = [{ valueKeys: ['black'], variantId: 101, expectedInventory: 25, inventory: 30 }];
assert.deepEqual(bindings.reconcileCatalogueInventoryChanges(intended, live), [
  { valueKeys: ['black'], variantId: 501, expectedInventory: 25, inventory: 30 },
]);
assert.throws(
  () => bindings.reconcileCatalogueInventoryChanges(intended, [{ ...live[0], inventory: 24 }]),
  /Live stock changed/,
  'a checkout after editor load must not be overwritten',
);
assert.throws(
  () => bindings.reconcileCatalogueInventoryChanges(intended, []),
  /product option changed/,
  'removed combinations must fail closed',
);

const touched = new Set([bindings.catalogueCombinationKey(['black'])]);
assert.deepEqual(bindings.catalogueInventoryChanges(
  [{ ...model.combinations[0], inventory: 30 }], touched, bindings.catalogueVariantBindingMap(live),
), [{ valueKeys: ['black'], variantId: 501, expectedInventory: 25, inventory: 30 }]);

const route = fs.readFileSync('src/lib/admin/catalogueAdminRoute.server.ts', 'utf8');
assert.match(route, /exact\(change,\['expectedInventory','inventory','valueKeys','variantId'\]\)/, 'inventory API must require exact tuple-based changes');
assert.match(route, /rowsByTuple/, 'inventory API must resolve the authoritative current variant by tuple under its lock');

console.log('Catalogue current variant binding check passed');
