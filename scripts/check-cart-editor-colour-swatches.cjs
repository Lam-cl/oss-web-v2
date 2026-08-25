const fs=require('fs');const assert=require('assert');
const source=fs.readFileSync('src/components/merchandise/CartMerchandiseEditor.tsx','utf8');
assert(!source.includes("product.optionLabel === 'Colour'"),'cart editor must not require British spelling');
assert((source.match(/\^colou\?r\$\/i\.test\(product\.optionLabel \|\| (?:''|"")\)/g)||[]).length>=2,'Color and Colour must both render swatches');
console.log('Cart editor colour swatch check passed');
