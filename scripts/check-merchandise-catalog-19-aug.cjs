const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');

function load(file, stubs = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', js)(module.exports, (id) => stubs[id] || require(id), module);
  return module.exports;
}

const merchandise = load('src/data/merchandise.ts', {
  '@/lib/minimumOrderQuantity': { getProductMinimumOrderQuantity: () => 1 },
  '@/lib/productDescription': { parseProductDescription: () => ({ description: '', details: [] }) },
});
const section = fs.readFileSync('src/components/home/MerchandiseSection.tsx', 'utf8');
const flyer = merchandise.merchandiseProducts.find((product) => product.id === 'merch-flyers');

assert(flyer, 'Flyers fallback enrichment must exist');
assert.equal(flyer.unitLabel, '20 pcs per bundle');
assert(flyer.features.includes('Pack size: 20 pcs'));
assert.equal(flyer.minimumOrderQuantity, 1, 'one sellable unit is one bundle');
assert(!section.includes('tone wow Collection'), 'collection eyebrow must be removed');
assert(section.includes('Shop official tone wow merchandise and SIM cards.'), 'catalog intro missing');

assert(merchandise.merchandiseProducts.some((product) => product.category === 'Apparel'));
assert(merchandise.merchandiseProducts.some((product) => product.category === 'Marketing'));

console.log('Merchandise catalogue behaviour check passed');
