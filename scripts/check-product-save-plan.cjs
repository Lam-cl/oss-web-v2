const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', output)(module.exports, require, module);
  return module.exports;
}

const { planProductSave } = load('src/lib/admin/productSavePlan.ts');

function fixture() {
  const current = {
    id: 7,
    title: 'Mug',
    price: 29.9,
    description: 'Warm',
    categories: ['Drinkware'],
    images: [{ id: 701, order: 0 }, { id: 702, order: 1 }],
    options: [
      { id: 10, name: 'Finish', order: 0, values: [{ id: 101, value: 'Matte', order: 0 }, { id: 102, value: 'Gloss', order: 1 }] },
      { id: 20, name: 'Capacity', order: 1, values: [{ id: 201, value: '350 ml', order: 0 }] },
    ],
    productVariants: [
      { id: 501, price: 29.9, inventory: 8, sku: 'MUG-MATTE-350' },
      { id: 502, price: 30.9, inventory: 4, sku: 'MUG-GLOSS-350' },
    ],
  };
  const control = {
    version: 1,
    productId: 7,
    updatedAt: '2026-08-23T01:02:03.000Z',
    upstreamFingerprint: 'a'.repeat(64),
    optionOrder: [10, 20],
    valueOrder: { 10: [101, 102], 20: [201] },
    hiddenValueIds: [],
    imageAssignments: [{ imageId: 701, valueId: 101 }, { imageId: 702, valueId: null }],
    variantBindings: [
      { valueIds: [101, 201], variantId: 501 },
      { valueIds: [102, 201], variantId: 502 },
    ],
    pendingOperation: null,
  };
  const spec = {
    details: { title: 'Mug', price: 29.9, description: 'Warm', category: 'Drinkware' },
    choices: [
      { key: 'finish', optionId: 10, name: 'Finish', values: [
        { key: 'matte', valueId: 101, label: 'Matte', retired: false },
        { key: 'gloss', valueId: 102, label: 'Gloss', retired: false },
      ] },
      { key: 'capacity', optionId: 20, name: 'Capacity', values: [
        { key: '350ml', valueId: 201, label: '350 ml', retired: false },
      ] },
    ],
    combinations: [
      { valueKeys: ['matte', '350ml'], variantId: 501, price: 29.9, inventory: 8, sku: 'MUG-MATTE-350' },
      { valueKeys: ['gloss', '350ml'], variantId: 502, price: 30.9, inventory: 4, sku: 'MUG-GLOSS-350' },
    ],
    existingImages: [
      { imageId: 701, order: 0, assignment: 'matte', remove: false },
      { imageId: 702, order: 1, assignment: 'all', remove: false },
    ],
  };
  return { current, control, spec };
}

const run = (change = {}) => {
  const base = fixture();
  return planProductSave({ ...base, ...change });
};
const kinds = (plan) => plan.map((operation) => operation.kind);
const byKind = (plan, kind) => plan.find((operation) => operation.kind === kind);

// The stable baseline is truly a no-op, including local control metadata.
assert.deepEqual(run(), [], 'unchanged intent must yield no operations');

// Product metadata is allowlisted and always last. Category remains local-only.
for (const [field, value] of [['title', 'Travel Mug'], ['price', 31.5], ['description', 'Hot or cold']]) {
  const { spec } = fixture();
  const plan = run({ spec: { ...spec, details: { ...spec.details, [field]: value } } });
  assert.deepEqual(plan, [{ kind: 'update-product', scope: 'bundle', payload: { [field]: value } }]);
}
{
  const { spec } = fixture();
  const plan = run({ spec: { ...spec, details: { ...spec.details, description: 'Hot or cold' } } });
  assert.equal(JSON.stringify(plan).includes('variants'), false, 'description-only edits cannot touch variants');
  assert.equal(JSON.stringify(plan).includes('inventory'), false);
}
{
  const { spec } = fixture();
  const plan = run({ spec: { ...spec, details: { ...spec.details, category: 'Gifts' } } });
  assert.deepEqual(kinds(plan), ['update-control']);
  assert.equal(plan[0].metadata.category, 'Gifts');
  assert.equal(JSON.stringify(plan).includes('categories'), false);
}

