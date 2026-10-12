const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = process.cwd();
const file = path.join(root, 'src/lib/admin/catalogueBundleAdapter.server.ts');
function load() {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const m = { exports: {} }; new Function('exports','require','module','__filename','__dirname',output)(m.exports, require, m, file, path.dirname(file)); return m.exports;
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
(async () => {
  const { createCatalogueBundleAdapter } = load();
  const hash = 'a'.repeat(64), op = 'b'.repeat(64), suffix = `\n[[TW-CATALOGUE-DRAFT:${op}]]`, titleSuffix=' [TW-bbbbbbbb-a2]', canonicalTitle='M'.repeat(200), providerCleanTitle='M'.repeat(200-' [TW-bbbbbbbb-a2]'.length), providerSku='MUG-A-TW00000000V2';
  let product = null;
  const calls = [], hidden = [];
  const job = {operationId:op,revision:2,catalogueId:'00000000-0000-4000-8000-000000000000',resolved:{images:{hero:9,back:8},options:{},values:{},variants:{}},bindings:[]};
  const media = [
    {mediaId:'hero',originalName:'hero.png',contentType:'image/png',order:0,sha256:hash},
    {mediaId:'back',originalName:'back.png',contentType:'image/png',order:1,sha256:'c'.repeat(64)},
  ];
  const local = {
    readPublication: async operationId => operationId === op ? job : null,
    readProductPublication: async productId => productId === 7 ? {...job,operationId:op,draftBundleProductId:7} : null,
    readMedia: async () => media,
    hideOptionValues: async (id, valueIds) => hidden.push([id, valueIds]),
    activateVersion: async () => undefined,
    readActivation: async (operationId, productId) => ({ active:true, operationId, productId, fingerprint:hash }),
    readActiveVersions: async () => [{ active:true, operationId:op, productId:7, fingerprint:hash }],
  };
  function applyMetadata(form) {
    product.isPreOrder = form.get('isPreOrder') === 'true';
    for (const key of ['title','description','type','price','shippingCost','weight']) if (form.get(key) !== null) product[key] = key === 'price' ? Number(form.get(key)) : String(form.get(key));
    // Real-provider failure mode: taxonomy is irreversibly discarded on every PUT.
    product.categories = []; product.tags = [];
  }
  const fetcher = async (url, init) => {
    const u = new URL(String(url)); calls.push([init.method, u.pathname, u.search, init.body]);
    if (u.pathname.endsWith('/products/upload')) {
      product = { id:7, title:String(init.body.get('title')), description:String(init.body.get('description')), type:String(init.body.get('type')), price:Number(init.body.get('price')), shippingCost:String(init.body.get('shippingCost')), weight:String(init.body.get('weight')), categories:[], tags:[], images:[], options:[], productVariants:[], deletedAt:null, isPreOrder:init.body.get('isPreOrder')==='true', requiresSimAssignment:init.body.get('requiresSimAssignment')==='true', tracksInventory:init.body.get('tracksInventory')==='true' };
      return json({ data:product }, 201);
    }
    if (u.pathname.endsWith('/products') && init.method === 'GET') return json({ data: product ? [product] : [] });
    if (u.pathname.endsWith('/products/7/variants')) {
      product.options = [{ id:10, name:'Catalogue Variant', values:[{id:11,value:'CV-A'}] }];
      product.productVariants = [{id:12,sku:'WATER-CV-A',price:null,inventory:0,selectedOptions:[]}];
      return json({ success:true }, 201);
    }
    if (u.pathname.endsWith('/products/7/batch-update')) { Object.assign(product.productVariants[0], JSON.parse(init.body).variants[0]); return json({success:true},201); }
    if (u.pathname.endsWith('/products/7/images/order')) return json({success:true});
    if (u.pathname.endsWith('/products/7') && init.method === 'PUT') {
      applyMetadata(init.body);
      if (init.body.get('images')) product.images.push({id:product.images.length ? 8 : 9,url:product.images.length ? '/back.png' : '/hero.png'});
      return json({data:product});
    }
    if (u.pathname.endsWith('/products/6/soft-delete')) return json({success:true});
    if (u.pathname.endsWith('/products/6')) return json({data:{id:6,deletedAt:'2026-08-24T00:00:00.000Z'}});
    if (u.pathname.endsWith('/products/7')) return json({data:product});
    throw new Error(`unexpected ${init.method} ${u}`);
  };
  const make = () => createCatalogueBundleAdapter({baseUrl:'https://bundle.test/api',token:'server-token',fetcher,local});
  const adapter = make();
  assert.equal(adapter.draftMarker, 'TW-CATALOGUE-DRAFT');
  await assert.rejects(()=>adapter.createDraft({draft:true,draftMarker:adapter.draftMarker,operationId:op,attemptRevision:3,title:canonicalTitle,description:'Keeps warm',price:10,categories:['SIM Card'],tags:['ignored']}),/revision|publication/i);
  const draft = await adapter.createDraft({draft:true,draftMarker:adapter.draftMarker,operationId:op,attemptRevision:2,title:canonicalTitle,description:'Keeps warm',price:10,categories:['SIM Card'],tags:['ignored'],isPreOrder:true});
  assert.equal(product.isPreOrder,true);
  assert.equal(draft.data.id, 7);
  assert.equal(product.title, `${canonicalTitle.slice(0,200-titleSuffix.length)}${titleSuffix}`);
  assert.equal(product.title.length, 200);
  assert.equal(product.description, `Keeps warm${suffix}`);
  assert.equal(product.requiresSimAssignment, true); assert.equal(product.tracksInventory, true);
  assert.deepEqual(product.categories, []); assert.deepEqual(product.tags, []);
  const authoritativeDraft = await adapter.findDraftByOperation(op);
  assert.equal(authoritativeDraft.id, 7);
  assert.equal(authoritativeDraft.title, providerCleanTitle);
  assert.equal(authoritativeDraft.description, 'Keeps warm');
  const providerDescription = product.description;
  product.description = 'Keeps warm\r\nProduct details:\r\n- Cotton' + suffix.replace('\n', '\r\n');
  const multilineDraft = (await adapter.readProduct(7)).data;
  assert.equal(multilineDraft.description, 'Keeps warm\nProduct details:\n- Cotton', 'provider CRLF descriptions must normalize before metadata verification');
  product.description = providerDescription;
  assert.equal(authoritativeDraft.draftOperationId, op);
  assert.equal(authoritativeDraft.draft, true); assert.equal(authoritativeDraft.published, false);
  // Full metadata image PUT preserves the raw marker and verifies it after each image.
  await adapter.uploadImage(7,{key:'hero',name:'hero.png',contentType:'image/png',order:0,body:Buffer.from([137,80,78,71,13,10,26,10]),sha256:hash,operationId:op});
  assert.equal(product.description, `Keeps warm${suffix}`);
  assert.equal(product.title, `${canonicalTitle.slice(0,200-titleSuffix.length)}${titleSuffix}`);
  await adapter.uploadImage(7,{key:'back',name:'back.png',contentType:'image/png',order:1,body:Buffer.from([137,80,78,71,13,10,26,10,1]),sha256:'c'.repeat(64),operationId:op});
  assert.equal(product.description, `Keeps warm${suffix}`);
  const compiled = await adapter.createCompiledVariants(7,{optionName:'Catalogue Variant',values:['CV-A'],hidden:true,autoGenerateSku:true,defaultInventory:0,operationId:op});
  assert.deepEqual(compiled,{optionId:10,valueIdByCode:{'CV-A':11},variantIdByCode:{'CV-A':12}});
  assert.deepEqual(hidden,[[7,[11]]]);
  // Normalized SKUs intentionally lose the generated CV code. The persisted
  // checkpoint, not provider row order, is the binding evidence after restart.
  job.resolved.options={'catalogue-variant':compiled.optionId};
  job.resolved.values={...compiled.valueIdByCode};
  job.bindings=Object.entries(compiled.variantIdByCode).map(([code,variantId])=>({valueKeys:[code],variantId}));
  await adapter.batchUpdateVariants(7,[{id:12,sku:providerSku,price:10,inventory:2}]);
  // Restart has no pending-memory state; durable job + suffix recover composition.
  const resumed = make();
  const composed = (await resumed.readProduct(7)).data;
  assert.equal(composed.description, 'Keeps warm'); assert.equal(composed.draft, true);
  assert.deepEqual(composed.productVariants[0].selectedOptions,[{optionId:10,valueId:11,value:'CV-A'}]);
  assert.equal(composed.productVariants[0].sku,providerSku);
  assert.deepEqual(composed.images.map(x=>x.uploadKey),['hero','back']);
  await resumed.publishProduct(7,op);
  assert.equal(product.description, 'Keeps warm');
  assert.equal(product.title, `${canonicalTitle.slice(0,200-titleSuffix.length)}${titleSuffix}`);
  assert.equal((await resumed.readPublicationState(7)).data.published,true);
  const publishedAfterRestart = (await make().readProduct(7)).data;
  assert.equal(publishedAfterRestart.title, providerCleanTitle);
  assert.deepEqual(publishedAfterRestart.images.map(x=>x.uploadKey),['hero','back']);
  assert.deepEqual(publishedAfterRestart.productVariants[0].selectedOptions,[{optionId:10,valueId:11,value:'CV-A'}]);
  assert.equal(publishedAfterRestart.productVariants[0].sku,providerSku);
  await make().restoreDraft(7,op);
  assert.equal(product.description, `Keeps warm${suffix}`);
  assert.equal((await resumed.readPublicationState(7)).data.draft,true);
  // Discovery is exact and bounded; duplicate, malformed and multiple markers fail closed.
  const original = product.description;
  product.description = `${original}\n[[TW-CATALOGUE-DRAFT:${op}]]`;
  await assert.rejects(()=>adapter.findDraftByOperation(op),/malformed|multiple|ambiguous/i);
  await assert.rejects(()=>adapter.readProduct(7),/malformed|multiple|ambiguous/i);
  product.description = 'Mug [[TW-CATALOGUE-DRAFT:not-a-hash]]';
  await assert.rejects(()=>adapter.readPublicationState(7),/malformed/i);
  product.description = original;
  const originalTitle = product.title;
  product.title = `${providerCleanTitle.slice(0,100)}${titleSuffix}${titleSuffix}`;
  await assert.rejects(()=>adapter.readProduct(7),/title suffix.*malformed|duplicate|ambiguous/i);
  product.title = `${canonicalTitle.slice(0,180)} [TW-bbbbbbbb-aX]`;
  await assert.rejects(()=>adapter.readPublicationState(7),/title suffix.*malformed|reserved/i);
  product.title = originalTitle;
  await adapter.activateVersion(7,[],hash,null,op);
  await adapter.retirePreviousVersion(6,7,op);
  assert.equal((await adapter.readRetirement(6,7)).retired,true);
  const availability = await adapter.checkGlobalSkuAvailability(['MUG-A'],{excludeProductIds:[7]});
  assert.equal(availability.available,true);
  assert(calls.some(([m,p,,body])=>m==='PUT'&&p==='/api/products/7'&&body.get('images')&&body.get('description')===`Keeps warm${suffix}`));
  assert.equal(product.isPreOrder,true,'image PUT, publish and restore preserve pre-order');
  for (const isPreOrder of [false,true,false]) {
    job.resolved.options={};job.resolved.values={};job.bindings=[];
    const fresh=make();
    await fresh.createDraft({draft:true,draftMarker:fresh.draftMarker,operationId:op,attemptRevision:2,title:'Pre-order test',description:'Test',price:10,categories:[],tags:[],isPreOrder});
    assert.equal(product.isPreOrder,isPreOrder);
    await fresh.publishProduct(7,op);assert.equal(product.isPreOrder,isPreOrder);
  }
  for (const [,p] of calls) assert.doesNotMatch(p,/catalogue\/(drafts|activations|retirements|sku-availability)|compiled-variants|publication-state|publish|restore-draft|catalogue-images/);

  // Production-like Water Bottle response: every selectedOptions array is
  // empty, generated SKUs upper-case the codes, and neither array is stable.
  const codes=['CV-52d472e72faae6f5af0a143a','CV-ef9fbefa5b5beb61fd03ac9e','CV-262f104b4c868211311bb4c3'];
  const correct={optionId:175,valueIdByCode:{[codes[0]]:725,[codes[1]]:726,[codes[2]]:727},variantIdByCode:{[codes[0]]:778,[codes[1]]:779,[codes[2]]:780}};
  const unnormalized={id:195,title:'Water Bottle 500ml'+titleSuffix,description:'Bottle'+suffix,images:[],options:[{id:175,name:'Catalogue Variant',values:[{id:727,value:codes[2]},{id:725,value:codes[0]},{id:726,value:codes[1]}]}],productVariants:[
    {id:779,sku:'WATER-'+codes[1].toUpperCase(),price:null,inventory:0,selectedOptions:[]},
    {id:780,sku:'WATER-'+codes[2].toUpperCase(),price:null,inventory:0,selectedOptions:[]},
    {id:778,sku:'WATER-'+codes[0].toUpperCase(),price:null,inventory:0,selectedOptions:[]},
  ]};
  const emptyMappingJob={operationId:op,draftBundleProductId:195,revision:6,catalogueId:job.catalogueId,resolved:{images:{},options:{},values:{},variants:{}},bindings:[]};
  const checkpoint={...emptyMappingJob,resolved:{...emptyMappingJob.resolved,options:{'catalogue-variant':175},values:correct.valueIdByCode},bindings:codes.map(code=>({valueKeys:[code],variantId:correct.variantIdByCode[code]}))};
  function mappingFixture(raw=unnormalized,stored=emptyMappingJob) {
    const result={raw:structuredClone(raw),stored:structuredClone(stored),writes:[],hidden:[],reads:[],extraProducts:[]};
    result.make=()=>createCatalogueBundleAdapter({baseUrl:'https://bundle.test/api',token:'mock-token',local:{...local,
      readPublication:async()=>result.stored,readProductPublication:async()=>result.stored,readMedia:async()=>[],
      hideOptionValues:async(id,valueIds)=>result.hidden.push([id,valueIds]),
    },fetcher:async(url,init)=>{
      const pathname=new URL(String(url)).pathname;
      if(init.method==='POST'&&pathname===`/api/products/${result.raw.id}/variants`){result.writes.push(JSON.parse(init.body));return json({success:true},201);}
      if(init.method==='GET')result.reads.push(pathname);
      if(init.method==='GET'&&pathname==='/api/products')return json({data:[...result.extraProducts,result.raw]});
      if(init.method==='GET'&&pathname===`/api/products/${result.raw.id}`)return json(result.raw);
      throw new Error('Unexpected mapping fixture request');
    }});
    result.adapter=result.make();return result;
  }
  const compileRequest={optionName:'Catalogue Variant',values:codes,hidden:true,autoGenerateSku:true,defaultInventory:0,operationId:op};
  const shuffled=mappingFixture();
  assert.deepEqual(await shuffled.adapter.createCompiledVariants(195,compileRequest),correct,'compiled bindings use code identity, not either shuffled array position');
  assert.deepEqual(Object.keys(correct.variantIdByCode),codes,'request code order is retained');
  assert.deepEqual(shuffled.hidden,[[195,[725,726,727]]]);
  shuffled.stored=structuredClone(checkpoint);
  const rawOrder=shuffled.raw.productVariants.map(variant=>variant.id);
  const composedMapping=(await shuffled.make().readProduct(195)).data;
  assert.deepEqual(composedMapping.productVariants.map(variant=>variant.id),rawOrder,'provider row order is irrelevant and need not be rewritten');
  composedMapping.productVariants.forEach(variant=>assert.equal(correct.variantIdByCode[variant.selectedOptions[0].value],variant.id));
  assert.deepEqual(shuffled.raw,unnormalized,'composition does not mutate the raw provider response');

  // Real retry after retiring draft 195: the provider retains its generated
  // SKUs and disambiguates draft 196 with a numeric suffix, while both response
  // arrays are still shuffled and selectedOptions remains empty.
  const retryOperation='e0bb57bb3cd8f684eb79b11ae55ef47ad53982a746f015971c47e1bfc100ad02';
  const retryCorrect={optionId:176,valueIdByCode:{[codes[0]]:728,[codes[1]]:729,[codes[2]]:730},variantIdByCode:{[codes[0]]:781,[codes[1]]:782,[codes[2]]:783}};
  const retryRaw={id:196,title:'Water Bottle 500ml [TW-e0bb57bb-a2]',description:`Bottle\n[[TW-CATALOGUE-DRAFT:${retryOperation}]]`,deletedAt:null,images:[],options:[{id:176,name:'Catalogue Variant',values:[{id:730,value:codes[2]},{id:728,value:codes[0]},{id:729,value:codes[1]}]}],productVariants:[
    {id:782,sku:'WATER-'+codes[1].toUpperCase()+'-1',price:null,inventory:0,selectedOptions:[]},
    {id:783,sku:'WATER-'+codes[2].toUpperCase()+'-1',price:null,inventory:0,selectedOptions:[]},
    {id:781,sku:'WATER-'+codes[0].toUpperCase()+'-1',price:null,inventory:0,selectedOptions:[]},
  ]};
  const retryJob={...emptyMappingJob,operationId:retryOperation,draftBundleProductId:196,revision:4};
  const retryCheckpoint={...retryJob,resolved:{...retryJob.resolved,options:{'catalogue-variant':176},values:retryCorrect.valueIdByCode},bindings:codes.map(code=>({valueKeys:[code],variantId:retryCorrect.variantIdByCode[code]}))};
  const retryRequest={...compileRequest,operationId:retryOperation};
  function retryFixture(stored=retryJob){
    const fixture=mappingFixture(retryRaw,stored);
    fixture.extraProducts=[{id:99,title:'Unrelated product',description:'Normal merchandise',deletedAt:null},{...unnormalized,deletedAt:'2026-10-12T06:00:44.206Z'}];
    return fixture;
  }
  function assertRetryMapping(composed,label){
    assert.equal(composed.id,196,label+' selects the current draft');
    assert.deepEqual(composed.productVariants.map(variant=>variant.id),[782,783,781],label+' does not assume provider row ordering');
    for(const variant of composed.productVariants){
      const selected=variant.selectedOptions[0];
      assert.equal(selected.optionId,176,label+' retains option identity');
      assert.equal(retryCorrect.variantIdByCode[selected.value],variant.id,label+' maps code to exact variant ID');
      assert.equal(retryCorrect.valueIdByCode[selected.value],selected.valueId,label+' maps code to exact value ID');
    }
  }
  for(const numericSuffix of ['1','2','10']){
    const retry=retryFixture();
    retry.raw.productVariants.forEach(variant=>{variant.sku=variant.sku.replace(/-1$/,'-'+numericSuffix);});
    assertRetryMapping(await retry.adapter.findDraftByOperation(retryOperation),'discovery with -'+numericSuffix);
    assert.deepEqual(retry.writes,[],'discovery never recreates variants for -'+numericSuffix);
    assertRetryMapping((await retry.make().readProduct(196)).data,'readback with -'+numericSuffix);
    assert.deepEqual(retry.writes,[],'readback never recreates variants for -'+numericSuffix);
    assert.deepEqual(await retry.make().createCompiledVariants(196,retryRequest),retryCorrect,'compiled callback attests the suffix without changing identity');
    assert.deepEqual(retry.raw.productVariants.map(variant=>variant.selectedOptions),[[],[],[]],'composition does not alter raw evidence');
  }
  const checkpointedRetry=retryFixture(retryCheckpoint);
  assertRetryMapping((await checkpointedRetry.make().readProduct(196)).data,'durable retry readback');
  assert.deepEqual(checkpointedRetry.hidden,[],'checkpointed retry needs no new hidden-option state');
  for(const [label,mutate]of [
    ['arbitrary suffix',raw=>{raw.productVariants[0].sku=raw.productVariants[0].sku.replace(/-1$/,'-copy');}],
    ['zero suffix',raw=>{raw.productVariants[0].sku=raw.productVariants[0].sku.replace(/-1$/,'-0');}],
    ['leading-zero suffix',raw=>{raw.productVariants[0].sku=raw.productVariants[0].sku.replace(/-1$/,'-01');}],
    ['multiple numeric suffixes',raw=>{raw.productVariants[0].sku+='-2';}],
    ['duplicate suffixed code',raw=>{raw.productVariants[0].sku=raw.productVariants[1].sku.replace(/-1$/,'-2');}],
    ['unknown suffixed code',raw=>{raw.productVariants[0].sku='WATER-CV-'+ 'f'.repeat(24)+'-1';}],
    ['selected value/SKU disagreement',raw=>{raw.productVariants[0].selectedOptions=[{optionId:176,valueId:728,value:codes[0]}];}],
  ]){
    const invalid=retryFixture();mutate(invalid.raw);
    await assert.rejects(()=>invalid.adapter.findDraftByOperation(retryOperation),/ambiguous|missing|invalid|contradict/i,label+' is rejected during discovery');
    await assert.rejects(()=>invalid.make().readProduct(196),/ambiguous|missing|invalid|contradict/i,label+' is rejected during direct readback');
    assert.deepEqual(invalid.writes,[],label+' causes no provider writes');
    assert.deepEqual(invalid.hidden,[],label+' never persists a fabricated mapping');
  }
  const wrongRetryCheckpoint=structuredClone(retryCheckpoint);
  wrongRetryCheckpoint.bindings=codes.map((code,index)=>({valueKeys:[code],variantId:[782,783,781][index]}));
  const conflictingRetry=retryFixture(wrongRetryCheckpoint),unchangedRetryCheckpoint=structuredClone(conflictingRetry.stored);
  await assert.rejects(()=>conflictingRetry.adapter.findDraftByOperation(retryOperation),/contradicts durable publication bindings/i,'numeric suffixes cannot override conflicting durable identities');
  assert.deepEqual(conflictingRetry.stored,unchangedRetryCheckpoint,'durable retry identities are never silently repaired');
  assert.deepEqual(conflictingRetry.writes,[],'conflicting durable retry evidence causes no provider writes');
  const unknownCheckpointedRetry=retryFixture(retryCheckpoint);
  unknownCheckpointedRetry.raw.productVariants[0].sku='WATER-CV-'+ 'f'.repeat(24)+'-10';
  await assert.rejects(()=>unknownCheckpointedRetry.adapter.readProduct(196),/contradict/i,'a numeric suffix on a foreign code cannot fall back to durable identity');

  const selected=mappingFixture();
  selected.raw.productVariants.forEach(variant=>{
    const code=codes.find(code=>correct.variantIdByCode[code]===variant.id);
    variant.sku='CANONICAL-'+variant.id;
    variant.selectedOptions=[{optionId:175,valueId:correct.valueIdByCode[code]}];
  });
  assert.deepEqual(await selected.adapter.createCompiledVariants(195,compileRequest),correct,'explicit option/value IDs independently prove a binding without generated SKUs');

  for(const [label,mutate]of [
    ['missing evidence',raw=>{raw.productVariants[0].sku='NO-CODE';}],
    ['duplicate SKU code',raw=>{raw.productVariants[0].sku=raw.productVariants[1].sku;}],
    ['unknown SKU code',raw=>{raw.productVariants[0].sku='WATER-CV-'+ 'f'.repeat(24);}],
    ['duplicate value ID',raw=>{raw.options[0].values[0].id=raw.options[0].values[1].id;}],
    ['duplicate value code',raw=>{raw.options[0].values[0].value=raw.options[0].values[1].value;}],
    ['duplicate variant ID',raw=>{raw.productVariants[0].id=raw.productVariants[1].id;}],
    ['selected option/SKU disagreement',raw=>{raw.productVariants[0].selectedOptions=[{optionId:175,valueId:725,value:codes[0]}];}],
    ['selected code/value disagreement',raw=>{raw.productVariants[0].selectedOptions=[{optionId:175,valueId:726,value:codes[0]}];}],
    ['wrong option ID',raw=>{raw.productVariants[0].selectedOptions=[{optionId:999,valueId:726,value:codes[1]}];}],
  ]){
    const invalid=mappingFixture();mutate(invalid.raw);
    await assert.rejects(()=>invalid.adapter.createCompiledVariants(195,compileRequest),/ambiguous|missing|invalid|contradict/i,label+' fails closed');
    assert.equal(invalid.hidden.length,0,label+' never persists a fabricated mapping');
  }

  const incorrectCheckpoint=structuredClone(checkpoint);
  incorrectCheckpoint.bindings=codes.map((code,index)=>({valueKeys:[code],variantId:[779,780,778][index]}));
  const stale=mappingFixture(unnormalized,incorrectCheckpoint),originalCheckpoint=structuredClone(stale.stored);
  await assert.rejects(()=>stale.adapter.readProduct(195),/contradicts durable publication bindings/i,'the actual old wrong 195 checkpoint is rejected before price or stock writes');
  assert.deepEqual(stale.stored,originalCheckpoint,'wrong durable bindings are never silently overwritten');
  assert.deepEqual(stale.writes,[],'readback does not attempt to repair the provider graph');

  const normalized=mappingFixture(unnormalized,checkpoint);
  normalized.raw.description='Bottle';
  normalized.raw.productVariants.forEach(variant=>{variant.sku='WATER-CANONICAL-'+variant.id+'-TWddbee112V5';variant.price=29;variant.inventory=12;});
  const historical=(await normalized.adapter.readPublicationState(195)).data;
  assert.equal(historical.published,true,'legacy normalized/published products remain readable from valid durable bindings');
  historical.productVariants.forEach(variant=>assert.equal(correct.variantIdByCode[variant.selectedOptions[0].value],variant.id));
  normalized.raw.productVariants[0].sku='WATER-CV-LEGACY';
  await normalized.make().readProduct(195); // Ordinary canonical suffixes are not compiler CV hashes.
  normalized.stored=structuredClone(emptyMappingJob);
  await assert.rejects(()=>normalized.make().readProduct(195),/missing|ambiguous/i,'normalized SKUs without durable bindings never fall back to row positions');
  console.log('Catalogue durable-marker Bundle adapter check passed');
})().catch(e => { console.error(e); process.exit(1); });
