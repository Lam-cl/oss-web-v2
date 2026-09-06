const assert=require('node:assert/strict');
const {compile}=require('./test-source-helpers.cjs');
const products=[
 {id:801,title:'Fixture Cap',slug:'fixture-cap',price:12,tags:[],productVariants:[{id:901,price:14,inventory:25}],options:[{values:[{id:1,value:'Black'},{id:2,value:'Green'}]}]},
 {id:802,slug:'flat-rate-delivery-fee',tags:[]},
 {id:803,slug:'pen-2-0',tags:[]},
 {id:804,slug:'unfinished-product',tags:['_tonewow_setup_draft']},
];
let status=200;
global.fetch=async(url,init)=>{assert.equal(init.cache,'no-store');return Response.json({data:products,meta:{total:4}},{status});};
const route=compile('src/app/api/bundle/merchandise/route.ts',{
 'next/server':{NextResponse:{json:(value,init)=>Response.json(value,init)}},
 '@/lib/productImageColors.server':{readProductImageColorSettings:async()=>({hiddenOptionValues:{801:[2]},products:{801:{image1:'Black'}}})},
});
(async()=>{
 const response=await route.GET(),body=await response.json();
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 assert.deepEqual(body.data.map(p=>p.id),[801],'Fee, hidden and setup draft items are not public');
 assert.deepEqual(body.data[0].productVariants,products[0].productVariants,'Live variant price and inventory are preserved');
 assert.equal(body.data[0].price,12,'Base price may differ from variant price');
 assert.deepEqual(body.data[0].options[0].values,[{id:1,value:'Black'}]);
 assert.deepEqual(body.data[0].imageColorAssignments,{image1:'Black'});
 status=503;assert.equal((await route.GET()).status,503,'Provider failure is not an empty successful catalogue');
 console.log('Deterministic catalogue visibility, variant stock/prices, colour assignments and failure propagation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
