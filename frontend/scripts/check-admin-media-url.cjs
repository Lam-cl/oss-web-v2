const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/lib/admin/mediaUrl.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(output, file);

const catalogueId = '12227c99-74e7-4213-9bec-1e99d670360f';
const mediaId = '02eafbd4-56bc-48be-b44c-f5d26bf1549f';
const publicUrl = `/catalogue-products-api?catalogueId=${catalogueId}&mediaId=${mediaId}`;
assert.equal(loaded.exports.adminMediaUrl(publicUrl), `/admin-api/catalogue-products/${catalogueId}/media/${mediaId}`);
assert.equal(loaded.exports.adminMediaUrl('https://cdn.example.com/product.png'), 'https://cdn.example.com/product.png');
assert.equal(loaded.exports.adminMediaUrl('/catalogue-products-api?catalogueId=bad&mediaId=bad'), '/catalogue-products-api?catalogueId=bad&mediaId=bad');

for (const relative of [
  'src/app/admin/products/page.tsx',
  'src/components/admin/ProductDrawer.tsx',
  'src/components/admin/OrderDrawer.tsx',
  'src/components/admin/UnifiedProductEditor.tsx',
]) assert.match(fs.readFileSync(path.join(root, relative), 'utf8'), /adminMediaUrl/);

console.log('Authenticated admin media URL check passed');
