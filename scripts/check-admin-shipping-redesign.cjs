const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('src/app/admin/shipping/page.tsx', 'utf8');
const css = fs.readFileSync('src/app/admin/admin.css', 'utf8');

assert.match(page, /Shipping settings/);
assert.match(page, /Needs assignment \(\{needsAction\.length\}\)/);
assert.match(page, /Assigned products \(\{completed\.length\}\)/);
assert.match(page, /No shipping required/);
assert.doesNotMatch(page, /assignProduct|courier group saved/i, 'product assignment must not auto-save');
assert.match(page, /beforeunload/);
assert.match(page, /addEventListener\('click', warnNavigation, true\)/, 'client-side navigation must warn while dirty');
assert.match(page, /const warnHistory = \(event: PopStateEvent\) =>/, 'history guard must inspect the destination state');
assert.match(page, /shippingHistoryPosition/, 'history entries must carry a stable position');
assert.match(page, /history\.go\(decision\.delta\)/, 'cancelled marked Back or Forward navigation must restore in the correct direction');
assert.match(page, /history\.pushState\(guarded\.state, '', guarded\.url\)/, 'cancelled unmarked navigation must restore the guarded entry without reload');
assert.doesNotMatch(page, /location\.reload\(/, 'unmarked history navigation must never reload and discard the draft');
assert.doesNotMatch(page, /history\.(?:back|forward)\(\)/, 'history guard must not assume Back navigation');
assert.match(page, /addEventListener\('popstate', warnHistory\)/, 'browser history navigation must warn while dirty');
assert.match(page, /<fieldset[^>]+disabled=\{saving\}/, 'all mutation controls must be disabled atomically while saving');
assert.match(page, /adminFetch<ShippingSettings>\('shipping-settings'\)[\s\S]+mergeChangedSettings\(savedSettings, settings, fresh\)[\s\S]+method: 'PUT'/, 'save must merge draft changes into fresh settings immediately before PUT');
assert.match(page, /loadedProducts\.meta\?\.totalPages/, 'all product pages must be loaded from pagination metadata');
assert.match(page, /aria-describedby=\{[^}]+\?[^:]+: undefined\}/, 'invalid inputs must reference their inline errors');
assert.match(page, /id=\{`\$\{[^}]+\}-error`\}[^>]+role="alert"/, 'inline errors need stable IDs and announcements');
assert.match(page, /Review and save/);
assert.match(page, /Product assignments:.*Shipping rates and labels:.*Mixed-order priority:/s, 'save review must summarize each change category');
assert.match(page, /<details[^>]+name="shipping-rates"[^>]+className="ship-disclosure ship-rate-group"/, 'rate details must use native exclusive accordion grouping');
assert.match(page, /Mixed-order rules \(Advanced\)/);
assert.match(page, /aria-label=\{`Move .* up`\}/);
assert.match(page, /aria-label=\{`Delete tier/);
assert.match(page, /\$\{tier\.minimum\}\+ units/);
assert.match(page, /Free/);
assert.match(page, /validateSettings/);
assert.match(css, /\.ship-dirty-bar/);
assert.match(css, /@media\(max-width:680px\).*\.ship-dirty-bar/s);
assert.match(css, /\.ship-search input,\.ship-product-row select\{min-height:44px\}/, 'mobile shipping inputs and selects need 44px touch targets');
assert.match(css, /@media\(max-width:680px\)\{\.adm-actions \.adm-icon-btn\{width:44px;height:44px\}\}/, 'mobile admin edit actions need 44px touch targets');

const historyHelperSource = page.match(/(function historyNavigationDecision[\s\S]*?\n})\nfunction mergeChangedSettings/)?.[1];
assert.ok(historyHelperSource, 'history decision helper must remain executable in the focused check');
const ts = require('typescript');
const historyModule = { exports: {} };
new Function('exports', 'module', 'require', ts.transpileModule(
  `export ${historyHelperSource}`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText)(historyModule.exports, historyModule, require);
const historyNavigationDecision = historyModule.exports.historyNavigationDecision;
assert.deepEqual(historyNavigationDecision(8, 7, false), { type: 'go', delta: 1 }, 'cancelled Back restores forward');
assert.deepEqual(historyNavigationDecision(8, 10, false), { type: 'go', delta: -2 }, 'cancelled Forward restores backward');
assert.deepEqual(historyNavigationDecision(8, undefined, false), { type: 'restore' }, 'cancelled unmarked navigation restores the guarded URL/state');
assert.deepEqual(historyNavigationDecision(8, undefined, true), { type: 'allow' }, 'confirmed unmarked navigation is allowed');

const helperSource = page.match(/(function mergeChangedSettings[\s\S]*?\n})\nfunction changeSummary/)?.[1];
assert.ok(helperSource, 'merge helper must remain executable in the focused check');
const helperModule = { exports: {} };
new Function('exports', 'module', 'require', ts.transpileModule(
  `const COURIER_GROUPS = ['shirt', 'bulky', 'small', 'flyers', 'sim'];\nconst GROUP_LABELS = { shirt: 'T-shirt', bulky: 'Water bottle, tumbler or bunting', small: 'Small items', flyers: 'Flyers', sim: 'SIM card' };\nexport ${helperSource}`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText)(helperModule.exports, helperModule, require);
const mergeChangedSettings = helperModule.exports.mergeChangedSettings;
const settings = () => ({
  productGroups: { 1: 'shirt' }, priority: ['shirt', 'bulky', 'small', 'flyers', 'sim'],
  groups: Object.fromEntries(['shirt', 'bulky', 'small', 'flyers', 'sim'].map((group) => [group, { label: group, tiers: [{ minimum: 1, peninsular: 5, eastMalaysia: 8 }] }])),
});
const baseline = settings();
const draft = structuredClone(baseline);
draft.productGroups[2] = 'small';
draft.groups.shirt.tiers[0].peninsular = 6;
const fresh = structuredClone(baseline);
fresh.groups.shirt.tiers[0].eastMalaysia = 9;
fresh.groups.bulky.label = 'Concurrent label';
const merged = mergeChangedSettings(baseline, draft, fresh);
assert.equal(merged.productGroups[2], 'small', 'draft product change must be applied');
assert.equal(merged.groups.shirt.tiers[0].peninsular, 6, 'draft rate change must be applied');
assert.equal(merged.groups.shirt.tiers[0].eastMalaysia, 9, 'concurrent rate change must survive');
assert.equal(merged.groups.bulky.label, 'Concurrent label', 'unrelated concurrent changes must survive');

const structuralBaseline = settings();
structuralBaseline.groups.shirt.tiers = [
  { minimum: 1, peninsular: 5, eastMalaysia: 8 },
  { minimum: 6, peninsular: 4, eastMalaysia: 7 },
  { minimum: 12, peninsular: 3, eastMalaysia: 6 },
];
const localDeletion = structuredClone(structuralBaseline);
localDeletion.groups.shirt.tiers.splice(1, 1);
const concurrentScalar = structuredClone(structuralBaseline);
concurrentScalar.groups.shirt.tiers[2].eastMalaysia = 10;
concurrentScalar.groups.bulky.label = 'Untouched concurrent data';
assert.throws(
  () => mergeChangedSettings(structuralBaseline, localDeletion, concurrentScalar),
  /rate-tier structure.*T-shirt/i,
  'local middle-tier deletion plus a concurrent scalar edit in the same group must abort clearly',
);
assert.equal(concurrentScalar.groups.bulky.label, 'Untouched concurrent data', 'conflict detection must not mutate fresh data');

const sameLengthReplacement = structuredClone(structuralBaseline);
sameLengthReplacement.groups.shirt.tiers.splice(1, 1, { minimum: 8, peninsular: 4, eastMalaysia: 7 });
const concurrentReplacementEdit = structuredClone(structuralBaseline);
concurrentReplacementEdit.groups.shirt.tiers[2].eastMalaysia = 10;
assert.throws(
  () => mergeChangedSettings(structuralBaseline, sameLengthReplacement, concurrentReplacementEdit),
  /rate-tier structure.*T-shirt/i,
  'same-length delete plus add tier replacement and a concurrent same-group edit must abort',
);

const localStructureOnly = structuredClone(structuralBaseline);
localStructureOnly.groups.shirt.tiers.splice(1, 1);
const freshWithoutGroupChange = structuredClone(structuralBaseline);
freshWithoutGroupChange.groups.bulky.label = 'Concurrent unrelated group';
const structurallyMerged = mergeChangedSettings(structuralBaseline, localStructureOnly, freshWithoutGroupChange);
assert.deepEqual(structurallyMerged.groups.shirt.tiers, localStructureOnly.groups.shirt.tiers, 'local-only structural change must be applied intact');
assert.equal(structurallyMerged.groups.bulky.label, 'Concurrent unrelated group', 'untouched concurrent group data must survive local structural changes');

const localScalar = structuredClone(structuralBaseline);
localScalar.groups.shirt.tiers[2].peninsular = 11;
const concurrentDeletion = structuredClone(structuralBaseline);
concurrentDeletion.groups.shirt.tiers.splice(1, 1);
assert.throws(
  () => mergeChangedSettings(structuralBaseline, localScalar, concurrentDeletion),
  /rate-tier structure.*T-shirt/i,
  'a concurrent tier deletion must abort rather than index into or overwrite the wrong tier',
);

const freshStructureOnly = structuredClone(structuralBaseline);
freshStructureOnly.groups.shirt.tiers.splice(1, 1);
const freshStructureMerged = mergeChangedSettings(structuralBaseline, structuredClone(structuralBaseline), freshStructureOnly);
assert.deepEqual(freshStructureMerged.groups.shirt.tiers, freshStructureOnly.groups.shirt.tiers, 'fresh-only structural changes must be preserved');

const scalarBaseline = settings();
const localRate = structuredClone(scalarBaseline);
localRate.groups.shirt.tiers[0].peninsular = 6;
const freshRate = structuredClone(scalarBaseline);
freshRate.groups.shirt.tiers[0].peninsular = 7;
let saveSubmissions = 0;
assert.throws(
  () => {
    const payload = mergeChangedSettings(scalarBaseline, localRate, freshRate);
    saveSubmissions += 1;
    return payload;
  },
  /settings.*T-shirt.*changed elsewhere/i,
  'baseline rate 5, local 6, fresh 7 must conflict',
);
assert.equal(saveSubmissions, 0, 'a merge conflict must be detected before PUT/save submission');

const identicalRate = structuredClone(scalarBaseline);
identicalRate.groups.shirt.tiers[0].peninsular = 6;
const identicallyMerged = mergeChangedSettings(scalarBaseline, identicalRate, structuredClone(identicalRate));
assert.equal(identicallyMerged.groups.shirt.tiers[0].peninsular, 6, 'identical concurrent scalar values must not conflict');

const localLabel = structuredClone(scalarBaseline);
localLabel.groups.shirt.label = 'Local label';
const freshEastRate = structuredClone(scalarBaseline);
freshEastRate.groups.shirt.tiers[0].eastMalaysia = 9;
const disjointMerged = mergeChangedSettings(scalarBaseline, localLabel, freshEastRate);
assert.equal(disjointMerged.groups.shirt.label, 'Local label', 'a disjoint local label change must merge');
assert.equal(disjointMerged.groups.shirt.tiers[0].eastMalaysia, 9, 'a disjoint fresh tier change must survive');

const localProduct = structuredClone(scalarBaseline);
localProduct.productGroups[1] = 'small';
const freshProduct = structuredClone(scalarBaseline);
freshProduct.productGroups[1] = 'bulky';
assert.throws(() => mergeChangedSettings(scalarBaseline, localProduct, freshProduct), /shipping category.*changed elsewhere/i, 'overlapping product mapping changes must conflict');

const localPriority = structuredClone(scalarBaseline);
localPriority.priority = ['bulky', 'shirt', 'small', 'flyers', 'sim'];
const freshPriority = structuredClone(scalarBaseline);
freshPriority.priority = ['small', 'shirt', 'bulky', 'flyers', 'sim'];
assert.throws(() => mergeChangedSettings(scalarBaseline, localPriority, freshPriority), /mixed-order priority.*changed elsewhere/i, 'overlapping priority changes must conflict');

const conflictingLocalLabel = structuredClone(scalarBaseline);
conflictingLocalLabel.groups.shirt.label = 'Local label';
const conflictingFreshLabel = structuredClone(scalarBaseline);
conflictingFreshLabel.groups.shirt.label = 'Fresh label';
assert.throws(() => mergeChangedSettings(scalarBaseline, conflictingLocalLabel, conflictingFreshLabel), /settings.*T-shirt.*changed elsewhere/i, 'overlapping group label changes must conflict');

console.log('admin shipping redesign check passed');
