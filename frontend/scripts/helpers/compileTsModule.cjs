// Transpiles a dependency-free TypeScript module (e.g. src/lib/cataloguePublicProjectionCore.ts) to CommonJS.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
module.exports = function compileTsModule(rel) {
  const file = path.resolve(rel);
  if (cache.has(file)) return cache.get(file);
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(m.exports, require, m, file, path.dirname(file));
  cache.set(file, m.exports);
  return m.exports;
};
