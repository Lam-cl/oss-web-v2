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
assert.equal(rebound.combinations[0].variantId, 501, 'a stale model ID is replaced by the current live binding');
assert.equal('variantId' in rebound.combinations[1], false, 'a combination absent from current evidence cannot retain a stale binding');
assert.equal(model.combinations[0].variantId, 101, 'rebinding does not mutate the caller model');

const published = bindings.rebindPublishedCatalogueModelVariantIds(model, live);
assert.equal(published.combinations[0].variantId, 501, 'publication persists the returned provider binding');
assert.equal('variantId' in published.combinations[1], false, 'retired combinations are detached after publication');
let lifecycleModel = { ...model, combinations: [{ ...model.combinations[0], variantId: undefined }] };
for (const [generation, variantId] of [[1, 501], [2, 602], [5, 905]]) {
  lifecycleModel = bindings.rebindPublishedCatalogueModelVariantIds(lifecycleModel, [
    { valueKeys: ['black'], variantId, inventory: 25 },
  ]);
  assert.equal(lifecycleModel.combinations[0].variantId, variantId, `generation ${generation} retains only its current binding`);
}
assert.throws(
  () => bindings.rebindPublishedCatalogueModelVariantIds(model, []),
  /exactly match/,
  'missing active publication bindings fail closed',
);
assert.throws(
  () => bindings.catalogueVariantBindingMap([
    { valueKeys: ['black'], variantId: 501, inventory: 25 },
    { valueKeys: ['black'], variantId: 502, inventory: 12 },
  ]),
  /ambiguous/,
  'duplicate tuple evidence fails closed',
);

const liveMap = bindings.catalogueVariantBindingMap(live);
const touched = new Set([bindings.catalogueCombinationKey(['black'])]);
assert.deepEqual(bindings.catalogueInventoryChanges(
  [{ ...model.combinations[0], inventory: 30 }],
  touched,
  liveMap,
), [{ valueKeys: ['black'], variantId: 501, expectedInventory: 25, inventory: 30 }], 'stock updates use the live ID instead of the stale model ID');
assert.deepEqual(bindings.catalogueInventoryChanges(
  [{ ...model.combinations[0], inventory: 30 }],
  new Set(),
  liveMap,
), [], 'untouched inventory never creates an update');
assert.deepEqual(bindings.catalogueInventoryChanges(
  [{ ...model.combinations[0], inventory: 25 }],
  touched,
  liveMap,
), [], 'unchanged live inventory never creates an update');

console.log('Catalogue current variant binding check passed');
