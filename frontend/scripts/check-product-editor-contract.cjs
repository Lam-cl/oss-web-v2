const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    module.exports, require, module, file, path.dirname(file),
  );
  return module.exports;
}

const file = 'src/lib/admin/productEditor.ts';
const editor = load(file);
const raw = {
  details: {
    title: '  Travel Mug  ',
    price: 29.9,
    description: '  Keeps drinks warm.  ',
    category: ' Drinkware ',
    categories: ['unsafe'],
    tags: ['unsafe'],
    shippingCost: 4.5,
    weight: 0.4,
  },
  choices: [
    {
      key: ' finish ',
      optionId: 10,
      name: ' Finish ',
      values: [
        { key: 'matte', valueId: 101, label: ' Matte ', retired: false },
        { key: 'gloss', valueId: 102, label: ' Gloss ', retired: true },
      ],
    },
    {
      key: 'capacity',
      name: ' Capacity ',
      values: [{ key: '350ml', label: ' 350 ml ', retired: false }],
    },
  ],
  combinations: [{
    valueKeys: ['350ml', 'matte'],
    variantId: 501,
    price: 29.9,
    inventory: 8,
    sku: ' MUG-MATTE-350 ',
  }],
  existingImages: [
    { imageId: 701, order: 1, assignment: 'matte', remove: false },
    { imageId: 702, order: 0, assignment: 'all', remove: true },
  ],
};

assert.deepEqual(editor.normalizeProductEditorSpec(raw), {
  details: {
    title: 'Travel Mug',
    price: 29.9,
    description: 'Keeps drinks warm.',
    category: 'Drinkware',
  },
  choices: [
    {
      key: 'finish',
      optionId: 10,
      name: 'Finish',
      values: [
        { key: 'matte', valueId: 101, label: 'Matte', retired: false },
        { key: 'gloss', valueId: 102, label: 'Gloss', retired: true },
      ],
    },
    {
      key: 'capacity',
      name: 'Capacity',
      values: [{ key: '350ml', label: '350 ml', retired: false }],
    },
  ],
  combinations: [{
    valueKeys: ['matte', '350ml'],
    variantId: 501,
    price: 29.9,
    inventory: 8,
    sku: 'MUG-MATTE-350',
  }],
  existingImages: [
    { imageId: 701, order: 1, assignment: 'matte', remove: false },
    { imageId: 702, order: 0, assignment: 'all', remove: true },
  ],
});

const unsaved = {
  details: { title: 'Tee', price: 20, description: '' },
  choices: [
    { key: 'style', name: 'Style', values: [{ key: 'crew', label: 'Crew', retired: false }] },
    { key: 'pack', name: 'Pack', values: [{ key: 'pair', label: 'Pair', retired: false }] },
  ],
  combinations: [{ valueKeys: ['pair', 'crew'], price: 20, inventory: 4 }],
  existingImages: [],
};
assert.deepEqual(editor.normalizeProductEditorSpec(unsaved), {
  ...unsaved,
  combinations: [{ valueKeys: ['crew', 'pair'], price: 20, inventory: 4 }],
});

const rejects = (change, pattern) => assert.throws(
  () => editor.normalizeProductEditorSpec(change(structuredClone(raw))), pattern,
);

for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
  rejects((value) => (value.choices[0].optionId = bad, value), /ID/i);
  rejects((value) => (value.choices[0].values[0].valueId = bad, value), /ID/i);
  rejects((value) => (value.combinations[0].variantId = bad, value), /ID/i);
  rejects((value) => (value.existingImages[0].imageId = bad, value), /ID/i);
}
for (const bad of ['', '   ', 'has space', 'slash/key', '.leading', 'x'.repeat(129), 1]) {
  rejects((value) => (value.choices[0].key = bad, value), /key/i);
  rejects((value) => (value.choices[0].values[0].key = bad, value), /key/i);
}
rejects((value) => (value.choices[1].key = ' finish ', value), /duplicate.*choice key/i);
rejects((value) => (value.choices[1].values[0].key = 'matte', value), /duplicate.*value key/i);
rejects((value) => (value.choices[1].optionId = 10, value), /duplicate.*option ID/i);
rejects((value) => (value.choices[1].values[0].valueId = 101, value), /duplicate.*value ID/i);
rejects((value) => (value.choices[0].values[1].label = ' matte ', value), /duplicate.*label/i);
rejects((value) => (value.choices[1].name = ' finish ', value), /duplicate.*choice name/i);
rejects((value) => (value.combinations[0].valueKeys = ['matte', 'gloss'], value), /exactly one value.*choice/i);
rejects((value) => (value.combinations[0].valueKeys = ['matte', 'matte'], value), /duplicate.*value key/i);
rejects((value) => (value.combinations[0].valueKeys = ['matte', 'missing'], value), /valid value key/i);
rejects((value) => (value.combinations.push({ ...value.combinations[0], valueKeys: ['matte', '350ml'], variantId: 502 }), value), /duplicate.*combination/i);
rejects((value) => (value.combinations.push({ ...value.combinations[0], valueKeys: ['gloss', '350ml'] }), value), /duplicate.*variant ID/i);
for (const field of ['price', 'inventory']) {
  for (const bad of [-1, NaN, Infinity, '1']) {
    rejects((value) => (value.combinations[0][field] = bad, value), new RegExp(field, 'i'));
  }
}
for (const bad of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
  rejects((value) => (value.combinations[0].inventory = bad, value), /inventory/i);
}
for (const bad of [-1, NaN, Infinity, '1']) {
  rejects((value) => (value.details.price = bad, value), /price/i);
}
rejects((value) => (value.existingImages[0].assignment = 'missing', value), /valid value key/i);
rejects((value) => (value.existingImages[0].assignment = 101, value), /assignment/i);
rejects((value) => (value.existingImages.push({ ...value.existingImages[0], order: 2 }), value), /duplicate.*image/i);
rejects((value) => (value.existingImages[1].order = 1, value), /duplicate.*image order/i);
for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
  rejects((value) => (value.existingImages[0].order = bad, value), /order/i);
}
rejects((value) => (value.details.title = '   ', value), /title/i);
rejects((value) => (value.choices[0].values[0].retired = 'false', value), /retired/i);
rejects((value) => (value.existingImages[0].remove = 0, value), /remove/i);

const source = fs.readFileSync(file, 'utf8');
assert(!/\b(?:Color|Size)\b/.test(source), 'editor contract must remain generic');
assert.equal(source.includes('toLocaleLowerCase'), false, 'normalization must not depend on process locale');
assert.equal('PRODUCT_EDITOR_COMMAND_KINDS' in editor, false, 'wrong command model must be removed');

const collision = {
  details: { title: 'Collision', price: 1, description: '' },
  choices: [
    { key: 'left', name: 'Left', values: [
      { key: 'a:b', label: 'A colon B', retired: false },
      { key: 'a', label: 'A', retired: false },
    ] },
    { key: 'right', name: 'Right', values: [
      { key: 'c', label: 'C', retired: false },
      { key: 'b:c', label: 'B colon C', retired: false },
    ] },
  ],
  combinations: [
    { valueKeys: ['a:b', 'c'], price: 1, inventory: 1 },
    { valueKeys: ['a', 'b:c'], price: 2, inventory: 2 },
  ],
  existingImages: [],
};
assert.equal(editor.normalizeProductEditorSpec(collision).combinations.length, 2,
  'JSON tuple keys must distinguish colon-containing value keys');
console.log('Product editor semantic contract check passed');
