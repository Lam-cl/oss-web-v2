#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function compile(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => dependencies[name] || require(name);
  new Function('exports', 'require', 'module', output)(module.exports, localRequire, module);
  return module.exports;
}

const payment = compile('src/lib/paymentProcessing.ts');
const loadResolution = (readBundlePaymentStatus) => compile('src/lib/paymentReturn.server.ts', {
  '@/lib/bundlePaymentStatus.server': { readBundlePaymentStatus },
  '@/lib/paymentProcessing': payment,
});

(async () => {
  const failed = loadResolution(async (orderId) => ({ state: 'failed', orderId, transactionId: '10', gatewayTxnId: '', amount: 12, paymentMethod: 'FPX' }));
  assert.match(await failed.authoritativePaymentReturnPath(200), /^\/payment\/failed\?status=failure&orderId=200&transactionId=10&reason=Payment\+failed$/);

  const completed = loadResolution(async (orderId) => ({ state: 'success', orderId, transactionId: '11', gatewayTxnId: 'gateway-11', amount: 12, paymentMethod: 'FPX' }));
  assert.match(await completed.authoritativePaymentReturnPath(201), /^\/payment\/success\?status=success&orderId=201&transactionId=11&gatewayTxnId=gateway-11$/);

  const pending = loadResolution(async (orderId) => ({ state: 'processing', orderId, transactionId: '12', gatewayTxnId: '', amount: 12, paymentMethod: 'FPX' }));
  assert.equal(await pending.authoritativePaymentReturnPath(202), '/payment/processing');

  const unavailable = loadResolution(async () => { throw new Error('timeout'); });
  assert.equal(await unavailable.authoritativePaymentReturnPath(203), '/payment/processing');

  let reads = 0;
  const invalid = loadResolution(async () => { reads += 1; throw new Error('must not run'); });
  for (const orderId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(await invalid.authoritativePaymentReturnPath(orderId), '/payment/processing');
  }
  assert.equal(reads, 0, 'invalid order identity must not trigger an authoritative status read');

  const route = fs.readFileSync('src/app/bundle/gkash-return/route.ts', 'utf8');
  assert(route.indexOf('readOrderMetadata(orderId)') < route.indexOf('authoritativeResult(request, orderId)'), 'stored reference verification must precede authoritative status fallback');
  assert(route.indexOf('if (target) return NextResponse.redirect') < route.indexOf('return authoritativeResult(request, orderId)'), 'a valid Bundle redirect remains authoritative before fallback reconciliation');
  console.log('GKash authoritative return resolution check passed');
})().catch((error) => { console.error(error); process.exit(1); });
