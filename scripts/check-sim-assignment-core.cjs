const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('src/lib/admin/simAssignments.ts', 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} }; new Function('exports','require','module',output)(mod.exports,require,mod);
const { SIM_PREFIXES, deriveSimUnits, isValidSimPrefix, isValidSimSerial } = mod.exports;
assert.equal(SIM_PREFIXES, undefined, 'SIM prefixes must come from the live API');
assert.equal(isValidSimPrefix('896016180'), true);
const units = deriveSimUnits({ items: [
  { id: 77, quantity: 2, product: { slug: 'biz-sim', title: 'TWE BIZ SIM' } },
  { id: 78, quantity: 1, product: { categories: [{ name: 'SIM Cards' }], title: 'SUPERLITE SIM' } },
  { id: 79, quantity: 1, product: { title: 'tone wow Shirt' } },
  { id: 80, quantity: 1, type: 'sim', name: 'Starter Pack' },
  { id: 81, quantity: 1, product: { title: 'SIM Delivery Fee', slug: 'sim-delivery-fee' } },
] });
assert.equal(units.length, 4);
assert.deepEqual(units.slice(0,2).map(x=>x.unitKey), ['item-77:1','item-77:2']);
assert.deepEqual(units.slice(0,2).map(x=>x.label), ['TWE BIZ SIM · Unit 1 of 2','TWE BIZ SIM · Unit 2 of 2']);
assert.equal(units.some(x=>x.productName==='tone wow Shirt'), false);
assert.equal(units.some(x=>x.productName==='SIM Delivery Fee'), false);
assert.equal(isValidSimSerial('01234567890'), true);
assert.equal(isValidSimSerial('1234567890'), false);
assert.equal(isValidSimSerial('1234567890A'), false);
console.log('SIM assignment core check passed');
