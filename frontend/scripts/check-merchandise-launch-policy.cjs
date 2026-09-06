const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = (file, imports = {}, globals = {}) => {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name) => imports[name] || {}, URL, ...globals }, { filename: file });
  return exports;
};
const policy = compile('src/lib/merchandiseCheckoutPolicy.ts');
const { merchandiseCheckoutPolicy: resolve, isAllowedMerchandisePaymentUrl: allowed } = policy;
// Reserved test domain, not an assertion about GKash's actual production host.
const production = { GKASH_ENVIRONMENT: 'production', GKASH_PRODUCTION_PAYMENT_ORIGIN: 'https://payments.example', MERCHANDISE_CHECKOUT_MODE: 'open' };
assert.equal(resolve({}).enabled, false);
assert.equal(resolve({ ...production, MERCHANDISE_CHECKOUT_MODE: undefined }).enabled, false);
assert.equal(resolve({ ...production, MERCHANDISE_CHECKOUT_MODE: 'closed' }, true).enabled, false);
assert.equal(resolve({ ...production, MERCHANDISE_CHECKOUT_MODE: 'qa' }).enabled, false);
assert.equal(resolve({ ...production, MERCHANDISE_CHECKOUT_MODE: 'qa' }, true).enabled, true);
assert.equal(resolve({ ...production, MERCHANDISE_CHECKOUT_MODE: 'typo' }, true).enabled, false);
assert.equal(resolve({ ...production, GKASH_PRODUCTION_PAYMENT_ORIGIN: undefined }).enabled, false);
for (const origin of ['http://payments.example', 'https://user:pass@payments.example', 'https://payments.example:8443', 'https://payments.example/pay', 'https://payments.example?x=1', 'https://payments.example#x', 'https://api-staging.pay.asia', 'not-a-url']) {
  assert.equal(resolve({ ...production, GKASH_PRODUCTION_PAYMENT_ORIGIN: origin }).enabled, false, origin);
}
const live = resolve(production);
assert.equal(allowed('https://payments.example/api/payment?reference=123', live), true);
for (const url of ['https://api-staging.pay.asia/api/payment', 'http://payments.example', 'https://payments.example.attacker.test', 'https://payments.example@attacker.test', 'https://u:p@payments.example', 'https://payments.example:8443', 'javascript:alert(1)', '/payment']) {
  assert.equal(allowed(url, live), false, url);
}
assert.equal(allowed('https://payments.example', resolve({ ...production, MERCHANDISE_CHECKOUT_MODE: 'closed' })), false);
assert.equal(resolve({ GKASH_ENVIRONMENT: 'staging', MERCHANDISE_CHECKOUT_MODE: 'open' }).enabled, true);
assert.equal(resolve({ GKASH_ENVIRONMENT: 'staging', MERCHANDISE_CHECKOUT_MODE: 'open', VERCEL_ENV: 'production' }).enabled, false);

(async () => {
  let session = null;
  const env = { ...production, MERCHANDISE_CHECKOUT_MODE: 'qa' };
  const server = compile('src/lib/merchandiseCheckoutPolicy.server.ts', {
    './admin/server': { getAdminSession: async () => session },
    './merchandiseCheckoutPolicy': policy,
  }, { process: { env } });
  assert.equal((await server.readMerchandiseCheckoutPolicy({})).enabled, false);
  session = { user: { role: 'STAFF' } };
  assert.equal((await server.readMerchandiseCheckoutPolicy({})).enabled, true);
  env.MERCHANDISE_CHECKOUT_MODE = 'closed';
  let upstreamCalls = 0;
  let bodyReads = 0;
  const route = compile('src/app/api/bundle/checkout/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/merchandiseCheckoutPolicy.server': server,
    '@/lib/merchandiseCheckoutPolicy': policy,
  }, { fetch: () => { upstreamCalls++; throw new Error('Must not reach Bundle'); }, process: { env } });
  const request = {
    nextUrl: new URL('https://shop.tonewow.com/bundle/checkout'),
    url: 'https://shop.tonewow.com/bundle/checkout',
    headers: new Headers({ origin: 'https://shop.tonewow.com', host: 'shop.tonewow.com' }),
    json: async () => { bodyReads++; return {}; },
  };
  const response = await route.POST(request);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'MERCHANDISE_CHECKOUT_PAUSED');
  assert.equal(upstreamCalls, 0);
  assert.equal(bodyReads, 0, 'Gate rejects before processing the checkout');
  const availability = await route.GET(request);
  assert.equal((await availability.json()).enabled, false);
  assert.match(availability.headers.get('cache-control'), /no-store/);
  const invalid = await route.POST({ ...request, headers: new Headers({ origin: 'https://attacker.test' }) });
  assert.equal(invalid.status, 403);
  console.log('Merchandise launch policy, exact-origin validation, authenticated QA and zero-side-effect closed checkout passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
