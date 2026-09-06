#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = fs.readFileSync('src/app/checkout/page.tsx', 'utf8');
assert.match(page, /shippingPending[\s\S]*?!shippingSettings \|\| !shippingState/);
assert.match(page, /shippingUnavailable[\s\S]*?courier\.unclassified\.length/);
assert.match(page, /shippingPending \? 'Select state' : shippingUnavailable \? 'Unavailable' : shipping === 0 \? 'FREE'/);
assert.doesNotMatch(page, /Total before shipping/);
assert.equal((page.match(/grandTotal !== null \?/g) || []).length, 3, 'Every desktop/mobile total must wait for a confirmed shipping amount');
assert.match(page, /Select state to calculate total/);
assert.match(page, /disabled=\{submitting \|\| merchandiseLoading \|\| stockIssues\.length > 0 \|\| shippingPending \|\| shippingUnavailable\}/);
console.log('checkout shipping presentation check passed');
