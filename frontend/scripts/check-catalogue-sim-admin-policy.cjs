#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const route = fs.readFileSync('src/lib/admin/catalogueAdminRoute.server.ts', 'utf8');
const page = fs.readFileSync('src/app/admin/products/page.tsx', 'utf8');
const presentationSource = fs.readFileSync('src/app/admin/products/productPresentation.ts', 'utf8');
const output = ts.transpileModule(presentationSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'require', 'module', output)(mod.exports, require, mod);

assert.doesNotMatch(route, /rejectLockedSimMutation|dedicated same-ID SIM publish|Active SIM adoption locked fields/,
  'SIM Card products must use ordinary catalogue mutations');
assert.match(route, /async update\([\s\S]*?updateCatalogueProduct/,
  'ordinary catalogue update remains available');
assert.match(route, /async publish\([\s\S]*?publishCatalogueProductVersion/,
  'ordinary catalogue publish remains available');
assert.match(route, /async unpublish\([\s\S]*?retirePreviousVersion/,
  'ordinary catalogue unpublish remains available');
assert.match(page, /genericLifecycleAllowed && publishAvailable/);
assert.match(page, /genericLifecycleAllowed && row\.catalogue\.status === 'published'/);
assert.match(page, /genericLifecycleAllowed && localDraft/);
assert.equal(mod.exports.genericCatalogueLifecycleAllowed(true), true);
assert.deepEqual(
  mod.exports.publicationActionPresentation({ state: 'dirty', localDraft: false, simManaged: true }),
  { visible: true, label: 'Publish changes', disabledReason: null },
);
console.log('Catalogue SIM Card ordinary lifecycle policy check passed');
