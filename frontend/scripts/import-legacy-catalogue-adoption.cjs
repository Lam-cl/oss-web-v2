#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = function(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  module._compile(output, filename);
};

function fail(message) { console.error(message); process.exit(2); }
function args(argv) {
  const result = {};
  for (let i=0;i<argv.length;i+=2) {
    const key=argv[i],value=argv[i+1];
    if (!key?.startsWith('--') || value===undefined || value.startsWith('--')) fail('Arguments must be exact --name value pairs.');
    if (Object.hasOwn(result,key)) fail(`Duplicate argument ${key}.`);
    result[key]=value;
  }
  const allowed=new Set(['--spec','--data-dir','--bundle-base-url','--token-env']);
  for (const key of Object.keys(result)) if(!allowed.has(key)) fail(`Unknown argument ${key}.`);
  if(!result['--spec']||!result['--data-dir']) fail('Usage: import-legacy-catalogue-adoption.cjs --spec <approved.json> --data-dir <absolute .data> [--bundle-base-url <https URL>] [--token-env <ENV_NAME>]');
  if(!path.isAbsolute(result['--spec'])||!path.isAbsolute(result['--data-dir']))fail('--spec and --data-dir must be absolute paths.');
  return result;
}
function boundedJson(file) {
  const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1024*1024)fail('Approved spec must be a regular JSON file no larger than 1 MiB.');
  try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{fail('Approved spec is not valid JSON.')}
}
(async()=>{
  const cli=args(process.argv.slice(2));
  const baseUrl=cli['--bundle-base-url']||'https://bundleapi.tonewow.com/api/';
  const tokenEnv=cli['--token-env']||'BUNDLE_ADMIN_TOKEN',token=process.env[tokenEnv];
  if(!token)fail(`Required read token environment variable ${tokenEnv} is not set.`);
  const { createCatalogueBundleAdapter }=require('../src/lib/admin/catalogueBundleAdapter.server.ts');
  const { adoptLegacyBundleProduct }=require('../src/lib/admin/catalogueAdoption.server.ts');
  const noLocalMutation=async()=>{throw new Error('Legacy adoption forbids local publication mutation through the Bundle adapter.')};
  const local={readPublication:async()=>null,readProductPublication:async()=>null,readMedia:async()=>[],hideOptionValues:noLocalMutation,activateVersion:noLocalMutation,readActivation:async()=>null,readActiveVersions:async()=>[]};
  const getOnlyFetch=async(input,init={})=>{if((init.method||'GET')!=='GET')throw new Error('Legacy adoption attempted a forbidden Bundle mutation.');return fetch(input,init)};
  const adapter=createCatalogueBundleAdapter({baseUrl,token,local,fetcher:getOnlyFetch});
  const downloadMedia=async url=>{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('Legacy media URL must be credential-free HTTPS.');const response=await fetch(parsed,{method:'GET',redirect:'error',cache:'no-store'});if(!response.ok)throw new Error(`Legacy media download failed with ${response.status}.`);const declared=response.headers.get('content-length');if(declared&&Number(declared)>10*1024*1024)throw new Error('Legacy media exceeds 10 MiB.');const body=new Uint8Array(await response.arrayBuffer());if(!body.length||body.length>10*1024*1024)throw new Error('Legacy media size is invalid.');return {body,contentType:(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()};};
  const result=await adoptLegacyBundleProduct(boundedJson(cli['--spec']),{readBundleProduct:id=>adapter.readProduct(id),downloadMedia},{dataDirectory:path.resolve(cli['--data-dir'])});
  process.stdout.write(`${JSON.stringify({ok:true,idempotent:result.idempotent,bundleProductId:result.product.currentBundleProductId,catalogueId:result.product.catalogueId,status:result.product.status,revision:result.product.revision,adoptionStatus:result.adoption.status},null,2)}\n`);
})().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exit(1)});
