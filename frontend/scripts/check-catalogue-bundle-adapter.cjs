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
    for (const key of ['title','description','type','price','shippingCost','weight']) if (form.get(key) !== null) product[key] = key === 'price' ? Number(form.get(key)) : String(form.get(key));
    // Real-provider failure mode: taxonomy is irreversibly discarded on every PUT.
    product.categories = []; product.tags = [];
  }
  const fetcher = async (url, init) => {
    const u = new URL(String(url)); calls.push([init.method, u.pathname, u.search, init.body]);
    if (u.pathname.endsWith('/products/upload')) {
      product = { id:7, title:String(init.body.get('title')), description:String(init.body.get('description')), type:String(init.body.get('type')), price:Number(init.body.get('price')), shippingCost:String(init.body.get('shippingCost')), weight:String(init.body.get('weight')), categories:[], tags:[], images:[], options:[], productVariants:[], deletedAt:null, requiresSimAssignment:init.body.get('requiresSimAssignment')==='true', tracksInventory:init.body.get('tracksInventory')==='true' };
      return json({ data:product }, 201);
    }
    if (u.pathname.endsWith('/products') && init.method === 'GET') return json({ data: product ? [product] : [] });
    if (u.pathname.endsWith('/products/7/variants')) {
      product.options = [{ id:10, name:'Catalogue Variant', values:[{id:11,value:'CV-A'}] }];
      product.productVariants = [{id:12,sku:'AUTO',price:null,inventory:0,selectedOptions:[]}];
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
  const draft = await adapter.createDraft({draft:true,draftMarker:adapter.draftMarker,operationId:op,attemptRevision:2,title:canonicalTitle,description:'Keeps warm',price:10,categories:['SIM Card'],tags:['ignored']});
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
  for (const [,p] of calls) assert.doesNotMatch(p,/catalogue\/(drafts|activations|retirements|sku-availability)|compiled-variants|publication-state|publish|restore-draft|catalogue-images/);
  console.log('Catalogue durable-marker Bundle adapter check passed');
})().catch(e => { console.error(e); process.exit(1); });
