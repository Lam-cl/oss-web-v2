const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/hooks/useCatalogueProductEditor.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const loaded = new Module(file, module); loaded.filename=file; loaded.paths=Module._nodeModulePaths(path.dirname(file));
const originalLoad=Module._load; Module._load=(request,parent,isMain)=>request==='react'?{useCallback(){},useEffect(){},useMemo(factory){return factory()},useState(){}}:originalLoad.call(Module,request,parent,isMain);
try{loaded._compile(output,file)}finally{Module._load=originalLoad}
const ids = {
  product:'39a00000-0000-4000-8000-000000000039', a:'49a00000-0000-4000-8000-000000000049',
  b:'59a00000-0000-4000-8000-000000000059', c:'69a00000-0000-4000-8000-000000000069',
};
const model={details:{title:'Yellow Pen',price:2,description:''},choices:[{key:'colour',name:'Colour',values:[{key:'red',label:'Red',retired:false}]}],combinations:[{valueKeys:['red'],price:2,inventory:12}],existingImages:[{imageId:71,order:0,assignment:'all',remove:false}]};
const originalProduct={catalogueId:ids.product,revision:4,slug:'yellow-pen',status:'draft',model};
const originalMedia=[
  {mediaId:ids.a,catalogueId:ids.product,originalName:'a.png',contentType:'image/png',bytes:8,order:0,assignment:'all',createdAt:'2026-08-25T00:00:00.000Z',url:'/a'},
  {mediaId:ids.b,catalogueId:ids.product,originalName:'b.png',contentType:'image/png',bytes:8,order:1,assignment:'all',createdAt:'2026-08-25T00:00:01.000Z',url:'/b'},
  {mediaId:ids.c,catalogueId:ids.product,originalName:'c.png',contentType:'image/png',bytes:8,order:2,assignment:'all',createdAt:'2026-08-25T00:00:02.000Z',url:'/c'},
];
const intent={spec:{...model,details:{...model.details,title:'Safer Yellow Pen'},existingImages:[]},existingMedia:[
  {mediaId:ids.a,url:'/a',order:0,assignment:'red',remove:false},
  {mediaId:ids.b,url:'/b',order:3,assignment:'all',remove:true},
  {mediaId:ids.c,url:'/c',order:4,assignment:'all',remove:true},
],pendingPhotos:[
  {key:'p1',file:new File([new Uint8Array([1])],'one.png',{type:'image/png'}),order:1,assignment:'all'},
  {key:'p2',file:new File([new Uint8Array([2])],'two.png',{type:'image/png'}),order:2,assignment:'red'},
]};
const clone=structuredClone;
function harness(mode='success'){
  let product=clone(originalProduct),media=clone(originalMedia),postCount=0,operation=null,finalizeCalls=0; const calls=[];
  const finalMedia=()=>media.filter(item=>item.mediaId!==ids.b&&item.mediaId!==ids.c).sort((a,b)=>a.order-b.order);
  const commit=(operationId)=>{media=finalMedia();operation={operationId,status:'committed'}};
  const fetcher=async(urlValue,init={})=>{
    const url=String(urlValue),method=init.method||'GET',isRemoval=url.includes('/media-removals/'),isCollection=url.endsWith('/media'),mediaId=!isCollection&&url.includes('/media/')&&!isRemoval?decodeURIComponent(url.split('/').pop()):null;
    calls.push({url,method});
    if(isRemoval&&method==='POST'){
      finalizeCalls++; const requested=JSON.parse(init.body).mediaIds, operationId=decodeURIComponent(url.split('/').pop()); assert.deepEqual(requested,[ids.b,ids.c]);
      if(mode==='rollback'||mode==='second-removal-failure'){operation={operationId,status:'rolled_back'};return Response.json({message:'Injected atomic rollback'},{status:500})}
      commit(operationId);
      if(mode==='response-loss'||mode==='readback-unavailable')throw new Error('Injected response loss');
      if(mode==='commit-then-error')return Response.json({message:'Injected commit response error'},{status:500});
      return Response.json({operation,media:clone(media)});
    }
    if(isRemoval&&method==='GET'){
      if(mode==='readback-unavailable')throw new Error('Injected reconciliation unavailable');
      return operation?Response.json({operation,media:clone(media)}):new Response(null,{status:404});
    }
    if(method==='GET'&&isCollection)return Response.json({media:clone(media).sort((a,b)=>a.order-b.order)});
    if(method==='GET')return Response.json({product:clone(product)});
    if(method==='POST'){
      postCount++; const item={mediaId:`new-${postCount}`,catalogueId:ids.product,originalName:init.body.get('file').name,contentType:'image/png',bytes:1,order:Number(init.body.get('order')),assignment:init.body.get('assignment'),createdAt:`2026-08-25T00:01:0${postCount}.000Z`,url:`/new-${postCount}`};media.push(item);return Response.json({media:clone(item)});
    }
    if(method==='PATCH'&&mediaId){const patch=JSON.parse(init.body),item=media.find(candidate=>candidate.mediaId===mediaId);if(!item)return Response.json({message:'not found'},{status:404});if(patch.order!==undefined&&media.some(candidate=>candidate!==item&&candidate.order===patch.order))return Response.json({message:'duplicate order'},{status:400});Object.assign(item,patch);return Response.json({media:clone(item)})}
    if(method==='PATCH'){const body=JSON.parse(init.body);if(body.revision!==product.revision)return Response.json({message:'revision conflict'},{status:409});product={...product,revision:product.revision+1,slug:body.slug,model:clone(body.model)};return Response.json({product:clone(product)})}
    if(method==='DELETE'&&mediaId){const index=media.findIndex(item=>item.mediaId===mediaId);if(index<0)return Response.json({message:'not found'},{status:404});return Response.json({media:media.splice(index,1)[0]})}
    return Response.json({message:'unexpected'},{status:405});
  };
  return {fetcher,getMedia:()=>clone(media),getProduct:()=>clone(product),calls,finalizeCalls:()=>finalizeCalls};
}
(async()=>{
  for(const mode of ['rollback','second-removal-failure']){
    const h=harness(mode);await assert.rejects(()=>loaded.exports.createCatalogueProductEditorClient(h.fetcher).save(originalProduct,intent),/rollback|Injected|could not be saved/i);
    assert.deepEqual(h.getMedia(),originalMedia,`${mode}: all old metadata remains exact`);assert.equal(h.getProduct().slug,originalProduct.slug);assert.deepEqual(h.getProduct().model,originalProduct.model,`${mode}: product content compensation is exact`);
  }
  for(const mode of ['success','response-loss','commit-then-error']){
    const h=harness(mode),saved=await loaded.exports.createCatalogueProductEditorClient(h.fetcher).save(originalProduct,intent);
    assert.deepEqual(saved.media.map(({mediaId,order})=>({mediaId,order})),[{mediaId:ids.a,order:0},{mediaId:'new-1',order:1},{mediaId:'new-2',order:2}]);
    assert.equal(h.finalizeCalls(),1,`${mode}: one whole-set finalization call`);
    assert.equal(h.calls.some(call=>call.method==='DELETE'&&(call.url.endsWith(ids.b)||call.url.endsWith(ids.c))),false,'old media are never deleted individually');
  }
  {
    const h=harness(),sameIntent={spec:clone(model),inventoryChanges:[],existingMedia:originalMedia.map(item=>({mediaId:item.mediaId,url:item.url,order:item.order,assignment:item.assignment,remove:false})),pendingPhotos:[]};
    const saved=await loaded.exports.createCatalogueProductEditorClient(h.fetcher).save(originalProduct,sameIntent);
    assert.equal(saved.product.revision,originalProduct.revision,'an inventory-only/no-op content save does not create a false catalogue revision');
    assert.equal(h.calls.some(call=>call.method==='PATCH'),false,'unchanged catalogue content is not PATCHed');
  }
  const uncertain=harness('readback-unavailable');
  await assert.rejects(()=>loaded.exports.createCatalogueProductEditorClient(uncertain.fetcher).save(originalProduct,intent),/uncertain|reconcil/i);
  assert.deepEqual(uncertain.getMedia().map(item=>item.mediaId),[ids.a,'new-1','new-2'],'unavailable readback cannot cause partial old-media loss');
  console.log('Catalogue product editor loss-safe save check passed');
})().catch(error=>{console.error(error);process.exit(1)});