// Variant batches contain only changed variants and changed fields.
{
  const { spec } = fixture();
  const changed = {
    ...spec,
    combinations: [spec.combinations[0], { ...spec.combinations[1], price: 31, sku: 'GLOSS-NEW' }],
  };
  assert.deepEqual(run({ spec: changed }), [{
    kind: 'update-variants', scope: 'bundle',
    variants: [{ variantId: 502, price: 31, sku: 'GLOSS-NEW' }],
  }]);
}
{
  const { spec } = fixture();
  const withoutSku = {
    ...spec,
    combinations: [spec.combinations[0], { ...spec.combinations[1], sku: undefined }],
  };
  assert.deepEqual(run({ spec: withoutSku }), [{
    kind: 'update-variants', scope: 'bundle', variants: [{ variantId: 502, sku: null }],
  }], 'clearing an SKU must remain explicit in an executor payload');
}

// Every active Cartesian combination is mandatory.
{
  const { spec } = fixture();
  const missing = { ...spec, combinations: [spec.combinations[0]] };
  assert.throws(() => run({ spec: missing }), /Missing Cartesian combination gloss:350ml/);
}

// A claimed existing combination must be verified by both numeric control and current Bundle state.
{
  const { control } = fixture();
  assert.throws(
    () => run({ control: { ...control, variantBindings: control.variantBindings.slice(1) } }),
    /Existing combination matte:350ml lacks a verified Bundle variant binding/,
  );
  const { current } = fixture();
  assert.throws(
    () => run({ current: { ...current, productVariants: current.productVariants.slice(1) } }),
    /Existing combination matte:350ml lacks a verified Bundle variant binding/,
  );
  const { spec } = fixture();
  const mismatch = { ...spec, combinations: [{ ...spec.combinations[0], variantId: 502 }, spec.combinations[1]] };
  assert.throws(() => run({ spec: mismatch }), /Existing combination matte:350ml lacks a verified Bundle variant binding/);
}

// Retired combinations are still trust-boundary input: a supplied variant ID must match the exact binding.
{
  const { spec } = fixture();
  const retired = {
    ...spec,
    choices: [{ ...spec.choices[0], values: [spec.choices[0].values[0], { ...spec.choices[0].values[1], retired: true }] }, spec.choices[1]],
    combinations: [spec.combinations[0], { ...spec.combinations[1], variantId: 501 }],
  };
  assert.throws(() => run({ spec: retired }), /Existing combination gloss.*350ml lacks a verified Bundle variant binding/);
}

// Claimed Bundle entity IDs and labels must match both current Bundle state and verified control order.
{
  const { spec } = fixture();
  assert.throws(() => run({ spec: { ...spec, choices: [{ ...spec.choices[0], name: 'Surface' }, spec.choices[1]] } }), /rename existing option.*10/i);
  assert.throws(() => run({ spec: { ...spec, choices: [{ ...spec.choices[0], values: [
    { ...spec.choices[0].values[0], label: 'Flat' }, spec.choices[0].values[1],
  ] }, spec.choices[1]] } }), /rename existing value.*101/i);
  assert.throws(() => run({ spec: { ...spec, choices: [{ ...spec.choices[0], optionId: 999 }, spec.choices[1]] } }), /option ID 999/i);
  assert.throws(() => run({ spec: { ...spec, choices: [{ ...spec.choices[0], values: [
    { ...spec.choices[0].values[0], valueId: 999 }, spec.choices[0].values[1],
  ] }, spec.choices[1]] } }), /value ID 999/i);
  assert.throws(() => run({ spec: { ...spec, existingImages: [
    { ...spec.existingImages[0], imageId: 999 }, spec.existingImages[1],
  ] } }), /image ID 999/i);
}
{
  const { control } = fixture();
  assert.throws(() => run({ control: { ...control, optionOrder: [20] } }), /option ID 10.*control order/i);
  assert.throws(() => run({ control: { ...control, valueOrder: { ...control.valueOrder, 10: [102] } } }), /value ID 101.*control value order/i);
  assert.throws(
    () => run({ control: { ...control, imageAssignments: control.imageAssignments.slice(1) } }),
    /image ID 701.*control image assignments/i,
  );
}

