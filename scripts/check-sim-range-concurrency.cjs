'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.resolve('src/lib/admin/simRange.server.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'require', 'module', output)(loaded.exports, require, loaded);

(async () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.ADMIN_SESSION_SECRET;
  let active = 0;
  let maximum = 0;
  const urls = [];
  process.env.ADMIN_SESSION_SECRET = 'tester-feedback-secret-at-least-32-characters';
  try {
    global.fetch = async (url) => {
      urls.push(String(url));
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return String(url).endsWith('51300112827')
        ? Response.json({ simPUK: '12345678', simCode: 'TWE', simType: 'Physical' })
        : Response.json({ error: { userMessage: 'SIM Serial Not Found' } }, { status: 422 });
    };
    const result = await loaded.exports.validateSimRange({
      orderId: 208,
      orderItemId: 1,
      productCode: 'TWE',
      prefixId: '17',
      simPrefix: '896016250',
      startSerial: '5130011282',
      endSerial: '5130011282',
    });
    assert.equal(result.quantity, 1);
    assert.equal(result.serials[0].simSerial, '51300112827');
    assert(!JSON.stringify(result).includes('12345678'), 'PUK must remain only inside the encrypted assignment token');
    assert(maximum > 1 && maximum <= 8, `provider concurrency must be bounded, saw ${maximum}`);
    assert(urls.every((url) => url.includes('/simprefixid/17/')), 'validation must use only the selected prefix ID');
    console.log('SIM range bounded concurrency check passed');
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = originalSecret;
  }
})().catch((error) => { console.error(error); process.exit(1); });
