import { createHash } from 'node:crypto';
import type {
  CatalogueActivationState,
  CatalogueCompiledVariantsAttestation,
  CatalogueCompiledVariantsRequest,
  CatalogueDraftPayload,
  CataloguePreparedImageUpload,
  CataloguePublishDependencies,
  CatalogueRetirementState,
  CatalogueVariantBinding,
  CatalogueVariantUpdate,
} from './cataloguePublish.server';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;
type PublicationSnapshot = {
  operationId?: string;
  draftBundleProductId?: number|null;
  revision: number;
  catalogueId: string;
  phase?: string;
  resolved: { images:Record<string,number>; options:Record<string,number>; values:Record<string,number>; variants:Record<string,number> };
  bindings: Array<{valueKeys:string[];variantId:number}>;
};
type MediaSnapshot = { mediaId:string; originalName:string; contentType:string; order:number; sha256:string };
export type CatalogueBundleLocalState = {
  readPublication(operationId:string):Promise<PublicationSnapshot|null>;
  readProductPublication(productId:number):Promise<PublicationSnapshot|null>;
  readMedia(catalogueId:string):Promise<MediaSnapshot[]>;
  hideOptionValues(productId:number,valueIds:number[]):Promise<unknown>;
  activateVersion(productId:number,bindings:CatalogueVariantBinding[],fingerprint:string,previousProductId:number|null,operationId:string):Promise<void>;
  readActivation(operationId:string,productId:number):Promise<CatalogueActivationState|null|undefined>;
  readActiveVersions():Promise<unknown>;
};
export type CatalogueBundleAdapterOptions = { baseUrl:string; token:string; local:CatalogueBundleLocalState; fetcher?:Fetcher };

export class CatalogueBundleAdapterError extends Error {
  constructor(message:string, readonly status=502) { super(message); this.name='CatalogueBundleAdapterError'; }
}

