const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', output)(module.exports, require, module);
  return module.exports;
}

const polling = load('src/lib/paymentProcessing.ts');
assert.deepEqual(
  [0, 29, 30, 35, 120, 121].map(polling.paymentPollingAction),
  ['wait', 'wait', 'poll', 'poll', 'poll', 'stop'],
  'polling boundaries must be 30s every 5s through 120s',
);
assert.equal(polling.paymentPollingAction(31), 'wait');

const reference = '16twoss1234567890123';
assert.equal(polling.isBundlePaymentReference(reference), true);
for (const invalid of ['', '16twoss-short', 'twoss123456789012345', '16twoss123456789012!', '../16twoss1234567890123']) {
  assert.equal(polling.isBundlePaymentReference(invalid), false, invalid);
}

const completed = polling.bundlePaymentProjection({ id: 42, status: 'CANCELLED', totalAmount: '19.50', transactions: [
  { id: 2, status: 'FAILED', transactionId: 'later-failure' },
  { id: 1, status: 'COMPLETED', transactionId: 'tx-1', gatewayTxnId: 'gw-1', amount: '19.50', paymentMethod: 'FPX' },
] });
assert.deepEqual(completed, { state: 'success', orderId: 42, transactionId: '1', gatewayTxnId: 'gw-1', amount: 19.5, paymentMethod: 'FPX' });
assert.equal(polling.bundlePaymentProjection({ id: 42, transactions: [{ status: 'FAILED' }] }).state, 'failed');
assert.equal(polling.bundlePaymentProjection({ id: 42, status: 'CANCELLED', transactions: [{ status: 'PENDING' }] }).state, 'processing');

assert.deepEqual(polling.readPendingPayment(JSON.stringify({ orderId: '42', referenceNumber: reference, storedAt: 1_000 }), 2_000), { orderId: '42', referenceNumber: reference });
assert.equal(polling.readPendingPayment(JSON.stringify({ orderId: '42', referenceNumber: reference, storedAt: 1_000 }), 8 * 24 * 60 * 60 * 1000)?.error, 'expired');
assert.equal(polling.readPendingPayment(null, 2_000)?.error, 'missing');

assert.equal(
  polling.paymentResultUrl(completed),
  '/payment/success?status=success&orderId=42&transactionId=1&gatewayTxnId=gw-1',
);
const failedUrl = polling.paymentResultUrl({ state: 'failed', orderId: 42, transactionId: '', gatewayTxnId: '', amount: 0, paymentMethod: '' });
assert.match(failedUrl, /^\/payment\/failed\?status=failure&orderId=42&reason=Payment\+failed$/);
assert.equal(failedUrl.includes('Payment+processing+error'), false, 'terminal failure must not reactivate polling');
assert.equal(polling.paymentResultUrl({ state: 'processing', orderId: 42 }), '', 'processing must not redirect');

const route = fs.readFileSync('src/lib/bundlePaymentStatus.server.ts', 'utf8');
const component = fs.readFileSync('src/components/payment/PaymentResult.tsx', 'utf8');
const failedPage = fs.readFileSync('src/app/payment/failed/page.tsx', 'utf8');
const processingPage = fs.readFileSync('src/app/payment/processing/page.tsx', 'utf8');
const transition = fs.readFileSync('src/components/layout/PageTransition.tsx', 'utf8');
assert.equal(route.includes('/payment/gkash/return'), false, 'status route must never replay payment return');
assert.equal(component.includes('/payment/gkash/return'), false, 'frontend must never replay payment return');
assert.match(failedPage, /reason=\{first\(searchParams\.error\)\s*\|\|\s*first\(searchParams\.reason\)\}/, 'failed page must prefer error and fall back to reason');
assert.equal(component.includes("reason === 'Payment processing error'"), false, 'gateway error text must never activate polling');
assert.match(component, /processing:\s*processingPage\s*=\s*false/, 'processing must require an explicit page-owned flag');
assert.match(component, /const processing = !success && processingPage/, 'success can never enter processing mode');
assert.match(processingPage, /PaymentResult status="failed" processing/, 'only the processing page opts into polling');
assert.equal(failedPage.includes(' processing'), false, 'the terminal failed page cannot opt into polling');
assert.match(transition, /pathname\.startsWith\('\/payment\/'\)/, 'payment result routes must bypass retained exit animations');
console.log('payment processing polling check passed');
