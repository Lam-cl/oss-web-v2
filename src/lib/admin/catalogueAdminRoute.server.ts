import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { NextRequest } from 'next/server';
import { BUNDLE_API, getAdminSession, requestIsSameOrigin, safeError } from '@/lib/admin/server';
import { createCatalogueProduct, listCatalogueProducts, readCatalogueProduct, updateCatalogueProduct, type CatalogueProductRecord } from '@/lib/admin/catalogueProduct.server';
import { listCatalogueMedia, readVerifiedCatalogueMedia } from '@/lib/admin/catalogueMedia.server';
import { listPublicationJobs, readPublicationJob, type CataloguePublicationJob } from '@/lib/admin/cataloguePublication.server';
import { CataloguePublishError, cataloguePublicationOperationId, publishCatalogueProductVersion, type CataloguePreparedImageUpload, type CatalogueVariantBinding } from '@/lib/admin/cataloguePublish.server';
import { createCataloguePublishedSnapshot, readCataloguePublishedSnapshot, type CataloguePublishedProduct } from '@/lib/cataloguePublishedSnapshot.server';
import { CatalogueBundleAdapterError, createCatalogueBundleAdapter } from '@/lib/admin/catalogueBundleAdapter.server';
import { archiveCatalogueProduct, CatalogueArchiveError } from '@/lib/admin/catalogueArchive.server';
import { enrichCatalogueProductWithAdoption, readCatalogueAdoptionByBundle, rollbackCatalogueAdoption, supersedeCatalogueAdoption } from '@/lib/admin/catalogueAdoption.server';
import { saveProductHiddenOptionValues } from '@/lib/productImageColors.server';
import { evaluatePublicationChangeState, type PublicationProviderProduct } from '@/lib/admin/cataloguePublicationChangeState.server';
import { inheritShippingProductGroup } from '@/lib/shippingSettings.server';

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_RECORDS = 1000;
const REMOTE_DATA = Boolean(process.env.TONEWOW_DATA_API_URL?.trim() && process.env.TONEWOW_DATA_API_TOKEN?.trim());
const PRODUCT_DIRECTORY = path.join(process.cwd(), '.data', 'catalogue-products');
const PUBLICATION_DIRECTORY = path.join(process.cwd(), '.data', 'catalogue-publications');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION = /^[a-f0-9]{64}$/;
type Row = Record<string, unknown>;

export class CatalogueAdminRouteError extends Error {
  constructor(message: string, readonly status: 400|404|409|413|500|502|503 = 400) { super(message); this.name='CatalogueAdminRouteError'; }
}
const object = (value:unknown):value is Row => Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const exact = (value:Row, keys:string[]) => JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const revision = (value:unknown):value is number => typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
function invalid(message='Catalogue admin request fields are invalid.'):never { throw new CatalogueAdminRouteError(message,400); }
function ensureId(id:string){if(!UUID.test(id))invalid('A valid catalogue ID is required.');}

export async function readCatalogueAdminSession(request:NextRequest, mutation:boolean) {
  const session=await getAdminSession(request);
  if(!session)return {session:null,error:safeError(401)};
  if(mutation&&!requestIsSameOrigin(request))return {session:null,error:safeError(403)};
  return {session,error:null};
}

