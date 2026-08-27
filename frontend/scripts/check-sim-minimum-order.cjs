const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const source = fs.readFileSync('src/lib/minimumOrderQuantity.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandboxModule = { exports: {} };
vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, require });
const { getProductMinimumOrderQuantity, incrementOrderQuantity, minimumOrderError } = sandboxModule.exports;
if (minimumOrderError(2) !== 'Minimum order quantity is 2 units') throw new Error('wrong minimum-order error');
if (incrementOrderQuantity(0, 2, 96) !== 2) throw new Error('zero must jump to MOQ 2');
if (incrementOrderQuantity(2, 2, 96) !== 3) throw new Error('normal increment must add one');
if (incrementOrderQuantity(96, 2, 96) !== 96) throw new Error('increment must respect stock cap');
for (const product of [
  { id: 39, slug: 'superlite-sim', title: 'SUPERLITE SIM', description: 'SUPERLITE SIM at RM10 per unit. Minimum order: 10 units.', tags: [] },
  { id: 40, slug: 'biz-sim', title: 'BIZ SIM', description: 'BIZ SIM at RM128 per unit. No minimum order quantity.', tags: [] },
]) {
  const actual = getProductMinimumOrderQuantity(product);
  if (actual !== 2) throw new Error(`${product.title}: expected MOQ 2, got ${actual}`);
}
console.log('SIM minimum-order check passed: SUPERLITE=2, BIZ=2');
