const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('/www/wwwroot/tonewow.xifuhalim.com/node_modules/typescript');

const path = '/www/wwwroot/tonewow.xifuhalim.com/src/lib/productImageColors.server.ts';
const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const box = { exports: {} };
vm.runInNewContext(code, { module: box, exports: box.exports, require, process });
const { validateProductImageColorAssignments, validateHiddenOptionValueIds } = box.exports;

const assignments = validateProductImageColorAssignments({ assignments: { 101: 53, 102: 53, 103: 'all' } });
assert.deepEqual(JSON.parse(JSON.stringify(assignments)), { 101: 53, 102: 53, 103: 'all' });
assert.throws(() => validateProductImageColorAssignments({ assignments: { nope: 53 } }), /image id/i);
assert.throws(() => validateProductImageColorAssignments({ assignments: { 101: -1 } }), /color/i);
assert.throws(() => validateProductImageColorAssignments({ assignments: { 101: 'Stoney' } }), /color/i);
assert.deepEqual(Array.from(validateHiddenOptionValueIds({ valueIds: [99, 99, 100] })), [99, 100]);
assert.throws(() => validateHiddenOptionValueIds({ valueIds: [-1] }), /option value/i);
const adminRoute = fs.readFileSync('/www/wwwroot/tonewow.xifuhalim.com/src/app/api/admin/[...path]/route.ts', 'utf8');
assert(adminRoute.includes('image-colors'), 'authenticated product image-color route missing');
assert(adminRoute.includes('saveProductImageColors'), 'image-color save handler missing');
assert(adminRoute.includes('hidden-option-values'), 'hidden option-value endpoint missing');
assert(adminRoute.includes('saveProductHiddenOptionValues'), 'hidden option-value save handler missing');
const publicRoute = fs.readFileSync('/www/wwwroot/tonewow.xifuhalim.com/src/app/api/bundle/merchandise/route.ts', 'utf8');
assert(publicRoute.includes('hiddenOptionValues'), 'storefront payload must exclude locally hidden option values');
const drawer = fs.readFileSync('/www/wwwroot/tonewow.xifuhalim.com/src/components/admin/ProductDrawer.tsx', 'utf8');
assert(drawer.includes('Assign color'), 'saved image color selector missing');
assert(drawer.includes('All colors / General'), 'general image option missing');
assert(drawer.includes('pendingImageColors'), 'pending uploads must retain their selected color');
assert(drawer.includes('image-colors'), 'drawer must persist product-scoped assignments');
assert(drawer.includes('Save image colors'), 'existing gallery assignments need a safe local-only save action');
console.log('Product image color settings check passed');
