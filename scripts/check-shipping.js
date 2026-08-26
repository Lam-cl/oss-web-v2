const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('src/lib/shipping.ts', 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleForShipping = { exports: {} };
new Function('exports', 'require', 'module', output)(moduleForShipping.exports, require, moduleForShipping);
const { calculateCourierCharge } = moduleForShipping.exports;

const tShirtPlusTumbler = calculateCourierCharge([
  { name: 'Tone Wow T-shirt', quantity: 1 },
  { name: 'Tumbler 1180ml', quantity: 21 },
], 'Johor');

assert.equal(
  tShirtPlusTumbler.amount,
  20,
  'mixed cart must use the heaviest product category, not the largest category charge',
);

const staleCatalogueCart = calculateCourierCharge([
  { productId: '81', name: 'Tone WOW 3.0 Topi [TW-5cb16d58-a2]', quantity: 1 },
], 'Johor', {
  priority: ['shirt', 'bulky', 'small', 'flyers', 'sim'],
  groups: moduleForShipping.exports.DEFAULT_SHIPPING_SETTINGS.groups,
  productGroups: { '81': 'small' },
});
assert.equal(staleCatalogueCart.amount, 10, 'stale cart productId must use the current numeric courier mapping');
assert.deepEqual(staleCatalogueCart.unclassified, []);
const canonicalSimCategory = calculateCourierCharge([
  { name: 'Starter Pack', category: 'SIM Card', quantity: 2 },
], 'Johor');
assert.equal(canonicalSimCategory.amount, 10, 'canonical SIM Card category must retain SIM shipping');
assert.equal(canonicalSimCategory.quantities.sim, 2);
console.log('shipping hierarchy check passed');
