const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    module.exports,
    require,
    module,
    file,
    path.dirname(file),
  );
  return module.exports;
}

const bundle = load('src/lib/admin/productBundleState.ts');
const left = {
  data: {
    updatedAt: 'volatile',
    requestId: 'ignore-me',
    title: 'Shirt',
    id: '7',
    price: '19.90',
    categories: [{ name: '["Apparel"' }, { name: '"Sale"]' }],
    tags: ['Tone Wow', 'sale'],
    images: [
      { id: '2', order: '2', url: 'b.jpg', signedUrl: 'volatile' },
      { id: 1, order: 1, url: 'a.jpg' },
    ],
    options: [{
      id: 10,
      order: 1,
      name: 'Finish',
      values: [
        { id: 101, order: 2, value: 'Gloss' },
        { id: 100, order: 1, value: 'Matte' },
      ],
    }],
    productVariants: [
      { id: '12', price: '19.90', inventory: '3', sku: 'BLUE', selectedOptions: [] },
      {
        id: 11,
        price: 19.9,
        inventory: 2,
        sku: 'RED',
        selectedOptions: [{ optionName: 'Finish', optionValue: 'Matte' }],
      },
    ],
  },
};
const right = {
  title: 'Shirt',
  id: 7,
  price: 19.9,
  categories: ['Sale', 'Apparel'],
  tags: ['sale', 'Tone Wow'],
  images: [
    { url: 'a.jpg', order: 1, id: 1, unknown: 'x' },
    { url: 'b.jpg', order: 2, id: 2 },
  ],
  options: [{
    name: 'Finish',
    id: 10,
    order: 1,
    values: [
      { value: 'Matte', id: 100, order: 1 },
      { value: 'Gloss', id: 101, order: 2 },
    ],
  }],
  productVariants: [
    {
      sku: 'RED',
      inventory: 2,
      price: 19.9,
      id: 11,
      selectedOptions: [{ optionValue: 'Matte', optionName: 'Finish' }],
    },
    { sku: 'BLUE', inventory: 3, price: 19.9, id: 12, selectedOptions: [] },
  ],
  unknownTopLevel: { random: true },
  updatedAt: 'later',
};

const normalized = bundle.normalizeBundleProduct(left);
assert.equal(normalized.id, 7);
assert.deepEqual(normalized.categories, ['Apparel', 'Sale']);
assert.deepEqual(
  normalized.productVariants.find((variant) => variant.id === 12).selectedOptions,
  [],
  'empty selectedOptions is semantic and must survive',
);
assert.equal('requestId' in normalized, false);
assert.equal('signedUrl' in normalized.images[1], false);

const fingerprint = bundle.fingerprintBundleProduct(left);
assert.match(fingerprint, /^[a-f0-9]{64}$/);
assert.equal(
  fingerprint,
  bundle.fingerprintBundleProduct(right),
  'allowlisted semantic state must be permutation deterministic',
);
assert.notEqual(fingerprint, bundle.fingerprintBundleProduct({ ...right, price: 20 }));
assert.notEqual(
  fingerprint,
  bundle.fingerprintBundleProduct({
    ...right,
    images: [{ url: 'a.jpg', order: 2, id: 1 }, { url: 'b.jpg', order: 1, id: 2 }],
  }),
);

const nestedSelectionProduct = {
  ...right,
  productVariants: [{
    ...right.productVariants[0],
    selectedOptions: [{
      productOptionValue: { id: 100, value: 'Matte', productOption: { id: 10, name: 'Finish' } },
    }],
  }, right.productVariants[1]],
};
assert.deepEqual(
  bundle.normalizeBundleProduct(right).productVariants[0].selectedOptions,
  bundle.normalizeBundleProduct(nestedSelectionProduct).productVariants[0].selectedOptions,
  'equivalent flat and nested selected options must share one canonical representation',
);
assert.equal(
  bundle.fingerprintBundleProduct(right),
  bundle.fingerprintBundleProduct(nestedSelectionProduct),
  'equivalent flat and nested selected options must share one fingerprint',
);
assert.throws(
  () => bundle.normalizeBundleProduct({
    ...right,
    productVariants: [{
      ...right.productVariants[0],
      selectedOptions: [{
        optionName: 'Finish',
        optionValue: 'Matte',
        productOptionValue: { id: 101, value: 'Gloss', productOption: { id: 10, name: 'Finish' } },
      }],
    }, right.productVariants[1]],
  }),
  /conflicting.*selected option aliases/i,
  'conflicting value aliases for one selected option must be rejected',
);

for (const unsafeString of ['9007199254740992', '9007199254740992.0', '0.10000000000000001']) {
  const numericValue = Number(unsafeString);
  assert.equal(
    bundle.normalizeBundleProduct({ ...right, price: unsafeString }).price,
    unsafeString,
    `${unsafeString} must remain a string`,
  );
  assert.notEqual(
    bundle.fingerprintBundleProduct({ ...right, price: unsafeString }),
    bundle.fingerprintBundleProduct({ ...right, price: numericValue }),
    `${unsafeString} must not collide with ${numericValue}`,
  );
}
assert.equal(bundle.normalizeBundleProduct({ ...right, price: '19.90' }).price, 19.9);

for (const nonFinite of [NaN, Infinity, -Infinity]) {
  assert.throws(
    () => bundle.normalizeBundleProduct({ ...right, price: nonFinite }),
    /finite/i,
    'non-finite numeric inputs must be rejected',
  );
}

