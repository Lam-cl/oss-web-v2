const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const root = process.cwd();
function compile(rel, injected = {}) {
  const file = path.join(root, rel);
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('exports','require','module','__filename','__dirname',out)(module.exports, id => id in injected ? injected[id] : require(id), module, file, path.dirname(file));
  return module.exports;
}
const response = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const next = { NextResponse: { json: (body, init = {}) => response(body, init.status || 200) } };
const model = { details:{title:'Mug',price:10,description:'',category:'Cups'}, choices:[], combinations:[{valueKeys:[],price:10,inventory:1}], existingImages:[] };
const catalogueId = randomUUID();
const fingerprint = 'e'.repeat(64);
const published = () => ({version:1,catalogueId,revision:4,status:'published',slug:'mug',model,currentBundleProductId:501,bundleVersions:[{bundleProductId:400,fingerprint:'d'.repeat(64),publishedAt:'2026-08-23T00:00:00.000Z',retiredAt:'2026-08-23T01:00:00.000Z'},{bundleProductId:501,fingerprint,publishedAt:'2026-08-24T00:00:00.000Z',retiredAt:null}],createdAt:'2026-08-22T00:00:00.000Z',updatedAt:'2026-08-24T00:00:00.000Z'});
function harness(options = {}) {
  let product = options.product ? structuredClone(options.product) : published();
  let updateCount = 0;
  const events = [];
  const stores = {
    readCatalogueProduct: async id => id === catalogueId ? structuredClone(product) : null,
    createCatalogueProduct: async () => { throw new Error('unused'); },
    updateCatalogueProduct: async (id, revision, updater) => {
      assert.equal(id, catalogueId); assert.equal(revision, product.revision); updateCount += 1;
      product = await updater(structuredClone(product)); product.revision += 1; product.updatedAt = '2026-08-24T01:00:00.000Z'; return structuredClone(product);
    },
  };
  const adapter = {
    async findDraftByOperation(operationId) { events.push(['find-draft', operationId]); if (options.findError) throw new Error('draft list timeout'); return options.foundDraft || null; },
    async readPublicationState(id) { events.push(['read-state', id]); if (options.readError) throw new Error('read timeout'); return {data: options.deleted ? {id,deleted:true,deletedAt:'2026-08-24T00:30:00.000Z',published:false} : {id,deleted:false,deletedAt:null,published:true}}; },
    async retirePreviousVersion(previous, replacement, operation) { events.push(['retire', previous, replacement, operation]); if (options.commitThenTimeout) { options.deleted = true; throw new Error('mutation timeout'); } if (options.retireError) throw new Error('mutation timeout'); options.deleted = true; },
    async readActiveVersions() { events.push(['active-list']); if (options.activeError) throw new Error('active list timeout'); return options.activeVersions || []; },
  };
  const actual = compile('src/lib/admin/catalogueAdminRoute.server.ts', {
    'node:fs/promises': {readdir:async directory=>directory.endsWith('catalogue-publications')&&options.job?[{name:`${options.job.operationId}.json`,isFile:()=>true}]:[]},
    'next/server': next,
    '@/lib/admin/server': {getAdminSession:async()=>null,requestIsSameOrigin:()=>false,safeError:(s,p)=>response(p||{},s),BUNDLE_API:'https://bundle.test/api'},
    '@/lib/admin/catalogueProduct.server': stores,
    '@/lib/admin/catalogueMedia.server': {listCatalogueMedia:async()=>[],readVerifiedCatalogueMedia:async()=>null},
    '@/lib/admin/cataloguePublication.server': {readPublicationJob:async operationId=>options.job?.operationId===operationId?structuredClone(options.job):null},
    '@/lib/admin/cataloguePublish.server': {CataloguePublishError:class extends Error{},publishCatalogueProductVersion:async()=>null},
    '@/lib/admin/catalogueBundleAdapter.server': {CatalogueBundleAdapterError:class extends Error{constructor(message,status=502){super(message);this.status=status}},createCatalogueBundleAdapter: options => { assert.equal(options.baseUrl,'https://bundle.test/api'); assert.equal(options.token,'server-token'); return adapter; }},
    '@/lib/admin/catalogueArchive.server': {CatalogueArchiveError:class extends Error{},archiveCatalogueProduct:async()=>{throw new Error('unused');}},
    '@/lib/admin/catalogueAdoption.server': {readCatalogueAdoptionByBundle:async()=>null,rollbackCatalogueAdoption:async()=>({}),supersedeCatalogueAdoption:async()=>({})},
    '@/lib/cataloguePublishedSnapshot.server': {createCataloguePublishedSnapshot:async()=>{throw new Error('unused')},readCataloguePublishedSnapshot:async()=>null},
    '@/lib/productImageColors.server': {saveProductHiddenOptionValues:async()=>[]},
  });
  return { actual, adapter, events, product:()=>structuredClone(product), updates:()=>updateCount };
}
(async () => {
  for (const rel of ['src/app/api/admin/catalogue-products/[id]/unpublish/route.ts','src/app/admin-api/catalogue-products/[id]/unpublish/route.ts']) assert(fs.existsSync(path.join(root, rel)), `${rel} missing`);
  // Route gate: authenticated, same-origin, exact revision body, exact token handoff.
  const calls = [];
  const helper = {readCatalogueAdminSession:async(r,m)=>!r.auth?{session:null,error:response({},401)}:m&&!r.sameOrigin?{session:null,error:response({},403)}:{session:{token:'secret'},error:null},readBoundedCatalogueJson:async r=>r.json(),catalogueAdminError:e=>response({},e.status||500),catalogueAdminRoute:{unpublish:async(id,body,token)=>{calls.push([id,body,token]);return {product:{catalogueId:id}}}}};
  const route = compile('src/app/api/admin/catalogue-products/[id]/unpublish/route.ts', {'next/server':next,'@/lib/admin/catalogueAdminRoute.server':helper});
  const request = ({auth=true,sameOrigin=true,body={revision:4}}={}) => { const r=new Request('https://admin.test/x',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});r.auth=auth;r.sameOrigin=sameOrigin;return r; };
  assert.equal((await route.POST(request({auth:false}),{params:{id:catalogueId}})).status,401);
  assert.equal((await route.POST(request({sameOrigin:false}),{params:{id:catalogueId}})).status,403);
  assert.equal((await route.POST(request(),{params:{id:catalogueId}})).status,200);
  assert.deepEqual(calls,[[catalogueId,{revision:4},'secret']]);
  // Positive quarantine uses the exact current Bundle ID, confirms deletion and active-list absence, then preserves history in one CAS.
  { const h=harness(); const out=await h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'); assert.equal(out.product.status,'draft'); assert.equal(out.product.currentBundleProductId,null); assert.equal(out.product.bundleVersions.length,2); assert.equal(out.product.bundleVersions[0].retiredAt,'2026-08-23T01:00:00.000Z'); assert.match(out.product.bundleVersions[1].retiredAt,/Z$/); assert.deepEqual(h.events,[['read-state',501],['retire',501,501,fingerprint],['read-state',501],['active-list']]); assert.equal(h.updates(),1); }
  // Exact body and revision conflict fail before any Bundle mutation.
  { const h=harness(); await assert.rejects(()=>h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4,extra:true},'server-token'),/exact|revision/i); assert.deepEqual(h.events,[]); }
  { const h=harness(); await assert.rejects(()=>h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:3},'server-token'),/revision.*conflict/i); assert.deepEqual(h.events,[]); }
  // A commit-then-timeout may reconcile only from positive readback; uncertain mutation/readback never changes local state.
  { const h=harness({commitThenTimeout:true}); const out=await h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'); assert.equal(out.product.status,'draft'); assert.equal(h.updates(),1); }
  { const h=harness({retireError:true,readError:true}); await assert.rejects(()=>h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'),/uncertain|Bundle|read/i); assert.equal(h.updates(),0); }
  { const h=harness({activeError:true}); await assert.rejects(()=>h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'),/uncertain|active/i); assert.equal(h.updates(),0); }
  { const h=harness({activeVersions:[{active:true,productId:501}]}); await assert.rejects(()=>h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'),/active|retire/i); assert.equal(h.updates(),0); }
  // Idempotent replay is unchanged only when draft/no-current has no active version.
  { const draft={...published(),status:'draft',currentBundleProductId:null,bundleVersions:published().bundleVersions.map(v=>({...v,retiredAt:v.retiredAt||'2026-08-24T00:30:00.000Z'}))}; const h=harness({product:draft}); const out=await h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'); assert.deepEqual(out.product,draft); assert.equal(h.updates(),0); assert.deepEqual(h.events,[['active-list']]); }
  { const draft={...published(),status:'draft',currentBundleProductId:null,bundleVersions:published().bundleVersions.map(v=>({...v,retiredAt:v.retiredAt||'2026-08-24T00:30:00.000Z'}))}; const h=harness({product:draft,activeVersions:[{active:true,productId:501}]}); await assert.rejects(()=>h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'),/active|uncertain/i); assert.equal(h.updates(),0); }
  // A failed publish may create a description-marked Bundle draft before checkpointing its ID. Reconcile only by exact description operation marker, delete, and prove active-list absence.
  { const operationId='a'.repeat(64), draft={...published(),status:'draft',currentBundleProductId:null,bundleVersions:[]}; const job={operationId,catalogueId,phase:'building',draftBundleProductId:null,updatedAt:'2026-08-24T02:00:00.000Z'}; const found={id:58,draft:true,draftOperationId:operationId,deleted:false,deletedAt:null,published:false}; const h=harness({product:draft,job,foundDraft:found}); h.adapter.readPublicationState=async id=>{h.events.push(['read-state',id]);return {data:{...found,id}}}; h.adapter.retirePreviousVersion=async(previous,replacement,operation)=>{h.events.push(['retire',previous,replacement,operation]);found.deleted=true;found.deletedAt='2026-08-24T02:01:00.000Z';found.published=false;}; h.adapter.findDraftByOperation=async op=>{h.events.push(['find-draft',op]);return found.deleted?null:found;}; const out=await h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'); assert.equal(out.product.currentBundleProductId,null); assert.equal(h.updates(),0); assert.deepEqual(h.events,[['find-draft',operationId],['read-state',58],['retire',58,58,operationId],['read-state',58],['find-draft',operationId],['active-list']]); }
  // A checkpointed ID is used exactly, without a discovery lookup, and still gets positive deletion and absence readback.
  { const operationId='b'.repeat(64), draft={...published(),status:'draft',currentBundleProductId:null,bundleVersions:[]}; const job={operationId,catalogueId,phase:'building',draftBundleProductId:58,updatedAt:'2026-08-24T02:00:00.000Z'}; const found={id:58,draft:true,draftOperationId:operationId,deleted:false,deletedAt:null,published:false}; const h=harness({product:draft,job}); h.adapter.readPublicationState=async id=>(h.events.push(['read-state',id]),{data:{...found,id}}); h.adapter.retirePreviousVersion=async(previous,replacement,operation)=>{h.events.push(['retire',previous,replacement,operation]);found.deleted=true;found.deletedAt='2026-08-24T02:01:00.000Z';}; h.adapter.findDraftByOperation=async op=>(h.events.push(['find-draft',op]),null); await h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'); assert.deepEqual(h.events,[['read-state',58],['retire',58,58,operationId],['read-state',58],['find-draft',operationId],['active-list']]); }
  // A checkpointed ID with an unrelated description operation marker is never deleted.
  { const operationId='c'.repeat(64), draft={...published(),status:'draft',currentBundleProductId:null,bundleVersions:[]}; const job={operationId,catalogueId,phase:'building',draftBundleProductId:58,updatedAt:'2026-08-24T02:00:00.000Z'}; const h=harness({product:draft,job}); h.adapter.readPublicationState=async id=>(h.events.push(['read-state',id]),{data:{id,draft:true,draftOperationId:'d'.repeat(64),deleted:false,deletedAt:null,published:false}}); await assert.rejects(()=>h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'),/operation|draft|identity/i); assert(!h.events.some(event=>event[0]==='retire')); assert.equal(h.updates(),0); }
  // Discovery uncertainty fails closed before any Bundle mutation or local quarantine.
  { const operationId='e'.repeat(64), draft={...published(),status:'draft',currentBundleProductId:null,bundleVersions:[]}; const job={operationId,catalogueId,phase:'building',draftBundleProductId:null,updatedAt:'2026-08-24T02:00:00.000Z'}; const h=harness({product:draft,job,findError:true}); await assert.rejects(()=>h.actual.catalogueAdminRoute.unpublish(catalogueId,{revision:4},'server-token'),/timeout|draft|Bundle/i); assert(!h.events.some(event=>event[0]==='retire')); assert.equal(h.updates(),0); }
  // Public projection excludes the quarantined draft record without network access.
  { const draft={...published(),revision:5,status:'draft',currentBundleProductId:null,bundleVersions:published().bundleVersions.map(v=>({...v,retiredAt:v.retiredAt||'2026-08-24T00:30:00.000Z'}))}; const projection=compile('src/lib/cataloguePublicProjection.server.ts',{'node:fs/promises':{readdir:async d=>d.endsWith('catalogue-products')?[{name:`${catalogueId}.json`,isFile:()=>true}]:[]},'@/lib/admin/catalogueProduct.server':{readCatalogueProduct:async()=>draft},'@/lib/admin/cataloguePublication.server':{readPublicationJob:async()=>null},'@/lib/admin/catalogueMedia.server':{readVerifiedCatalogueMedia:async()=>{throw new Error('draft must not read media')}},'@/lib/admin/catalogueAdoption.server':{readCatalogueAdoptionByBundle:async()=>null},'@/lib/cataloguePublishedSnapshot.server':{readCataloguePublishedSnapshot:async()=>null,readCataloguePublishedSnapshotMedia:async()=>null}}); assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[]}); }
  const alias=fs.readFileSync(path.join(root,'src/app/admin-api/catalogue-products/[id]/unpublish/route.ts'),'utf8'); assert.match(alias,/export\s*\{\s*POST\s*\}/); assert.match(alias,/@\/app\/api\/admin\/catalogue-products\/\[id\]\/unpublish\/route/);
  console.log('Catalogue unpublish check passed');
})().catch(error=>{console.error(error);process.exit(1)});
