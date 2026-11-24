import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Compile the matcher exactly as `next build` does: Next statically reads
// `config` from src/middleware.ts and turns each entry into a regexp.
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getPageStaticInfo } = require('next/dist/build/analysis/get-page-static-info');

const info = await getPageStaticInfo({
  pageFilePath: join(here, 'middleware.ts'),
  nextConfig: {},
  isDev: false,
  page: '/middleware',
  pageType: 'root',
});
const matchers = info.middleware?.matchers ?? [];
const regexps = matchers.map((m) => new RegExp(m.regexp));
const invokesMiddleware = (pathname) => regexps.some((re) => re.test(pathname));

test('Next reads the middleware matcher as static config', () => {
  assert.ok(matchers.length > 0, 'no matchers parsed from src/middleware.ts');
  assert.equal(info.runtime, undefined);
});

// Every path a middleware branch acts on.
const handled = {
  'x-oss-public-origin forwarding': [
    '/api-proxy', '/api-proxy/verifyPromoter', '/api-proxy/a/b/c',
    '/oss-nest-proxy', '/oss-nest-proxy/numbers/search',
  ],
  'admin guard': [
    '/admin', '/admin/login', '/admin/products', '/admin/products/123/edit',
  ],
  'merchandise pages': [
    '/merchandise', '/merchandise/hoodie', '/checkout', '/checkout/success',
  ],
  'merchandise APIs': [
    '/bundle/checkout', '/api/bundle/checkout', '/bundle/merchandise', '/api/bundle/merchandise',
    '/catalogue-products-api', '/catalogue-products-api/42',
    '/api/catalogue-products', '/api/catalogue-products/42/media',
    '/shipping-settings-api', '/shipping-settings-api/zones',
  ],
  'direct checkout token': ['/sim/purchase'],
};

for (const [branch, paths] of Object.entries(handled)) {
  test(`matcher covers ${branch}`, () => {
    for (const pathname of paths) {
      assert.ok(invokesMiddleware(pathname), `${pathname} should invoke middleware`);
    }
  });
}

test('storefront, static and other API paths skip middleware', () => {
  const skipped = [
    '/', '/sim', '/sim/purchase/extra', '/sim-replacement-tnc', '/cart', '/devices',
    '/esim-info', '/esim-install', '/register', '/thank-you', '/payment/processing',
    '/confirmation', '/adx', '/ms',
    '/admin-api/products', '/administrator', '/merchandise-x', '/checkouts',
    '/api/proxy', '/api/numbers/search', '/api/confirmation', '/api/payment/gkash/initiate',
    '/api/bundle/vouchers/preview', '/api/bundle/checkout/extra', '/bundle/checkout/extra',
    '/api/catalogue-productsX', '/gkash/initiate', '/bundle/gkash-return',
    '/_next/static/chunks/main.js', '/_next/image', '/favicon.ico', '/logo.png', '/fonts/a.woff2',
  ];
  for (const pathname of skipped) {
    assert.ok(!invokesMiddleware(pathname), `${pathname} should not invoke middleware`);
  }
});
