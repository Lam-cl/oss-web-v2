const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pagePath = path.join(root, 'src/app/admin/products/page.tsx');
const source = fs.readFileSync(pagePath, 'utf8');

assert.match(source, /import UnifiedProductEditor(?:\s*,\s*\{[^}]*\})? from ['"]@\/components\/admin\/UnifiedProductEditor['"];/, 'products page must import the unified editor');
assert.match(source, /useCatalogueProductEditor\(/, 'migrated catalogue records must use the catalogue editor hook');
assert.match(source, /\/admin-api\/catalogue-products/, 'products page must discover catalogue records from the public frontend admin alias');
assert.match(source, /currentBundleProductId/, 'catalogue records must be matched to legacy list rows by their returned published product identity');
assert.match(source, /product\.catalogueId/, 'the editor must open the catalogue ID returned by the catalogue API');
assert.match(source, /<UnifiedProductEditor[\s\S]*?onSave=\{async \(intent\) => \{[\s\S]*?await save\(catalogueContentIntent\(intent, product!\.model, inventory\?\.inventory \?\? \[\]\)\)/, 'existing catalogue content edits reconcile current bindings while preserving operational live inventory');
assert.match(source, /editorKey=\{catalogueId\}/, 'existing editor must identify the controlled product by catalogue ID');
assert.match(source, /editorKey="new-product"/, 'new-product editor must use a stable identity key');
assert.match(source, /availableCategories = useMemo\([\s\S]*?product\.model\.details\.category/, 'Products page must derive category options from saved Catalogue products');
assert.match(source, /<CreateCatalogueEditor availableCategories=\{availableCategories\}/, 'new editor receives saved categories');
assert.match(source, /<ExistingCatalogueEditor[\s\S]*?availableCategories=\{availableCategories\}/, 'existing editor receives saved categories');
assert.match(source, /intent\.inventoryChanges\.length[\s\S]*?method:\s*['"]PATCH['"][\s\S]*?setPendingPhotos\(\[\]\);\s*onSaved\(\);/, 'successful existing save applies explicit live stock changes before closing');
assert.match(source, /catalogueRequest<\{ product: CatalogueProductRecord \}>[\s\S]*?method:\s*['"]POST['"]/, 'new products must be created through the catalogue collection and use its returned record');
assert.doesNotMatch(source, /ProductDrawer/, 'the fragmented legacy editor must not remain an entry point');
assert.doesNotMatch(source, /soft-delete|Soft delete|Soft-delete/, 'destructive legacy product actions must not remain on this page');
assert.match(source, /View legacy product/, 'unmigrated legacy products must retain a safe view-only path');
assert.match(source, /Add product/, 'the page must expose one clear add-product entry point');
assert.match(source, /onCreated=\{\(\) => \{[\s\S]*?history\.replaceState\(null, '', '\/admin\/products'\)[\s\S]*?setEditor\(undefined\)[\s\S]*?Product added successfully\.[\s\S]*?void load\(\)/, 'successful creation must close the editor, clear the create URL, refresh the list, and show confirmation');
assert.doesNotMatch(source, /onCreated=\{\(product[^)]*\) =>/, 'successful creation must not leave the admin inside the same editor');
assert.match(source, /onSaved=\{\(\) => \{[\s\S]*?history\.replaceState\(null, '', '\/admin\/products'\)[\s\S]*?setEditor\(undefined\)[\s\S]*?Product saved\.[\s\S]*?void load\(\)/, 'successful existing save must normalize the URL, close the editor, preserve confirmation, and refresh the list');
assert.match(source, /Edit product/, 'migrated rows must expose one clear edit-product entry point');
assert.match(source, /canPublishCatalogueProduct\(row\.catalogue, catalogueMedia\[row\.catalogue\.catalogueId\]\)/, 'Publish must only be offered after the draft model and saved media are confirmed ready');
assert.match(source, /row\.catalogue\.status === ['"]draft['"][\s\S]*?row\.catalogue\.currentBundleProductId === null/, 'published Catalogue rows must not offer Publish');
assert.match(source, /catalogueRequest[\s\S]*?encodeURIComponent\(product\.catalogueId\)[\s\S]*?\/publish[\s\S]*?method:\s*['"]POST['"][\s\S]*?JSON\.stringify\(\{ revision: product\.revision \}\)/, 'Publish must call the exact same-origin Catalogue publish route with the current revision');
assert.match(source, /if \(publishingCatalogueIdRef\.current\) return;[\s\S]*?publishingCatalogueIdRef\.current = product\.catalogueId;[\s\S]*?setPublishingCatalogueId\(product\.catalogueId\)/, 'Publish must synchronously block duplicate clicks before React re-renders');
assert.match(source, /disabled=\{!canPublish \|\| publishHazardDisabled \|\| publishingCatalogueId !== null \|\| archivingCatalogueId !== null\}/, 'Publish controls must remain disabled when unready, hazardous, publishing, or archiving');
assert.match(source, /disabled=\{archiveHazardDisabled \|\| archivingCatalogueId !== null \|\| publishingCatalogueId !== null\}/, 'Archive remains disabled while provider recovery is pending or another lifecycle action is active');
assert.match(source, /Publishing…/, 'the active Publish action must show clear progress');
assert.match(source, /await load\(\);[\s\S]*?Product published successfully\. It is now visible in OSS\./, 'successful publication must refresh the list before showing the OSS confirmation');
assert.match(source, /The product could not be published\. Please review it and try again\./, 'publication failures must show a safe operator-facing error');
assert.match(source, /title=\{publishHazardReason \|\| `\$\{publishLabel\} for \$\{title\} to OSS`\}[\s\S]*?aria-label=\{`\$\{publishLabel\} for \$\{title\} to OSS`\}[\s\S]*?aria-describedby=\{publishHazardReason \? publishHazardReasonId : undefined\}/, 'Publish must retain its clear label while exposing the visible disabled reason through title and aria-describedby');
assert.equal((source.match(/\/publish`/g) || []).length, 1, 'saving and editing must never auto-publish');
const presentationSource = fs.readFileSync(path.join(root, 'src/app/admin/products/productPresentation.ts'), 'utf8');
const presentationOutput = require('typescript').transpileModule(presentationSource, { compilerOptions: { module: require('typescript').ModuleKind.CommonJS, target: require('typescript').ScriptTarget.ES2022 } }).outputText;
const presentation = { exports: {} };
new Function('exports', 'require', 'module', presentationOutput)(presentation.exports, require, presentation);
const dirtyAction = presentation.exports.publicationActionPresentation({ state: 'dirty', localDraft: false, simManaged: false });
assert.deepEqual(dirtyAction, { visible: true, label: 'Publish changes', disabledReason: null }, 'verified dirty evidence exposes replacement publication');
assert.deepEqual(presentation.exports.publicationActionPresentation({ state: 'clean', localDraft: false, simManaged: false }), { visible: false }, 'verified clean evidence hides publication');
assert.equal(presentation.exports.publicationActionPresentation({ state: 'unknown', localDraft: false, simManaged: false }).disabledReason.length > 0, true, 'unknown evidence stays visible but disabled with a reason');
const shirtChoices = [
  { name: 'Color', values: Array.from({ length: 4 }, (_, index) => ({ key: `color-${index}` })) },
  { name: 'Size', values: Array.from({ length: 9 }, (_, index) => ({ key: `size-${index}` })) },
];
const shirtCombinations = shirtChoices[0].values.flatMap((color) => shirtChoices[1].values.map((size) => ({ valueKeys: [color.key, size.key] })));
assert.deepEqual(presentation.exports.catalogueChoiceSummary({ choices: shirtChoices, combinations: shirtCombinations }), {
  primary: 'Color 4 · Size 9', secondary: '36 combinations', incomplete: false,
}, 'shirt rows explain both choice dimensions while retaining the real Bundle combination count');
assert.deepEqual(presentation.exports.catalogueChoiceSummary({ choices: shirtChoices, combinations: shirtCombinations.slice(0, 35) }), {
  primary: 'Color 4 · Size 9', secondary: '35 of 36 combinations', incomplete: true,
}, 'an incomplete Cartesian matrix is visible instead of being disguised as a valid count');
assert.match(source, /encodeURIComponent\(product\.catalogueId\)\}\/archive`[\s\S]*?JSON\.stringify\(\{ revision: product\.revision \}\)/, 'Archive must call the exact revision-aware Catalogue route');
assert.match(source, /Archive \$\{title\}/, 'draft Catalogue rows must expose an Archive action');
assert.match(source, /Product archived successfully\./, 'successful archive must refresh the list and confirm removal');
assert.match(source, /Unpublish \$\{title\}/, 'published Catalogue rows must unpublish before archive');
assert.match(source, /window\.confirm\(`Archive/, 'Archive must require explicit confirmation');
assert.doesNotMatch(source, /method:\s*['"]DELETE['"]/, 'Catalogue UI must not permanently delete products');
assert.doesNotMatch(source, />\s*(?:Save changes|Create product|Save product)\s*</, 'the page must not add a second save control beside the unified editor');

console.log('Unified Product Editor admin integration check passed');
