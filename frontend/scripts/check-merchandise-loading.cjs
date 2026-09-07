const assert = require('node:assert/strict');
const { compile } = require('./test-source-helpers.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function main() {
 const {createMerchandiseDisplayCache} = compile('src/lib/merchandiseDisplayCache.ts');
 let now=0,calls=0,job=deferred();
 const cache=createMerchandiseDisplayCache(()=>{calls++;return job.promise},()=>now);
 assert.equal(cache.peek(),null);
 const first=cache.refresh();assert.equal(first,cache.refresh());assert.equal(calls,1);
 job.resolve(['initial']);await first;assert.equal(cache.peek().fresh,true);
 now=30000;assert.equal(cache.peek().fresh,false);
 job=deferred();const retry=cache.refresh();job.reject(Error('offline'));await assert.rejects(retry);
 assert.deepEqual(cache.peek().value,['initial'],'failed refresh retains display only');
 now=300000;assert.equal(cache.peek(),null,'expired display is discarded');
 job=deferred();const recovered=cache.refresh();job.resolve(['updated']);await recovered;
 assert.deepEqual(cache.peek().value,['updated']);

 const oldFetch=global.fetch,requests=[];
 const bundle=deferred(),catalogue=deferred();
 global.fetch=(url,options)=>{requests.push({url,options});return url==='/bundle/merchandise'?bundle.promise:catalogue.promise};
 const loader=compile('src/lib/loadMerchandiseProducts.ts',{
  '@/data/merchandise':{mergeBundleMerchandiseProducts:data=>data},
  '@/lib/catalogueStorefront':{CATALOGUE_STOREFRONT_ENDPOINT:'/catalogue-products-api',adaptCatalogueStorefrontPayload:(payload,fallback)=>({payload,stock:fallback})},
 });
 try {
  const pending=loader.loadMerchandiseProducts();
  assert.deepEqual(requests.map(r=>r.url),['/bundle/merchandise','/catalogue-products-api'],'both reads start before either resolves');
  bundle.resolve({ok:true,json:async()=>({data:[{inventory:25}]})});
  catalogue.resolve({ok:true,json:async()=>({products:['published']})});
  assert.deepEqual(await pending,{payload:{products:['published']},stock:[{inventory:25}]});
  assert(requests.every(r=>r.options.cache==='no-store'));
  global.fetch=async url=>url==='/bundle/merchandise'?{ok:true,json:async()=>({data:[{inventory:0}]})}:Promise.reject(Error('offline'));
  assert.deepEqual(await loader.loadMerchandiseProducts(),{payload:null,stock:[{inventory:0}]},'catalogue outage keeps existing fallback policy');
  global.fetch=async()=>({ok:false,json:async()=>({})});
  await assert.rejects(loader.loadMerchandiseProducts(),/Unable/);
 } finally {global.fetch=oldFetch;}

 // Execute the actual hook with lifecycle-controlled React primitives.
 let effect,states=[],index=0,reconciled=0,networkCalls=0,writes=0;
 let hookJob=deferred();
 const display=createMerchandiseDisplayCache(()=>hookJob.promise);
 const react={useState(initial){const i=index++;states[i]=initial;return [initial,v=>{writes++;states[i]=typeof v==='function'?v(states[i]):v}]},useCallback:fn=>fn,useEffect:fn=>{effect=fn}};
 const hook=compile('src/hooks/useMerchandiseProducts.ts',{
  react,
  '@/store/cartStore':{useCartStore:selector=>selector({reconcileMerchandiseCatalog:()=>reconciled++})},
  '@/lib/loadMerchandiseProducts':{merchandiseDisplayCache:display,loadMerchandiseProducts:()=>{networkCalls++;return hookJob.promise}},
 });
 const priorWindow=global.window;global.window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};
 try {
  hook.useMerchandiseProducts();const cleanup=effect();assert.equal(networkCalls,1,'checkout/default consumers always load live data');
  cleanup();const before=writes;hookJob.resolve(['late']);await tick();assert.equal(writes,before);assert.equal(reconciled,0,'unmounted consumer cannot reconcile cart');
  index=0;hookJob=deferred();hook.useMerchandiseProducts();const clean2=effect();hookJob.resolve(['fresh']);await tick();assert.deepEqual(states[0],['fresh']);assert.equal(reconciled,1);clean2();
  hookJob=deferred();const prefetch=display.refresh();hookJob.resolve(['cached']);await prefetch;
  index=0;hook.useMerchandiseProducts({displayCache:true});const clean3=effect();await tick();assert.deepEqual(states[0],['cached']);assert.equal(states[1],false);assert.equal(networkCalls,2,'remount uses display cache without extra fetch');assert.equal(reconciled,1,'display cache does not certify cart stock');clean3();
 } finally {global.window=priorWindow;}
 console.log('Merchandise parallel loading, display cache, recovery and unmount checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
