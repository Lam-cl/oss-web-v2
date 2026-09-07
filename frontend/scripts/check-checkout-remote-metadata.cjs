const assert=require('node:assert/strict');
const {compile,parse,find,ts}=require('./test-source-helpers.cjs');
async function main(){
 const prior={...process.env},oldFetch=global.fetch;
 let remote=true,readFails=false,writeFails=false,corrupt=false,creates=0,writes=0,fsCalls=0;
 let database={version:1,orders:{'99':{courier:{service:'Existing',trackingNo:'KEEP'},updatedAt:'before'}}};
 const noFS=()=>{fsCalls++;throw Error('Filesystem must not be used')};
 const store=compile('src/lib/admin/orderMetadata.server.ts',{
  'fs/promises':Object.fromEntries(['mkdir','readFile','rename','unlink','writeFile'].map(key=>[key,noFS])),
  '@/lib/dataApiClient.server':{
   dataApiEnabled:()=>remote,
   readRemoteSingleton:async()=>{if(readFails)throw Error('private remote diagnostic');return corrupt?{version:8}:structuredClone(database)},
   mutateRemoteSingleton:async(_key,_fallback,mutate)=>{writes++;if(writeFails)throw Error('private write diagnostic');database=await mutate(structuredClone(database))},
  },
 });
 try{
  process.env.VERCEL='1';process.env.VERCEL_ENV='production';delete process.env.ENABLE_LOCAL_ORDER_METADATA;
  await store.assertOrderMetadataReady();
  process.env.ENABLE_LOCAL_ORDER_METADATA='false';await store.readOrderMetadata(99);
  const route=compile('src/app/api/bundle/checkout/route.ts',{
   '@/lib/admin/orderMetadata.server':store,
   '@/lib/merchandiseCheckoutPolicy.server':{readMerchandiseCheckoutPolicy:async()=>({enabled:true,paymentOrigin:'https://api.gkash.my'})},
   '@/lib/cataloguePublicProjection.server':{readCataloguePublicProjection:async()=>({products:[{bundleProductId:1,combinations:[{variantId:2}],minimumOrderQuantity:1}]})},
   '@/lib/shippingSettings.server':{readShippingSettings:async()=>({})},
   '@/lib/shipping':{calculateCourierCharge:()=>({amount:10,unclassified:[]})},
   '@/lib/productSetup':{isProductSetupDraft:()=>false},
   '@/lib/minimumOrderQuantity':{getProductMinimumOrderQuantity:()=>1},
   '@/data/merchandise':{mergeBundleMerchandiseProducts:()=>[]},
  });
  global.fetch=async(url,options)=>{
   if(String(url).includes('/products?'))return Response.json({data:[{id:1,name:'Test cap',price:39,productVariants:[{id:2,price:39,inventory:10}]},{id:3,slug:'flat-rate-delivery-fee',price:10,productVariants:[{id:4,price:10,inventory:100}]}]});
   assert.equal(String(url),'https://bundleapi.tonewow.com/api/products/checkout');assert.equal(options.method,'POST');creates++;
   return Response.json({orderId:'99',order:{id:99,totalAmount:49},cartId:'TEST-REF',paymentUrl:'https://api.gkash.my/api/paymentform.aspx',paymentParams:{v_cartid:'TEST-REF',v_amount:'49.00'}});
  };
  const address={fullName:'QA Test',address:'Test address',city:'Kuala Lumpur',state:'W.P. Kuala Lumpur',postalCode:'50000'};
  const payload={customerName:'QA Test',customerEmail:'qa@example.com',customerPhone:'01112345678',billingAddress:address,shippingAddress:address,deliveryOption:'DELIVER',items:[{productId:1,variantId:2,quantity:1}],paymentMethodId:'16',expectedTotal:49};
  const request=()=>new Request('https://shop.tonewow.com/bundle/checkout',{method:'POST',headers:{origin:'https://shop.tonewow.com',host:'shop.tonewow.com','content-type':'application/json'},body:JSON.stringify(payload)});
  const ok=await route.POST(request());assert.equal(ok.status,200,JSON.stringify(await ok.clone().json()));
  const success=await ok.json();assert.equal(success.orderId,'99');assert(success.paymentParams.returnurl.includes('orderId=99'));
  assert.equal(creates,1);assert.equal(writes,1,'billing and reference saved in one mutation');
  assert.equal(database.orders['99'].billingAddress.fullName,'QA Test');assert.equal(database.orders['99'].paymentReference.referenceNumber,'TEST-REF');assert.equal(database.orders['99'].courier.trackingNo,'KEEP');
  for(const scenario of ['missing','unavailable','corrupt']){
   creates=0;remote=scenario!=='missing';readFails=scenario==='unavailable';corrupt=scenario==='corrupt';
   const r=await route.POST(request());assert.equal(r.status,503);const data=await r.json();assert.equal(data.code,'ORDER_METADATA_UNAVAILABLE');assert(!data.error.includes('private'));assert.equal(creates,0);
  }
  remote=true;readFails=false;corrupt=false;writeFails=true;creates=0;const snapshot=structuredClone(database);
  const failed=await route.POST(request());assert.equal(failed.status,502);const error=await failed.json();assert.equal(error.code,'ORDER_METADATA_SAVE_FAILED');assert.equal(error.orderId,'99');assert.equal(creates,1);assert.deepEqual(database,snapshot);assert(!error.error.includes('private'));
  remote=false;process.env.ENABLE_LOCAL_ORDER_METADATA='true';await assert.rejects(store.assertOrderMetadataReady(),/required on Vercel/);assert.equal(fsCalls,0);

  // Client helper must retain recovery metadata, not reduce it to a plain message.
  const api=compile('src/lib/api.ts');
  global.fetch=async()=>Response.json(error,{status:502});
  await assert.rejects(api.initiateBundleGuestPayment(payload),e=>e.code==='ORDER_METADATA_SAVE_FAILED'&&e.orderId==='99');
  const tree=parse('src/app/checkout/page.tsx');
  const handler=find(tree,n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)==='handleSubmit')[0];
  const handlerCode=ts.transpileModule('const submit = '+handler.initializer.getText(tree),{fileName:'handler.ts',compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let submissions=0;
  const scope={createdOrderBlocked:false,checkoutAvailability:{enabled:true},shippingSettings:{},shippingSettingsError:'',merchandiseLoading:false,stockIssues:[],grandTotal:49,form:{firstName:'QA',lastName:'Test',email:'qa@example.com',phone:'01112345678',ic:'QA',billingAddress:'Test',billingCity:'KL',billingState:'KL',billingPostcode:'50000'},pickupOption:'delivery',courier:{unclassified:[]},sameAsBilling:true,items:[],checkoutItems:()=>[],formatRM:String,paymentMethodId:'16',promo:null,setSubmitting:()=>{},setError:message=>{scope.message=message},setCreatedOrderBlocked:value=>{scope.createdOrderBlocked=value},initiateBundleGuestPayment:async()=>{submissions++;throw Object.assign(Error(error.error),error)}};
  const submit=new Function('scope',`with(scope){${handlerCode};return submit;}`)(scope);
  await submit({preventDefault(){}});assert.equal(scope.createdOrderBlocked,true);assert.match(scope.message,/99/);
  await submit({preventDefault(){}});assert.equal(submissions,1,'blocked page must not submit another order');
  console.log('Full website checkout + remote metadata: success, atomic save, zero-create preflight failures and post-create recovery passed');
 }finally{global.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);}
}
main().catch(e=>{console.error(e);process.exitCode=1});
