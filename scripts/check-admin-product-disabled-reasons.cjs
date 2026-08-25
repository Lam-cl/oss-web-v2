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
const { catalogueHazardReason } = mod.exports;

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
  catalogueHazardReason({ ...completeModel, combinations: [completeModel.combinations[0]] }, false),
  'Complete every active variant before publishing or archiving.',
  'incomplete variant matrices have a concise actionable reason',
);
assert.equal(
  catalogueHazardReason({ ...completeModel, combinations: [
    completeModel.combinations[0],
    { valueKeys: ['plus'], price: 0 },
  ] }, false),
  'Set the base price to RM0 or correct the RM0 variant before publishing or archiving.',
  'an accidental RM0 variant is distinguished from an incomplete matrix',
);
assert.equal(
  catalogueHazardReason(completeModel, true),
  'Provider operation unresolved. Wait for it to finish, then reload.',
  'unresolved provider work has a distinct recovery action',
);
assert.equal(catalogueHazardReason(completeModel, false), null, 'ready rows do not show a hazard reason');

assert.match(page, /const hazardousActionReason = row\.kind === 'catalogue'[\s\S]*?catalogueHazardReason\(row\.catalogue\.model, providerOperationUnresolved\)/, 'row presentation derives one reason from the shared policy');
assert.match(page, /id=\{hazardousActionReasonId\}[\s\S]*?className="adm-action-disabled-reason"[\s\S]*?\{hazardousActionReason\}/, 'the reason is visibly rendered beside the row actions');
assert.match(page, /aria-describedby=\{hazardousActionReason \? hazardousActionReasonId : undefined\}/, 'disabled hazardous controls reference the visible reason');
assert.ok((page.match(/title=\{hazardousActionReason \|\|/g) || []).length >= 2, 'Publish and Archive expose the actionable reason as a title');
assert.match(css, /\.adm-action-disabled-reason\b[^}]*color:[^;}]+;[^}]*font-size:[^;}]+;/, 'disabled reason has visible presentation styling');

console.log('Admin product disabled-action reasons check passed');