// Colon-containing client keys form unambiguous tuples.
{
  const { current, control, spec } = fixture();
  const collision = {
    ...spec,
    choices: [
      { key: 'left', name: 'Left', values: [
        { key: 'a:b', label: 'A colon B', retired: false }, { key: 'a', label: 'A', retired: false },
      ] },
      { key: 'right', name: 'Right', values: [
        { key: 'c', label: 'C', retired: false }, { key: 'b:c', label: 'B colon C', retired: false },
      ] },
    ],
    combinations: [
      { valueKeys: ['a:b', 'c'], price: 1, inventory: 1 },
      { valueKeys: ['a:b', 'b:c'], price: 2, inventory: 2 },
      { valueKeys: ['a', 'c'], price: 3, inventory: 3 },
      { valueKeys: ['a', 'b:c'], price: 4, inventory: 4 },
    ],
  };
  const created = byKind(planProductSave({ current, control, spec: collision }), 'create-variants').variants;
  assert.deepEqual(created.map(({ valueKeys, price }) => ({ valueKeys, price })), [
    { valueKeys: ['a:b', 'c'], price: 1 },
    { valueKeys: ['a:b', 'b:c'], price: 2 },
    { valueKeys: ['a', 'c'], price: 3 },
    { valueKeys: ['a', 'b:c'], price: 4 },
  ]);
}

// A semantic combination without a verified binding is created using client value keys.
{
  const { spec } = fixture();
  const semanticNew = { ...spec, combinations: [spec.combinations[0], { ...spec.combinations[1], variantId: undefined }] };
  const { control } = fixture();
  const plan = run({ spec: semanticNew, control: { ...control, variantBindings: control.variantBindings.slice(0, 1) } });
  assert.deepEqual(byKind(plan, 'create-variants'), {
    kind: 'create-variants', scope: 'bundle',
    variants: [{ valueKeys: ['gloss', '350ml'], price: 30.9, inventory: 4, sku: 'MUG-GLOSS-350' }],
  });
  assert.ok(byKind(plan, 'update-control'), 'new variants require resolvable local control metadata');
}

// Generic unsaved choices and values need no premature Bundle IDs and produce the full Cartesian product.
{
  const { current, control, spec } = fixture();
  const unsaved = {
    ...spec,
    choices: [
      ...spec.choices,
      { key: 'material', name: 'Material', values: [
        { key: 'steel', label: 'Steel', retired: false },
        { key: 'glass', label: 'Glass', retired: false },
      ] },
    ],
    combinations: spec.combinations.flatMap((combination) => [
      { valueKeys: [...combination.valueKeys, 'steel'], price: combination.price, inventory: combination.inventory, sku: `${combination.sku}-S` },
      { valueKeys: [...combination.valueKeys, 'glass'], price: combination.price + 2, inventory: 2, sku: `${combination.sku}-G` },
    ]),
  };
  const plan = planProductSave({ current, control, spec: unsaved });
  assert.deepEqual(plan[0], {
    kind: 'create-option', scope: 'bundle',
    choice: {
      choiceKey: 'material', name: 'Material',
      values: [{ valueKey: 'steel', label: 'Steel' }, { valueKey: 'glass', label: 'Glass' }],
    },
  });
  assert.equal(byKind(plan, 'create-variants').variants.length, 4);
  assert.deepEqual(byKind(plan, 'create-variants').variants.map((entry) => entry.valueKeys), [
    ['matte', '350ml', 'steel'], ['matte', '350ml', 'glass'],
    ['gloss', '350ml', 'steel'], ['gloss', '350ml', 'glass'],
  ]);
}
{
  const { spec } = fixture();
  const withValue = {
    ...spec,
    choices: [{ ...spec.choices[0], values: [
      ...spec.choices[0].values,
      { key: 'satin', label: 'Satin', retired: false },
    ] }, spec.choices[1]],
    combinations: [...spec.combinations, {
      valueKeys: ['satin', '350ml'], price: 32, inventory: 3, sku: 'MUG-SATIN-350',
    }],
  };
  const plan = run({ spec: withValue });
  assert.deepEqual(byKind(plan, 'add-option-values'), {
    kind: 'add-option-values', scope: 'bundle', optionId: 10, choiceKey: 'finish',
    values: [{ valueKey: 'satin', label: 'Satin' }],
  });
  assert.deepEqual(byKind(plan, 'create-variants').variants.at(-1).valueKeys, ['satin', '350ml']);
}