const permutations = [['I', 'ı', 'i', 'İ'], ['é', 'e', 'É', 'E']];
for (const tags of permutations) {
  assert.equal(
    bundle.fingerprintBundleProduct({ ...right, tags }),
    bundle.fingerprintBundleProduct({ ...right, tags: [...tags].reverse() }),
    'ordering must not depend on input permutation or locale',
  );
}

const duplicates = [
  { ...right, images: [...right.images, { id: 1, order: 3, url: 'duplicate.jpg' }] },
  { ...right, options: [...right.options, { id: 10, name: 'Other', values: [] }] },
  {
    ...right,
    options: [{
      ...right.options[0],
      values: [...right.options[0].values, { id: 100, value: 'Duplicate' }],
    }],
  },
  {
    ...right,
    options: [
      right.options[0],
      { id: 20, name: 'Pack', values: [{ id: 100, value: 'Duplicate across choices' }] },
    ],
  },
  {
    ...right,
    productVariants: [...right.productVariants, { id: 11, sku: 'DUP', selectedOptions: [] }],
  },
  {
    ...right,
    productVariants: [{
      ...right.productVariants[0],
      selectedOptions: [
        { optionName: 'Finish', optionValue: 'Matte' },
        { optionName: 'Finish', optionValue: 'Matte' },
      ],
    }, right.productVariants[1]],
  },
  {
    ...right,
    productVariants: [{
      ...right.productVariants[0],
      selectedOptions: [
        { optionName: 'Finish', optionValue: 'Matte' },
        { optionName: 'Finish', optionValue: 'Gloss' },
      ],
    }, right.productVariants[1]],
  },
];
for (const duplicate of duplicates) {
  assert.throws(() => bundle.normalizeBundleProduct(duplicate), /duplicate/i);
}

const imageDigestDrift = structuredClone(right);
imageDigestDrift.images[0].sha256 = 'f'.repeat(64);
assert.notEqual(
  bundle.fingerprintBundleProduct(right),
  bundle.fingerprintBundleProduct(imageDigestDrift),
  'provider image byte digest must be part of the structural CAS fingerprint',
);

assert.throws(
  () => bundle.normalizeBundleProduct({
    ...right,
    productVariants: [{
      ...right.productVariants[0],
      selectedOptions: [
        { optionName: 'Finish', optionValue: 'Matte' },
        { productOptionValue: { id: 100, value: 'Matte', productOption: { id: 10, name: 'Finish' } } },
      ],
    }, right.productVariants[1]],
  }),
  /duplicate.*selected option/i,
  'alternate aliases for one product option must canonicalize to one relationship',
);
for (const selectedOption of [
  {
    optionName: 'Pack',
    optionValue: 'Matte',
    productOptionValue: { id: 100, value: 'Matte', productOption: { id: 10, name: 'Finish' } },
  },
  { productOptionValue: { id: 100, value: 'Matte', productOption: { id: 10, name: 'Pack' } } },
]) {
  assert.throws(
    () => bundle.normalizeBundleProduct({
      ...right,
      productVariants: [{ ...right.productVariants[0], selectedOptions: [selectedOption] }, right.productVariants[1]],
    }),
    /conflicting.*option alias/i,
  );
}

const malformedEntities = [
  [{ ...right, images: 'bad' }, /images.*array/i],
  [{ ...right, images: undefined }, /images.*array/i],
  [{ ...right, images: [{ url: 'missing-id.jpg' }] }, /image.*positive safe integer ID/i],
  [{ ...right, images: ['bad'] }, /image.*object/i],
  [{ ...right, options: 'bad' }, /options.*array/i],
  [{ ...right, options: [{ name: 'Missing ID', values: [] }] }, /option.*positive safe integer ID/i],
  [{ ...right, options: ['bad'] }, /option.*object/i],
  [{ ...right, options: [{ ...right.options[0], values: 'bad' }] }, /values.*array/i],
  [{ ...right, options: [{ ...right.options[0], values: undefined }] }, /values.*array/i],
  [{ ...right, options: [{ ...right.options[0], values: [{ value: 'Missing ID' }] }] }, /value.*positive safe integer ID/i],
  [{ ...right, options: [{ ...right.options[0], values: ['bad'] }] }, /value.*object/i],
  [{ ...right, productVariants: 'bad' }, /product.?variants.*array/i],
  [{ ...right, productVariants: [{ sku: 'missing-id' }] }, /variant.*positive safe integer ID/i],
  [{ ...right, productVariants: ['bad'] }, /variant.*object/i],
  [{ ...right, productVariants: [{ ...right.productVariants[0], selectedOptions: 'bad' }] }, /selected.?options.*array/i],
  [{ ...right, productVariants: [{ ...right.productVariants[0], selectedOptions: undefined }] }, /selected.?options.*array/i],
  [{ ...right, productVariants: [{ ...right.productVariants[0], selectedOptions: ['bad'] }] }, /selected option.*object/i],
];
for (const [malformed, message] of malformedEntities) {
  assert.throws(() => bundle.normalizeBundleProduct(malformed), message);
}

assert.throws(() => bundle.normalizeBundleProduct(null), /valid Bundle product/);
assert.throws(() => bundle.normalizeBundleProduct({ data: [] }), /valid Bundle product/);
console.log('Product Bundle state check passed');
