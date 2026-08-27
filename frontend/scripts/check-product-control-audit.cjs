const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const { auditCatalogue, cartesian, renderMarkdown, exitCode } = await import('./audit-product-control.mjs');

  assert.deepEqual(cartesian([
    { name: 'Color', values: [{ id: 1, value: 'Black' }, { id: 2, value: 'White' }] },
    { name: 'Size', values: [{ id: 3, value: 'S' }, { id: 4, value: 'M' }] },
  ]).map((item) => item.values), [
    ['Black', 'S'], ['Black', 'M'], ['White', 'S'], ['White', 'M'],
  ]);

  const products = [
    {
      id: 1, title: 'Native', price: 10,
      options: [{ id: 1, name: 'Color', order: 0, values: [{ id: 1, value: 'Black', order: 0, imageUrl: 'black.png' }] }],
      productVariants: [
        { id: 11, sku: 'DUP', price: 11, inventory: 3, selectedOptions: [{ optionName: 'Color', optionValue: 'Black' }] },
        { id: 12, sku: 'ORPHAN', price: 12, inventory: 4, selectedOptions: [{ optionName: 'Color', optionValue: 'Ghost' }] },
      ],
      images: [{ id: 9, order: 1, url: 'b.png' }, { id: 8, order: 0, url: 'a.png' }],
    },
    {
      id: 2, title: 'Recorded', price: 20,
      options: [{ id: 2, name: 'Pack', values: [{ id: 5, value: 'Standard' }] }],
      productVariants: [{ id: 21, sku: 'DUP', price: 20, inventory: 5, selectedOptions: [] }],
      images: [],
    },
    {
      id: 3, title: 'Generated pattern', price: 30,
      options: [
        { id: 4, name: 'Size', values: [{ id: 8, value: 'S' }, { id: 9, value: 'M' }] },
        { id: 3, name: 'Color', values: [{ id: 6, value: 'Black' }, { id: 7, value: 'White' }] },
      ],
      productVariants: [
        { id: 30, sku: 'BLACK-ORPHAN', price: 30, inventory: 1, selectedOptions: [] },
        { id: 31, sku: 'WHITE-ORPHAN', price: 30, inventory: 1, selectedOptions: [] },
        { id: 32, sku: 'X1', price: 31, inventory: 2, selectedOptions: [] },
        { id: 33, sku: 'X2', price: 32, inventory: 3, selectedOptions: [] },
        { id: 34, sku: 'X3', price: 33, inventory: 4, selectedOptions: [] },
        { id: 35, sku: 'X4', price: 34, inventory: 5, selectedOptions: [] },
      ], images: [],
    },
    {
      id: 4, title: 'SKU evidence and gap', price: 40,
      options: [{ id: 5, name: 'Color', values: [{ id: 10, value: 'Navy Blue' }, { id: 11, value: 'Orange' }, { id: 12, value: 'Purple' }] }],
      productVariants: [
        { id: 41, sku: 'BOTTLE-NAVY-BLUE', price: 41, inventory: 6, selectedOptions: [] },
        { id: 42, sku: 'MYSTERY', price: 42, inventory: 7, selectedOptions: [] },
      ], images: [],
    },
  ];

  const report = auditCatalogue(products, { 2: { 'Pack=Standard': 21 } });
  assert.equal(report.summary.products, 4);
  assert.equal(report.summary.combinations, 9);
  assert.equal(report.summary.ambiguousProducts, 1);
  assert.deepEqual(report.duplicateSkus, [{ sku: 'DUP', variants: [{ productId: 1, variantId: 11 }, { productId: 2, variantId: 21 }] }]);

  const [native, recorded, pattern, sku] = report.products;
  assert.equal(native.combinations[0].evidence, 'verified-native');
  assert.deepEqual(native.orphanVariants.map((v) => v.id), [12]);
  assert.deepEqual(native.images.map((i) => i.id), [8, 9]);
  assert.deepEqual(native.prices, { product: 10, variants: [{ id: 11, price: 11 }, { id: 12, price: 12 }] });
  assert.deepEqual(native.inventory, { total: 7, variants: [{ id: 11, inventory: 3 }, { id: 12, inventory: 4 }] });
  assert.equal(recorded.combinations[0].evidence, 'verified-recorded');
  assert.deepEqual(pattern.combinations.map((c) => c.evidence), Array(4).fill('candidate-order-pattern'));
  assert.deepEqual(pattern.combinations.map((c) => c.variant.id), [32, 33, 34, 35]);
  assert.deepEqual(pattern.orphanVariants.map((v) => v.id), [30, 31]);
  assert.equal(sku.combinations[0].evidence, 'candidate-unique-sku');
  assert.equal(sku.combinations[1].evidence, 'ambiguous');
  assert.deepEqual(sku.missingCombinations.map((c) => c.key), ['Color=Orange', 'Color=Purple']);
  assert.deepEqual(sku.orphanVariants.map((v) => v.id), [42]);
  assert.equal(sku.ambiguous, true);
  assert.equal(exitCode(report), 1);
  assert.match(renderMarkdown(report), /# Product Control Audit/);
  assert.match(renderMarkdown(report), /SKU evidence and gap/);

  const collision = auditCatalogue([{ id: 9, title: 'Collision', options: [{ id: 9, name: 'Color', values: [{ id: 9, value: 'Black' }] }], productVariants: [
    { id: 91, sku: 'ONE', price: 1, inventory: 1, selectedOptions: [{ optionName: 'Color', optionValue: 'Black' }] },
    { id: 92, sku: 'TWO', price: 1, inventory: 1, selectedOptions: [{ optionName: 'Color', optionValue: 'Black' }] },
  ] }]);
  assert.equal(collision.products[0].combinations[0].evidence, 'ambiguous');
  assert.equal(collision.summary.ambiguousProducts, 1);

  const singleOptionOrphans = auditCatalogue([{ id: 10, title: 'Single option orphans', options: [{ id: 10, name: 'Color', values: [
    { id: 101, value: 'Black' }, { id: 102, value: 'White' },
  ] }], productVariants: [
    { id: 101, sku: 'UNKNOWN-1', price: 1, inventory: 1, selectedOptions: [] },
    { id: 102, sku: 'UNKNOWN-2', price: 1, inventory: 1, selectedOptions: [] },
    { id: 103, sku: 'UNKNOWN-3', price: 1, inventory: 1, selectedOptions: [] },
    { id: 104, sku: 'UNKNOWN-4', price: 1, inventory: 1, selectedOptions: [] },
  ] }]);
  assert.deepEqual(singleOptionOrphans.products[0].combinations.map((item) => item.evidence), ['ambiguous', 'ambiguous']);
  assert.deepEqual(singleOptionOrphans.products[0].orphanVariants.map((item) => item.id), [101, 102, 103, 104]);

  const source = fs.readFileSync('scripts/audit-product-control.mjs', 'utf8');
  assert(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i.test(source), 'auditor must not mutate Bundle');
  assert(!source.includes('/.data') && !source.includes("'.data") && !source.includes('".data'), 'auditor must not write .data');
  console.log('product control audit check passed');
})().catch((error) => { console.error(error); process.exit(1); });


