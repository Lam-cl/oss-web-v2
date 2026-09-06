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
const ts = require('typescript');
const vm = require('node:vm');
const tree = ts.createSourceFile('checkout.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const paymentButtons = [];
function visit(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'button') {
    const attrs = node.attributes.properties;
    if (attrs.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'form' && attr.initializer?.text === 'checkout-form')) {
      const disabled = attrs.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'disabled');
      assert(disabled?.initializer && ts.isJsxExpression(disabled.initializer));
      paymentButtons.push(disabled.initializer.expression.getText(tree));
    }
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(paymentButtons.length, 2, 'Desktop and mobile payment controls must both be tested');
for (const expression of paymentButtons) {
  const ready = { submitting: false, merchandiseLoading: false, stockIssues: [], shippingPending: false, shippingUnavailable: false, checkoutAvailability: { enabled: true } };
  assert.equal(vm.runInNewContext(expression, ready), false, 'Ready checkout can be submitted');
  for (const blocked of [{shippingPending:true}, {shippingUnavailable:true}, {submitting:true}, {merchandiseLoading:true}, {stockIssues:[{}]}, {checkoutAvailability:{enabled:false}}]) {
    assert.equal(vm.runInNewContext(expression, {...ready,...blocked}), true, 'Unsafe checkout must stay disabled');
  }
}
console.log('checkout shipping presentation check passed');
