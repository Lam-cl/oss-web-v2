#!/usr/bin/env node
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const catalogueId = '26a311f1-6cdf-4cc1-9c11-e22f62f229f7';
const mediaId = '018f47a2-a117-4c37-8a28-7f429768bea2';
const operationId = '5cb16d5869f057fc890b6f25555213c52e1956f13ea7f9fd907ca1535525986e';
const resultFingerprint64 = 'b'.repeat(64);
const png = Buffer.from([137,80,78,71,13,10,26,10,1]);
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const codeFor=keys=>`CV-${sha256(canonical(keys)).slice(0,24)}`;
const model = inventories => ({
  details:{title:'Topi',price:10,description:'Topi published',category:'Accessories'},
  choices:[{key:'size',name:'Size',values:['s','m','l'].map(key=>({key,label:key.toUpperCase(),retired:false}))}],
  combinations:['s','m','l'].map((key,index)=>({valueKeys:[key],price:10,inventory:inventories[index],sku:`TOPI-${key.toUpperCase()}`})),
  existingImages:[],
});
const product = inventories => ({version:1,catalogueId,revision:7,status:'published',slug:'topi',model:model(inventories),currentBundleProductId:501,
  bundleVersions:[{bundleProductId:501,fingerprint:resultFingerprint64,publishedAt:'2026-08-25T01:00:00.000Z',retiredAt:null}],createdAt:'2026-08-25T00:00:00.000Z',updatedAt:'2026-08-25T02:00:00.000Z'});
const job = {version:1,operationId,catalogueId,revision:9,phase:'complete',modelFingerprint64:operationId,previousBundleProductId:null,draftBundleProductId:501,
  completedSteps:[],resolved:{options:{'catalogue-variant':1},values:Object.fromEntries(['s','m','l'].map((key,index)=>[codeFor([key]),11+index])),images:{[mediaId]:21},variants:{'v:0':31,'v:1':32,'v:2':33}},
  bindings:['s','m','l'].map((key,index)=>({valueKeys:[codeFor([key])],variantId:31+index})),resultFingerprint64,createdAt:'2026-08-25T00:00:00.000Z',updatedAt:'2026-08-25T02:00:00.000Z'};
async function json(file,value){await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file,`${JSON.stringify(value,null,2)}\n`);}
async function treeHash(root){const hash=crypto.createHash('sha256');async function walk(dir){for(const entry of (await fsp.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);hash.update(path.relative(root,file));if(entry.isDirectory())await walk(file);else hash.update(await fsp.readFile(file));}}await walk(root);return hash.digest('hex');}
async function rootWith(record){const root=await fsp.mkdtemp(path.join(os.tmpdir(),'catalogue-backfill-'));await json(path.join(root,'catalogue-products',`${catalogueId}.json`),record);await json(path.join(root,'catalogue-publications',`${operationId}.json`),job);const metadata={mediaId,catalogueId,originalName:'topi.png',contentType:'image/png',bytes:png.length,sha256:sha256(png),order:0,assignment:'all',createdAt:'2026-08-25T00:00:00.000Z'};await json(path.join(root,'catalogue-media',catalogueId,'manifest.json'),{media:[metadata]});await fsp.writeFile(path.join(root,'catalogue-media',catalogueId,`${mediaId}.bin`),png);return root;}

(async()=>{
  assert.equal(fs.existsSync('scripts/backfill-catalogue-published-snapshots.cjs'),true,'backfill script missing');
  const { runBackfill, parseCli }=require('./backfill-catalogue-published-snapshots.cjs');
  assert.deepEqual(parseCli(['--data-dir','/data']),{dataDir:'/data',apply:false,candidates:new Map()});
  assert.throws(()=>parseCli(['--data-dir','relative']),/absolute.*normalized/i);
  assert.throws(()=>parseCli(['--data-dir','/data','--apply=yes']),/unknown|usage/i);

  const data=await rootWith(product([1,1,1])),backup=await rootWith(product([1,2,3])),sourceHash=await treeHash(data),backupHash=await treeHash(backup);
  let writes=0;
  const snapshots=new Map();
  const deps={
    operationFor(request){return request.spec.combinations.map(x=>x.inventory).join(',')==='1,2,3'?operationId:'d'.repeat(64);},
    async createSnapshot(input){writes++;const normalized={...input,media:input.media.map(item=>({...item,body:Buffer.from(item.body)}))},prior=snapshots.get(input.operationId);if(prior){assert.deepEqual(normalized,prior);return {manifest:prior,idempotent:true};}snapshots.set(input.operationId,normalized);return {manifest:normalized,idempotent:false};},
    async readSnapshot(id){return snapshots.get(id)||null;},
  };
  const blocked=await runBackfill({dataDir:data,apply:false,candidates:new Map()},deps);
  assert.deepEqual(blocked.records.map(x=>[x.catalogueId,x.status]),[[catalogueId,'BLOCKED']]);
  assert.match(blocked.records[0].reason,/drift|candidate/i);assert.equal(writes,0);

  const candidates=new Map([[catalogueId,backup]]);
  const ready=await runBackfill({dataDir:data,apply:false,candidates},deps);
  assert.equal(ready.records[0].status,'READY');assert.equal(ready.records[0].source,'historical-candidate');assert.equal(ready.records[0].operationId,operationId);assert.equal(writes,0,'dry-run must write nothing');
  const applied=await runBackfill({dataDir:data,apply:true,candidates},deps);
  assert.equal(applied.records[0].status,'CREATED');assert.equal(writes,1);
  const replay=await runBackfill({dataDir:data,apply:true,candidates},deps);
  assert.equal(replay.records[0].status,'EXISTS');assert.equal(writes,2,'idempotent replay must use the tested create-only writer');
  assert.deepEqual(snapshots.get(operationId).product.combinations.map(x=>x.inventory),[1,2,3]);
  assert.deepEqual(snapshots.get(operationId).product.combinations.map(x=>x.variantId),[31,32,33],'compiled CV bindings must map back to exact Topi tuples');
  assert.equal(await treeHash(data),sourceHash,'backfill must not mutate products, jobs, media, revisions, or status');assert.equal(await treeHash(backup),backupHash,'approved backup candidate is read-only');

  await json(path.join(data,'catalogue-publications',`${'e'.repeat(64)}.json`),{...job,operationId:'e'.repeat(64),modelFingerprint64:'e'.repeat(64)});
  const ambiguous=await runBackfill({dataDir:data,apply:false,candidates},deps);
  assert.equal(ambiguous.records[0].status,'BLOCKED');assert.match(ambiguous.records[0].reason,/exactly one|ambiguous/i);

  const unsafe=path.join(os.tmpdir(),`catalogue-backfill-link-${process.pid}`);await fsp.symlink(backup,unsafe);
  await assert.rejects(()=>runBackfill({dataDir:data,apply:false,candidates:new Map([[catalogueId,unsafe]])},deps),/symlink|safe/i);
  await fsp.unlink(unsafe);await fsp.rm(data,{recursive:true,force:true});await fsp.rm(backup,{recursive:true,force:true});
  const source=fs.readFileSync('scripts/backfill-catalogue-published-snapshots.cjs','utf8');
  assert.match(source,/O_NOFOLLOW/);assert.match(source,/handle\.stat\(\)/,'candidate reads must fstat the opened handle');
  assert.doesNotMatch(source,/fsp\.readFile\(file\)/,'candidate media must not use precheck-then-read');
  console.log('Catalogue published snapshot backfill check passed');
})().catch(error=>{console.error(error);process.exit(1)});
