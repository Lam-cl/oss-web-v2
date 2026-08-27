const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/components/admin/OrderDrawer.tsx','utf8');
const match=source.match(/const statuses\s*=\s*\[([^\]]+)\]/);
assert.ok(match,'Order status options missing');
for(const status of ['PENDING','PROCESSING','PAID']) assert.equal(new RegExp(`["']${status}["']`).test(match[1]),false,status+' must not be selectable');
for(const status of ['SHIPPED','DELIVERED','CANCELLED','REFUNDED']) assert.equal(new RegExp(`["']${status}["']`).test(match[1]),true,status+' must remain selectable');
assert.equal(source.includes('Select next status'),true,'Paid orders need an explicit next-status placeholder');
assert.equal(source.includes('orderPaymentStatus(order)'),true,'Payment display must not reuse fulfilment status directly');
console.log('order status dropdown check passed');
