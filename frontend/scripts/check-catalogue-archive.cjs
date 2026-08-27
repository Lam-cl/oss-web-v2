const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const root = process.cwd();
function compile(rel, injected = {}) {
  const file = path.join(root, rel);
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('exports','require','module','__filename','__dirname',out)(module.exports, id => id in injected ? injected[id] : require(id), module, file, path.dirname(file));
  return module.exports;
}
const sha = body => createHash('sha256').update(body).digest('hex');
const model = { details:{title:'Mug',price:10,description:'',category:'Cups'}, choices:[], combinations:[{valueKeys:[],price:10,inventory:1}], existingImages:[] };
const product = (catalogueId, overrides = {}) => ({ version:1, catalogueId, revision:7, status:'draft', slug:'mug', model, currentBundleProductId:null, bundleVersions:[], createdAt:'2026-08-24T00:00:00.000Z', updatedAt:'2026-08-24T00:00:00.000Z', ...overrides });
const job = (catalogueId, operationId) => ({ version:1, operationId, catalogueId, revision:1, phase:'building', modelFingerprint64:'f'.repeat(64), previousBundleProductId:null, draftBundleProductId:null, completedSteps:[], resolved:{options:{},values:{},images:{},variants:{}}, bindings:[], resultFingerprint64:null, createdAt:'2026-08-24T00:00:00.000Z', updatedAt:'2026-08-24T00:00:00.000Z' });
async function json(file, value) { await fsp.mkdir(path.dirname(file), { recursive:true }); await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
async function fixture() {
  const dataDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'catalogue-archive-'));
  const catalogueId = randomUUID(), unrelatedId = randomUUID();
  const operationId = 'a'.repeat(64), unrelatedOperation = 'b'.repeat(64);
  await json(path.join(dataDirectory,'catalogue-products',`${catalogueId}.json`), product(catalogueId));
  await json(path.join(dataDirectory,'catalogue-products',`${unrelatedId}.json`), product(unrelatedId));
  await json(path.join(dataDirectory,'catalogue-publications',`${operationId}.json`), job(catalogueId,operationId));
  await json(path.join(dataDirectory,'catalogue-publications',`${unrelatedOperation}.json`), job(unrelatedId,unrelatedOperation));
  await json(path.join(dataDirectory,'catalogue-media',catalogueId,'manifest.json'), {media:[]});
  await fsp.writeFile(path.join(dataDirectory,'catalogue-media',catalogueId,'hero.bin'), Buffer.from('hero'));
  await json(path.join(dataDirectory,'catalogue-published',operationId,'manifest.json'), {version:1,operationId,catalogueId,bundleProductId:501,resultFingerprint64:'e'.repeat(64),createdAt:'2026-08-24T00:00:00.000Z',product:{},media:[]});
  await fsp.writeFile(path.join(dataDirectory,'catalogue-published',operationId,'hero.bin'), Buffer.from('published hero'));
  await json(path.join(dataDirectory,'catalogue-published',unrelatedOperation,'manifest.json'), {version:1,operationId:unrelatedOperation,catalogueId:unrelatedId,bundleProductId:502,resultFingerprint64:'e'.repeat(64),createdAt:'2026-08-24T00:00:00.000Z',product:{},media:[]});
  return {dataDirectory,catalogueId,unrelatedId,operationId,unrelatedOperation};
}
const response = (body, status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
const next = { NextResponse:{ json:(body,init={})=>response(body,init.status||200) } };
(async()=>{
  const helperFile='src/lib/admin/catalogueArchive.server.ts';
  const routeFile='src/app/api/admin/catalogue-products/[id]/archive/route.ts';
  const aliasFile='src/app/admin-api/catalogue-products/[id]/archive/route.ts';
  for (const rel of [helperFile,routeFile,aliasFile]) assert(fs.existsSync(path.join(root,rel)),`${rel} missing`);
  const localDataApi = { dataApiEnabled:()=>false, dataApiRequest:async()=>{ throw new Error('remote archive is outside this filesystem fixture'); } };
  const { archiveCatalogueProduct, CatalogueArchiveError } = compile(helperFile,{'@/lib/dataApiClient.server':localDataApi});

  // Draft archive moves only the exact product, media tree, and matching publication jobs.
  const f=await fixture();
  const result=await archiveCatalogueProduct(f.catalogueId,7,{dataDirectory:f.dataDirectory,now:()=>new Date('2026-08-24T03:04:05.678Z')});
  assert.equal(result.idempotent,false); assert.equal(result.manifest.catalogueId,f.catalogueId); assert.equal(result.manifest.revision,7);
  assert.equal(result.manifest.archivedAt,'2026-08-24T03:04:05.678Z'); assert.match(result.manifest.archiveId,/^20260824T030405678Z$/);
  const archive=path.join(f.dataDirectory,'catalogue-archive',f.catalogueId,result.manifest.archiveId);
  assert.equal(fs.existsSync(path.join(f.dataDirectory,'catalogue-products',`${f.catalogueId}.json`)),false);
  assert.equal(fs.existsSync(path.join(f.dataDirectory,'catalogue-media',f.catalogueId)),false);
  assert.equal(fs.existsSync(path.join(f.dataDirectory,'catalogue-publications',`${f.operationId}.json`)),false);
  assert.equal(fs.existsSync(path.join(f.dataDirectory,'catalogue-published',f.operationId)),false);
  assert.equal(fs.existsSync(path.join(archive,'product.json')),true); assert.equal(fs.existsSync(path.join(archive,'media','hero.bin')),true);
  assert.equal(fs.existsSync(path.join(archive,'publications',`${f.operationId}.json`)),true);
  assert.equal(fs.existsSync(path.join(archive,'published',f.operationId,'manifest.json')),true);assert.equal(fs.existsSync(path.join(archive,'published',f.operationId,'hero.bin')),true);
  assert.equal(fs.existsSync(path.join(f.dataDirectory,'catalogue-products',`${f.unrelatedId}.json`)),true);
  assert.equal(fs.existsSync(path.join(f.dataDirectory,'catalogue-publications',`${f.unrelatedOperation}.json`)),true);
  assert.equal(fs.existsSync(path.join(f.dataDirectory,'catalogue-published',f.unrelatedOperation,'manifest.json')),true);
  assert.deepEqual((await fsp.readdir(path.join(f.dataDirectory,'catalogue-products'))).sort(),[`${f.unrelatedId}.json`]);
  const projection=compile('src/lib/cataloguePublicProjection.server.ts',{
    'node:fs/promises':{readdir:(directory,options)=>fsp.readdir(path.join(f.dataDirectory,path.basename(directory)),options)},
    '@/lib/admin/catalogueProduct.server':{readCatalogueProduct:async id=>id===f.unrelatedId?product(f.unrelatedId):null},
    '@/lib/admin/cataloguePublication.server':{readPublicationJob:async()=>job(f.unrelatedId,f.unrelatedOperation)},
    '@/lib/admin/catalogueMedia.server':{readVerifiedCatalogueMedia:async()=>{throw new Error('draft projection must not read media')}},
    '@/lib/admin/catalogueAdoption.server':{readCatalogueAdoptionByBundle:async()=>null},
    '@/lib/cataloguePublishedSnapshot.server':{readCataloguePublishedSnapshot:async()=>null,readCataloguePublishedSnapshotMedia:async()=>null},
  });
  assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[]});
  const diskManifest=JSON.parse(await fsp.readFile(path.join(archive,'manifest.json'),'utf8'));
  assert.deepEqual(diskManifest,result.manifest); assert.equal(diskManifest.state,'archived');
  const listed=diskManifest.files.map(x=>x.source).sort();
  assert.deepEqual(listed,[`catalogue-media/${f.catalogueId}/hero.bin`,`catalogue-media/${f.catalogueId}/manifest.json`,`catalogue-products/${f.catalogueId}.json`,`catalogue-publications/${f.operationId}.json`,`catalogue-published/${f.operationId}/hero.bin`,`catalogue-published/${f.operationId}/manifest.json`].sort());
  for(const entry of diskManifest.files){const body=await fsp.readFile(path.join(archive,entry.archived));assert.equal(entry.bytes,body.length);assert.equal(entry.sha256,sha(body));}
  assert.deepEqual(diskManifest.rollback.destinations.map(x=>x.source).sort(),listed);

  // A failure after directory moves rolls the snapshot and every other source back, then a retry succeeds.
  const rollback=await fixture(); let injectedFailure=false;
  const failingFs={...fsp,rename:async(source,destination)=>{
    if(!injectedFailure&&path.basename(destination)==='product.json'){injectedFailure=true;const error=new Error('injected product move failure');error.code='EIO';throw error;}
    return fsp.rename(source,destination);
  }};
  const failingArchive=compile(helperFile,{'node:fs/promises':failingFs,'@/lib/dataApiClient.server':localDataApi}).archiveCatalogueProduct;
  await assert.rejects(()=>failingArchive(rollback.catalogueId,7,{dataDirectory:rollback.dataDirectory,now:()=>new Date('2026-08-24T03:04:06.678Z')}),/injected product move failure/);
  assert.equal(fs.existsSync(path.join(rollback.dataDirectory,'catalogue-products',`${rollback.catalogueId}.json`)),true);
  assert.equal(fs.existsSync(path.join(rollback.dataDirectory,'catalogue-media',rollback.catalogueId,'hero.bin')),true);
  assert.equal(fs.existsSync(path.join(rollback.dataDirectory,'catalogue-publications',`${rollback.operationId}.json`)),true);
  assert.equal(fs.existsSync(path.join(rollback.dataDirectory,'catalogue-published',rollback.operationId,'manifest.json')),true);
  assert.deepEqual((await fsp.readdir(path.join(rollback.dataDirectory,'catalogue-archive',rollback.catalogueId))).filter(name=>name.startsWith('.tmp-')),[]);
  const retried=await archiveCatalogueProduct(rollback.catalogueId,7,{dataDirectory:rollback.dataDirectory,now:()=>new Date('2026-08-24T03:04:07.678Z')});
  assert.equal(retried.idempotent,false);

  // Exact replay returns the verified archived manifest; a different revision is a conflict.
  const replay=await archiveCatalogueProduct(f.catalogueId,7,{dataDirectory:f.dataDirectory}); assert.equal(replay.idempotent,true); assert.deepEqual(replay.manifest,diskManifest);
  await assert.rejects(()=>archiveCatalogueProduct(f.catalogueId,6,{dataDirectory:f.dataDirectory}),e=>e instanceof CatalogueArchiveError&&e.status===409);
  await fsp.mkdir(path.join(archive,'unexpected-empty-tree'));
  await assert.rejects(()=>archiveCatalogueProduct(f.catalogueId,7,{dataDirectory:f.dataDirectory}),/extra|unexpected|tree/i);
  await fsp.rm(path.join(archive,'unexpected-empty-tree'),{recursive:true});await fsp.symlink(os.tmpdir(),path.join(archive,'unexpected-link'));
  await assert.rejects(()=>archiveCatalogueProduct(f.catalogueId,7,{dataDirectory:f.dataDirectory}),/symlink|safe/i);

  // Existing archives apply the same file budget before trusting manifest-declared payloads.
  const overcountRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-archive-existing-')),overcountId=randomUUID(),overcountArchiveId='20260824T030405678Z';
  const overcountDirectory=path.join(overcountRoot,'catalogue-archive',overcountId,overcountArchiveId),overcountFiles=Array.from({length:1001},(_,i)=>({source:`source-${i}`,archived:`payload/file-${i}.bin`,bytes:0,sha256:sha(Buffer.alloc(0))}));
  await Promise.all(overcountFiles.map(item=>fsp.mkdir(path.dirname(path.join(overcountDirectory,item.archived)),{recursive:true}).then(()=>fsp.writeFile(path.join(overcountDirectory,item.archived),''))));
  await json(path.join(overcountDirectory,'manifest.json'),{version:1,state:'archived',catalogueId:overcountId,revision:7,archivedAt:'2026-08-24T03:04:05.678Z',archiveId:overcountArchiveId,files:overcountFiles,rollback:{destinations:overcountFiles.map(({source,archived})=>({source,archived}))}});
  await assert.rejects(()=>archiveCatalogueProduct(overcountId,7,{dataDirectory:overcountRoot}),/file.*limit/i);assert.equal(fs.existsSync(path.join(overcountDirectory,'payload','file-1000.bin')),true);
  const oversizedRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-archive-oversized-')),oversizedId=randomUUID(),oversizedDirectory=path.join(oversizedRoot,'catalogue-archive',oversizedId,overcountArchiveId),oversizedFile={source:'source.bin',archived:'payload.bin',bytes:10*1024*1024+1,sha256:'0'.repeat(64)};
  await fsp.mkdir(oversizedDirectory,{recursive:true});const oversizedHandle=await fsp.open(path.join(oversizedDirectory,'payload.bin'),'w');await oversizedHandle.truncate(oversizedFile.bytes);await oversizedHandle.close();
  await json(path.join(oversizedDirectory,'manifest.json'),{version:1,state:'archived',catalogueId:oversizedId,revision:7,archivedAt:'2026-08-24T03:04:05.678Z',archiveId:overcountArchiveId,files:[oversizedFile],rollback:{destinations:[{source:oversizedFile.source,archived:oversizedFile.archived}]}});
  await assert.rejects(()=>archiveCatalogueProduct(oversizedId,7,{dataDirectory:oversizedRoot}),/per-file|file.*byte/i);assert.equal((await fsp.stat(path.join(oversizedDirectory,'payload.bin'))).size,oversizedFile.bytes);

  // Published/current Bundle state is blocked before any move and tells the UI to unpublish.
  const blocked=await fixture(); await json(path.join(blocked.dataDirectory,'catalogue-products',`${blocked.catalogueId}.json`),product(blocked.catalogueId,{status:'published',currentBundleProductId:501,bundleVersions:[{bundleProductId:501,fingerprint:'e'.repeat(64),publishedAt:'2026-08-24T00:00:00.000Z',retiredAt:null}]}));
  await assert.rejects(()=>archiveCatalogueProduct(blocked.catalogueId,7,{dataDirectory:blocked.dataDirectory}),e=>e instanceof CatalogueArchiveError&&e.status===409&&/unpublish/i.test(e.message));
  assert.equal(fs.existsSync(path.join(blocked.dataDirectory,'catalogue-products',`${blocked.catalogueId}.json`)),true);
  // Revision mismatch, malformed IDs, and symlinks fail closed without moving source data.
  const conflict=await fixture(); await assert.rejects(()=>archiveCatalogueProduct(conflict.catalogueId,8,{dataDirectory:conflict.dataDirectory}),e=>e.status===409); assert(fs.existsSync(path.join(conflict.dataDirectory,'catalogue-media',conflict.catalogueId)));
  await assert.rejects(()=>archiveCatalogueProduct('../escape',7,{dataDirectory:conflict.dataDirectory}),/valid catalogue ID/i);
  const linked=await fixture(); await fsp.rm(path.join(linked.dataDirectory,'catalogue-media',linked.catalogueId),{recursive:true}); await fsp.symlink(os.tmpdir(),path.join(linked.dataDirectory,'catalogue-media',linked.catalogueId));
  await assert.rejects(()=>archiveCatalogueProduct(linked.catalogueId,7,{dataDirectory:linked.dataDirectory}),/symlink|safe/i); assert(fs.existsSync(path.join(linked.dataDirectory,'catalogue-products',`${linked.catalogueId}.json`)));

  // Every archive traversal bound fails before moves and leaves the complete source tree exact.
  const bounded=async(setup,pattern)=>{const value=await fixture();const media=path.join(value.dataDirectory,'catalogue-media',value.catalogueId);await setup(media);const before=sha(await fsp.readFile(path.join(value.dataDirectory,'catalogue-products',`${value.catalogueId}.json`)));await assert.rejects(()=>archiveCatalogueProduct(value.catalogueId,7,{dataDirectory:value.dataDirectory}),pattern);assert.equal(fs.existsSync(path.join(value.dataDirectory,'catalogue-products',`${value.catalogueId}.json`)),true);assert.equal(sha(await fsp.readFile(path.join(value.dataDirectory,'catalogue-products',`${value.catalogueId}.json`))),before);assert.equal(fs.existsSync(path.join(value.dataDirectory,'catalogue-publications',`${value.operationId}.json`)),true);return value;};
  await bounded(async media=>{let dir=media;for(let i=0;i<9;i++){dir=path.join(dir,`d${i}`);await fsp.mkdir(dir);}await fsp.writeFile(path.join(dir,'deep.bin'),'x');},/depth.*limit/i);
  await bounded(async media=>{await Promise.all(Array.from({length:1001},(_,i)=>fsp.mkdir(path.join(media,`empty-${i}`))));},/director(?:y|ies).*limit|traversal.*limit/i);
  await bounded(async media=>{await Promise.all(Array.from({length:1001},(_,i)=>fsp.writeFile(path.join(media,`many-${i}.bin`),'')));},/file.*limit/i);
  const growing=await fixture();const growingFile=path.join(growing.dataDirectory,'catalogue-media',growing.catalogueId,'grow.bin');await fsp.writeFile(growingFile,'x');let grew=false;
  const growingFs={...fsp,open:async(target,...args)=>{const handle=await fsp.open(target,...args);if(target!==growingFile)return handle;return {...handle,stat:(...statArgs)=>handle.stat(...statArgs),read:async(...readArgs)=>{if(!grew){grew=true;await fsp.appendFile(growingFile,'x');}return handle.read(...readArgs);},readFile:async(...readArgs)=>{if(!grew){grew=true;await fsp.appendFile(growingFile,'x');}return handle.readFile(...readArgs);},close:()=>handle.close()};}};
  const growingArchive=compile(helperFile,{'node:fs/promises':growingFs,'@/lib/dataApiClient.server':localDataApi}).archiveCatalogueProduct;
  await assert.rejects(()=>growingArchive(growing.catalogueId,7,{dataDirectory:growing.dataDirectory}),/grew|changed|byte limit|safely/i);assert.equal(fs.existsSync(path.join(growing.dataDirectory,'catalogue-products',`${growing.catalogueId}.json`)),true);
  await bounded(async media=>{const handle=await fsp.open(path.join(media,'large.bin'),'w');try{await handle.truncate(10*1024*1024+1);}finally{await handle.close();}},/per-file|file.*byte|item.*limit/i);
  await bounded(async media=>{for(let i=0;i<11;i++){const handle=await fsp.open(path.join(media,`aggregate-${i}.bin`),'w');try{await handle.truncate(10*1024*1024);}finally{await handle.close();}}},/aggregate|total.*byte/i);

  // Route requires auth + same-origin and forwards only the exact body into archive orchestration.
  const calls=[]; const routeHelper={readCatalogueAdminSession:async(r,m)=>!r.auth?{session:null,error:response({},401)}:m&&!r.sameOrigin?{session:null,error:response({},403)}:{session:{token:'secret'},error:null},readBoundedCatalogueJson:async r=>r.json(),catalogueAdminError:e=>response({message:e.message},e.status||500),catalogueAdminRoute:{archive:async(id,body)=>{calls.push([id,body]);return {manifest:{catalogueId:id},idempotent:false}}}};
  const route=compile(routeFile,{'next/server':next,'@/lib/admin/catalogueAdminRoute.server':routeHelper});
  const request=({auth=true,sameOrigin=true,body={revision:7}}={})=>{const r=new Request('https://admin.test/x',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});r.auth=auth;r.sameOrigin=sameOrigin;return r};
  assert.equal((await route.POST(request({auth:false}),{params:{id:f.catalogueId}})).status,401); assert.equal((await route.POST(request({sameOrigin:false}),{params:{id:f.catalogueId}})).status,403); assert.equal((await route.POST(request(),{params:{id:f.catalogueId}})).status,200); assert.deepEqual(calls,[[f.catalogueId,{revision:7}]]);
  const alias=await fsp.readFile(path.join(root,aliasFile),'utf8'); assert.match(alias,/export\s*\{\s*POST\s*\}/); assert(alias.includes('@/app/api/admin/catalogue-products/[id]/archive/route'));
  assert.doesNotMatch(await fsp.readFile(path.join(root,helperFile),'utf8'),/handle\.readFile\(/,'archive reads must stay chunk-bounded');
  console.log('Catalogue archive check passed');
})().catch(error=>{console.error(error);process.exit(1)});
