const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/app/admin/page.tsx','utf8');
assert.equal(source.includes('orders.data.filter(isPaymentConfirmedOrder).slice(0, 7)'),true,'Recent orders must filter payment-confirmed orders before slicing');
assert.equal(source.includes('isPaymentConfirmedOrder'),true,'Dashboard must reuse confirmed-payment helper');
console.log('dashboard recent paid-orders check passed');
