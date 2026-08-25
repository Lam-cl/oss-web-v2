#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const catalogueId='018f47a2-a117-4c37-8a28-7f429768bea1', mediaId='018f47a2-a117-4c37-8a28-7f429768bea2', operationId='a'.repeat(64), fingerprint='b'.repeat(64);
const oldProduct={catalogueId,slug:'published-title',details:{title:'Published title',price:10,description:'old'},choices:[],combinations:[{valueKeys:[],variantId:90,price:10,inventory:5}],images:[{url:`/catalogue-products-api?catalogueId=${catalogueId}&mediaId=${mediaId}`,order:0,assignment:'all'}],bundleProductId:501};
let product={catalogueId,status:'published',currentBundleProductId:501,bundleVersions:[{bundleProductId:501,fingerprint,publishedAt:'2026-01-01T00:00:00.000Z',retiredAt:null}],slug:'draft-title',model:{details:{title:'Draft title',price:99,description:'changed'},choices:[],combinations:[{valueKeys:[],price:99,inventory:0}],existingImages:[]}};
const complete={operationId,catalogueId,phase:'complete',draftBundleProductId:501,resultFingerprint64:fingerprint};
let jobs=[complete];
let snapshots=new Map([[operationId,{version:1,operationId,catalogueId,bundleProductId:501,resultFingerprint64:fingerprint,createdAt:'2026-01-01T00:00:00.000Z',product:oldProduct,media:[{mediaId,originalName:'old.png',contentType:'image/png',bytes:8,sha256:'c'.repeat(64),order:0,assignment:'all',file:`${mediaId}.bin`}]}]]);
const body=Buffer.from([137,80,78,71,13,10,26,10]);
function load(){const file=path.resolve('src/lib/cataloguePublicProjection.server.ts'),out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,m={exports:{}};const stubs={
'node:fs/promises':{readdir:async directory=>directory.endsWith('catalogue-products')?[{name:`${catalogueId}.json`,isFile:()=>true}]:jobs.map(job=>({name:`${job.operationId}.json`,isFile:()=>true}))},
'@/lib/admin/catalogueProduct.server':{readCatalogueProduct:async()=>structuredClone(product)},
'@/lib/admin/cataloguePublication.server':{readPublicationJob:async id=>structuredClone(jobs.find(job=>job.operationId===id)||null)},
'@/lib/admin/catalogueMedia.server':{readVerifiedCatalogueMedia:async()=>{throw new Error('ordinary snapshot must not read mutable media')}},
'@/lib/admin/catalogueAdoption.server':{readCatalogueAdoptionByBundle:async()=>null},
'@/lib/cataloguePublishedSnapshot.server':{readCataloguePublishedSnapshot:async id=>structuredClone(snapshots.get(id)||null),readCataloguePublishedSnapshotMedia:async(id,wanted)=>id===operationId&&wanted===mediaId?{...snapshots.get(id).media[0],body}:null},
};new Function('exports','require','module','__filename','__dirname',out)(m.exports,id=>stubs[id]||require(id),m,file,path.dirname(file));return m.exports;}
(async()=>{const projection=load();
 assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[oldProduct]},'draft save must not alter active public payload');
 const media=await projection.readCataloguePublicSnapshotMedia(catalogueId,mediaId);assert.deepEqual(media.body,body,'draft media must not be read');
 jobs=[{...complete,phase:'activated',resultFingerprint64:null}];
 assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[oldProduct]},'snapshot must remain visible after active identity CAS even when publication completion reports an error');
 for(const phase of ['retirement-uncertain','previous-retired','complete']){jobs=[{...complete,phase}];assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[oldProduct]},`${phase} is activation-or-later and must remain visible`);}
 for(const phase of ['building','bundle-published','activation-uncertain']){jobs=[{...complete,phase}];assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[]},`${phase} is before attested activation and must remain hidden`);}
 jobs=[{...complete,phase:'activated',resultFingerprint64:null}];product={...product,currentBundleProductId:777,bundleVersions:[{...product.bundleVersions[0],bundleProductId:777}]};
 assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[]},'compensation that reverts active product identity removes visibility');
 product={...product,currentBundleProductId:501,bundleVersions:[{...product.bundleVersions[0],bundleProductId:501}]};
 jobs=[complete];
 jobs.push({...complete,operationId:'d'.repeat(64)});snapshots.set('d'.repeat(64),{...snapshots.get(operationId),operationId:'d'.repeat(64)});
 assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[]},'ambiguous complete jobs fail closed');
 assert.equal(await projection.readCataloguePublicSnapshotMedia(catalogueId,mediaId),null);
 jobs=[complete];snapshots.set(operationId,{...snapshots.get(operationId),resultFingerprint64:'e'.repeat(64)});
 assert.deepEqual(await projection.readCataloguePublicProjection(),{products:[]},'snapshot attestation mismatch fails closed');
 const route=fs.readFileSync('src/app/api/catalogue-products/route.ts','utf8');
 assert.match(route,/readCataloguePublicSnapshotMedia/);assert.doesNotMatch(route,/readVerifiedCatalogueMedia/);
 console.log('Catalogue snapshot projection check passed');
})().catch(e=>{console.error(e);process.exit(1)});
