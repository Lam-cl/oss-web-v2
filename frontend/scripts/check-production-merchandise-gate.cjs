const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
const tabs = fs.readFileSync('src/components/home/CategoryTabs.tsx', 'utf8');
const productionEnv = fs.readFileSync('.env.production', 'utf8');

assert.match(productionEnv, /^NEXT_PUBLIC_ENABLE_MERCHANDISE=true$/m, 'production catalogue must be enabled');
const config = Object.fromEntries(productionEnv.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)]; }));
const policyExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/merchandiseCheckoutPolicy.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {exports:policyExports,URL});
const livePolicy=policyExports.merchandiseCheckoutPolicy({...config,VERCEL_ENV:'production'});
assert.equal(livePolicy.enabled,true,'approved production checkout must be enabled');
assert.equal(livePolicy.paymentOrigin,'https://api.gkash.my','must match observed Bundle production redirect');
assert.equal(policyExports.isAllowedMerchandisePaymentUrl('https://api-staging.pay.asia',livePolicy),false,'staging redirects remain blocked');
assert.match(productionEnv, /^GKASH_ENVIRONMENT=production$/m);
const source = ts.transpileModule(fs.readFileSync('src/lib/features.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
for (const [flag, expected] of [['true', true], ['false', false], ['', false], [' TRUE ', true]]) {
  const exports = {};
  vm.runInNewContext(source, { exports, process: { env: { NEXT_PUBLIC_ENABLE_MERCHANDISE: flag } } });
  assert.equal(exports.isMerchandiseEnabled(), expected);
}
assert.match(tabs, /disabled=\{!merchandiseEnabled\}/, 'homepage merchandise tab must respect the disabled flag');
assert.match(tabs, /merchandiseEnabled\s*\?\s*'Merchandise'\s*:\s*'Coming Soon'/, 'disabled tab must say Coming Soon');
assert.match(middleware, /pathname === '\/merchandise'/, 'direct merchandise pages must be gated');
assert.match(middleware, /pathname === '\/checkout'/, 'merchandise checkout page must be gated');
assert.match(middleware, /pathname === '\/api\/bundle\/checkout'/, 'merchandise checkout API must be gated');
assert.match(middleware, /status:\s*404/, 'disabled public merchandise APIs must not expose catalogue data');
assert.match(middleware, /if \(pathname === '\/admin'/, 'admin access must remain independently protected');

console.log('production merchandise launch gate check passed');
