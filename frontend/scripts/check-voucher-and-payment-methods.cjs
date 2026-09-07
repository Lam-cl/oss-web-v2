const assert=require('node:assert/strict');
const {parse,find,ts}=require('./test-source-helpers.cjs');
const tree=parse('src/app/api/bundle/checkout/route.ts');
const fn=find(tree,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='bundleCheckoutPayload')[0];
const code=ts.transpileModule(fn.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported={};new Function('exports',code)(exported);
const {bundleCheckoutPayload}=exported;
for(const paymentMethodId of [undefined,'16','2','3','unexpected']){
 const payload=bundleCheckoutPayload({checkoutData:{paymentMethodId},upstreamItems:[],billingAddress:{},shippingAddress:{},customerName:'QA',customerEmail:'qa@example.com',customerPhone:'1',deliveryOption:'PICKUP',paymentMethodId,voucherCode:'TEST',expectedAmount:39});
 assert(!Object.hasOwn(payload,'paymentMethodId'));assert(!Object.hasOwn(payload,'paymentType'));
 assert.equal(payload.voucherCode,'TEST');assert.equal(payload.expectedTotal,39);
}
const form=parse('src/app/checkout/page.tsx');
assert.equal(find(form,n=>ts.isJsxAttribute(n)&&n.name.text==='name'&&n.initializer?.text==='merchPaymentMethod').length,0,'no nonfunctional payment selector');
const admin=parse('src/app/admin/vouchers/page.tsx');
const methods=find(admin,n=>ts.isPropertyAssignment(n)&&n.name.getText(admin)==='method').map(n=>n.initializer.text);
assert(methods.includes('DELETE')&&methods.includes('PATCH'));
console.log('Gateway-selected merchandise payment payload and voucher mutation methods passed');
