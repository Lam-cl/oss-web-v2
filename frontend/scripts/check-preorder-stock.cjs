const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const mod = { exports: {} };
const js = ts.transpileModule(fs.readFileSync('src/data/merchandise.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('exports','require','module',js)(mod.exports, id => id === '@/lib/minimumOrderQuantity' ? { getProductMinimumOrderQuantity: () => 2 } : id === '@/lib/productDescription' ? { parseProductDescription: () => ({ description: '', details: [] }) } : require(id), mod);
const { getMerchandiseVariantInventory: physical, getMerchandiseVariantPurchaseLimit: limit, mergeBundleMerchandiseProducts: merge } = mod.exports;
for (const inventory of [0, 4, 25]) {
  const product = { isPreOrder: true, variantInventoryById: { 91: inventory } };
  assert.equal(physical(product,91),inventory);
  assert.equal(limit(product,91),Infinity);
  assert.equal(limit(product,999),0);
  assert.equal(limit(product),0);
  assert.equal(limit({...product,isPreOrder:false},91),inventory);
  assert.equal(limit({...product,isPreOrder:'true'},91),inventory);
}
const fixture = { id: 90, title: 'Preorder fixture', slug: 'preorder-fixture', price: 10, options: [{ name: 'Style', values: [{ value: 'Standard' }] }], productVariants: [{ id: 91, inventory: 0, price: 10 }] };
assert.equal(merge([{...fixture,isPreOrder:true}])[0].soldOut,false);
assert.equal(merge([{...fixture,isPreOrder:false}])[0].soldOut,true);
assert.equal(merge([{...fixture,isPreOrder:true}])[0].inventory,0);
console.log('Pre-order purchase availability preserves physical stock and variant validation: PASS');