export async function readBoundedCatalogueJson(request:NextRequest):Promise<unknown>{
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))))invalid();
  if(declared!==null&&Number(declared)>MAX_JSON_BYTES)throw new CatalogueAdminRouteError('Catalogue request is too large.',413);
  if(!request.body)invalid();
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_JSON_BYTES){try{await reader.cancel();}catch{}throw new CatalogueAdminRouteError('Catalogue request is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)),total).toString('utf8'));}catch{invalid();}
}
export const catalogueAdminBadRequest=()=>safeError(400);
export function catalogueAdminError(reason:unknown){
  if(reason instanceof CatalogueAdminRouteError)return safeError(reason.status,{message:reason.message});
  if(reason instanceof CataloguePublishError||reason instanceof CatalogueBundleAdapterError||reason instanceof CatalogueArchiveError)return safeError(reason.status,{message:reason.message});
  const message=reason instanceof Error?reason.message:'';
  if(/not found/i.test(message))return safeError(404);
  if(/revision.*conflict/i.test(message))return safeError(409);
  if(/valid|required|invalid|must|duplicate/i.test(message))return safeError(400,{message});
  return safeError(500,{message:'The catalogue product could not be processed. Please try again.'});
}

async function filenames(directory:string, pattern:RegExp){
  let entries;
  try{entries=await readdir(directory,{withFileTypes:true});}catch(reason:any){if(reason?.code==='ENOENT')return [];throw reason;}
  if(entries.length>MAX_RECORDS)throw new CatalogueAdminRouteError('Catalogue record limit was exceeded.',503);
  return entries.filter(entry=>entry.isFile()&&pattern.test(entry.name)).map(entry=>entry.name);
}
type PublicationJobIndex={byCatalogue:Map<string,CataloguePublicationJob[]>;uncertain:boolean};
async function publicationJobIndex():Promise<PublicationJobIndex>{
  const byCatalogue=new Map<string,CataloguePublicationJob[]>();let uncertain=false;let names:string[]=[];
  if(REMOTE_DATA){try{for(const job of await listPublicationJobs()){const jobs=byCatalogue.get(job.catalogueId)??[];jobs.push(job);byCatalogue.set(job.catalogueId,jobs);}return {byCatalogue,uncertain};}catch{return {byCatalogue,uncertain:true};}}
  try{names=await filenames(PUBLICATION_DIRECTORY,/^[a-f0-9]{64}\.json$/);}catch{uncertain=true;}
  for(const name of names){const operationId=name.slice(0,-5);if(!OPERATION.test(operationId))continue;try{const job=await readPublicationJob(operationId);if(!job)continue;const jobs=byCatalogue.get(job.catalogueId)??[];jobs.push(job);byCatalogue.set(job.catalogueId,jobs);}catch{uncertain=true;}}
  return {byCatalogue,uncertain};
}
async function providerProductIndex():Promise<Map<number,PublicationProviderProduct>|null>{
  try{const response=await fetch(`${BUNDLE_API}/products?type=MERCHANDISE&limit=1000`,{headers:{accept:'application/json'},cache:'no-store'});if(!response.ok)return null;const payload=await response.json();const rows=object(payload)&&Array.isArray(payload.data)?payload.data:[];const products=rows.filter((item):item is PublicationProviderProduct=>object(item)&&revision(item.id));return new Map(products.map(product=>[product.id,product]));}catch{return null;}
}
async function publicationChange(product:CatalogueProductRecord,jobs:PublicationJobIndex,providers:Map<number,PublicationProviderProduct>|null){
  const active=product.bundleVersions.filter(version=>version.retiredAt===null);
  const productJobs=jobs.byCatalogue.get(product.catalogueId)??[];
  const matching=active.length===1?productJobs.filter(job=>job.phase==='complete'&&job.draftBundleProductId===active[0].bundleProductId&&job.resultFingerprint64===active[0].fingerprint):[];
  let snapshot=null,media:Awaited<ReturnType<typeof listCatalogueMedia>>=[];let storageUncertain=jobs.uncertain;
  if(matching.length===1){try{snapshot=await readCataloguePublishedSnapshot(matching[0].operationId);}catch{storageUncertain=true;}}
  try{media=await listCatalogueMedia(product.catalogueId);}catch{storageUncertain=true;}
  return evaluatePublicationChangeState({product,jobs:productJobs,snapshot,media,providerProduct:product.currentBundleProductId===null?null:providers?.get(product.currentBundleProductId)??null,storageUncertain});
}
async function listProducts(){
  const [records,jobs,providers]=await Promise.all([REMOTE_DATA?listCatalogueProducts():filenames(PRODUCT_DIRECTORY,/^[0-9a-f-]{36}\.json$/).then(async names=>{const rows:CatalogueProductRecord[]=[];for(const name of names){const id=name.slice(0,-5);if(!UUID.test(id))continue;const product=await readCatalogueProduct(id);if(product)rows.push(product);}return rows;}),publicationJobIndex(),providerProductIndex()]);const products:Array<CatalogueProductRecord&Row>=[];
  for(const product of records)products.push({...await enrichAdminProduct(product),...await publicationChange(product,jobs,providers)});
  return products.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))||String(a.catalogueId).localeCompare(String(b.catalogueId)));
}
async function latestPublication(catalogueId:string){
  const jobs:CataloguePublicationJob[]=[];
  if(REMOTE_DATA){for(const job of await listPublicationJobs())if(job.catalogueId===catalogueId)jobs.push(job);}
  else {const names=await filenames(PUBLICATION_DIRECTORY,/^[a-f0-9]{64}\.json$/);for(const name of names){const operationId=name.slice(0,-5);if(!OPERATION.test(operationId))continue;const job=await readPublicationJob(operationId);if(job?.catalogueId===catalogueId)jobs.push(job);}}
  return jobs.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.operationId.localeCompare(a.operationId))[0]??null;
}
type CatalogueInventoryRow={valueKeys:string[];variantId:number;inventory:number};
type CatalogueInventoryState={bundleProductId:number;rows:CatalogueInventoryRow[];providerVariants:Map<number,{id:number;sku:string;price:number;inventory:number}>};
const inventoryQueues=new Map<string,Promise<void>>();
function withInventoryLock<T>(catalogueId:string,action:()=>Promise<T>){
  const previous=inventoryQueues.get(catalogueId)??Promise.resolve();
  const result=previous.then(action,action),settled=result.then(()=>undefined,()=>undefined);
  inventoryQueues.set(catalogueId,settled);settled.then(()=>{if(inventoryQueues.get(catalogueId)===settled)inventoryQueues.delete(catalogueId);});
  return result;
}
async function activeCatalogueInventory(id:string,token:string):Promise<CatalogueInventoryState>{
  const product=await requireProduct(id),active=product.bundleVersions.filter(version=>version.retiredAt===null);
  if(product.status!=='published'||product.currentBundleProductId===null||active.length!==1||active[0].bundleProductId!==product.currentBundleProductId)throw new CatalogueAdminRouteError('Live inventory is available only for one verified active publication.',409);
  const jobs=(await publicationJobIndex()).byCatalogue.get(id)??[],matching=jobs.filter(job=>job.phase==='complete'&&job.draftBundleProductId===active[0].bundleProductId&&job.resultFingerprint64===active[0].fingerprint);
  if(matching.length!==1)throw new CatalogueAdminRouteError('Live inventory publication evidence is missing or ambiguous.',409);
  const snapshot=await readCataloguePublishedSnapshot(matching[0].operationId);
  if(!snapshot||snapshot.catalogueId!==id||snapshot.bundleProductId!==product.currentBundleProductId||snapshot.resultFingerprint64!==active[0].fingerprint)throw new CatalogueAdminRouteError('Live inventory publication snapshot is missing or ambiguous.',409);
  let response:Response;try{response=await fetch(`${BUNDLE_API}/products/${product.currentBundleProductId}`,{headers:{authorization:`Bearer ${token}`,accept:'application/json'},cache:'no-store'});}catch{throw new CatalogueAdminRouteError('Bundle live inventory could not be read.',503);}
  if(!response.ok)throw new CatalogueAdminRouteError('Bundle live inventory could not be read.',response.status===404?404:503);
  const payload=await response.json().catch(()=>null),provider=object(payload)&&object(payload.data)?payload.data:payload;
  if(!object(provider)||provider.id!==product.currentBundleProductId||!Array.isArray(provider.productVariants))throw new CatalogueAdminRouteError('Bundle live inventory readback is invalid.',502);
  const providerVariants=new Map<number,{id:number;sku:string;price:number;inventory:number}>();
  for(const raw of provider.productVariants){if(!object(raw)||!revision(raw.id)||typeof raw.sku!=='string'||!raw.sku||!Number.isFinite(Number(raw.price))||Number(raw.price)<0||!Number.isSafeInteger(Number(raw.inventory))||Number(raw.inventory)<0||providerVariants.has(raw.id))throw new CatalogueAdminRouteError('Bundle live variant evidence is incomplete or ambiguous.',502);providerVariants.set(raw.id,{id:raw.id,sku:raw.sku,price:Number(raw.price),inventory:Number(raw.inventory)});}
  const rows=snapshot.product.combinations.map(combination=>{const variant=providerVariants.get(combination.variantId);if(!variant)throw new CatalogueAdminRouteError('A published variant is missing from Bundle live inventory.',409);return {valueKeys:[...combination.valueKeys],variantId:combination.variantId,inventory:variant.inventory};});
  if(new Set(rows.map(row=>row.variantId)).size!==rows.length)throw new CatalogueAdminRouteError('Published inventory bindings are ambiguous.',409);
  return {bundleProductId:product.currentBundleProductId,rows,providerVariants};
}
async function requireProduct(id:string){ensureId(id);const product=await readCatalogueProduct(id);if(!product)throw new CatalogueAdminRouteError('Catalogue product was not found.',404);return product;}
async function activeAdoption(product:CatalogueProductRecord){if(product.currentBundleProductId===null)return null;const adoption=await readCatalogueAdoptionByBundle(product.currentBundleProductId);return adoption?.status==='active'&&adoption.catalogueId===product.catalogueId?adoption:null;}
async function enrichAdminProduct(product:CatalogueProductRecord){return enrichCatalogueProductWithAdoption(product,await activeAdoption(product)) as CatalogueProductRecord&Row;}
function bundleRow(value:unknown):Row|null {const unwrapped=object(value)&&'data' in value?value.data:value;return object(unwrapped)?unwrapped:null;}
function bundleProductIsDeleted(value:unknown,id:number){const row=bundleRow(value);return Boolean(row&&row.id===id&&(row.deleted===true||row.deletedAt!==null&&row.deletedAt!==undefined)&&row.published===false);}
function bundleProductIsPublished(value:unknown,id:number){const row=bundleRow(value);return Boolean(row&&row.id===id&&row.deleted!==true&&(row.deletedAt===null||row.deletedAt===undefined)&&row.published===true);}
function bundleProductIsDraft(value:unknown,id:number,operationId:string){const row=bundleRow(value);return Boolean(row&&row.id===id&&row.deleted!==true&&(row.deletedAt===null||row.deletedAt===undefined)&&row.published===false&&row.draft===true&&row.draftOperationId===operationId);}
function activeBundleRows(value:unknown){if(!Array.isArray(value))throw new CatalogueAdminRouteError('Bundle active-version readback is uncertain.',502);return value.filter(item=>object(item)&&item.active===true);}
function publishedProduct(source:CatalogueProductRecord,bundleProductId:number,bindings:CatalogueVariantBinding[],metadata:Awaited<ReturnType<typeof listCatalogueMedia>>):CataloguePublishedProduct{
  const choices=source.model.choices.map(choice=>({key:choice.key,name:choice.name,values:choice.values.filter(value=>!value.retired).map(value=>({key:value.key,label:value.label}))}));
  const activeKeys=new Set(choices.flatMap(choice=>choice.values.map(value=>value.key))),bindingByTuple=new Map(bindings.map(binding=>[JSON.stringify(binding.valueKeys),binding.variantId]));
  const combinations=source.model.combinations.filter(combination=>combination.valueKeys.length===choices.length&&combination.valueKeys.every(key=>activeKeys.has(key))).map(combination=>({valueKeys:[...combination.valueKeys],variantId:bindingByTuple.get(JSON.stringify(combination.valueKeys))!,price:combination.price,inventory:combination.inventory}));
  if(combinations.length!==bindings.length||combinations.some(combination=>!revision(combination.variantId)))throw new CatalogueAdminRouteError('Published snapshot variant bindings are not exact.',502);
  const ordered=[...metadata].sort((a,b)=>a.order-b.order);const {minimumOrderQuantity=1,...details}=source.model.details;
  return {catalogueId:source.catalogueId,slug:source.slug,details,choices,combinations,images:ordered.map(item=>({url:`/catalogue-products-api?catalogueId=${encodeURIComponent(source.catalogueId)}&mediaId=${encodeURIComponent(item.mediaId)}`,order:item.order,assignment:item.assignment})),bundleProductId,minimumOrderQuantity};
}

