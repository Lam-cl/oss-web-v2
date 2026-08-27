const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/components/admin/OrderDrawer.tsx','utf8');
assert.equal(source.includes('Customer type'),false,'Customer type must be hidden from the order drawer');
assert.equal(source.includes("customerType:f.get('customerType')||undefined"),false,'Hidden customer type must not be submitted');
console.log('order customer type hidden check passed');
