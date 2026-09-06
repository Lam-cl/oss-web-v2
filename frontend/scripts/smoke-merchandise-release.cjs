#!/usr/bin/env node
const assert = require('node:assert/strict');

async function smoke(origin) {
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== 'https:' && url.hostname !== '127.0.0.1')) throw new Error('Use an exact HTTPS origin (or local loopback)');
  const get = async path => {
    const result = await fetch(origin + path, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    console.log(`${path}: ${result.status}`);
    return result;
  };
  assert.equal((await get('/')).status, 200);
  const settings = await get('/api/settings');assert.equal(settings.status,200);
  assert.equal((await settings.json()).showMerchandise,true,'Merchandise is overridden or disabled');
  for (const path of ['/bundle/checkout','/api/bundle/checkout']) {
    const result=await get(path);assert.equal(result.status,200);
    assert.equal((await result.json()).enabled,false,'Pre-cutover checkout must be closed');
    assert.match(result.headers.get('cache-control'),/no-store/);
  }
  const admin=await get('/admin');assert([302,303,307,308].includes(admin.status));
  assert.match(admin.headers.get('location'),/\/admin\/login/);
  assert.equal((await get('/admin-api/catalogue-products')).status,401);
  const products=await get('/catalogue-products-api');assert.equal(products.status,200);
  const body=await products.json();assert(Array.isArray(body.products)&&body.products.length>0,'Published products must be readable');
  assert.equal((await get('/bundle/merchandise')).status,200);
  assert.equal((await get('/shipping-settings-api')).status,200);
  const icon=await get('/images/balam-tonewow-chat.svg');assert.equal(icon.status,200);
  assert.match(icon.headers.get('content-type'),/image\/svg\+xml/);
  console.log('Read-only catalogue/admin/closed-checkout/asset smoke passed');
}
module.exports={smoke};
if(require.main===module)smoke(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=1;});
