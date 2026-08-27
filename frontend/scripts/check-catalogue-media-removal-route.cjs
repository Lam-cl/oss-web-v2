const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = process.cwd();
const file = path.join(root, 'src/app/api/admin/catalogue-products/[id]/media-removals/[operationId]/route.ts');
function compile(file, injected) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('exports','require','module','__filename','__dirname',output)(module.exports, id => id in injected ? injected[id] : require(id), module, file, path.dirname(file));
  return module.exports;
}
const json = (body, status = 200) => Response.json(body, { status });
const catalogueId = '39a00000-0000-4000-8000-000000000039';
const operationId = '49a00000-0000-4000-8000-000000000049';
const mediaIds = ['59a00000-0000-4000-8000-000000000059', '69a00000-0000-4000-8000-000000000069'];
let writes = 0, sim = false;
const removal = { operationId, catalogueId, status: 'committed', removed: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const media = [{ mediaId: '79a00000-0000-4000-8000-000000000079', catalogueId, originalName:'keep.png', contentType:'image/png', bytes:8, sha256:'a'.repeat(64), order:0, assignment:'all', createdAt:new Date().toISOString() }];
const helper = {
  catalogueMediaAuthError: async (request, mutation) => !request.auth ? json({},401) : mutation && !request.sameOrigin ? json({},403) : null,
  catalogueMediaBadRequest: () => json({},400), catalogueMediaRequestError: () => json({},500),
  readCatalogueMediaProduct: async id => id === catalogueId ? ({ product:{}, error:null }) : ({ product:null, error:json({},400) }), activeSimMediaMutationError: async () => sim ? json({},409) : null,
  isValidCatalogueMediaId: value => /^[0-9a-f-]{36}$/.test(value), publicCatalogueMedia: item => item,
};
const store = {
  finalizeCatalogueMediaRemoval: async (id, op, ids) => { writes++; assert.equal(id,catalogueId); assert.equal(op,operationId); assert.deepEqual(ids,mediaIds); return removal; },
  getCatalogueMediaRemoval: async () => removal,
  listCatalogueMedia: async () => { throw new Error('final readback unavailable'); },
};
const route = compile(file, { 'next/server':{NextResponse:{json:(body,init={})=>json(body,init.status||200)}}, '@/lib/admin/catalogueMedia.server':store, '@/lib/admin/catalogueMediaRoute.server':helper, '@/lib/admin/catalogueAdminRoute.server':{readBoundedCatalogueJson: request=>request.json(), catalogueAdminError:()=>json({},400)} });
const req = (method, body, auth=true, sameOrigin=true) => { const request = new Request('https://admin.test/x',{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})}); request.auth=auth; request.sameOrigin=sameOrigin; return request; };
const context = { params:{ id:catalogueId, operationId } };
(async()=>{
  assert.equal((await route.POST(req('POST',{mediaIds},false),context)).status,401);
  assert.equal((await route.POST(req('POST',{mediaIds},true,false),context)).status,403);
  assert.equal((await route.GET(req('GET',undefined,false),context)).status,401);
  assert.equal((await route.GET(req('GET',undefined,true,false),context)).status,403);
  assert.equal((await route.GET(req('GET'),{params:{id:catalogueId,operationId:'bad'}})).status,400);
  assert.equal((await route.GET(req('GET'),{params:{id:'bad',operationId}})).status,400);
  assert.equal((await route.POST(req('POST',{mediaIds,extra:true}),context)).status,400);
  assert.equal((await route.POST(req('POST',{mediaIds:['bad']}),context)).status,400);
  sim=true; assert.equal((await route.POST(req('POST',{mediaIds}),context)).status,409); sim=false;
  const committed = await route.POST(req('POST',{mediaIds}),context); assert.equal(committed.status,200); assert.equal((await committed.json()).operation.status,'committed');
  const read = await route.GET(req('GET'),context); assert.equal(read.status,200); assert.deepEqual(await read.json(),{operation:{operationId,status:'committed'}});
  assert.equal(writes,1);
  console.log('Catalogue media removal route check passed');
})().catch(error=>{console.error(error);process.exit(1)});
