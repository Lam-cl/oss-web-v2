const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/components/admin/ProductDrawer.tsx','utf8');
assert(source.includes("type EditableProductVariant = Omit<ProductVariant, 'inventory'> & { inventory: number | '' };"),'variant inventory editor must allow a temporarily empty field');
assert(source.includes("inventory: event.target.value === '' ? '' : Number(event.target.value)"),'clearing inventory must not immediately restore zero');
assert(source.includes('inventory: Number(inventory)'),'saved inventory must remain numeric at the API boundary');
console.log('admin variant inventory input check passed');
