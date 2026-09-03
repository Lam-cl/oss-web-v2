const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/lib/admin/client.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(output, file);
const { adminFetch, AdminApiError } = loaded.exports;

(async () => {
  const originalFetch = global.fetch;
  let signal;
  try {
    global.fetch = async (_url, init) => {
      signal = init.signal;
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    };
    await assert.rejects(
      () => adminFetch('products?page=1&limit=100'),
      (error) => error instanceof AdminApiError
        && error.status === 504,
    );
    assert(signal instanceof AbortSignal, 'admin requests must receive an AbortSignal');
    assert.equal(signal.aborted, false, 'the request receives a live timeout signal');
    assert.match(fs.readFileSync(file, 'utf8'), /timeoutMs\s*=\s*20_000/);
    console.log('Admin API timeout check passed');
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => { console.error(error); process.exit(1); });
