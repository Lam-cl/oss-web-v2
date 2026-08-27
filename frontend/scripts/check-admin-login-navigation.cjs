const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const navigationFile = path.join(root, 'src/lib/admin/navigation.ts');
const output = ts.transpileModule(fs.readFileSync(navigationFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(navigationFile, module);
loaded.filename = navigationFile;
loaded.paths = Module._nodeModulePaths(path.dirname(navigationFile));
loaded._compile(output, navigationFile);

const { resolveAdminNextPath } = loaded.exports;
assert.equal(resolveAdminNextPath('/admin'), '/admin');
assert.equal(resolveAdminNextPath('/admin/orders?status=pending'), '/admin/orders?status=pending');
assert.equal(resolveAdminNextPath('/administrator'), '/admin');
assert.equal(resolveAdminNextPath('//attacker.example/admin'), '/admin');
assert.equal(resolveAdminNextPath('https://attacker.example/admin'), '/admin');
assert.equal(resolveAdminNextPath(null), '/admin');

const loginPage = fs.readFileSync(path.join(root, 'src/app/admin/login/page.tsx'), 'utf8');
assert.match(loginPage, /window\.location\.replace\(resolveAdminNextPath\(params\.get\('next'\)\)\)/);
assert.match(loginPage, /signal:\s*AbortSignal\.timeout\(20_000\)/);
assert.doesNotMatch(loginPage, /router\.(replace|refresh)/);

const loginRoute = fs.readFileSync(path.join(root, 'src/app/api/admin/auth/login/route.ts'), 'utf8');
assert.match(loginRoute, /signal:\s*AbortSignal\.timeout\(15_000\)/);
assert.match(loginRoute, /safeError\(504/);

const adminShell = fs.readFileSync(path.join(root, 'src/components/admin/AdminShell.tsx'), 'utf8');
assert.match(adminShell, /window\.location\.replace\('\/admin\/login'\)/);
assert.doesNotMatch(adminShell, /router\.(replace|refresh)/);

console.log('Admin login navigation and timeout checks passed');
