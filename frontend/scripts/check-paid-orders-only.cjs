const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const sandboxModule={exports:require('../src/lib/admin/types.ts')};
const {isPaymentConfirmedOrder}=sandboxModule.exports;
for(const status of ['PAID','PROCESSING','SHIPPED','DELIVERED']) assert.equal(isPaymentConfirmedOrder({status}),true,status+' must remain visible');
for(const status of ['PENDING','CANCELLED','REFUNDED','']) assert.equal(isPaymentConfirmedOrder({status}),false,status+' must be hidden');
console.log('confirmed-payment order filter check passed');
