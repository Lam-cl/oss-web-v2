const assert=require('node:assert/strict'),fs=require('node:fs');
const css=['src/app/globals.css','src/app/merchandise-parity.css'].map(file=>fs.readFileSync(file,'utf8')).join('\n');
assert(!css.includes('body:has(.merch-catalog) #fc_widget'),'Merchandise must not hide Freshworks');
assert(css.includes('body:has(.merch-catalog) .referral-floating-widget'),'Referral must not overlap the merchandise cart');
assert(css.includes('right: 97px;'),'Mobile cart stays left of chat');
for(const route of ['/cart','/checkout'])require('./test-balam-behavior.cjs')(route);
console.log('Current mobile chat offset, checkout/modal hiding and recovery passed');
