'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(rel) {
  const file = path.resolve(rel);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(module.exports, require, module, file, path.dirname(file));
  return module.exports;
}

const stock = load('src/lib/admin/productStock.ts');
const model = {
  details: { title: 'Lanyard', description: '', price: 10 },
  choices: [{ key: 'colour', optionId: 8, name: 'Colour', values: [{ key: 'blue', valueId: 18, label: 'Blue', retired: false }] }],
  combinations: [{ valueKeys: ['blue'], variantId: 213, sku: 'TONE -STANDARD-2', price: 10, inventory: 1 }],
  existingImages: [],
};
const catalogue = { status: 'published', currentBundleProductId: 83, model };
const live = { id: 83, productVariants: [{ id: 213, sku: 'TONE-STANDARD-2-TWc49c1d85V2', inventory: 0, selectedOptions: [] }] };
assert.equal(stock.productInventory(catalogue, live), 0, 'published joined rows use live provider stock after a sale');
assert.equal(stock.productInventory(catalogue, { id: 83, productVariants: [{ id: 999, sku: 'ORPHAN', inventory: 5, selectedOptions: [] }] }), 0, 'unrelated provider variants must not make a sold-out catalogue product active');
assert.equal(stock.productInventory({ ...catalogue, status: 'draft' }, live), 1, 'unpublished rows retain local draft stock');
assert.equal(stock.productInventory(catalogue, { ...live, id: 84 }), 1, 'a non-current provider product must not override local intent');

const replacement = {
  id: 83,
  productVariants: [{ id: 301, inventory: 7, selectedOptions: [{ productOptionValue: { id: 18 } }] }],
};
assert.deepEqual(stock.liveCombinationInventory(model, replacement), { blue: 7 }, 'provider replacement variant IDs bind through current option values');
const ambiguous = { id: 83, productVariants: [
  { id: 302, sku: 'TONE-STANDARD-2-TWc49c1d85V3', inventory: 8, selectedOptions: [{ productOptionValue: { id: 18 } }] },
  { id: 303, sku: 'OTHER', inventory: 9, selectedOptions: [{ productOptionValue: { id: 18 } }] },
] };
assert.deepEqual(stock.liveCombinationInventory({ ...model, combinations: [{ ...model.combinations[0], variantId: 39 }] }, ambiguous), { blue: 0 }, 'ambiguous native option relationships must fail closed without SKU fallback');
const unmatched = { id: 83, productVariants: [{ id: 999, sku: 'ORPHAN', inventory: 5, selectedOptions: [] }] };
assert.deepEqual(stock.liveCombinationInventory(model, unmatched), { blue: 0 }, 'unmatched provider variants must emit explicit zero stock for every local combination');
const staleBindingModel = { ...model, combinations: [{ ...model.combinations[0], variantId: 39 }] };
assert.deepEqual(stock.liveCombinationInventory(staleBindingModel, live), { blue: 0 }, 'versioned provider SKU suffix binds live stock without mutating stale publication IDs');
const generatedSkuModel = { ...model, combinations: [{ ...model.combinations[0], variantId: 39, sku: '' }] };
const generatedSkuLive = { id: 83, productVariants: [
  { id: 302, sku: 'LANYARD-BLUE-TWc49c1d85V3', inventory: 6, selectedOptions: [] },
  { id: 303, sku: 'LANYARD-BLUE', inventory: 9, selectedOptions: [] },
] };
assert.deepEqual(stock.liveCombinationInventory(generatedSkuModel, generatedSkuLive), { blue: 6 }, 'blank canonical SKU resolves only the exact generated versioned provider binding');
const longSku = 'S'.repeat(100), suffix = '-TWc49c1d85V4';
const longSkuModel = { ...model, combinations: [{ ...model.combinations[0], variantId: 39, sku: longSku }] };
const longSkuLive = { id: 83, productVariants: [{ id: 304, sku: `${longSku.slice(0, 100 - suffix.length)}${suffix}`, inventory: 4, selectedOptions: [] }] };
assert.deepEqual(stock.liveCombinationInventory(longSkuModel, longSkuLive), { blue: 4 }, 'long canonical SKU resolves by exact provider truncation and version suffix reconstruction');
const operationId='b'.repeat(64),identity={catalogueId:'c49c1d85-1234-4567-89ab-123456789abc',operationId};
const operationSuffix=`-TWc49c1d85V4-${operationId.slice(0,16)}`;
const operationSkuLive={id:83,productVariants:[{id:305,sku:`TONE-STANDARD-2${operationSuffix}`,inventory:15,selectedOptions:[]}]};
assert.deepEqual(stock.liveCombinationInventory(staleBindingModel,operationSkuLive,identity),{blue:15},'operation-specific SKU resolves live stock with stale editor IDs');
const longOperationSkuLive={id:83,productVariants:[{id:305,sku:`${longSku.slice(0,100-operationSuffix.length)}${operationSuffix}`,inventory:16,selectedOptions:[]}]};
assert.equal(longOperationSkuLive.productVariants[0].sku.length,100);
assert.deepEqual(stock.liveCombinationInventory(longSkuModel,longOperationSkuLive,identity),{blue:16},'operation-specific suffix preserves exact 100-character canonical truncation');
assert.deepEqual(stock.liveCombinationInventory(staleBindingModel,operationSkuLive,{...identity,operationId:'c'.repeat(64)}),{blue:0},'provided publication operation identity must match the exact suffix');
assert.deepEqual(stock.liveCombinationInventory(staleBindingModel,operationSkuLive,{...identity,catalogueId:'deadbeef-1234-4567-89ab-123456789abc'}),{blue:0},'another catalogue suffix must not supply stock');
assert.equal(stock.productInventory({...catalogue,catalogueId:identity.catalogueId,publicationOperationId:operationId,model:staleBindingModel},operationSkuLive),15,'joined row stock retains catalogue and available publication identity');
for(const sku of ['TONE-STANDARD-2'+operationSuffix.slice(0,-1),'TONE-STANDARD-2'+operationSuffix+'x','TONE-STANDARD-2-TWc49c1d85V4-operation']){
  assert.deepEqual(stock.liveCombinationInventory(staleBindingModel,{id:83,productVariants:[{id:305,sku,inventory:15,selectedOptions:[]}]}),{blue:0},'arbitrary or partial operation suffixes never supply live stock');
}
assert.equal(model.combinations[0].inventory, 1, 'live reconciliation never mutates local publish intent');

const page = fs.readFileSync('src/app/admin/products/page.tsx', 'utf8');
assert.match(page, /productInventory\(/, 'row display and filter share authoritative inventory helper');
assert.match(page, /catalogue-products.*inventory|inventory.*catalogue-products/s, 'editor loads authoritative inventory through its catalogue binding');
assert.match(page, /expectedInventory/, 'stock writes retain the exact live value seen when the editor opened');
const editor = fs.readFileSync('src/components/admin/UnifiedProductEditor.tsx', 'utf8');
assert.match(editor, /shownInventory/, 'stock inputs display authoritative provider stock directly');
assert.match(editor, /touchedInventory/, 'only explicitly edited stock fields may become inventory changes');
assert.doesNotMatch(editor, />Live stock:|>Stock to publish/, 'stale draft stock is not rendered as the editable value beside live stock');

console.log('Admin product live stock reconciliation check passed');
