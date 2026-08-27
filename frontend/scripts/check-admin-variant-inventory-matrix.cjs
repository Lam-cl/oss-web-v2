const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('/www/wwwroot/tonewow.xifuhalim.com/node_modules/typescript');

const sourcePath = '/www/wwwroot/tonewow.xifuhalim.com/src/lib/admin/variantMatrix.ts';
const source = fs.readFileSync(sourcePath, 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(code, { module: moduleBox, exports: moduleBox.exports });
const { buildVariantMatrix } = moduleBox.exports;

const options = [
  { name: 'Color', values: ['Stoney', 'Midnight', 'Olive Green', 'Sand'].map((value) => ({ value })) },
  { name: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'].map((value) => ({ value })) },
];
const variants = Array.from({ length: 40 }, (_, index) => ({ id: 58 + index, inventory: 100, selectedOptions: [] }));
variants.push(variants.splice(4, 1)[0]);
const matrix = buildVariantMatrix(options, variants);
assert.equal(matrix.rows.length, 4);
assert.equal(matrix.columns.length, 9);
assert.equal(matrix.rows[0].cells[0].variant.id, 62);
assert.equal(matrix.rows[3].cells[8].variant.id, 97);
assert.deepEqual(Array.from(matrix.unmapped, (variant) => variant.id), [58, 59, 60, 61]);

const reordered = buildVariantMatrix([options[1], options[0]], variants);
assert.equal(reordered.title, 'Inventory by color & size');
assert.equal(reordered.rows.length, 4);
assert.equal(reordered.columns.length, 9);
assert.equal(reordered.rows[0].cells[0].variant.id, 62);

const selected = buildVariantMatrix(
  [{ name: 'Color', values: [{ value: 'Black' }] }, { name: 'Size', values: [{ value: 'M' }] }],
  [{ id: 9, inventory: 7, selectedOptions: [{ optionName: 'Size', optionValue: 'M' }, { optionName: 'Color', optionValue: 'Black' }] }],
);
assert.equal(selected.rows[0].cells[0].variant.id, 9);

const oneOption = buildVariantMatrix(
  [{ name: 'Color', values: [{ value: 'Black' }, { value: 'Sand' }] }],
  [{ id: 2, sku: 'SAND', inventory: 3 }, { id: 1, sku: 'BLACK', inventory: 4 }],
);
assert.equal(oneOption.title, 'Inventory by color');
assert.deepEqual(Array.from(oneOption.rows, (row) => row.label), ['Black', 'Sand']);
assert.equal(oneOption.rows[1].cells[0].variant.id, 2);
assert.equal(oneOption.showTotals, false);

const plain = buildVariantMatrix([], [{ id: 7, sku: 'STANDARD', inventory: 8 }]);
assert.equal(plain.title, 'Inventory by variant');
assert.equal(plain.rows[0].label, 'STANDARD');
assert.equal(plain.rows[0].cells[0].variant.id, 7);
const drawer = fs.readFileSync('/www/wwwroot/tonewow.xifuhalim.com/src/components/admin/ProductDrawer.tsx', 'utf8');
assert(drawer.includes('buildVariantMatrix(visibleOptions, variants)'), 'drawer must build the matrix from visible options and live variants');
assert(drawer.includes('adm-variant-matrix'), 'inventory matrix table missing');
assert(drawer.includes('adm-variant-advanced'), 'advanced SKU and price fallback missing');
assert(drawer.includes('variantMatrix?.title'), 'drawer must label inventory flow for each product option shape');
assert(drawer.includes('variantMatrix.showTotals'), 'single-option products must not duplicate stock as a total');
const matrixSection = drawer.slice(drawer.indexOf(`{tab === 'variants' && fresh`), drawer.indexOf('<footer className="adm-drawer-foot">'));
assert(!matrixSection.includes('<img'), 'variant inventory must use text labels only for every product');
assert(!source.includes('imageUrl'), 'variant matrix data must not carry unused images');
console.log('Admin variant inventory matrix check passed');
