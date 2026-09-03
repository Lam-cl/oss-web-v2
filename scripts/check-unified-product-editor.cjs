const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const componentPath = path.join(root, 'src/components/admin/UnifiedProductEditor.tsx');
const normalizerPath = path.join(root, 'src/lib/admin/productEditor.ts');
const productDescriptionPath = path.join(root, 'src/lib/productDescription.ts');
const variantBindingsPath = path.join(root, 'src/lib/admin/catalogueVariantBindings.ts');
const cssPath = path.join(root, 'src/components/admin/UnifiedProductEditor.module.css');

function loadTypescript(file, stubs = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  const originalLoad = Module._load;
  require.extensions['.css'] = (cssModule) => { cssModule.exports = new Proxy({}, { get: (_target, key) => String(key) }); };
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(output, file); } finally { Module._load = originalLoad; }
  return loaded.exports;
}

const normalizer = loadTypescript(normalizerPath);
const productDescription = loadTypescript(productDescriptionPath);
const variantBindings = loadTypescript(variantBindingsPath, {
  '@/lib/admin/productEditor': normalizer,
});
const component = loadTypescript(componentPath, {
  '@/lib/admin/productEditor': normalizer,
  '@/lib/admin/catalogueVariantBindings': variantBindings,
  '@/lib/productDescription': productDescription,
  react: {
    useEffect() {},
    useMemo(factory) { return factory(); },
    useRef(value) { return { current: value }; },
    useState(value) { return [typeof value === 'function' ? value() : value, () => {}]; },
  },
  'react/jsx-runtime': { jsx() {}, jsxs() {}, Fragment: Symbol('Fragment') },
});
const source = fs.readFileSync(componentPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

assert.deepEqual(component.mergeProductCategories(['Testing', 'testing', ' Event Kit ']),
  ['Apparel', 'Bottles', 'Marketing Material', 'Stationary', 'SIM Card', 'Testing', 'Event Kit'],
  'saved custom categories must be reusable and deduplicated case-insensitively');

const base = {
  details: { title: ' Shirt ', price: 10, description: ' Cotton ', category: ' Apparel ' },
  choices: [
    { key: 'choice-color', optionId: 11, name: 'Color', values: [
      { key: 'value-red', valueId: 21, label: 'Red', retired: false },
      { key: 'value-blue', valueId: 22, label: 'Blue', retired: false },
    ] },
    { key: 'choice-size', optionId: 12, name: 'Size', values: [
      { key: 'value-s', valueId: 31, label: 'S', retired: false },
      { key: 'value-m', valueId: 32, label: 'M', retired: false },
      { key: 'value-l', valueId: 33, label: 'L', retired: false },
    ] },
  ],
  combinations: [
    { valueKeys: ['value-red', 'value-s'], variantId: 101, sku: 'RED-S', price: 11, inventory: 4 },
    { valueKeys: ['value-red', 'value-m'], variantId: 102, sku: 'RED-M', price: 12, inventory: 5 },
    { valueKeys: ['value-red', 'value-l'], variantId: 103, sku: 'RED-L', price: 13, inventory: 6 },
    { valueKeys: ['value-blue', 'value-s'], variantId: 104, sku: 'BLUE-S', price: 14, inventory: 7 },
    { valueKeys: ['value-blue', 'value-m'], variantId: 105, sku: 'BLUE-M', price: 15, inventory: 8 },
    { valueKeys: ['value-blue', 'value-l'], variantId: 106, sku: 'BLUE-L', price: 16, inventory: 9 },
  ],
  existingImages: [],
};
const clone = (value) => structuredClone(value);

assert.match(component.validateProductEditorDraft({ ...clone(base), choices: [{ key: 'empty', name: 'Material', values: [] }] }) || '', /value/i,
  'an empty choice must make the draft invalid');
assert.match(component.validateProductEditorDraft({ ...clone(base), choices: [
  { key: 'a', name: ' Color ', values: [{ key: 'x', label: 'Red', retired: false }] },
  { key: 'b', name: 'color', values: [{ key: 'y', label: 'S', retired: false }] },
] }) || '', /different|duplicate|unique/i, 'trimmed duplicate choice names must be invalid');
assert.match(component.validateProductEditorDraft({ ...clone(base), choices: [
  { key: 'a', name: 'Color', values: [{ key: 'x', label: ' Red ', retired: false }, { key: 'y', label: 'red', retired: false }] },
] }) || '', /different|duplicate|unique/i, 'trimmed duplicate labels must be invalid');

const photos = [
  { key: 'existing-1', kind: 'existing', imageId: 1, mediaId: 'media-1', url: '/one.jpg', alt: '', assignment: 'value-red', removed: false },
  { key: 'existing-2', kind: 'existing', imageId: 2, mediaId: 'media-2', url: '/two.jpg', alt: '', assignment: 'all', removed: true },
  { key: 'pending-1', kind: 'pending', file: { name: 'three.jpg' }, url: '/three.jpg', alt: '', assignment: 'value-red', removed: false },
];
const retired = component.toggleValueRetirement(clone(base), photos, 'choice-color', 'value-red');
assert.deepEqual(retired.model.combinations, base.combinations, 'retiring a value must preserve every combination field exactly');
assert.deepEqual(retired.photos.map((photo) => photo.assignment), ['all', 'all', 'all'], 'retiring a value must reassign its photos to General');
const restored = component.toggleValueRetirement(retired.model, retired.photos, 'choice-color', 'value-red');
assert.deepEqual(restored.model.combinations, base.combinations, 'Undo must restore the exact variant IDs, SKUs, prices, and inventory');

assert.deepEqual(component.visiblePhotoRows(photos).map((photo) => photo.key), ['existing-1', 'pending-1'],
  'removed photos must not participate in visible cover ordering');
assert.equal(component.visiblePhotoRows(photos)[0].url, '/one.jpg', 'preview and cover must use the first visible photo');

const defaultVariantPrice = component.reconcileCombinations({
  details: { title: 'Cap', price: 12.5, description: '' },
  choices: [{ key: 'color', name: 'Color', values: [
    { key: 'red', label: 'Red', retired: false },
    { key: 'orange', label: 'Orange', retired: false },
  ] }],
  combinations: [{ valueKeys: [], variantId: 999, sku: 'STANDARD', price: 99, inventory: 42 }],
  existingImages: [],
});
assert.deepEqual(defaultVariantPrice.combinations, [
  { valueKeys: ['red'], price: 12.5, inventory: 0 },
  { valueKeys: ['orange'], price: 12.5, inventory: 0 },
], 'every new choice combination must start at Base price and zero stock without copied identity or SKU');

const expanded = component.reconcileCombinations({
  ...clone(base),
  choices: [
    base.choices[0],
    { ...base.choices[1], values: [...base.choices[1].values, { key: 'value-xl', label: 'XL', retired: false }] },
  ],
});
assert.deepEqual(expanded.combinations.find((combination) => combination.valueKeys.join('|') === 'value-red|value-s'), base.combinations[0],
  'an exact existing combination must be preserved byte-for-byte');
assert.deepEqual(expanded.combinations.find((combination) => combination.valueKeys.join('|') === 'value-red|value-xl'),
  { valueKeys: ['value-red', 'value-xl'], price: 10, inventory: 0 },
  'choice expansion must not inherit SKU, variant ID, price, or inventory from an ancestor');

const standardAfterFinalChoice = component.removeChoiceFromModel({
  details: { title: 'Cap', price: 12.5, description: '' },
  choices: [{ key: 'color', name: 'Color', values: [{ key: 'red', label: 'Red', retired: false }] }],
  combinations: [{ valueKeys: ['red'], variantId: 20, sku: 'RED', price: 18, inventory: 7 }],
  existingImages: [],
}, 'color');
assert.deepEqual(standardAfterFinalChoice.combinations, [{ valueKeys: [], price: 12.5, inventory: 0 }],
  'removing the final choice must create one conservative no-choice combination without identity or SKU');
const preservedStandardStock = component.removeChoiceFromModel({
  ...standardAfterFinalChoice,
  choices: [{ key: 'color', name: 'Color', values: [{ key: 'red', label: 'Red', retired: false }] }],
  combinations: [
    { valueKeys: [], variantId: 10, sku: 'OLD', price: 8, inventory: 3 },
    { valueKeys: ['red'], variantId: 20, sku: 'RED', price: 18, inventory: 7 },
  ],
}, 'color');
assert.deepEqual(preservedStandardStock.combinations, [{ valueKeys: [], price: 12.5, inventory: 3 }],
  'a pre-existing no-choice row may contribute stock only when the final choice is removed');

const emptyNumericFields = new Set(['base-price']);
assert.equal(component.validateProductEditorDraft(clone(base), undefined, emptyNumericFields), 'Base price is required.',
  'clearing base price must identify the exact missing field');
assert.equal(component.validateProductEditorDraft(clone(base), undefined, new Set(['inventory:value-red|value-m'])), 'Stock for Red / M is required.',
  'clearing Lanyard-style variant stock must identify the exact combination');
assert.equal(component.friendlySpecError(new Error('Combination inventory must be a nonnegative safe integer.')),
  'Combination inventory must be a nonnegative safe integer.', 'server stock validation must remain actionable in the UI');
const explicitZero = clone(base);
explicitZero.details.price = 0;
explicitZero.combinations = explicitZero.combinations.map((combination) => ({ ...combination, price: 0, inventory: 0 }));
assert.equal(component.validateProductEditorDraft(explicitZero, undefined, new Set()), null,
  'an explicitly entered zero remains a valid numeric value');


const matrix = component.buildStockMatrix(base);
assert.equal(matrix.rows.length, 2, 'matrix rows must match first choice active values');
assert.equal(matrix.columns.length, 3, 'matrix columns must match second choice active values');
assert.equal(matrix.cells.length, 2);
assert.equal(matrix.cells[0].length, 3);
assert.equal(matrix.cells[0][2].combination.inventory, 6, 'matrix cell must resolve the semantic combination');

const intent = component.buildSaveIntent(clone(base), photos, normalizer.normalizeProductEditorSpec);
assert.equal(intent.spec.details.title, 'Shirt');
assert.equal(intent.spec.details.category, 'Apparel', 'save must normalize trimmed category');
assert.equal(intent.spec.combinations[0].variantId, 101, 'normalized save must preserve variant identity');
assert.deepEqual(intent.spec.existingImages, [
  { imageId: 1, order: 0, assignment: 'value-red', remove: false },
  { imageId: 2, order: 2, assignment: 'all', remove: true },
]);
assert.equal(intent.pendingPhotos.length, 1);
assert.equal(intent.pendingPhotos[0].order, 1, 'removed rows must not consume a saved media order');
assert.deepEqual(intent.existingMedia.filter(({ remove }) => !remove).map(({ order, remove }) => ({ order, remove })), [
  { order: 0, remove: false },
], 'surviving existing media starts the contiguous zero-based order');
assert.equal(intent.existingMedia.find(({ remove }) => remove).order, 2,
  'removed media is ordered outside the contiguous saved set and does not consume its order');

const photoControlledModel = {
  ...clone(base),
  existingImages: [{ imageId: 1, order: 0, assignment: 'missing-value', remove: false }],
};
assert.equal(component.validateProductEditorDraft(photoControlledModel, photos), null,
  'validation must use controlled photo rows rather than stale image metadata in the model');

for (const prop of ['model:', 'onModelChange:', 'onPhotosChange:', 'onSave:']) assert.ok(source.includes(prop), `controlled prop ${prop} is required`);
assert.doesNotMatch(source, /initialModel/, 'controlled editor must not retain an initialModel contract');
assert.doesNotMatch(source, /useState\([^\n]*(?:model|photos)/i, 'model and photos must not be internal persistent state');
assert.match(source, /<table/, 'two-choice stock UI must use a semantic table');
assert.match(source, /<th/, 'stock matrix must have table headers');
assert.match(source, /optionId[^\n]*disabled|disabled[^\n]*optionId/, 'existing choice names must be read-only');
assert.ok(source.includes('valueId'), 'existing value identity must be respected');
assert.match(source, /editorKey:\s*string/, 'controlled editor requires an explicit product identity key');
assert.match(source, /\}, \[editorKey\]\);/, 'local drafts reset only when the explicit product identity changes');
assert.doesNotMatch(source, /productDraftResetKey|lastLocalResetKey/, 'model-content fingerprint heuristics must not control product identity');
assert.match(source, /emptyNumericFields/, 'cleared numeric drafts must participate in save validation');
assert.match(source, /URL\.revokeObjectURL/, 'pending photo object URLs must be revoked');
assert.ok(source.includes("value.retired ? 'Undo' : 'Hide'"), 'choice actions must use Hide and Undo wording');
assert.ok(!source.includes('Hide removes a value from the storefront'), 'no unsolicited choice helper copy is added');
assert.doesNotMatch(source, />Retire<|Undo retirement of|retired value/i,
  'internal retired terminology must not leak into user-facing copy');
assert.doesNotMatch(source.slice(source.indexOf('export type UnifiedProductEditorProps')), /\b(?:fetch|adminFetch|Bundle|API)\b/, 'isolated editor component must not mention transport or backend concepts');
assert.ok(css.includes('@media (max-width: 640px)'), 'mobile composition breakpoint is required');
assert.match(css, /overflow-x:\s*auto/, 'mobile stock matrix must scroll horizontally');
assert.match(css, /position:\s*sticky/, 'matrix labels and save bar need sticky behavior');
const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
assert.doesNotMatch(mobile, /saveBar\s*>\s*div:first-child\s*\{[^}]*display:\s*none/s, 'mobile must not hide aria-live errors');
assert.match(mobile, /neutralHelper[^}]*display:\s*none/s, 'mobile may hide only neutral helper copy');
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'reduced-motion support is required');
assert.ok(css.includes(':focus-visible'), 'visible keyboard focus is required');

console.log('Unified Product Editor behavioral contract: PASS');
