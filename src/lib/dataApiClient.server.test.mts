import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteDocument, dataApiRequest, mutateRemoteSingleton, remoteDocument, replaceRemoteDocument, ToneWowDataApiError } from './dataApiClient.server.ts';

test('remote document client keeps auth server-side and sends CAS revisions', async () => {
  process.env.TONEWOW_DATA_API_URL='https://data.test/';process.env.TONEWOW_DATA_API_TOKEN='s'.repeat(32);
  const calls=[];const original=globalThis.fetch;
  globalThis.fetch=async (url,init={})=>{calls.push({url:String(url),init});const value=JSON.parse(String(init.body||'{}')).value||{revision:1,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};return Response.json({data:{key:'one',revision:value.revision||1,value,createdAt:value.createdAt,updatedAt:value.updatedAt}})};
  try{const value={revision:1,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};await createRemoteDocument('catalogue-products','one',value);await replaceRemoteDocument('catalogue-products','one',1,{...value,revision:2});assert.equal(new Headers(calls[0].init.headers).get('authorization'),`Bearer ${'s'.repeat(32)}`);assert.equal(new Headers(calls[1].init.headers).get('x-expected-revision'),'1');}finally{globalThis.fetch=original;delete process.env.TONEWOW_DATA_API_URL;delete process.env.TONEWOW_DATA_API_TOKEN;}
});

test('remote document converts a 404 to null and preserves other structured errors', async()=>{
  process.env.TONEWOW_DATA_API_URL='https://data.test';process.env.TONEWOW_DATA_API_TOKEN='s'.repeat(32);const original=globalThis.fetch;
  try{globalThis.fetch=async()=>Response.json({error:{code:'NOT_FOUND',message:'missing'}},{status:404});assert.equal(await remoteDocument('catalogue-products','missing'),null);globalThis.fetch=async()=>Response.json({error:{code:'REVISION_CONFLICT',message:'conflict'}},{status:409});await assert.rejects(()=>dataApiRequest('/x'),(error)=>error instanceof ToneWowDataApiError&&error.code==='REVISION_CONFLICT');}finally{globalThis.fetch=original;delete process.env.TONEWOW_DATA_API_URL;delete process.env.TONEWOW_DATA_API_TOKEN;}
});

test('remote singleton retries a conflicting compare-and-swap against fresh state', async()=>{
  process.env.TONEWOW_DATA_API_URL='https://data.test';process.env.TONEWOW_DATA_API_TOKEN='s'.repeat(32);const original=globalThis.fetch;
  let revision=3,value={orders:{first:true}},putCalls=0;
  try{
    globalThis.fetch=async(_url,init={})=>{
      if(!init.method)return Response.json({data:{key:'singleton',revision,value,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}});
      putCalls+=1;
      if(putCalls===1){revision=4;value={orders:{first:true,concurrent:true}};return Response.json({error:{code:'REVISION_CONFLICT',message:'conflict'}},{status:409});}
      const body=JSON.parse(String(init.body));revision=body.revision;value=body.value;return Response.json({data:{key:'singleton',revision,value,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:body.updatedAt}});
    };
    const result=await mutateRemoteSingleton('order-metadata',()=>({orders:{}}),current=>({orders:{...current.orders,second:true}}));
    assert.deepEqual(result,{orders:{first:true,concurrent:true,second:true}});assert.equal(putCalls,2);
  }finally{globalThis.fetch=original;delete process.env.TONEWOW_DATA_API_URL;delete process.env.TONEWOW_DATA_API_TOKEN;}
});
