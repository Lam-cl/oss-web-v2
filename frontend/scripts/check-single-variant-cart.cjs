#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function compile(file, mocks = {}) {
  const filename = path.resolve(file);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    mod.exports,
    (id) => id in mocks ? mocks[id] : require(id),
    mod,
    filename,
    path.dirname(filename),
  );
  return mod.exports;
}

const key = (option, size) => `${option.toLowerCase()}::${(size || '').toLowerCase()}`;

const cart = compile('src/store/cartStore.ts', {
  zustand: { create: () => () => ({}) },
  'zustand/middleware': { persist: (value) => value },
  '@/data/merchandise': {
    merchandiseVariantKey: key,
    getMerchandiseVariantId: (product, option, size) => product.variantIds[key(option, size)],
    getMerchandiseVariantInventory: (product, id) => product.variantInventoryById[id] || 0,
  },
});

const flyers = {
  id: '12227c99-74e7-4213-9bec-1e99d670360f', apiProductId: 112, slug: 'tone-wow-flyers', name: 'tone wow 3-Fold Flyers',
  description: 'Current flyer', price: 20, optionLabel: 'Style', options: [{ name: 'Standard', image: '/flyer.png' }],
  variantIds: { [key('Standard')]: 349 }, variantPrices: { [key('Standard')]: 20 }, variantInventoryById: { 349: 100 }, minimumOrderQuantity: 1,
};
const staleFlyer = {
  id: 'flyer', type: 'merchandise', productId: flyers.id, bundleProductId: 97, bundleVariantId: undefined,
  slug: flyers.slug, name: flyers.name, price: 18, quantity: 1, selectionRequired: 'Variant selection required', addedAt: '',
};
const repairedFlyer = cart.reconcileMerchandiseCartItems([staleFlyer], [flyers])[0];
assert.deepEqual({ product: repairedFlyer.bundleProductId, variant: repairedFlyer.bundleVariantId, label: repairedFlyer.variant }, { product: 112, variant: 349, label: 'Standard' });
assert.equal(repairedFlyer.availableQuantity, 100);
assert.equal(repairedFlyer.price, 20);
assert.equal(repairedFlyer.selectionRequired, undefined);

const superlite = {
  id: '39a00000-0000-4000-8000-000000000039', apiProductId: 107, slug: 'superlite-sim', name: 'TWE SUPERLITE SIM',
  description: 'TWE', price: 10, optionLabel: 'Variant', options: [{ name: 'Tone Excel', image: '/sim.png' }],
  variantIds: { [key('Tone Excel')]: 344 }, variantPrices: { [key('Tone Excel')]: 10 }, variantInventoryById: { 344: 44 }, minimumOrderQuantity: 2,
};
const repairedSim = cart.reconcileMerchandiseCartItems([{
  id: 'sim', type: 'merchandise', productId: superlite.id, bundleProductId: 107, bundleVariantId: 344,
  slug: superlite.slug, name: superlite.name, price: 10, quantity: 2, addedAt: '',
}], [superlite])[0];
assert.equal(repairedSim.variant, 'Tone Excel');
assert.equal(repairedSim.bundleVariantId, 344);
assert.equal(repairedSim.selectionRequired, undefined);

const multi = { ...flyers, apiProductId: 113, options: [{ name: 'Blue' }, { name: 'Red' }], variantIds: { [key('Blue')]: 350, [key('Red')]: 351 }, variantInventoryById: { 350: 5, 351: 5 } };
const ambiguous = cart.reconcileMerchandiseCartItems([staleFlyer], [multi])[0];
assert.equal(ambiguous.bundleVariantId, undefined);
assert.equal(ambiguous.selectionRequired, 'Variant selection required');

const sized = { ...flyers, apiProductId: 114, options: [{ name: 'Standard', sizes: ['S', 'M'] }], sizes: ['S', 'M'], variantIds: { [key('Standard', 'S')]: 352, [key('Standard', 'M')]: 353 }, variantInventoryById: { 352: 5, 353: 5 } };
const sizedResult = cart.reconcileMerchandiseCartItems([staleFlyer], [sized])[0];
assert.equal(sizedResult.bundleVariantId, undefined);
assert.equal(sizedResult.selectionRequired, 'Variant selection required');

console.log('Single-variant cart behavior passed');
