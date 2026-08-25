#!/usr/bin/env node
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
const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const catalogueId = '018f47a2-a117-4c37-8a28-7f429768bea1';
const mediaId = '018f47a2-a117-4c37-8a28-7f429768bea2';
const source = {
  id:23,title:'tone wow Lanyard',description:'Legacy source',price:3,type:'MERCHANDISE',deleted:false,deletedAt:null,
  images:[{id:110,order:0,url:'https://media.test/lanyard.png'}],
  options:[{id:27,name:'Style',values:[{id:41,value:'Standard'},{id:42,value:'Internal hidden'}]}],
  productVariants:[{id:39,sku:'TONE-STANDARD',price:3,inventory:7,selectedOptions:[]},{id:40,sku:'ORPHAN',price:3,inventory:0,selectedOptions:[]}],
};
const model = {
  details:{title:'tone wow Lanyard',price:3,description:'Legacy source',category:'Apparel'},
  choices:[{key:'style',optionId:27,name:'Style',values:[{key:'standard',valueId:41,label:'Standard',retired:false}]}],
  combinations:[{valueKeys:['standard'],variantId:39,price:3,inventory:7,sku:'TONE-STANDARD'}],
  existingImages:[{imageId:110,order:0,assignment:'all',remove:false}],
};
const auditFiles = [
  '/root/legacy-merchandise-23-36-migration-audit-2026-08-24.json',
  '/root/legacy-merchandise-23-36-migration-table-2026-08-24.csv',
  '/root/legacy-merchandise-relationship-audit-2026-08-24.json',
  '/root/legacy-merchandise-import-mapping.json',
].map(file => ({path:file,sha256:sha(fs.readFileSync(file))}));
(async()=>{
  const rel='src/lib/admin/catalogueAdoption.server.ts';
  assert(fs.existsSync(path.join(root,rel)),`${rel} missing`);
  const adoption=compile(rel,{
    '../dataApiClient.server':{dataApiEnabled:()=>false},
    './productEditor':compile('src/lib/admin/productEditor.ts'),
    './productBundleState':compile('src/lib/admin/productBundleState.ts'),
  });
  const expectedSourceFingerprint=adoption.fingerprintLegacyAdoptionSource(source);
  const spec={schemaVersion:1,approval:{approved:true,approvedBy:'migration-owner',approvedAt:'2026-08-24T00:00:00.000Z'},bundleProductId:23,catalogueId,slug:'tone-wow-lanyard',expectedSourceFingerprint,model,providerBindings:{optionIds:[27],valueBindings:[{valueKey:'standard',valueId:41}],variantBindings:[{valueKeys:['standard'],variantId:39}],imageBindings:[{mediaId,imageId:110,url:'https://media.test/lanyard.png',sha256:sha(png),bytes:png.length,contentType:'image/png',order:0,assignment:'all'}]},exclusions:{hiddenValueIds:[42],orphanVariantIds:[40]},evidence:{auditFiles,relationshipEvidence:[{valueKeys:['standard'],kind:'candidate-order-pattern',reason:'Owner approved exact one-to-one legacy order evidence.'}]}};
  const dataDirectory=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-'));
  let reads=0,downloads=0;
  const deps={readBundleProduct:async id=>{reads++;assert.equal(id,23);return structuredClone(source)},downloadMedia:async url=>{downloads++;assert.equal(url,'https://media.test/lanyard.png');return {body:Buffer.from(png),contentType:'image/png'}}};
  const first=await adoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory});
  assert.equal(first.idempotent,false);assert.equal(first.product.currentBundleProductId,23);assert.equal(first.product.status,'published');assert.equal(first.product.bundleVersions.length,1);assert.equal(first.adoption.status,'active');
  assert.equal(first.adoption.activatedProjection.bundleProductId,23);assert.equal(first.adoption.providerBindings.variantBindings[0].variantId,39);assert.deepEqual(first.adoption.exclusions,{hiddenValueIds:[42],orphanVariantIds:[40]});
  assert.deepEqual(first.adoption.checkpoints.map(x=>x.name),['source-verified','media-verified','media-activated','adoption-activated']);
  const productFile=path.join(dataDirectory,'catalogue-products',`${catalogueId}.json`),adoptionFile=path.join(dataDirectory,'catalogue-imports','by-bundle','23.json');
  assert(fs.existsSync(productFile));assert(fs.existsSync(adoptionFile));
  const manifest=JSON.parse(await fsp.readFile(path.join(dataDirectory,'catalogue-media',catalogueId,'manifest.json'),'utf8'));
  assert.equal(manifest.media[0].mediaId,mediaId);assert.equal(sha(await fsp.readFile(path.join(dataDirectory,'catalogue-media',catalogueId,`${mediaId}.bin`))),sha(png));
  const replay=await adoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory});assert.equal(replay.idempotent,true);assert.deepEqual(replay.adoption,first.adoption);assert.equal(downloads,1,'idempotent replay must not redownload');
  const duplicate={...spec,catalogueId:randomUUID()};await assert.rejects(()=>adoption.adoptLegacyBundleProduct(duplicate,deps,{dataDirectory}),/already adopted|duplicate/i);
  const drift={...source,price:4};await assert.rejects(()=>adoption.adoptLegacyBundleProduct({...spec,bundleProductId:24,catalogueId:randomUUID()}, {...deps,readBundleProduct:async()=>drift},{dataDirectory}),/fingerprint|drift/i);
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct({...spec,bundleProductId:30,catalogueId:randomUUID()},deps,{dataDirectory}),/scope|approved/i);
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct({...spec,bundleProductId:39,catalogueId:randomUUID()},deps,{dataDirectory}),/scope|approved/i);
  const incompleteRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-incomplete-'));
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct({...spec,catalogueId:randomUUID(),providerBindings:{...spec.providerBindings,variantBindings:[]}},deps,{dataDirectory:incompleteRoot}),/variant|mapping|orphan/i);
  const hiddenRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-hidden-'));
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct({...spec,catalogueId:randomUUID(),exclusions:{...spec.exclusions,hiddenValueIds:[]}},deps,{dataDirectory:hiddenRoot}),/value|hidden|mapping/i);
  const fabricatedValue={...spec,catalogueId:randomUUID(),model:{...model,choices:[{...model.choices[0],values:[...model.choices[0].values,{key:'fabricated',valueId:999,label:'Fabricated',retired:true}]}]}},fabricatedValueRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-value-'));
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct(fabricatedValue,deps,{dataDirectory:fabricatedValueRoot}),/value|mapping|binding|exact/i);
  const fabricatedImage={...spec,catalogueId:randomUUID(),model:{...model,existingImages:[{...model.existingImages[0],imageId:999}]}},fabricatedImageRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-image-'));
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct(fabricatedImage,deps,{dataDirectory:fabricatedImageRoot}),/image|media|mapping|binding|exact/i);
  const emptyEvidenceRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-evidence-'));
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct({...spec,catalogueId:randomUUID(),evidence:{...spec.evidence,relationshipEvidence:[]}},deps,{dataDirectory:emptyEvidenceRoot}),/relationship|evidence|variant|mapping/i);
  const symlinkTarget=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-symlink-target-')),symlinkParent=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-symlink-parent-')),symlinkRoot=path.join(symlinkParent,'data');
  await fsp.symlink(symlinkTarget,symlinkRoot,'dir');
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct({...spec,catalogueId:randomUUID()},deps,{dataDirectory:symlinkRoot}),/unsafe|symbolic|symlink|realpath/i);
  assert.deepEqual(await fsp.readdir(symlinkTarget),[],'symlinked dataDirectory must never be written through');
  const mediaDrift={...spec,bundleProductId:24,catalogueId:randomUUID(),expectedSourceFingerprint:adoption.fingerprintLegacyAdoptionSource({...source,id:24})};
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct(mediaDrift,{readBundleProduct:async()=>({...source,id:24}),downloadMedia:async()=>({body:Buffer.from([...png,9]),contentType:'image/png'})},{dataDirectory}),/media|digest|bytes/i);
  // Crash after durable adoption but before product is safe and resumes without duplicate records.
  const crashRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-crash-'));let crashed=false;
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory:crashRoot,afterCheckpoint:async name=>{if(name==='adoption-activated'&&!crashed){crashed=true;throw new Error('simulated crash')}}}),/simulated crash/);
  assert(fs.existsSync(path.join(crashRoot,'catalogue-imports','by-bundle','23.json')));assert(!fs.existsSync(path.join(crashRoot,'catalogue-products',`${catalogueId}.json`)));
  const resumed=await adoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory:crashRoot});assert.equal(resumed.product.currentBundleProductId,23);
  // Crash after media activation but before adoption activation resumes from verified activated media without redownloading.
  const mediaCrashRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-media-crash-'));let mediaCrashed=false,mediaCrashDownloads=0;
  const mediaCrashDeps={...deps,downloadMedia:async url=>{mediaCrashDownloads++;return deps.downloadMedia(url)}};
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct(spec,mediaCrashDeps,{dataDirectory:mediaCrashRoot,afterCheckpoint:async name=>{if(name==='media-activated'&&!mediaCrashed){mediaCrashed=true;throw new Error('simulated media activation crash')}}}),/simulated media activation crash/);
  assert(fs.existsSync(path.join(mediaCrashRoot,'catalogue-media',catalogueId,'manifest.json')));assert(!fs.existsSync(path.join(mediaCrashRoot,'catalogue-imports','by-bundle','23.json')));
  const mediaResumed=await adoption.adoptLegacyBundleProduct(spec,mediaCrashDeps,{dataDirectory:mediaCrashRoot});assert.equal(mediaResumed.product.currentBundleProductId,23);assert.equal(mediaCrashDownloads,1,'media activation recovery must verify rather than redownload');
  const corruptMediaRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-corrupt-media-'));let corruptCrashed=false;
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory:corruptMediaRoot,afterCheckpoint:async name=>{if(name==='media-activated'&&!corruptCrashed){corruptCrashed=true;throw new Error('simulated corruptible media crash')}}}),/simulated corruptible media crash/);
  await fsp.writeFile(path.join(corruptMediaRoot,'catalogue-media',catalogueId,`${mediaId}.bin`),Buffer.from([...png.slice(0,-1),9]));
  await assert.rejects(()=>adoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory:corruptMediaRoot}),/media|digest|signature|drift/i);
  // Working edits never change immutable adopted public projection.
  const edited=JSON.parse(await fsp.readFile(productFile,'utf8'));edited.model.details.title='UNPUBLISHED LOCAL EDIT';edited.revision++;await fsp.writeFile(productFile,JSON.stringify(edited));
  const active=await adoption.readCatalogueAdoptionByBundle(23,{dataDirectory});assert.equal(active.activatedProjection.details.title,'tone wow Lanyard');
  // First replacement supersedes adoption; rollback is forbidden after replacement.
  const superseded=await adoption.supersedeCatalogueAdoption(23,501,{dataDirectory});assert.equal(superseded.status,'superseded');assert.equal(superseded.replacementBundleProductId,501);
  await assert.rejects(()=>adoption.rollbackCatalogueAdoption(23,{dataDirectory}),/superseded|replacement/i);
  // A legacy crash artifact with adoption.json moved but no journal/manifest is never accepted as idempotent.
  const journalLessRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-journalless-'));await adoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory:journalLessRoot});const journalLessArchive=path.join(journalLessRoot,'catalogue-imports','rollback','23','20260824T010203004Z');await fsp.mkdir(journalLessArchive,{recursive:true});await fsp.rename(path.join(journalLessRoot,'catalogue-imports','by-bundle','23.json'),path.join(journalLessArchive,'adoption.json'));
  await assert.rejects(()=>adoption.rollbackCatalogueAdoption(23,{dataDirectory:journalLessRoot}),/journal|incomplete|recovery/i);
  assert(fs.existsSync(path.join(journalLessRoot,'catalogue-products',`${catalogueId}.json`)),'journal-less crash must not be falsely reported complete');
  // Before replacement, rollback archives adoption/media/product and is idempotent.
  const rollbackRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-rollback-'));await adoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory:rollbackRoot});
  let rollbackCrashed=false;
  await assert.rejects(()=>adoption.rollbackCatalogueAdoption(23,{dataDirectory:rollbackRoot,now:()=>new Date('2026-08-24T01:02:03.004Z'),afterRollbackCheckpoint:async name=>{if(name==='adoption-moved'&&!rollbackCrashed){rollbackCrashed=true;throw new Error('simulated rollback process death')}}}),/simulated rollback process death/);
  assert(!fs.existsSync(path.join(rollbackRoot,'catalogue-imports','by-bundle','23.json')),'crash fixture must move adoption first');
  const rolled=await adoption.rollbackCatalogueAdoption(23,{dataDirectory:rollbackRoot,now:()=>new Date('2026-08-24T01:02:03.004Z')});assert.equal(rolled.idempotent,false);assert(!fs.existsSync(path.join(rollbackRoot,'catalogue-products',`${catalogueId}.json`)));assert(!fs.existsSync(path.join(rollbackRoot,'catalogue-imports','by-bundle','23.json')));assert(fs.existsSync(rolled.archiveDirectory));
  assert(fs.existsSync(path.join(rolled.archiveDirectory,'manifest.json')));assert(fs.existsSync(path.join(rolled.archiveDirectory,'journal.json')));
  const rolledAgain=await adoption.rollbackCatalogueAdoption(23,{dataDirectory:rollbackRoot});assert.equal(rolledAgain.idempotent,true);assert.equal(rolledAgain.archiveDirectory,rolled.archiveDirectory);
  // Every adoption, activation, product, supersession and rollback rename is followed by file/directory fsyncs.
  const durabilityEvents=[],instrumentedFs={...fsp,open:async(target,...args)=>{const handle=await fsp.open(target,...args);return new Proxy(handle,{get(object,key){if(key==='sync')return async()=>{durabilityEvents.push(`sync:${target}`);return object.sync()};const value=object[key];return typeof value==='function'?value.bind(object):value}})},rename:async(sourcePath,destinationPath)=>{await fsp.rename(sourcePath,destinationPath);durabilityEvents.push(`rename:${sourcePath}->${destinationPath}`)}};
  const durableAdoption=compile(rel,{'node:fs/promises':instrumentedFs,'../dataApiClient.server':{dataApiEnabled:()=>false},'./productEditor':compile('src/lib/admin/productEditor.ts'),'./productBundleState':compile('src/lib/admin/productBundleState.ts')});
  const durableRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-durable-'));await durableAdoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory:durableRoot});await durableAdoption.rollbackCatalogueAdoption(23,{dataDirectory:durableRoot,now:()=>new Date('2026-08-24T03:00:00.000Z')});
  const supersedeRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-adopt-durable-super-'));await durableAdoption.adoptLegacyBundleProduct(spec,deps,{dataDirectory:supersedeRoot});await durableAdoption.supersedeCatalogueAdoption(23,501,{dataDirectory:supersedeRoot});
  const renameIndexes=durabilityEvents.flatMap((event,index)=>event.startsWith('rename:')?[index]:[]);assert(renameIndexes.length>=12,'all durable state transitions must exercise rename durability');
  for(let position=0;position<renameIndexes.length;position++){const index=renameIndexes[position],event=durabilityEvents[index],match=/^rename:(.*)->(.*)$/.exec(event),window=durabilityEvents.slice(index+1,renameIndexes[position+1]??durabilityEvents.length);const sourcePath=match[1],destinationPath=match[2];assert(window.includes(`sync:${destinationPath}`),`renamed destination was not fsynced: ${destinationPath}`);assert(window.includes(`sync:${path.dirname(sourcePath)}`),`rename source directory was not fsynced: ${sourcePath}`);assert(window.includes(`sync:${path.dirname(destinationPath)}`),`rename destination directory was not fsynced: ${destinationPath}`)}
  assert(reads>0);console.log('Catalogue legacy adoption check passed');
})().catch(error=>{console.error(error);process.exit(1)});
