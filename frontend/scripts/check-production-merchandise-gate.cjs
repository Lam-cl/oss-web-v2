const assert = require('node:assert/strict');
const fs = require('node:fs');

const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
const tabs = fs.readFileSync('src/components/home/CategoryTabs.tsx', 'utf8');
const productionEnv = fs.readFileSync('.env.production', 'utf8');

assert.match(productionEnv, /^NEXT_PUBLIC_ENABLE_MERCHANDISE=false$/m, 'production merchandise flag must remain disabled');
assert.match(tabs, /disabled=\{!merchandiseEnabled\}/, 'homepage merchandise tab must respect the disabled flag');
assert.match(tabs, /merchandiseEnabled\s*\?\s*'Merchandise'\s*:\s*'Coming Soon'/, 'disabled tab must say Coming Soon');
assert.match(middleware, /pathname === '\/merchandise'/, 'direct merchandise pages must be gated');
assert.match(middleware, /pathname === '\/checkout'/, 'merchandise checkout page must be gated');
assert.match(middleware, /pathname === '\/api\/bundle\/checkout'/, 'merchandise checkout API must be gated');
assert.match(middleware, /status:\s*404/, 'disabled public merchandise APIs must not expose catalogue data');
assert.match(middleware, /if \(pathname === '\/admin'/, 'admin access must remain independently protected');

console.log('production merchandise launch gate check passed');
