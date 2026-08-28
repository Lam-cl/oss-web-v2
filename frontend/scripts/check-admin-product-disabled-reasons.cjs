const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const presentationPath = path.join(root, 'src/app/admin/products/productPresentation.ts');
const page = fs.readFileSync(path.join(root, 'src/app/admin/products/page.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/app/admin/admin.css'), 'utf8');
const source = fs.readFileSync(presentationPath, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'require', 'module', output)(mod.exports, require, mod);
const { catalogueHazardReason, publicationRecoveryPresentation } = mod.exports;

const completeModel = {
  details: { title: 'PRO SIM', price: 10 },
  choices: [{ values: [{ key: 'excel' }, { key: 'plus' }] }],
  combinations: [
    { valueKeys: ['excel'], price: 10 },
    { valueKeys: ['plus'], price: 10 },
  ],
};

assert.equal(typeof catalogueHazardReason, 'function', 'presentation exposes the disabled-action reason policy');
assert.equal(
  catalogueHazardReason({ ...completeModel, combinations: [completeModel.combinations[0]] }),
  'Complete every active variant before publishing or archiving.',
  'incomplete variant matrices have a concise actionable reason',
);
assert.equal(
  catalogueHazardReason({ ...completeModel, combinations: [
    completeModel.combinations[0],
    { valueKeys: ['plus'], price: 0 },
  ] }),
  'Set the base price to RM0 or correct the RM0 variant before publishing or archiving.',
  'an accidental RM0 variant is distinguished from an incomplete matrix',
);
assert.equal(catalogueHazardReason(completeModel), null, 'ready rows do not show a content hazard reason');
for (const phase of ['building', 'bundle-published', 'activation-uncertain', 'activated', 'retirement-uncertain', 'previous-retired']) {
  assert.deepEqual(
    publicationRecoveryPresentation({ phase }),
    { pending: true, label: 'Resume publication', disabledReason: null },
    `${phase} provider work is explicitly resumable`,
  );
}
assert.deepEqual(
  publicationRecoveryPresentation(undefined),
  { pending: false, label: 'Publish', disabledReason: 'Provider operation status could not be loaded. Reload before publishing or archiving.' },
  'unavailable provider evidence stays fail-closed',
);
assert.deepEqual(publicationRecoveryPresentation(null), { pending: false, label: 'Publish', disabledReason: null }, 'a new draft uses normal Publish');
assert.deepEqual(publicationRecoveryPresentation({ phase: 'complete' }), { pending: false, label: 'Publish', disabledReason: null }, 'completed work is not presented as pending');
assert.equal(publicationRecoveryPresentation({ phase: 'invalid' }).disabledReason.length > 0, true, 'invalid provider phases stay fail-closed');
const hiddenGreenModel = {
  ...completeModel,
  choices: [{ values: [
    ...completeModel.choices[0].values,
    { key: 'green', retired: true },
  ] }],
  combinations: [
    ...completeModel.combinations,
    { valueKeys: ['green'], price: 10 },
  ],
};
assert.equal(
  catalogueHazardReason(hiddenGreenModel),
  null,
  'a complete active matrix remains publishable when a preserved combination belongs only to a hidden value',
);
assert.deepEqual(
  mod.exports.catalogueChoiceSummary(hiddenGreenModel),
  { primary: 'Choice 2', secondary: '2 combinations', incomplete: false },
  'choice summary counts active values and combinations only',
);

const unknownAction = mod.exports.publicationActionPresentation({ state: 'unknown', localDraft: false, simManaged: false, unknownReason: 'Snapshot missing.' });
assert.deepEqual(unknownAction, { visible: true, label: 'Publish changes', disabledReason: 'Snapshot missing.' }, 'unknown publication evidence supplies an actionable disabled reason');
assert.equal(page.includes('adm-action-disabled-reason'), true, 'the shared disabled reason has a visible row presentation');
assert.equal(page.includes('aria-describedby'), true, 'disabled actions expose their visible reason to assistive technology');
assert.match(page, /publicationRecovery\.pending \? publicationRecovery\.label/,'pending rows use the recovery label');
assert.match(page, /publicationRecovery\.pending \? 'Resuming…' : 'Publishing…'/,'pending rows expose resume progress');
assert.match(page, /Resume or finish provider publication before archiving\./,'archive remains disabled while provider recovery is pending');
assert.doesNotMatch(page, /Provider operation unresolved\. Wait for it to finish/,'the UI must not claim that an absent worker will finish provider work');
assert.match(css, /\.adm-action-disabled-reason\b[^}]*color:[^;}]+;[^}]*font-size:[^;}]+;/, 'disabled reason has visible presentation styling');

console.log('Admin product disabled-action reasons check passed');