const MAX_RESPONSE_BYTES=2*1024*1024, PAGE_LIMIT=100, MAX_PAGES=100;
const DRAFT_MARKER='TW-CATALOGUE-DRAFT';
const MARKER_TOKEN='TW-CATALOGUE-DRAFT';
const markerSuffix=(operationId:string)=>`\n[[${MARKER_TOKEN}:${operationId}]]`;
const titleSuffix=(operationId:string,revision:number)=>` [TW-${operationId.slice(0,8)}-a${revision}]`;
const object=(value:unknown):value is Row=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const operation=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const digest=operation;
const exactKeys=(value:Row,keys:string[])=>JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const rows=(value:unknown)=>Array.isArray(value)?value.filter(object):[];
const unwrap=(value:unknown)=>object(value)&&'data'in value?value.data:value;
function taxonomy(value:unknown):string[]{
  if(!Array.isArray(value)||value.length>100)return [];
  const raw=value.map(item=>typeof item==='string'?item:object(item)&&typeof item.name==='string'?item.name:null);
  if(raw.some(item=>item===null))return [];
  const names=(raw as string[]).map(item=>item.trim());
  if(names.some(item=>!item||item.length>128||/[\x00-\x1f\x7f]/.test(item)))return [];
  const joined=names.join(','),wrapped=joined.startsWith('[')||joined.endsWith(']');
  if(wrapped){
    if(!joined.startsWith('[')||!joined.endsWith(']'))return [];
    try{const parsed=JSON.parse(joined);if(Array.isArray(parsed)&&parsed.every(item=>typeof item==='string'))return taxonomy(parsed);}catch{}
    const parts=joined.slice(1,-1).split(',').map(item=>item.trim()),unwrapped=parts.map(item=>{const match=item.match(/^(['"])([^'"\[\]]+)\1$/);return match?.[2]??null;});
    if(unwrapped.some(item=>item===null))return [];
    return taxonomy(unwrapped);
  }
  if(names.some(item=>/[\[\]'"]/.test(item)))return [];
  return names.filter((item,index)=>names.indexOf(item)===index);
}
const tagsOf=(product:Row)=>taxonomy(product.tags);
function descriptionState(value:unknown){
  if(typeof value!=='string'||value.length>10_100)throw new CatalogueBundleAdapterError('Bundle product description is invalid.');
  const normalized=value.replace(/\r\n/g,'\n'),occurrences=normalized.split(MARKER_TOKEN).length-1;
  if(occurrences===0)return {description:normalized,operationId:null as string|null,raw:value};
  const match=normalized.match(/\n\[\[TW-CATALOGUE-DRAFT:([a-f0-9]{64})\]\]$/);
  if(!match||occurrences!==1)throw new CatalogueBundleAdapterError('Bundle draft description marker is malformed or ambiguous.',409);
  return {description:normalized.slice(0,-match[0].length),operationId:match[1],raw:value};
}
function titleState(value:unknown,job:PublicationSnapshot|null){
  if(typeof value!=='string'||value.length>200||!value.trim())throw new CatalogueBundleAdapterError('Bundle product title is invalid.');
  const occurrences=value.split('[TW-').length-1;
  if(occurrences===0)return {title:value,attemptRevision:null as number|null};
  const match=value.match(/ \[TW-([a-f0-9]{8})-a([1-9][0-9]*)\]$/),attemptRevision=match?Number(match[2]):NaN;
  if(!match||occurrences!==1||!Number.isSafeInteger(attemptRevision)||attemptRevision<=0)throw new CatalogueBundleAdapterError('Bundle provider title suffix is malformed or ambiguous.',409);
  if(!job||!operation(job.operationId)||!Number.isSafeInteger(job.revision)||job.revision<attemptRevision||job.operationId.slice(0,8)!==match[1])throw new CatalogueBundleAdapterError('Bundle provider title suffix does not match durable publication identity.',409);
  const title=value.slice(0,-match[0].length);
  if(!title.trim())throw new CatalogueBundleAdapterError('Bundle provider title suffix has no canonical title.',409);
  return {title,attemptRevision};
}
function productId(value:unknown){if(!positive(value))throw new CatalogueBundleAdapterError('A valid Bundle product ID is required.',400);return value;}
function operationId(value:unknown){if(!operation(value))throw new CatalogueBundleAdapterError('A valid publication operation ID is required.',400);return value;}
function boundedText(value:unknown,label:string,max:number,empty=false){if(typeof value!=='string'||value.length>max||!empty&&!value.trim())throw new CatalogueBundleAdapterError(`A valid ${label} is required.`,400);return value;}
function strings(value:unknown,label:string,max=10_000){if(!Array.isArray(value)||value.length>max||value.some(item=>typeof item!=='string'||!item||item.length>128)||new Set(value).size!==value.length)throw new CatalogueBundleAdapterError(`Valid unique ${label} are required.`,400);return [...value] as string[];}
function multipartStrings(value:unknown,label:string,max:number){const values=strings(value,label,max);if(values.some(item=>/[\x00-\x1f\x7f,]/.test(item)))throw new CatalogueBundleAdapterError(`Valid unambiguous ${label} are required.`,400);return values;}
function ids(value:unknown,label:string,max=10_000){if(!Array.isArray(value)||value.length>max||value.some(item=>!positive(item))||new Set(value).size!==value.length)throw new CatalogueBundleAdapterError(`Valid unique ${label} are required.`,400);return [...value] as number[];}
function productRow(value:unknown){const row=unwrap(value);if(!object(row)||!positive(row.id))throw new CatalogueBundleAdapterError('Bundle product readback is invalid.');return row;}

// Provider arrays have no stable ordering. An empty selectedOptions response is
// common, so generated SKUs are the other explicit source of code identity.
// After normalization removes those generated SKUs, retain a durable binding
// only when all remaining structural and explicit evidence agrees with it.
function compiledVariantAttestation(
  product:Row,
  codes:string[],
  expected?:CatalogueCompiledVariantsAttestation,
):CatalogueCompiledVariantsAttestation {
  const options=rows(product.options),variants=rows(product.productVariants);
  if(!codes.length||new Set(codes).size!==codes.length||new Set(codes.map(code=>code.toUpperCase())).size!==codes.length
    ||options.length!==1||options[0].name!=='Catalogue Variant'||!positive(options[0].id)
    ||variants.length!==codes.length||variants.some(variant=>!positive(variant.id))
    ||new Set(variants.map(variant=>variant.id)).size!==variants.length) {
    throw new CatalogueBundleAdapterError('Bundle compiled variant structure or IDs are ambiguous.');
  }
  const option=options[0],values=rows(option.values),wanted=new Set(codes);
  if(values.length!==codes.length||values.some(value=>!positive(value.id)||typeof value.value!=='string'||!wanted.has(value.value))
    ||new Set(values.map(value=>value.id)).size!==values.length||new Set(values.map(value=>value.value)).size!==values.length) {
    throw new CatalogueBundleAdapterError('Bundle compiled option/value code mapping is ambiguous.');
  }
  const valueIdForCode=new Map(values.map(value=>[value.value as string,value.id as number]));
  const valueIdByCode=Object.fromEntries(codes.map(code=>[code,valueIdForCode.get(code)!]));
  const codeByValueId=new Map(values.map(value=>[value.id,value.value as string]));
  const codeByUppercase=new Map(codes.map(code=>[code.toUpperCase(),code]));
  const variantIds=new Set(variants.map(variant=>variant.id));
  if(expected&&(expected.optionId!==option.id
    ||Object.keys(expected.valueIdByCode).length!==codes.length||Object.keys(expected.variantIdByCode).length!==codes.length
    ||codes.some(code=>expected.valueIdByCode[code]!==valueIdByCode[code]
      ||!positive(expected.variantIdByCode[code])||!variantIds.has(expected.variantIdByCode[code]))
    ||new Set(Object.values(expected.variantIdByCode)).size!==codes.length)) {
    throw new CatalogueBundleAdapterError('Bundle compiled IDs do not match durable publication bindings.',409);
  }
  const expectedCodeByVariant=new Map(expected?codes.map(code=>[expected.variantIdByCode[code],code]):[]);
  const variantIdByCode:Record<string,number>={};
  for(const variant of variants) {
    let selectedCode:string|undefined;
    if(variant.selectedOptions!==undefined&&variant.selectedOptions!==null) {
      if(!Array.isArray(variant.selectedOptions))throw new CatalogueBundleAdapterError('Bundle compiled selected-option mapping is invalid.');
      if(variant.selectedOptions.length) {
        const selected=variant.selectedOptions[0];
        if(variant.selectedOptions.length!==1||!object(selected)||selected.optionId!==option.id
          ||!positive(selected.valueId)||!codeByValueId.has(selected.valueId)) {
          throw new CatalogueBundleAdapterError('Bundle compiled selected-option mapping is invalid.');
        }
        selectedCode=codeByValueId.get(selected.valueId)!;
        if(selected.value!==undefined&&selected.value!==selectedCode) {
          throw new CatalogueBundleAdapterError('Bundle compiled selected-option code/value IDs contradict each other.');
        }
      }
    }
    // Bundle keeps SKUs reserved even after soft-delete, so its compiler can
    // append a numeric uniqueness counter (e.g. CV-<hash>-1) on a later draft.
    // The full CV code still identifies the value; the counter never does.
    // Keep this anchored and numeric-only, and retain all one-to-one and
    // selected/durable identity checks below. Never infer identity by row order.
    const generatedCode=typeof variant.sku==='string'?variant.sku.match(/(?:^|-)(CV-[A-Z0-9]+)(?:-[1-9][0-9]*)?$/i)?.[1]:undefined;
    const skuCode=generatedCode?codeByUppercase.get(generatedCode.toUpperCase()):undefined;
    const unknownGeneratedCode=generatedCode&&!skuCode&&/^CV-[A-F0-9]{24}$/i.test(generatedCode);
    if(unknownGeneratedCode||selectedCode&&skuCode&&selectedCode!==skuCode) {
      throw new CatalogueBundleAdapterError('Bundle compiled generated SKU and selected-option mappings contradict each other.');
    }
    const explicitCode=selectedCode??skuCode,durableCode=expectedCodeByVariant.get(variant.id as number);
    if(explicitCode&&expected&&explicitCode!==durableCode) {
      throw new CatalogueBundleAdapterError('Bundle compiled variant evidence contradicts durable publication bindings. Retire the inactive draft before retrying.',409);
    }
    const code=explicitCode??durableCode;
    if(!code||Object.hasOwn(variantIdByCode,code)) {
      throw new CatalogueBundleAdapterError('Bundle compiled variant code identity is missing or ambiguous.');
    }
    variantIdByCode[code]=variant.id as number;
  }
  return {optionId:option.id as number,valueIdByCode,variantIdByCode:Object.fromEntries(codes.map(code=>[code,variantIdByCode[code]]))};
}

export function createCatalogueBundleAdapter(options:CatalogueBundleAdapterOptions):CataloguePublishDependencies {
  const expected=options?.fetcher===undefined?['baseUrl','local','token']:['baseUrl','fetcher','local','token'];
  if(!object(options)||!exactKeys(options,expected)||!object(options.local))throw new CatalogueBundleAdapterError('Exact Bundle adapter options are required.',500);
  const localMethods=['readPublication','readProductPublication','readMedia','hideOptionValues','activateVersion','readActivation','readActiveVersions'] as const;
  if(localMethods.some(name=>typeof options.local[name]!=='function'))throw new CatalogueBundleAdapterError('Valid local Catalogue composition is required.',500);
  let base:URL;try{base=new URL(options.baseUrl);}catch{throw new CatalogueBundleAdapterError('A valid Bundle API URL is required.',500);}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new CatalogueBundleAdapterError('Bundle API URL must use HTTPS without credentials or query data.',500);
  boundedText(options.token,'server Bundle token',8192);const fetcher=options.fetcher??fetch;if(typeof fetcher!=='function')throw new CatalogueBundleAdapterError('A valid Bundle fetch implementation is required.',500);
  base.pathname=`${base.pathname.replace(/\/$/,'')}/`;
  async function call(path:string,method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',body?:BodyInit):Promise<unknown>{
    let response:Response;const headers:Record<string,string>={authorization:`Bearer ${options.token}`,accept:'application/json'};if(typeof body==='string')headers['content-type']='application/json';
    try{response=await fetcher(new URL(path.replace(/^\//,''),base),{method,headers,...(body===undefined?{}:{body}),cache:'no-store'});}catch{throw new CatalogueBundleAdapterError('Bundle API request failed.');}
    const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>MAX_RESPONSE_BYTES))throw new CatalogueBundleAdapterError('Bundle API response is too large.');
    const text=await response.text();if(Buffer.byteLength(text)>MAX_RESPONSE_BYTES)throw new CatalogueBundleAdapterError('Bundle API response is too large.');
    let payload:unknown={};if(text)try{payload=JSON.parse(text);}catch{throw new CatalogueBundleAdapterError('Bundle API returned invalid JSON.');}
    if(!response.ok)throw new CatalogueBundleAdapterError('Bundle API rejected the catalogue operation.',response.status>=400&&response.status<=599?response.status:502);return payload;
  }
  const get=(path:string,query?:Record<string,string|number>)=>call(`${path}${query?`?${new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)]))}`:''}`,'GET');
  const json=(path:string,method:'POST'|'PATCH',value:unknown)=>call(path,method,JSON.stringify(value));
  async function readRaw(id:number){return productRow(await get(`products/${productId(id)}`));}
  // A provider PUT may commit before the response or local checkpoint survives.
  // Never append another copy merely because per-request metadata was lost.
  // Only bytes from the fixed provider bucket can attest an unbound image.
  const imageDigests=new Map<string,Promise<string>>();
  function imageDigest(image:Row):Promise<string>{
    const key=JSON.stringify([image.id,image.url]);
    let promise=imageDigests.get(key);
    if(!promise){promise=downloadImageDigest(image);imageDigests.set(key,promise);}
    return promise;
  }
  async function downloadImageDigest(image:Row):Promise<string>{
    let url:URL;
    try{url=new URL(String(image.url));}catch{throw new CatalogueBundleAdapterError('Uncheckpointed image URL cannot be verified.',503);}
    if(url.protocol!=='https:'||url.hostname!=='oss-bucket.s3.us-east-2.amazonaws.com'||url.port||url.username||url.password||url.hash)throw new CatalogueBundleAdapterError('Uncheckpointed image storage origin is not approved.',503);
    let response:Response;
    try{response=await fetcher(url,{method:'GET',headers:{accept:'image/*'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});}catch{throw new CatalogueBundleAdapterError('Existing image bytes are unavailable. No duplicate upload was attempted.',503);}
    const length=response.headers.get('content-length');
    if(!response.ok||!response.body||length!==null&&(!/^\d+$/.test(length)||Number(length)>10*1024*1024))throw new CatalogueBundleAdapterError('Existing image bytes cannot be safely verified.',503);
    const reader=response.body.getReader(),hash=createHash('sha256');let bytes=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>10*1024*1024){await reader.cancel();throw new CatalogueBundleAdapterError('Existing image exceeds the safe verification limit.',503);}hash.update(value);}}finally{reader.releaseLock();}
    if(bytes===0)throw new CatalogueBundleAdapterError('Existing image is empty. No duplicate upload was attempted.',503);
    return hash.digest('hex');
  }
  async function listProducts(query:Record<string,string|number>={}){
    const all:Row[]=[];
    for(let page=1;page<=MAX_PAGES;page+=1){const raw=unwrap(await get('products',{...query,page,limit:PAGE_LIMIT}));const pageRows=Array.isArray(raw)?rows(raw):object(raw)&&Array.isArray(raw.data)?rows(raw.data):[];if(!Array.isArray(raw)&&!(object(raw)&&Array.isArray(raw.data)))throw new CatalogueBundleAdapterError('Bundle product list readback is invalid.');all.push(...pageRows);if(pageRows.length<PAGE_LIMIT)return all;}
    throw new CatalogueBundleAdapterError('Bundle product pagination exceeded its safe bound.',503);
  }
  type Pending={operationId:string;images:Record<string,{id:number;name:string;contentType:string;order:number;sha256:string}>;option?:CatalogueCompiledVariantsAttestation};
  const pending=new Map<number,Pending>();
  const state=(id:number,op:string)=>{const current=pending.get(id);if(current&&current.operationId!==op)throw new CatalogueBundleAdapterError('Bundle draft operation identity changed.',409);if(current)return current;const created:Pending={operationId:op,images:{}};pending.set(id,created);return created;};
  async function operationFor(product:Row){return descriptionState(product.description).operationId;}
  async function composition(id:number,product:Row){
    const marker=descriptionState(product.description),composed=structuredClone(product),deleted=product.deletedAt!=null||product.deleted===true;
    composed.description=marker.description;composed.categories=taxonomy(composed.categories);composed.tags=taxonomy(composed.tags);composed.draft=Boolean(marker.operationId)&&!deleted;composed.published=!marker.operationId&&!deleted;composed.isPublished=composed.published;
    if(marker.operationId)composed.draftOperationId=marker.operationId;else delete composed.draftOperationId;
    const memory=pending.get(id);let op=marker.operationId??memory?.operationId??null,job=op?await options.local.readPublication(op):await options.local.readProductPublication(id);
    if(!op&&job){if(!operation(job.operationId)||job.draftBundleProductId!==id)throw new CatalogueBundleAdapterError('Local Catalogue publication identity is invalid.',409);op=job.operationId;}
    if(!op){composed.title=titleState(composed.title,null).title;return composed;}if(!job)job=await options.local.readPublication(op);
    composed.title=titleState(composed.title,job).title;
    const imageMeta:Record<number,{key:string;name:string;contentType:string;order:number;sha256:string}>={};
    if(job){const media=await options.local.readMedia(job.catalogueId);for(const item of media){const imageId=job.resolved.images[item.mediaId];if(positive(imageId))imageMeta[imageId]={key:item.mediaId,name:item.originalName,contentType:item.contentType,order:item.order,sha256:item.sha256};}}
    for(const [key,item] of Object.entries(memory?.images??{}))imageMeta[item.id]={key,name:item.name,contentType:item.contentType,order:item.order,sha256:item.sha256};
    // Keep the provider's actual order. Local intent is not evidence that an
    // image-order mutation committed.
    composed.images=rows(composed.images).map(image=>{const meta=positive(image.id)?imageMeta[image.id]:undefined;return meta?{...image,uploadKey:meta.key,contentType:meta.contentType,sha256:meta.sha256}:image;});
    let option=memory?.option;
    if(job&&positive(job.resolved.options['catalogue-variant'])) {
      const durable={optionId:job.resolved.options['catalogue-variant'],valueIdByCode:{...job.resolved.values},variantIdByCode:Object.fromEntries(job.bindings.filter(binding=>binding.valueKeys.length===1).map(binding=>[binding.valueKeys[0],binding.variantId]))};
      const attested=compiledVariantAttestation(product,Object.keys(durable.valueIdByCode),durable);
      if(option&&(option.optionId!==attested.optionId||Object.keys(option.valueIdByCode).length!==Object.keys(attested.valueIdByCode).length
        ||Object.keys(attested.valueIdByCode).some(code=>option!.valueIdByCode[code]!==attested.valueIdByCode[code]||option!.variantIdByCode[code]!==attested.variantIdByCode[code]))) {
        throw new CatalogueBundleAdapterError('Bundle compiled in-memory and durable publication bindings disagree.',409);
      }
      option=attested;
    } else if(option) {
      option=compiledVariantAttestation(product,Object.keys(option.valueIdByCode),option);
    } else {
      const productOptions=rows(product.options);
      if(productOptions.length===1&&productOptions[0].name==='Catalogue Variant') {
        const codes=rows(productOptions[0].values).map(value=>value.value);
        if(codes.some(code=>typeof code!=='string'))throw new CatalogueBundleAdapterError('Bundle compiled variant codes are invalid.');
        option=compiledVariantAttestation(product,codes as string[]);
        await options.local.hideOptionValues(id,Object.values(option.valueIdByCode));
      }
    }
    if(option){const codeByVariant=new Map(Object.entries(option.variantIdByCode).map(([code,variantId])=>[variantId,code]));composed.productVariants=rows(composed.productVariants).map(variant=>{const code=positive(variant.id)?codeByVariant.get(variant.id):undefined;return code?{...variant,selectedOptions:[{optionId:option!.optionId,valueId:option!.valueIdByCode[code],value:code}]}:variant;});}
    return composed;
  }
  function fullMetadataForm(product:Row,description:string){
    const form=new FormData();form.set('title',boundedText(product.title,'product title',200));form.set('description',boundedText(description,'product description',10_100,true));form.set('type',typeof product.type==='string'&&product.type?product.type:'MERCHANDISE');
    const price=typeof product.price==='number'?product.price:Number(product.price);if(!Number.isFinite(price)||price<0)throw new CatalogueBundleAdapterError('Bundle product price is invalid.');form.set('price',String(price));
    form.set('shippingCost',String(product.shippingCost??0));form.set('weight',String(product.weight??0));form.set('isPreOrder',String(product.isPreOrder===true));if(product.requiresSimAssignment===true)form.set('requiresSimAssignment','true');if(product.tracksInventory===true)form.set('tracksInventory','true');return form;
  }
  function verifyRawMetadata(before:Row,after:Row,description:string){const normalized=(value:unknown)=>typeof value==='string'?value.replace(/\r\n/g,'\n'):value;if(after.title!==before.title||normalized(after.description)!==normalized(description)||Number(after.price)!==Number(before.price)||(after.isPreOrder===true)!==(before.isPreOrder===true)||before.requiresSimAssignment===true&&after.requiresSimAssignment!==true||before.tracksInventory===true&&after.tracksInventory!==true)throw new CatalogueBundleAdapterError('Bundle full metadata PUT readback failed.');}
  async function putMetadata(id:number,product:Row,description:string,image?:{bytes:Uint8Array;contentType:string;name:string}){const form=fullMetadataForm(product,description);if(image)form.set('images',new Blob([Uint8Array.from(image.bytes).buffer],{type:image.contentType}),image.name);await call(`products/${id}`,'PUT',form);const after=await readRaw(id);verifyRawMetadata(product,after,description);return after;}
  async function publicationState(id:number){return composition(id,await readRaw(id));}

  return {
    draftMarker:DRAFT_MARKER,
    async createDraft(payload:CatalogueDraftPayload){
      if(!object(payload)||!exactKeys(payload,['attemptRevision','categories','description','draft','draftMarker','operationId','price','tags','title',...(Object.hasOwn(payload,'isPreOrder')?['isPreOrder']:[])])||payload.isPreOrder!==undefined&&typeof payload.isPreOrder!=='boolean'||payload.draft!==true||payload.draftMarker!==DRAFT_MARKER||!operation(payload.operationId)||!Number.isSafeInteger(payload.attemptRevision)||payload.attemptRevision<=0||typeof payload.price!=='number'||!Number.isFinite(payload.price)||payload.price<0)throw new CatalogueBundleAdapterError('A valid explicit catalogue draft payload is required.',400);
      boundedText(payload.title,'draft title',200);boundedText(payload.description,'draft description',10_000,true);const categories=strings(payload.categories,'draft categories',100),tags=strings(payload.tags,'draft tags',100);if(payload.description.includes(MARKER_TOKEN))throw new CatalogueBundleAdapterError('Draft description contains reserved marker text.',400);if(payload.title.includes('[TW-'))throw new CatalogueBundleAdapterError('Draft title contains reserved provider suffix text.',400);
      const job=await options.local.readPublication(payload.operationId);if(!job||job.operationId!==payload.operationId||job.revision!==payload.attemptRevision)throw new CatalogueBundleAdapterError('Draft attempt revision does not match the durable publication.',409);
      const suffix=titleSuffix(payload.operationId,payload.attemptRevision),providerTitle=`${payload.title.slice(0,200-suffix.length)}${suffix}`;
      const form=new FormData();form.set('title',providerTitle);form.set('description',`${payload.description}${markerSuffix(payload.operationId)}`);form.set('type','MERCHANDISE');form.set('price',String(payload.price));form.set('shippingCost','0');form.set('weight','0');form.set('isPreOrder',String(payload.isPreOrder??false));form.set('categories',JSON.stringify(categories));form.set('tags',JSON.stringify(tags));const simCategory=categories.some(category=>/^sim cards?$/i.test(category));if(simCategory){form.set('requiresSimAssignment','true');form.set('tracksInventory','true');}const response=await call('products/upload','POST',form);const created=productRow(response);if(simCategory||payload.isPreOrder!==undefined){const readback=await readRaw(created.id as number);if((readback.isPreOrder===true)!==(payload.isPreOrder===true)||simCategory&&(readback.requiresSimAssignment!==true||readback.tracksInventory!==true))throw new CatalogueBundleAdapterError('Bundle did not persist required product flags.',502);}return response;
    },
    async findDraftByOperation(value:string){const op=operationId(value),matches:Row[]=[];for(const product of await listProducts()){if(product.deletedAt!=null||product.deleted===true)continue;const state=descriptionState(product.description);if(state.operationId===op)matches.push(product);}if(matches.length>1)throw new CatalogueBundleAdapterError('Bundle draft reconciliation is ambiguous.',409);return matches[0]&&positive(matches[0].id)?composition(matches[0].id,matches[0]):null;},
    async readProduct(id:number){const product=await composition(productId(id),await readRaw(id));return {data:product};},
    async readPublicationState(id:number){return {data:await publicationState(productId(id))};},
    async uploadImage(id:number,upload:CataloguePreparedImageUpload){
      id=productId(id);if(!object(upload)||!exactKeys(upload,['body','contentType','key','name','operationId','order','sha256'])||!operation(upload.operationId)||!digest(upload.sha256)||!Number.isSafeInteger(upload.order)||upload.order<0||!['image/jpeg','image/png','image/webp'].includes(upload.contentType))throw new CatalogueBundleAdapterError('A valid explicit catalogue image upload is required.',400);boundedText(upload.key,'upload key',128);boundedText(upload.name,'upload name',255);const bytes=upload.body instanceof Uint8Array?upload.body:null;if(!bytes||!bytes.byteLength||bytes.byteLength>10*1024*1024)throw new CatalogueBundleAdapterError('Catalogue image bytes are invalid.',400);
      if(createHash('sha256').update(bytes).digest('hex')!==upload.sha256)throw new CatalogueBundleAdapterError('Catalogue image upload digest does not match its bytes.',400);
      const before=await readRaw(id),marker=descriptionState(before.description);
      if(marker.operationId!==upload.operationId||before.deletedAt!=null||before.deleted===true)throw new CatalogueBundleAdapterError('Bundle image upload draft identity is invalid.',409);
      const job=await options.local.readPublication(upload.operationId);
      if(!job||job.operationId!==upload.operationId||job.draftBundleProductId!==id||job.phase!==undefined&&job.phase!=='building')throw new CatalogueBundleAdapterError('Image recovery requires the exact building publication identity.',409);
      const media=await options.local.readMedia(job.catalogueId),source=media.find(item=>item.mediaId===upload.key);
      if(!source||media.filter(item=>item.mediaId===upload.key).length!==1||source.sha256!==upload.sha256||source.contentType!==upload.contentType||source.originalName!==upload.name||source.order!==upload.order)throw new CatalogueBundleAdapterError('Image recovery source manifest does not match this upload.',409);
      const images=rows(before.images),beforeIds=new Set(images.map(image=>image.id));
      if(!Array.isArray(before.images)||images.length!==before.images.length||images.length>100||images.some(image=>!positive(image.id)||image.productId!==undefined&&image.productId!==id)||beforeIds.size!==images.length)throw new CatalogueBundleAdapterError('Image recovery provider identities are ambiguous.',503);
      const current=state(id,upload.operationId),known={...job.resolved.images,...Object.fromEntries(Object.entries(current.images).map(([key,image])=>[key,image.id]))};
      if(new Set(Object.values(known)).size!==Object.keys(known).length)throw new CatalogueBundleAdapterError('Checkpointed image identities are ambiguous.',503);
      const verifiedOrders=new Map<number,number>();
      for(const [key,imageId]of Object.entries(known)){
        const item=media.find(item=>item.mediaId===key),image=images.find(image=>image.id===imageId);
        if(!item||!image||await imageDigest(image)!==item.sha256)throw new CatalogueBundleAdapterError('Checkpointed image bytes contradict the source manifest. No duplicate upload was attempted.',503);
        verifiedOrders.set(imageId,item.order);
      }
      const expectedId=known[upload.key],otherIds=new Set(Object.entries(known).filter(([key])=>key!==upload.key).map(([,imageId])=>imageId));
      if(expectedId!==undefined&&(!positive(expectedId)||!beforeIds.has(expectedId)||otherIds.has(expectedId)))throw new CatalogueBundleAdapterError('Checkpointed image identity is missing or ambiguous. No duplicate upload was attempted.',503);
      const candidates=images.filter(image=>!otherIds.has(image.id as number)),matches:Row[]=[];
      // A failed read cannot prove absence: fail closed rather than duplicate.
      for(const image of candidates){
        const sha256=await imageDigest(image);
        if(!media.some(item=>item.sha256===sha256))throw new CatalogueBundleAdapterError('An existing draft image does not match the source manifest. No duplicate upload was attempted.',503);
        if(sha256===upload.sha256)matches.push(image);
      }
      if(matches.length>1||matches.length===1&&(expectedId!==undefined&&matches[0].id!==expectedId||expectedId===undefined&&media.filter(item=>item.sha256===upload.sha256&&!Object.hasOwn(known,item.mediaId)).length!==1))throw new CatalogueBundleAdapterError('Existing image content mapping is ambiguous. No duplicate upload was attempted.',503);
      if(expectedId!==undefined&&matches.length!==1)throw new CatalogueBundleAdapterError('Checkpointed image bytes no longer match the source. No duplicate upload was attempted.',503);
      let after=before,imageId:number;
      if(matches.length===1){imageId=matches[0].id as number;}
      else{
        try{after=await putMetadata(id,before,marker.raw,{bytes:new Uint8Array(bytes),contentType:upload.contentType,name:upload.name});}
        catch{after=await readRaw(id);verifyRawMetadata(before,after,marker.raw);}
        const added=rows(after.images).filter(image=>positive(image.id)&&!beforeIds.has(image.id));
        if(added.length!==1||descriptionState(after.description).operationId!==upload.operationId||await imageDigest(added[0])!==upload.sha256)throw new CatalogueBundleAdapterError('Image upload outcome could not be verified. Retry the same draft; do not add another image.',503);
        imageId=added[0].id as number;
      }
      verifiedOrders.set(imageId,upload.order);
      const ordering=rows(after.images).map(image=>({id:image.id as number,order:verifiedOrders.get(image.id as number)??image.order as number})).sort((a,b)=>a.order-b.order);
      if(ordering.length!==rows(after.images).length||ordering.some((item,index)=>item.order!==index))throw new CatalogueBundleAdapterError('Bundle image order composition is incomplete.');
      try{await json(`products/${id}/images/order`,'PATCH',{images:ordering});}catch{/* Exact readback also reconciles an order commit with a lost response. */}
      after=await readRaw(id);
      if(descriptionState(after.description).operationId!==upload.operationId||rows(after.images).length!==ordering.length||ordering.some(item=>!rows(after.images).some(image=>image.id===item.id&&image.order===item.order)))throw new CatalogueBundleAdapterError('Bundle image upload/order positive readback failed.');
      // Promote the binding only after the provider's raw ordering is proven.
      // A failed order write must not manufacture positive publisher evidence.
      current.images[upload.key]={id:imageId,name:upload.name,contentType:upload.contentType,order:upload.order,sha256:upload.sha256};
      return {imageId,sha256:upload.sha256};
    },
    async createCompiledVariants(id:number,request:CatalogueCompiledVariantsRequest){
      id=productId(id);if(!object(request)||!exactKeys(request,['autoGenerateSku','defaultInventory','hidden','operationId','optionName','values'])||request.optionName!=='Catalogue Variant'||request.hidden!==true||request.autoGenerateSku!==true||request.defaultInventory!==0||!operation(request.operationId))throw new CatalogueBundleAdapterError('A valid explicit compiled variant request is required.',400);const codes=strings(request.values,'compiled variant codes');await json(`products/${id}/variants`,'POST',{optionName:'Catalogue Variant',values:codes.map(value=>({value})),autoGenerateSku:true,defaultInventory:0});const attestation=compiledVariantAttestation(await readRaw(id),codes);state(id,request.operationId).option=attestation;await options.local.hideOptionValues(id,Object.values(attestation.valueIdByCode));return attestation;
    },
    async batchUpdateVariants(id:number,variants:CatalogueVariantUpdate[]){id=productId(id);if(!Array.isArray(variants)||!variants.length||variants.length>10_000||variants.some(v=>!object(v)||!exactKeys(v,['id','inventory','price','sku'])||!positive(v.id)||typeof v.sku!=='string'||!v.sku||v.sku.length>100||typeof v.price!=='number'||!Number.isFinite(v.price)||v.price<0||!Number.isSafeInteger(v.inventory)||v.inventory<0))throw new CatalogueBundleAdapterError('Valid explicit variant updates are required.',400);await json(`products/${id}/batch-update`,'POST',{variants});},
    async publishProduct(id:number,op:string){id=productId(id);op=operationId(op);const product=await readRaw(id),marker=descriptionState(product.description);if(marker.operationId!==op)throw new CatalogueBundleAdapterError('Bundle publication draft identity is invalid.',409);await putMetadata(id,product,marker.description);const state=await publicationState(id);if(state.published!==true||state.draft!==false)throw new CatalogueBundleAdapterError('Bundle publication positive readback failed.');},
    async restoreDraft(id:number,op:string){id=productId(id);op=operationId(op);const product=await readRaw(id),marker=descriptionState(product.description);if(marker.operationId!==null&&marker.operationId!==op)throw new CatalogueBundleAdapterError('Bundle draft restoration identity is invalid.',409);const clean=marker.description;if(clean.includes(MARKER_TOKEN))throw new CatalogueBundleAdapterError('Bundle draft restoration description is invalid.',409);await putMetadata(id,product,`${clean}${markerSuffix(op)}`);const state=await publicationState(id);if(state.draft!==true||state.published!==false||state.draftOperationId!==op)throw new CatalogueBundleAdapterError('Bundle draft restoration positive readback failed.');},
    activateVersion(id:number,bindings:CatalogueVariantBinding[],fingerprint:string,previousProductId:number|null,op:string){productId(id);if(!digest(fingerprint)||!operation(op)||previousProductId!==null&&!positive(previousProductId)||!Array.isArray(bindings)||bindings.length>10_000)throw new CatalogueBundleAdapterError('Valid explicit catalogue activation data is required.',400);return options.local.activateVersion(id,bindings,fingerprint,previousProductId,op);},
    readActivation(op:string,id:number){return options.local.readActivation(operationId(op),productId(id));},
    readActiveVersions(){return options.local.readActiveVersions();},
    async retirePreviousVersion(previous:number,replacement:number,op:string){productId(previous);productId(replacement);operationId(op);await call(`products/${previous}/soft-delete`,'DELETE');const state=await this.readRetirement(previous,replacement);if(state?.retired!==true)throw new CatalogueBundleAdapterError('Bundle retirement positive readback failed.');},
    async readRetirement(previous:number,replacement:number){previous=productId(previous);replacement=productId(replacement);const prior=await readRaw(previous),replacementIsAttested=previous===replacement||rows(await options.local.readActiveVersions()).some(x=>(x.productId??x.bundleProductId)===replacement&&x.active===true);return {retired:prior.deletedAt!=null||prior.deleted===true,previousProductId:previous,replacementProductId:replacement,...(replacementIsAttested?{}:{retired:false})} as CatalogueRetirementState;},
    async checkGlobalSkuAvailability(skus:string[],context:{excludeProductIds:number[]}){const checked=strings(skus,'SKU values');if(!object(context)||!exactKeys(context,['excludeProductIds']))throw new CatalogueBundleAdapterError('Exact SKU availability context is required.',400);const excluded=ids(context.excludeProductIds,'excluded product IDs'),wanted=new Set(checked),collisions:Row[]=[];for(const product of await listProducts()){if(!positive(product.id)||excluded.includes(product.id))continue;for(const variant of [...rows(product.productVariants),...rows(product.variants)])if(typeof variant.sku==='string'&&wanted.has(variant.sku))collisions.push({productId:product.id,variantId:variant.id??null,sku:variant.sku});if(typeof product.sku==='string'&&wanted.has(product.sku))collisions.push({productId:product.id,variantId:null,sku:product.sku});}return {available:collisions.length===0,collisions,checkedSkus:checked,excludedProductIds:excluded};},
  };
}