// Retirement is non-destructive and zeroes only a verified bound variant inventory.
{
  const { spec } = fixture();
  const retired = {
    ...spec,
    choices: [{ ...spec.choices[0], values: [spec.choices[0].values[0], { ...spec.choices[0].values[1], retired: true }] }, spec.choices[1]],
  };
  const plan = run({ spec: retired });
  assert.deepEqual(byKind(plan, 'update-variants'), {
    kind: 'update-variants', scope: 'bundle', variants: [{ variantId: 502, inventory: 0 }],
  });
  assert.equal(kinds(plan).some((kind) => /delete-option|delete-variant|remove-option/.test(kind)), false);
  assert.ok(byKind(plan, 'update-control').metadata.choices[0].values[1].retired);
}

// Upload, structural, variant, removal, ordering, control, and product metadata sequencing is deterministic.
{
  const { current, control, spec } = fixture();
  const desired = {
    ...spec,
    details: { ...spec.details, title: 'New Mug' },
    choices: [
      { ...spec.choices[0], values: [...spec.choices[0].values, { key: 'satin', label: 'Satin', retired: false }] },
      spec.choices[1],
      { key: 'pack', name: 'Pack', values: [{ key: 'single', label: 'Single', retired: false }] },
    ],
    combinations: [
      ...spec.combinations.map((combination) => ({
        valueKeys: [...combination.valueKeys, 'single'],
        price: combination.price,
        inventory: combination.inventory,
        sku: combination.sku,
      })),
      { valueKeys: ['satin', '350ml', 'single'], price: 32, inventory: 3, sku: 'SATIN' },
    ],
    existingImages: [
      { imageId: 701, order: 2, assignment: 'matte', remove: false },
      { imageId: 702, order: 0, assignment: 'all', remove: true },
    ],
  };
  const uploads = [{ key: 'front', name: 'front.png', order: 0 }, { key: 'side', name: 'side.png', order: 1 }];
  const plan = planProductSave({ current, control, spec: desired, uploads });
  assert.deepEqual(kinds(plan), [
    'upload-images', 'create-option', 'add-option-values', 'create-variants',
    'remove-images', 'order-images', 'update-control', 'update-product',
  ]);
  assert.deepEqual(plan[0].uploads, uploads);
  assert.deepEqual(byKind(plan, 'remove-images').imageIds, [702]);
  assert.deepEqual(byKind(plan, 'order-images').images, [
    { uploadKey: 'front' }, { uploadKey: 'side' }, { imageId: 701 },
  ]);
  assert.deepEqual(plan.at(-1), { kind: 'update-product', scope: 'bundle', payload: { title: 'New Mug' } });
  assert.deepEqual(byKind(plan, 'update-control').metadata.images, [
    { ref: { uploadKey: 'front' }, assignment: null },
    { ref: { uploadKey: 'side' }, assignment: null },
    { ref: { imageId: 701 }, assignment: 'matte' },
  ]);
}

// Existing-only image reorder/removal and assignment-only changes are changed-only.
{
  const { spec } = fixture();
  const reordered = { ...spec, existingImages: [
    { ...spec.existingImages[0], order: 1 }, { ...spec.existingImages[1], order: 0 },
  ] };
  const plan = run({ spec: reordered });
  assert.deepEqual(kinds(plan), ['order-images', 'update-control']);
  assert.deepEqual(plan[0].images, [{ imageId: 702 }, { imageId: 701 }]);
}
{
  const { spec } = fixture();
  const assigned = { ...spec, existingImages: [spec.existingImages[0], { ...spec.existingImages[1], assignment: 'gloss' }] };
  const plan = run({ spec: assigned });
  assert.deepEqual(kinds(plan), ['update-control']);
  assert.equal(plan[0].metadata.images[1].assignment, 'gloss');
}
{
  const { spec } = fixture();
  const removed = { ...spec, existingImages: [{ ...spec.existingImages[0], remove: true }, spec.existingImages[1]] };
  const plan = run({ spec: removed });
  assert.deepEqual(kinds(plan), ['remove-images', 'order-images', 'update-control']);
  assert.deepEqual(plan[0].imageIds, [701]);
  assert.deepEqual(plan[1].images, [{ imageId: 702 }]);
}

// No forbidden Bundle fields can leak into any plan.
{
  const serialized = JSON.stringify(run());
  for (const forbidden of ['tags', 'shippingCost', 'weight']) assert.equal(serialized.includes(forbidden), false);
}

console.log('Product save planner check passed (all requirement groups)');