export const catalogueAdminRoute={
  async list(){return {products:await listProducts()};},
  async get(id:string){return {product:await enrichAdminProduct(await requireProduct(id))};},
  async inventory(id:string,token:string){ensureId(id);const state=await activeCatalogueInventory(id,token);return {bundleProductId:state.bundleProductId,inventory:state.rows};},
  async updateInventory(id:string,body:unknown,token:string){
    ensureId(id);if(!object(body)||!exact(body,['bundleProductId','changes'])||!revision(body.bundleProductId)||!Array.isArray(body.changes)||body.changes.length>10_000)invalid('Exact Bundle product identity and inventory changes are required.');
    const changes=body.changes;if(changes.some(change=>!object(change)||!exact(change,['expectedInventory','inventory','variantId'])||!revision(change.variantId)||typeof change.expectedInventory!=='number'||!Number.isSafeInteger(change.expectedInventory)||change.expectedInventory<0||typeof change.inventory!=='number'||!Number.isSafeInteger(change.inventory)||change.inventory<0)||new Set(changes.map(change=>(change as Row).variantId)).size!==changes.length)invalid('Each inventory change requires one unique variant ID and nonnegative expected/new stock.');
    return withInventoryLock(id,async()=>{
      const before=await activeCatalogueInventory(id,token);if(before.bundleProductId!==body.bundleProductId)throw new CatalogueAdminRouteError('The active product changed. Reload before saving stock.',409);
      const requested=changes as Array<{variantId:number;expectedInventory:number;inventory:number}>;
      for(const change of requested){const variant=before.providerVariants.get(change.variantId);if(!variant||!before.rows.some(row=>row.variantId===change.variantId))throw new CatalogueAdminRouteError('A stock variant binding changed. Reload before saving.',409);if(variant.inventory!==change.expectedInventory&&variant.inventory!==change.inventory)throw new CatalogueAdminRouteError('Live stock changed after this editor was opened. Reload and review the latest stock before saving.',409);}
      const updates=requested.flatMap(change=>{const variant=before.providerVariants.get(change.variantId)!;return variant.inventory===change.inventory?[]:[{id:variant.id,sku:variant.sku,price:variant.price,inventory:change.inventory}];});
      let mutationFailed=false;if(updates.length)try{const response=await fetch(`${BUNDLE_API}/products/${before.bundleProductId}/batch-update`,{method:'POST',headers:{authorization:`Bearer ${token}`,accept:'application/json','content-type':'application/json'},body:JSON.stringify({variants:updates}),cache:'no-store'});if(!response.ok)mutationFailed=true;}catch{mutationFailed=true;}
      const after=await activeCatalogueInventory(id,token);
      for(const change of requested){const prior=before.providerVariants.get(change.variantId)!,current=after.providerVariants.get(change.variantId);if(!current||current.inventory!==change.inventory||current.sku!==prior.sku||current.price!==prior.price)throw new CatalogueAdminRouteError(mutationFailed?'Bundle stock update failed and could not be reconciled.':'Bundle stock readback did not match the requested change.',503);}
      return {bundleProductId:after.bundleProductId,inventory:after.rows,reconciled:mutationFailed};
    });
  },
  async create(body:unknown){if(!object(body)||!exact(body,['model','slug']))invalid('Exact model and slug fields are required.');return {product:await createCatalogueProduct(body.model,body.slug)};},
  async update(id:string,body:unknown){ensureId(id);if(!object(body)||!exact(body,['model','revision','slug'])||!revision(body.revision))invalid('Exact positive revision, model and slug fields are required.');const existing=await requireProduct(id);if(existing.revision!==body.revision)throw new CatalogueAdminRouteError('Catalogue product revision conflict.',409);const model=body.model as CatalogueProductRecord['model'],slug=body.slug as string;return {product:await updateCatalogueProduct(id,body.revision,record=>({...record,model,slug}))};},
  async archive(id:string,body:unknown){
    ensureId(id);if(!object(body)||!exact(body,['revision'])||!revision(body.revision))invalid('An exact positive revision is required.');
    const product=await requireProduct(id);if(product.revision!==body.revision)throw new CatalogueAdminRouteError('Catalogue product revision conflict.',409);
    const adoption=await activeAdoption(product);
    if(adoption?.status==='active'&&adoption.catalogueId===id)return {...await rollbackCatalogueAdoption(adoption.bundleProductId),adoptionRollback:true};
    return archiveCatalogueProduct(id,body.revision);
  },
  async unpublish(id:string,body:unknown,token:string){
    ensureId(id);if(!object(body)||!exact(body,['revision'])||!revision(body.revision))invalid('An exact positive revision is required.');
    const product=await requireProduct(id);if(product.revision!==body.revision)throw new CatalogueAdminRouteError('Catalogue product revision conflict.',409);
    const deletedBundleProductIds=new Set<number>();
    const local={
      readPublication:(operationId:string)=>readPublicationJob(operationId),
      async readProductPublication(productId:number){const publication=await latestPublication(id);return publication?.draftBundleProductId===productId?publication:null;},
      readMedia:(catalogueId:string)=>listCatalogueMedia(catalogueId),
      hideOptionValues:(productId:number,valueIds:number[])=>saveProductHiddenOptionValues(productId,{valueIds}),
      async activateVersion(){throw new CatalogueAdminRouteError('Catalogue activation is unavailable during unpublish.',500);},
      async readActivation(){return null;},
      async readActiveVersions(){const current=await requireProduct(id);return current.bundleVersions.filter(version=>version.retiredAt===null&&!deletedBundleProductIds.has(version.bundleProductId)).map(version=>({active:true,productId:version.bundleProductId,fingerprint:version.fingerprint}));},
    };
    const adapter=createCatalogueBundleAdapter({baseUrl:BUNDLE_API,token,local});
    const job=await latestPublication(id);
    if(job&&job.phase!=='complete'){
      let draftId=Number.isSafeInteger(job.draftBundleProductId)&&Number(job.draftBundleProductId)>0?Number(job.draftBundleProductId):null;
      if(draftId===null){const found=await adapter.findDraftByOperation(job.operationId);const row=bundleRow(found);if(found!==null&&(!row||!Number.isSafeInteger(row.id)||Number(row.id)<=0))throw new CatalogueAdminRouteError('Bundle draft reconciliation readback is uncertain.',502);draftId=row?Number(row.id):null;}
      if(draftId!==null){
        let before:unknown;try{before=await adapter.readPublicationState(draftId);}catch{throw new CatalogueAdminRouteError('Bundle draft readback is uncertain.',502);}
        if(!bundleProductIsDeleted(before,draftId)){
          if(!bundleProductIsDraft(before,draftId,job.operationId))throw new CatalogueAdminRouteError('Bundle draft operation identity is invalid.',409);
          try{await adapter.retirePreviousVersion(draftId,draftId,job.operationId);}catch{/* positive readback below decides commit-then-error */}
        }
        let after:unknown;try{after=await adapter.readPublicationState(draftId);}catch{throw new CatalogueAdminRouteError('Bundle draft retirement readback is uncertain.',502);}
        if(!bundleProductIsDeleted(after,draftId))throw new CatalogueAdminRouteError('Bundle draft retirement was not positively confirmed.',502);
        if(await adapter.findDraftByOperation(job.operationId)!==null)throw new CatalogueAdminRouteError('Bundle draft active-list absence was not positively confirmed.',502);
      }
    }
    if(product.status==='draft'&&product.currentBundleProductId===null){
      let active:unknown;try{active=await adapter.readActiveVersions();}catch{throw new CatalogueAdminRouteError('Bundle active-version readback is uncertain.',502);}
      if(activeBundleRows(active).length)throw new CatalogueAdminRouteError('Bundle still reports an active Catalogue version.',409);
      return {product};
    }
    const bundleProductId=product.currentBundleProductId;
    const active=product.bundleVersions.filter(version=>version.retiredAt===null);
    if(product.status!=='published'||bundleProductId===null||active.length!==1||active[0].bundleProductId!==bundleProductId)throw new CatalogueAdminRouteError('Catalogue publication state is invalid.',409);
    let before:unknown;try{before=await adapter.readPublicationState(bundleProductId);}catch{throw new CatalogueAdminRouteError('Bundle product readback is uncertain.',502);}
    if(!bundleProductIsPublished(before,bundleProductId))throw new CatalogueAdminRouteError('Bundle product is not positively published.',409);
    let mutationError:unknown=null;
    try{await adapter.retirePreviousVersion(bundleProductId,bundleProductId,active[0].fingerprint);}catch(reason){mutationError=reason;}
    let after:unknown;try{after=await adapter.readPublicationState(bundleProductId);}catch{throw new CatalogueAdminRouteError('Bundle retirement readback is uncertain.',502);}
    if(!bundleProductIsDeleted(after,bundleProductId))throw mutationError??new CatalogueAdminRouteError('Bundle retirement was not positively confirmed.',502);
    deletedBundleProductIds.add(bundleProductId);
    let remaining:unknown;try{remaining=await adapter.readActiveVersions();}catch{throw new CatalogueAdminRouteError('Bundle active-version readback is uncertain.',502);}
    if(activeBundleRows(remaining).length)throw new CatalogueAdminRouteError('Bundle still reports an active Catalogue version.',409);
    const retiredAt=new Date().toISOString();
    return {product:await updateCatalogueProduct(id,product.revision,record=>({...record,status:'draft' as const,currentBundleProductId:null,bundleVersions:record.bundleVersions.map(version=>version.retiredAt===null&&version.bundleProductId===bundleProductId?{...version,retiredAt}:version)}))};
  },
  async publication(id:string){await requireProduct(id);return {publication:await latestPublication(id)};},
  async publish(id:string,body:unknown,token:string){
    ensureId(id);if(!object(body)||!exact(body,['revision'])||!revision(body.revision))invalid('An exact positive revision is required.');
    const product=await requireProduct(id);if(product.revision!==body.revision)throw new CatalogueAdminRouteError('Catalogue product revision conflict.',409);
    let publishModel=product.model;
    if(product.currentBundleProductId!==null){const live=await activeCatalogueInventory(id,token),byTuple=new Map(live.rows.map(row=>[JSON.stringify(row.valueKeys),row]));publishModel={...product.model,combinations:product.model.combinations.map(combination=>{const current=byTuple.get(JSON.stringify(combination.valueKeys));return current?{...combination,inventory:current.inventory}:combination;})};}
    const publicationProduct={...product,model:publishModel};
    const metadata=await listCatalogueMedia(id);const uploads:Array<CataloguePreparedImageUpload&{body:Uint8Array}>=[];
    for(const item of metadata.sort((a,b)=>a.order-b.order)){const media=await readVerifiedCatalogueMedia(id,item.mediaId);uploads.push({key:media.mediaId,name:media.originalName,contentType:media.contentType,order:media.order,body:media.body,sha256:media.sha256});}
    const publishRequest={catalogueId:id,spec:publishModel,uploads,previousBundleProductId:product.currentBundleProductId,versionOrdinal:product.bundleVersions.length+1};
    const pendingPublication=await latestPublication(id),operationId=cataloguePublicationOperationId(publishRequest);
    const persistSnapshot=async(productId:number,bindings:CatalogueVariantBinding[],fingerprint:string,snapshotOperationId:string)=>{
      const publicProduct=publishedProduct(publicationProduct,productId,bindings,metadata);
      const snapshotMedia=uploads.map(upload=>{const item=metadata.find(media=>media.mediaId===upload.key);if(!item)throw new CatalogueAdminRouteError('Published snapshot media binding is missing.',502);return {mediaId:item.mediaId,originalName:item.originalName,contentType:item.contentType,bytes:item.bytes,sha256:item.sha256,order:item.order,assignment:item.assignment,body:upload.body};});
      await createCataloguePublishedSnapshot({operationId:snapshotOperationId,catalogueId:id,bundleProductId:productId,resultFingerprint64:fingerprint,product:publicProduct,media:snapshotMedia});
      const readback=await readCataloguePublishedSnapshot(snapshotOperationId);
      if(!readback||readback.catalogueId!==id||readback.bundleProductId!==productId||readback.resultFingerprint64!==fingerprint||!isDeepStrictEqual(readback.product,publicProduct))throw new CatalogueAdminRouteError('Published snapshot readback attestation failed.',503);
    };
    let activationOperation:string|null=null,snapshotOperation:string|null=null;
    const local={
      readPublication:(operationId:string)=>readPublicationJob(operationId),
      async readProductPublication(productId:number){const publication=await latestPublication(id);return publication?.draftBundleProductId===productId?publication:null;},
      readMedia:(catalogueId:string)=>listCatalogueMedia(catalogueId),
      hideOptionValues:(productId:number,valueIds:number[])=>saveProductHiddenOptionValues(productId,{valueIds}),
      async activateVersion(productId:number,bindings:CatalogueVariantBinding[],fingerprint:string,previousProductId:number|null,operationId:string){
        activationOperation=operationId;await persistSnapshot(productId,bindings,fingerprint,operationId);snapshotOperation=operationId;const current=await requireProduct(id);const active=current.bundleVersions.find(version=>version.retiredAt===null);
        if(current.currentBundleProductId===productId&&active?.fingerprint===fingerprint)return;
        if(current.currentBundleProductId!==previousProductId||current.revision!==product.revision)throw new CatalogueAdminRouteError('Catalogue activation conflicts with a newer product edit.',409);
        const now=new Date().toISOString();await updateCatalogueProduct(id,current.revision,record=>({...record,model:publishModel,status:'published' as const,currentBundleProductId:productId,bundleVersions:[...record.bundleVersions.map(version=>version.retiredAt===null?{...version,retiredAt:now}:version),{bundleProductId:productId,fingerprint,publishedAt:now,retiredAt:null}]}));
      },
      async readActivation(operationId:string,productId:number){
        activationOperation=operationId;const [job,current]=await Promise.all([readPublicationJob(operationId),requireProduct(id)]);const active=current.bundleVersions.find(version=>version.retiredAt===null);
        return {active:Boolean(job?.catalogueId===id&&job.draftBundleProductId===productId&&current.currentBundleProductId===productId&&active),operationId,productId,fingerprint:active?.fingerprint};
      },
      async readActiveVersions(){const current=await requireProduct(id),active=current.bundleVersions.find(version=>version.retiredAt===null);return active?[{active:true,operationId:activationOperation??undefined,productId:active.bundleProductId,fingerprint:active.fingerprint}]:[];},
    };
    const adapter=createCatalogueBundleAdapter({baseUrl:BUNDLE_API,token,local});
    if(pendingPublication&&pendingPublication.phase!=='complete'&&pendingPublication.operationId!==operationId){let conflictingDraft:unknown;try{conflictingDraft=await adapter.findDraftByOperation(pendingPublication.operationId);}catch{throw new CatalogueAdminRouteError('Catalogue publication is quarantined: the previous provider operation marker is ambiguous or unavailable.',409);}if(conflictingDraft)throw new CatalogueAdminRouteError(`Catalogue publication is quarantined: retire provider draft ${pendingPublication.draftBundleProductId??'unknown'} for operation ${pendingPublication.operationId} before publishing the changed draft.`,409);}
    const publication=await publishCatalogueProductVersion(publishRequest,adapter);
    if(snapshotOperation!==publication.operationId)await persistSnapshot(publication.bundleProductId,publication.bindings,publication.fingerprint,publication.operationId);
    let updated=await requireProduct(id);
    if(updated.currentBundleProductId!==publication.bundleProductId||!updated.bundleVersions.some(version=>version.bundleProductId===publication.bundleProductId&&version.fingerprint===publication.fingerprint&&version.retiredAt===null)){
      updated=await updateCatalogueProduct(id,updated.revision,record=>{const now=new Date().toISOString();return {...record,model:publishModel,status:'published' as const,currentBundleProductId:publication.bundleProductId,bundleVersions:[...record.bundleVersions.map(version=>version.retiredAt===null?{...version,retiredAt:now}:version),{bundleProductId:publication.bundleProductId,fingerprint:publication.fingerprint,publishedAt:now,retiredAt:null}]};});
    }
    if(product.currentBundleProductId!==null){const adoption=await readCatalogueAdoptionByBundle(product.currentBundleProductId);if(adoption?.status==='active'&&adoption.catalogueId===id)await supersedeCatalogueAdoption(product.currentBundleProductId,publication.bundleProductId);}
    await inheritShippingProductGroup({catalogueId:id,previousBundleProductId:product.currentBundleProductId,bundleProductId:publication.bundleProductId,slug:product.slug});
    return {product:updated,publication};
  },
};
