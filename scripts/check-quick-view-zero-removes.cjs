const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/components/home/MerchandiseSection.tsx','utf8');
assert.equal(source.includes('const removeItem = useCartStore((state) => state.removeItem);'),true,'quick view must access cart removal');
assert.equal((source.match(/value <= selectedProduct\.minimumOrderQuantity \? 0 : value - 1/g)||[]).length,2,'desktop and mobile minus must reach zero');
assert.equal(source.includes('if (quantity === 0)'),true,'zero quantity must remove selected cart variant');
assert.equal(source.includes("quantity === 0 ? 'Remove from Cart'"),true,'zero state must explain removal action');
console.log('quick-view zero quantity removal check passed');
