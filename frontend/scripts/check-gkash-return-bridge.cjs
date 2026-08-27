#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const checkout = fs.readFileSync('src/app/api/bundle/checkout/route.ts', 'utf8');
const bridge = fs.readFileSync('src/app/bundle/gkash-return/route.ts', 'utf8');
const processing = fs.readFileSync('src/app/payment/processing/page.tsx', 'utf8');
assert.match(checkout, /paymentParams\.returnurl = returnUrl\.toString\(\)/, 'browser return must use the local bridge');
assert.match(checkout, /\/bundle\/gkash-return/, 'checkout must issue the same-origin return URL');
assert.match(bridge, /redirect: 'manual'/, 'upstream response body must never be rendered');
assert.match(bridge, /NextResponse\.redirect\(new URL\('\/payment\/processing'/, 'uncertain return must redirect to local processing');
assert.match(bridge, /x-forwarded-host/, 'reverse-proxied returns must use the public host');
assert.match(bridge, /publicOrigin\(request\)/, 'gateway redirects must not expose the internal Next.js origin');
assert.match(bridge, /readOrderMetadata\(orderId\)/, 'return query must be bound to stored order metadata');
assert.match(bridge, /MAX_RETURN_BYTES = 64 \* 1024/, 'gateway body must be bounded');
assert.match(bridge, /authoritativePaymentReturnPath\(orderId\)/, 'an uncertain callback must reconcile terminal Bundle status before processing');
assert.match(processing, /PaymentResult status="failed" processing/, 'processing page must explicitly enable authoritative polling');
console.log('GKash return bridge check passed');
