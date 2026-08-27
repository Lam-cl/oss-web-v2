#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_JSON=2*1024*1024;
const fail=message=>{throw new Error(message)};
const sha256=body=>crypto.createHash('sha256').update(body).digest('hex');
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:object(value)?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const codeFor=keys=>`CV-${sha256(canonical(keys)).slice(0,24)}`;

function parseCli(argv){
  const out={apply:false,candidates:new Map()};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(key==='--apply'){if(out.apply)fail('Duplicate --apply.');out.apply=true;continue;}
    if(key!=='--data-dir'&&key!=='--candidate')fail(`Unknown argument: ${key}`);
    const value=argv[++i];if(!value||value.startsWith('--'))fail('Usage: --data-dir <absolute-data-root> [--candidate <catalogue-id>=<absolute-root-or-product-file>] [--apply]');
    if(key==='--data-dir'){if(out.dataDir)fail('Duplicate --data-dir.');out.dataDir=value;continue;}
    const split=value.indexOf('='),id=value.slice(0,split),candidate=value.slice(split+1);
    if(split<1||!UUID.test(id)||!candidate||out.candidates.has(id))fail('Each --candidate must be a unique <catalogue-id>=<absolute-root-or-product-file>.');
    out.candidates.set(id,candidate);
  }
  if(!out.dataDir)fail('Usage: --data-dir <absolute-data-root> [--candidate <catalogue-id>=<absolute-root-or-product-file>] [--apply]');
  for(const value of [out.dataDir,...out.candidates.values()])if(!path.isAbsolute(value)||path.normalize(value)!==value)fail('Data and candidate paths must be absolute and normalized.');
  return out;
}
async function safeExisting(target,wantDirectory=true){
  const resolved=path.resolve(target);if(resolved!==target)fail('Paths must be absolute and normalized.');
  const parsed=path.parse(resolved);let current=parsed.root;
  for(const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);const stat=await fsp.lstat(current);
    if(stat.isSymbolicLink())fail(`Unsafe symlink in path ${current}.`);
  }
  const stat=await fsp.lstat(resolved);
  if(wantDirectory?!stat.isDirectory():!stat.isFile())fail(`Expected a safe ${wantDirectory?'directory':'regular file'} at ${resolved}.`);
  if(await fsp.realpath(resolved)!==resolved)fail(`Path ${resolved} is not safe.`);
  return resolved;
}
async function readJson(file,max=MAX_JSON){
  await safeExisting(path.dirname(file));
  const handle=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||!stat.size||stat.size>max)fail(`JSON file ${file} has an invalid size.`);return JSON.parse((await readOpenedBounded(handle,max,file)).toString('utf8'));}finally{await handle.close();}
}
async function readOpenedBounded(handle,max,file){const chunks=[];let total=0,position=0;while(true){const chunk=Buffer.alloc(Math.min(64*1024,max+1-total));const {bytesRead}=await handle.read(chunk,0,chunk.length,position);if(!bytesRead)break;total+=bytesRead;if(total>max)fail(`File ${file} exceeds its byte limit.`);chunks.push(chunk.subarray(0,bytesRead));position+=bytesRead;}return Buffer.concat(chunks,total);}
async function readRegularBounded(file,max){await safeExisting(path.dirname(file));const handle=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.size<=0||stat.size>max)fail(`File ${file} has an invalid size.`);return await readOpenedBounded(handle,max,file);}finally{await handle.close();}}
async function candidateRoot(value,id){
  const stat=await fsp.lstat(value);if(stat.isSymbolicLink())fail(`Candidate ${value} is a symlink and is unsafe.`);
  if(stat.isDirectory()){await safeExisting(value);return value;}
  await safeExisting(value,false);
  if(path.basename(value)!==`${id}.json`||path.basename(path.dirname(value))!=='catalogue-products')fail('A candidate file must be the exact catalogue-products/<catalogue-id>.json path.');
  return safeExisting(path.dirname(path.dirname(value)));
}
async function listFiles(directory,pattern){
  await safeExisting(directory);const entries=await fsp.readdir(directory,{withFileTypes:true});if(entries.length>1000)fail(`Record limit exceeded in ${directory}.`);
  return entries.filter(entry=>entry.isFile()&&pattern.test(entry.name)).map(entry=>entry.name).sort();
}
function activeVersion(product){
  if(!object(product)||!UUID.test(product.catalogueId)||product.status!=='published'||!Number.isSafeInteger(product.currentBundleProductId)||product.currentBundleProductId<=0||!Array.isArray(product.bundleVersions))fail('Published product identity is invalid.');
  const active=product.bundleVersions.filter(version=>object(version)&&version.retiredAt===null&&version.bundleProductId===product.currentBundleProductId&&HASH.test(version.fingerprint));
  if(active.length!==1)fail('Published product must have exactly one active Bundle identity.');
  const ordinal=product.bundleVersions.indexOf(active[0])+1;if(ordinal<=0)fail('Published product version ordinal is invalid.');return {version:active[0],ordinal};
}
async function adopted(dataDir,product){
  const file=path.join(dataDir,'catalogue-imports','by-bundle',`${product.currentBundleProductId}.json`);
  try{const value=await readJson(file);return object(value)&&value.status==='active'&&value.catalogueId===product.catalogueId&&value.bundleProductId===product.currentBundleProductId;}
  catch(error){if(error?.code==='ENOENT')return false;throw error;}
}
async function mediaFor(root,id){
  const dir=path.join(root,'catalogue-media',id),manifest=await readJson(path.join(dir,'manifest.json'));
  if(!object(manifest)||Object.keys(manifest).length!==1||!Array.isArray(manifest.media)||!manifest.media.length||manifest.media.length>100)fail('Candidate media manifest is invalid.');
  const sorted=[...manifest.media].sort((a,b)=>a.order-b.order),seen=new Set();let total=0;
  const output=[];
  for(let index=0;index<sorted.length;index++){
    const item=sorted[index];
    if(!object(item)||!UUID.test(item.mediaId)||item.catalogueId!==id||seen.has(item.mediaId)||item.order!==index||!['image/png','image/jpeg','image/webp'].includes(item.contentType)||!HASH.test(item.sha256)||!Number.isSafeInteger(item.bytes)||item.bytes<=0||item.bytes>10*1024*1024||typeof item.assignment!=='string')fail('Candidate media metadata or ordering is invalid.');
    const file=path.join(dir,`${item.mediaId}.bin`),body=await readRegularBounded(file,10*1024*1024);total+=body.length;
    const signature=item.contentType==='image/png'?body.length>=8&&body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):item.contentType==='image/jpeg'?body.length>=3&&body[0]===255&&body[1]===216&&body[2]===255:body.length>=12&&body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP';
    if(body.length!==item.bytes||sha256(body)!==item.sha256||!signature)fail('Candidate media bytes, signature, or hash verification failed.');
    seen.add(item.mediaId);output.push({...item,body});
  }
  if(total>100*1024*1024)fail('Candidate media exceeds the total byte limit.');return output;
}
function snapshotInput(product,job,active,media){
  if(!object(job.resolved)||!object(job.resolved.values)||!object(job.resolved.variants)||!object(job.resolved.images)||!Array.isArray(job.bindings))fail('Publication provider bindings are invalid.');
  const variantIds=Object.values(job.resolved.variants),bindingIds=job.bindings.map(binding=>binding.variantId);
  if(job.bindings.some(binding=>!object(binding)||!Array.isArray(binding.valueKeys)||!binding.valueKeys.length||binding.valueKeys.some(key=>!Object.hasOwn(job.resolved.values,key)))
    ||new Set(bindingIds).size!==bindingIds.length||variantIds.length!==bindingIds.length||bindingIds.some(id=>!variantIds.includes(id))
    ||media.length!==Object.keys(job.resolved.images).length||media.some(item=>!Number.isSafeInteger(job.resolved.images[item.mediaId])||job.resolved.images[item.mediaId]<=0))fail('Publication provider bindings do not exactly attest variants and media.');
  const choices=product.model.choices.map(choice=>({key:choice.key,name:choice.name,values:choice.values.filter(value=>!value.retired).map(({key,label})=>({key,label}))}));
  const keys=new Set(choices.flatMap(choice=>choice.values.map(value=>value.key))),byCode=new Map(job.bindings.map(binding=>[binding.valueKeys[0],binding.variantId]));
  if(byCode.size!==job.bindings.length)fail('Publication provider bindings are ambiguous.');
  const combinations=product.model.combinations.filter(item=>item.valueKeys.length===choices.length&&item.valueKeys.every(key=>keys.has(key))).map(item=>({valueKeys:[...item.valueKeys],variantId:byCode.get(codeFor(item.valueKeys)),price:item.price,inventory:item.inventory}));
  if(combinations.length!==job.bindings.length||combinations.some(item=>!Number.isSafeInteger(item.variantId)||item.variantId<=0)||new Set(combinations.map(item=>item.variantId)).size!==combinations.length)fail('Publication provider bindings do not exactly cover the historical model.');
  const productOut={catalogueId:product.catalogueId,slug:product.slug,details:{...product.model.details},choices,combinations,images:media.map(item=>({url:`/catalogue-products-api?catalogueId=${encodeURIComponent(product.catalogueId)}&mediaId=${encodeURIComponent(item.mediaId)}`,order:item.order,assignment:item.assignment})),bundleProductId:active.version.bundleProductId};
  return {operationId:job.operationId,catalogueId:product.catalogueId,bundleProductId:active.version.bundleProductId,resultFingerprint64:active.version.fingerprint,product:productOut,media:media.map(({createdAt:_,catalogueId:__,...item})=>item)};
}
function publicationRequest(product,job,active,media){return {catalogueId:product.catalogueId,spec:product.model,uploads:media.map(item=>({key:item.mediaId,name:item.originalName,contentType:item.contentType,order:item.order,body:item.body,sha256:item.sha256})),previousBundleProductId:job.previousBundleProductId,versionOrdinal:active.ordinal};}
async function actualDeps(snapshotRoot){
  const publish=require('../src/lib/admin/cataloguePublish.server.ts'),store=require('../src/lib/cataloguePublishedSnapshot.server.ts');
  return {operationFor:publish.cataloguePublicationOperationId,createSnapshot:input=>store.createCataloguePublishedSnapshot(input,snapshotRoot)};
}
async function runBackfill(config,deps){
  await safeExisting(config.dataDir);const productsDir=path.join(config.dataDir,'catalogue-products'),jobsDir=path.join(config.dataDir,'catalogue-publications');
  const candidateRoots=new Map();for(const [id,value] of config.candidates)candidateRoots.set(id,await candidateRoot(value,id));
  deps=deps||await actualDeps(path.join(config.dataDir,'catalogue-published'));
  const names=await listFiles(productsDir,/^[0-9a-f-]{36}\.json$/),jobNames=await listFiles(jobsDir,/^[a-f0-9]{64}\.json$/),jobs=[];
  for(const name of jobNames){const value=await readJson(path.join(jobsDir,name));if(object(value)&&value.operationId===name.slice(0,-5)&&value.modelFingerprint64===value.operationId)jobs.push(value);}
  const records=[],seen=new Set();
  for(const name of names){const id=name.slice(0,-5);if(!UUID.test(id))continue;let current;
    try{current=await readJson(path.join(productsDir,name));if(current.status!=='published')continue;if(await adopted(config.dataDir,current))continue;seen.add(id);const active=activeVersion(current);
      const matching=jobs.filter(job=>job.catalogueId===id&&job.phase==='complete'&&job.draftBundleProductId===active.version.bundleProductId&&job.resultFingerprint64===active.version.fingerprint);
      if(matching.length!==1)fail(`Expected exactly one complete publication job for the active Bundle ID/result fingerprint; found ${matching.length}.`);
      const job=matching[0];let source=current,root=config.dataDir,media=await mediaFor(root,id),sourceName='current';
      let operation=deps.operationFor(publicationRequest(source,job,active,media));
      if(operation!==job.operationId){const candidate=candidateRoots.get(id);if(!candidate)fail('Current model/media drifted and no explicitly approved historical candidate was supplied.');root=candidate;source=await readJson(path.join(root,'catalogue-products',`${id}.json`));const historicalActive=activeVersion(source);if(historicalActive.version.bundleProductId!==active.version.bundleProductId||historicalActive.version.fingerprint!==active.version.fingerprint||historicalActive.ordinal!==active.ordinal)fail('Historical candidate does not attest the exact active Bundle identity and ordinal.');media=await mediaFor(root,id);operation=deps.operationFor(publicationRequest(source,job,historicalActive,media));if(operation!==job.operationId)fail('Approved historical candidate does not reproduce the exact publication operation.');sourceName='historical-candidate';}
      const input=snapshotInput(source,job,active,media);
      if(!config.apply){records.push({catalogueId:id,status:'READY',source:sourceName,operationId:job.operationId});continue;}
      const result=await deps.createSnapshot(input);records.push({catalogueId:id,status:result.idempotent?'EXISTS':'CREATED',source:sourceName,operationId:job.operationId});
    }catch(error){records.push({catalogueId:id,status:'BLOCKED',reason:error instanceof Error?error.message:String(error)});}
  }
  for(const id of candidateRoots.keys())if(!seen.has(id))fail(`Candidate ${id} did not match a published non-adopted product.`);
  return {mode:config.apply?'apply':'dry-run',records};
}
module.exports={parseCli,runBackfill};
if(require.main===module)(async()=>{const result=await runBackfill(parseCli(process.argv.slice(2)));process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(result.records.some(item=>item.status==='BLOCKED'))process.exitCode=2;})().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exit(1)});
