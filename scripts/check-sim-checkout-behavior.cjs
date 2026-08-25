'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
let projection={products:[{bundleProductId:39,combinations:[{variantId:120}]},{bundleProductId:40,combinations:[{variantId:220}]},{bundleProductId:79,combinations:[{variantId:202}]}]};
const file=path.resolve('src/app/api/bundle/checkout/route.ts');
const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const moduleValue={exports:{}};
const stubs={
  'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status||200})}},
  '@/lib/minimumOrderQuantity':{getProductMinimumOrderQuantity:()=>1},
  '@/lib/productSetup':{isProductSetupDraft:()=>false},
  '@/lib/shipping':{calculateCourierCharge:()=>({amount:10,unclassified:[]})},
  '@/lib/pickup':{isKualaLumpurWorkingDay:()=>true,malaysiaDate:()=>'',minimumPickupDate:()=>'',pickupDateFromAddress:()=>''},
  '@/lib/admin/orderMetadata.server':{saveBillingAddress:async()=>{},savePaymentReference:async()=>{}},
  '@/lib/cataloguePublicProjection.server':{readCataloguePublicProjection:async()=>{if(projection instanceof Error)throw projection;return projection}},
  '@/data/merchandise':{mergeBundleMerchandiseProducts:()=>[{apiProductId:23,variantIds:{standard:18}}]},
};
new Function('exports','require','module','__filename','__dirname',output)(moduleValue.exports,id=>id in stubs?stubs[id]:require(id),moduleValue,file,path.dirname(file));
const api=moduleValue.exports;
const products=[
  {id:39,title:'SUPERLITE SIM',slug:'superlite-sim',price:10,productVariants:[{id:106,price:10,inventory:87},{id:120,price:10,inventory:5}]},
  {id:40,title:'BIZ SIM',slug:'biz-sim',price:128,productVariants:[{id:220,price:128,inventory:5}]},
  {id:79,title:'Button Badge',slug:'button-badge',price:5,productVariants:[{id:202,price:5,inventory:7},{id:203,price:5,inventory:9}]},
  {id:23,title:'Legacy Cap',slug:'legacy-cap',price:39,productVariants:[{id:18,price:39,inventory:2},{id:19,price:39,inventory:2}]},
  {id:90,title:'Delivery Fee',slug:'flat-rate-delivery-fee',price:10,productVariants:[{id:700,price:10},{id:701,price:10}]},
];
global.fetch=async()=>({ok:true,json:async()=>({data:products})});
(async()=>{
  await assert.rejects(()=>api.calculateExpectedAmount([{productId:39,variantId:220,quantity:1}],'PICKUP',''),/no longer available|Variant selection/i,'wrong product/variant pair must fail');
  await assert.rejects(()=>api.calculateExpectedAmount([{productId:39,variantId:106,quantity:1}],'PICKUP',''),/Variant selection required/i,'legacy Standard variant must fail');
  await assert.rejects(()=>api.calculateExpectedAmount([{productId:79,variantId:203,quantity:1}],'PICKUP',''),/Variant selection required/i,'unprojected provider variant must fail for every Catalogue product');
  await assert.rejects(()=>api.calculateExpectedAmount([{productId:23,variantId:19,quantity:1}],'PICKUP',''),/Variant selection required/i,'legacy products must use the authoritative mapped allowlist');
  assert.equal((await api.calculateExpectedAmount([{productId:79,variantId:202,quantity:1}],'PICKUP','')).merchandiseSubtotal,5);
  assert.equal((await api.calculateExpectedAmount([{productId:23,variantId:18,quantity:1}],'PICKUP','')).merchandiseSubtotal,39);
  await assert.rejects(()=>api.calculateExpectedAmount([{productId:39,variantId:120,quantity:3},{productId:39,variantId:120,quantity:3}],'PICKUP',''),/stock limit/i,'duplicate lines must aggregate stock');
  projection=new Error('projection unavailable');
  await assert.rejects(()=>api.calculateExpectedAmount([{productId:39,variantId:120,quantity:1}],'PICKUP',''),/projection unavailable/i,'projection outage must fail closed');
  projection={products:[{bundleProductId:39,combinations:[{variantId:120}]},{bundleProductId:40,combinations:[{variantId:220}]},{bundleProductId:79,combinations:[{variantId:202}]}]};
  const calculated=await api.calculateExpectedAmount([{productId:39,variantId:120,quantity:2}],'PICKUP','');
  assert.deepEqual(calculated.upstreamItems,[{productId:39,variantId:120,quantity:2}]);
  const shippingProduct=products.find(product=>product.id===90);
  shippingProduct.productVariants=[{id:700,price:10}];
  assert.deepEqual((await api.calculateExpectedAmount([{productId:39,variantId:120,quantity:1}],'DELIVER','Kuala Lumpur')).upstreamItems,[{productId:39,variantId:120,quantity:1},{productId:90,variantId:700,quantity:1}],'one valid shipping-fee variant remains accepted');
  shippingProduct.productVariants=[{id:700,price:10},{id:701,price:10}];
  let checkoutCalls=0;
  global.fetch=async url=>String(url).endsWith('/products/checkout')?(checkoutCalls++,{ok:true,text:async()=>'{}'}):({ok:true,json:async()=>({data:products})});
  const request={headers:{get:key=>key==='origin'?'https://shop.test':key==='host'?'shop.test':null},json:async()=>({items:[{productId:39,variantId:120,quantity:1}],deliveryOption:'DELIVER',expectedTotal:20,customerName:'Ada Lovelace',customerEmail:'a@test',customerPhone:'1',paymentMethodId:'16',billingAddress:{fullName:'Ada Lovelace',email:'a@test',phone:'1',address:'A',city:'KL',state:'KL',postalCode:'50000'},shippingAddress:{fullName:'Ada Lovelace',email:'a@test',phone:'1',address:'A',city:'KL',state:'Kuala Lumpur',postalCode:'50000'}})};
  const rejected=await api.POST(request);
  assert.match(rejected.body.error,/delivery fee is not configured correctly/i,'multiple shipping-fee variants must be rejected');
  assert.equal(checkoutCalls,0,'ambiguous shipping-fee variants must fail before upstream checkout');
  const billingAddress={firstName:'Ada',lastName:'Lovelace',fullName:'Ada Lovelace',email:'a@test',phone:'1',phoneNumber:'1',address:'A',city:'KL',state:'KL',country:'Malaysia',postalCode:'50000',idNumber:'ID'};
  const payload=api.bundleCheckoutPayload({checkoutData:{billingAddress:{idNumber:'ID'},description:'SIM order',notes:'note'},upstreamItems:calculated.upstreamItems,billingAddress,shippingAddress:billingAddress,customerName:'Ada Lovelace',customerEmail:'a@test',customerPhone:'1',deliveryOption:'PICKUP',paymentMethodId:'16',voucherCode:'',expectedAmount:20});
  assert.deepEqual(payload,{customerName:'Ada Lovelace',customerEmail:'a@test',customerPhone:'1',customerType:'retail',customerID:'ID',description:'SIM order',items:[{productId:39,variantId:120,quantity:2}],billingAddress,shippingAddress:billingAddress,isGuest:true,deliveryOption:'PICKUP',agentId:undefined,paymentMethodId:'16',voucherCode:undefined,expectedTotal:20,shippingCost:0,notes:'note'});
  assert.equal(JSON.stringify(payload).includes('FormData'),false);
  console.log('SIM checkout authoritative pair, stock and exact JSON payload checks passed');
})().catch(error=>{console.error(error);process.exit(1)});
