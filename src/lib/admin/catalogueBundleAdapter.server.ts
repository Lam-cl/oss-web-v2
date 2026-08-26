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
    composed.images=rows(composed.images).map(image=>{const meta=positive(image.id)?imageMeta[image.id]:undefined;return meta?{...image,uploadKey:meta.key,contentType:meta.contentType,order:meta.order,sha256:meta.sha256}:image;});
    let option=memory?.option;
    if(!option&&job&&positive(job.resolved.options['catalogue-variant']))option={optionId:job.resolved.options['catalogue-variant'],valueIdByCode:{...job.resolved.values},variantIdByCode:Object.fromEntries(job.bindings.filter(x=>x.valueKeys.length===1).map(x=>[x.valueKeys[0],x.variantId]))};
    if(!option){const productOptions=rows(composed.options),variants=rows(composed.productVariants),values=productOptions.length===1?rows(productOptions[0].values):[];if(productOptions.length===1&&productOptions[0].name==='Catalogue Variant'&&positive(productOptions[0].id)&&values.length===variants.length&&values.length>0&&values.every(value=>positive(value.id)&&typeof value.value==='string')&&variants.every(variant=>positive(variant.id))){option={optionId:productOptions[0].id as number,valueIdByCode:Object.fromEntries(values.map(value=>[value.value as string,value.id as number])),variantIdByCode:Object.fromEntries(values.map((value,index)=>[value.value as string,variants[index].id as number]))};await options.local.hideOptionValues(id,Object.values(option.valueIdByCode));}}
    if(option){const codeByVariant=new Map(Object.entries(option.variantIdByCode).map(([code,variantId])=>[variantId,code]));composed.productVariants=rows(composed.productVariants).map(variant=>{const code=positive(variant.id)?codeByVariant.get(variant.id):undefined;return code?{...variant,selectedOptions:[{optionId:option!.optionId,valueId:option!.valueIdByCode[code],value:code}]}:variant;});}
    return composed;
  }
  function fullMetadataForm(product:Row,description:string){
    const form=new FormData();form.set('title',boundedText(product.title,'product title',200));form.set('description',boundedText(description,'product description',10_100,true));form.set('type',typeof product.type==='string'&&product.type?product.type:'MERCHANDISE');
    const price=typeof product.price==='number'?product.price:Number(product.price);if(!Number.isFinite(price)||price<0)throw new CatalogueBundleAdapterError('Bundle product price is invalid.');form.set('price',String(price));
    form.set('shippingCost',String(product.shippingCost??0));form.set('weight',String(product.weight??0));if(product.requiresSimAssignment===true)form.set('requiresSimAssignment','true');if(product.tracksInventory===true)form.set('tracksInventory','true');return form;
  }
  function verifyRawMetadata(before:Row,after:Row,description:string){const normalized=(value:unknown)=>typeof value==='string'?value.replace(/\r\n/g,'\n'):value;if(after.title!==before.title||normalized(after.description)!==normalized(description)||Number(after.price)!==Number(before.price)||before.requiresSimAssignment===true&&after.requiresSimAssignment!==true||before.tracksInventory===true&&after.tracksInventory!==true)throw new CatalogueBundleAdapterError('Bundle full metadata PUT readback failed.');}
  async function putMetadata(id:number,product:Row,description:string,image?:{bytes:Uint8Array;contentType:string;name:string}){const form=fullMetadataForm(product,description);if(image)form.set('images',new Blob([Uint8Array.from(image.bytes).buffer],{type:image.contentType}),image.name);await call(`products/${id}`,'PUT',form);const after=await readRaw(id);verifyRawMetadata(product,after,description);return after;}
  async function publicationState(id:number){return composition(id,await readRaw(id));}

  return {
    draftMarker:DRAFT_MARKER,
    async createDraft(payload:CatalogueDraftPayload){
      if(!object(payload)||!exactKeys(payload,['attemptRevision','categories','description','draft','draftMarker','operationId','price','tags','title'])||payload.draft!==true||payload.draftMarker!==DRAFT_MARKER||!operation(payload.operationId)||!Number.isSafeInteger(payload.attemptRevision)||payload.attemptRevision<=0||typeof payload.price!=='number'||!Number.isFinite(payload.price)||payload.price<0)throw new CatalogueBundleAdapterError('A valid explicit catalogue draft payload is required.',400);
      boundedText(payload.title,'draft title',200);boundedText(payload.description,'draft description',10_000,true);const categories=strings(payload.categories,'draft categories',100),tags=strings(payload.tags,'draft tags',100);if(payload.description.includes(MARKER_TOKEN))throw new CatalogueBundleAdapterError('Draft description contains reserved marker text.',400);if(payload.title.includes('[TW-'))throw new CatalogueBundleAdapterError('Draft title contains reserved provider suffix text.',400);
      const job=await options.local.readPublication(payload.operationId);if(!job||job.operationId!==payload.operationId||job.revision!==payload.attemptRevision)throw new CatalogueBundleAdapterError('Draft attempt revision does not match the durable publication.',409);
      const suffix=titleSuffix(payload.operationId,payload.attemptRevision),providerTitle=`${payload.title.slice(0,200-suffix.length)}${suffix}`;
      const form=new FormData();form.set('title',providerTitle);form.set('description',`${payload.description}${markerSuffix(payload.operationId)}`);form.set('type','MERCHANDISE');form.set('price',String(payload.price));form.set('shippingCost','0');form.set('weight','0');form.set('categories',JSON.stringify(categories));form.set('tags',JSON.stringify(tags));const simCategory=categories.some(category=>/^sim cards?$/i.test(category));if(simCategory){form.set('requiresSimAssignment','true');form.set('tracksInventory','true');}const response=await call('products/upload','POST',form);const created=productRow(response);if(simCategory){const readback=await readRaw(created.id as number);if(readback.requiresSimAssignment!==true||readback.tracksInventory!==true)throw new CatalogueBundleAdapterError('Bundle did not persist required SIM fulfilment flags.',502);}return response;
    },
    async findDraftByOperation(value:string){const op=operationId(value),matches:Row[]=[];for(const product of await listProducts()){if(product.deletedAt!=null||product.deleted===true)continue;const state=descriptionState(product.description);if(state.operationId===op)matches.push(product);}if(matches.length>1)throw new CatalogueBundleAdapterError('Bundle draft reconciliation is ambiguous.',409);return matches[0]&&positive(matches[0].id)?composition(matches[0].id,matches[0]):null;},
    async readProduct(id:number){const product=await composition(productId(id),await readRaw(id));return {data:product};},
    async readPublicationState(id:number){return {data:await publicationState(productId(id))};},
    async uploadImage(id:number,upload:CataloguePreparedImageUpload){
      id=productId(id);if(!object(upload)||!exactKeys(upload,['body','contentType','key','name','operationId','order','sha256'])||!operation(upload.operationId)||!digest(upload.sha256)||!Number.isSafeInteger(upload.order)||upload.order<0||!['image/jpeg','image/png','image/webp'].includes(upload.contentType))throw new CatalogueBundleAdapterError('A valid explicit catalogue image upload is required.',400);boundedText(upload.key,'upload key',128);boundedText(upload.name,'upload name',255);const bytes=upload.body instanceof Uint8Array?upload.body:null;if(!bytes||!bytes.byteLength||bytes.byteLength>10*1024*1024)throw new CatalogueBundleAdapterError('Catalogue image bytes are invalid.',400);
      const before=await readRaw(id),marker=descriptionState(before.description);if(marker.operationId!==upload.operationId)throw new CatalogueBundleAdapterError('Bundle image upload draft identity is invalid.',409);const beforeIds=new Set(rows(before.images).map(x=>x.id));const copy=new Uint8Array(bytes);let after=await putMetadata(id,before,marker.raw,{bytes:copy,contentType:upload.contentType,name:upload.name}),added=rows(after.images).filter(x=>positive(x.id)&&!beforeIds.has(x.id));if(added.length!==1)throw new CatalogueBundleAdapterError('Bundle image upload ID readback is ambiguous.');const imageId=added[0].id as number;const current=state(id,upload.operationId);current.images[upload.key]={id:imageId,name:upload.name,contentType:upload.contentType,order:upload.order,sha256:upload.sha256};const composed=await composition(id,after),ordering=rows(composed.images).filter(image=>positive(image.id)&&Number.isSafeInteger(image.order)).sort((a,b)=>(a.order as number)-(b.order as number)).map(image=>({id:image.id as number,order:image.order as number}));if(ordering.length!==rows(after.images).length||ordering.some((item,index)=>item.order!==index))throw new CatalogueBundleAdapterError('Bundle image order composition is incomplete.');await json(`products/${id}/images/order`,'PATCH',{images:ordering});after=await readRaw(id);if(descriptionState(after.description).operationId!==upload.operationId||!rows(after.images).some(x=>x.id===imageId))throw new CatalogueBundleAdapterError('Bundle image upload positive readback failed.');return {imageId,sha256:upload.sha256};
    },
    async createCompiledVariants(id:number,request:CatalogueCompiledVariantsRequest){
      id=productId(id);if(!object(request)||!exactKeys(request,['autoGenerateSku','defaultInventory','hidden','operationId','optionName','values'])||request.optionName!=='Catalogue Variant'||request.hidden!==true||request.autoGenerateSku!==true||request.defaultInventory!==0||!operation(request.operationId))throw new CatalogueBundleAdapterError('A valid explicit compiled variant request is required.',400);const codes=strings(request.values,'compiled variant codes');await json(`products/${id}/variants`,'POST',{optionName:'Catalogue Variant',values:codes.map(value=>({value})),autoGenerateSku:true,defaultInventory:0});const product=await readRaw(id),productOptions=rows(product.options),variants=rows(product.productVariants);if(productOptions.length!==1||productOptions[0].name!=='Catalogue Variant'||variants.length!==codes.length||rows(productOptions[0].values).length!==codes.length)throw new CatalogueBundleAdapterError('Bundle compiled variant readback is ambiguous.');const optionValues=rows(productOptions[0].values);if(!positive(productOptions[0].id)||optionValues.some((value,index)=>!positive(value.id)||value.value!==codes[index])||variants.some(variant=>!positive(variant.id))||new Set(variants.map(x=>x.id)).size!==variants.length)throw new CatalogueBundleAdapterError('Bundle compiled variant IDs are invalid.');const attestation={optionId:productOptions[0].id as number,valueIdByCode:Object.fromEntries(codes.map((code,index)=>[code,optionValues[index].id as number])),variantIdByCode:Object.fromEntries(codes.map((code,index)=>[code,variants[index].id as number]))};state(id,request.operationId).option=attestation;await options.local.hideOptionValues(id,Object.values(attestation.valueIdByCode));return attestation;
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
