const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/app/checkout/page.tsx','utf8');
for(const forbidden of ['Promoter ID (optional)','verifyPromoter','promoterPrefix','promoterCode','agentId:']) assert.equal(source.includes(forbidden),false,`checkout still contains ${forbidden}`);
console.log('checkout promoter field removal check passed');
