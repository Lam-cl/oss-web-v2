const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const moduleFile = path.join(process.cwd(), 'src/lib/admin/catalogueMutationLock.server.ts');
const compiled = ts.transpileModule(fs.readFileSync(moduleFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'require', 'module', compiled)(loaded.exports, name => {
  if (name === '@/lib/dataApiClient.server') return {
    dataApiEnabled: () => false,
    dataApiRequest: async () => { throw new Error('Unexpected remote request in local lock fixture'); },
    ToneWowDataApiError: class extends Error {},
  };
  return require(name);
}, loaded);
module.exports = loaded.exports;
