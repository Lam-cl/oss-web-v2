import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createRemoteDocument, dataApiBinary, dataApiEnabled, dataApiRequest, remoteDocument } from '@/lib/dataApiClient.server';

export type CataloguePublishedProduct = {
  catalogueId: string;
  slug: string;
  details: { title: string; price: number; description: string; category?: string };
  choices: Array<{ key: string; name: string; values: Array<{ key: string; label: string }> }>;
  combinations: Array<{ valueKeys: string[]; variantId: number; price: number; inventory: number }>;
  images: Array<{ url: string; order: number; assignment: string }>;
  bundleProductId: number;
  minimumOrderQuantity?: number;
};
export type CataloguePublishedSnapshotMedia = {
  mediaId: string; originalName: string; contentType: 'image/jpeg'|'image/png'|'image/webp'; bytes: number;
  sha256: string; order: number; assignment: string; file: string;
};
export type CataloguePublishedSnapshotManifest = {
  version: 1; operationId: string; catalogueId: string; bundleProductId: number; resultFingerprint64: string;
  createdAt: string; product: CataloguePublishedProduct; media: CataloguePublishedSnapshotMedia[];
};
export type CreateCataloguePublishedSnapshotInput = Omit<CataloguePublishedSnapshotManifest, 'version'|'createdAt'|'media'> & {
  media: Array<Omit<CataloguePublishedSnapshotMedia, 'file'> & { body: Uint8Array }>;
};
export type CataloguePublishedSnapshotResult = { manifest: CataloguePublishedSnapshotManifest; idempotent: boolean };

const DEFAULT_ROOT = path.join(process.cwd(), '.data', 'catalogue-published');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const NOFOLLOW = constants.O_NOFOLLOW || 0;
const DIRECTORY = constants.O_DIRECTORY || 0;
const MAX_ITEM_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const queues = new Map<string, Promise<void>>();
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Row, keys: string[]) => isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...keys].sort());
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const finitePrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const hash = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
const corrupt = (operationId: string) => new Error(`Catalogue published snapshot ${operationId} is corrupt.`);

function assertOperationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error('A valid 64-character publication operation ID is required.');
}
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}
function safeText(value: unknown, max: number, required = true): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= max && (!required || value.trim().length > 0) && !/\u0000/.test(value);
}
function safeKey(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function signature(type: string, body: Uint8Array) {
  if (type === 'image/png') return body.length >= 8 && [137,80,78,71,13,10,26,10].every((byte, index) => body[index] === byte);
  if (type === 'image/jpeg') return body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255;
  return type === 'image/webp' && body.length >= 12 && Buffer.from(body.subarray(0,4)).toString('ascii') === 'RIFF' && Buffer.from(body.subarray(8,12)).toString('ascii') === 'WEBP';
}
function validateProduct(value: unknown, catalogueId: string, bundleProductId: number): CataloguePublishedProduct {
  if (!object(value) || !Object.hasOwn(value, 'slug')) throw new Error('Published snapshot product is invalid.');
  const allowed = ['bundleProductId','catalogueId','choices','combinations','details','images','slug', ...(Object.hasOwn(value,'minimumOrderQuantity') ? ['minimumOrderQuantity'] : [])];
  if (!exact(value, allowed) || value.catalogueId !== catalogueId || value.bundleProductId !== bundleProductId || !safeText(value.slug, 200)) throw new Error('Published snapshot product is invalid.');
  if (!object(value.details) || !exact(value.details, ['description','price','title', ...(Object.hasOwn(value.details,'category') ? ['category'] : [])])
    || !safeText(value.details.title, 200) || !safeText(value.details.description, 10_000, false) || !finitePrice(value.details.price)
    || Object.hasOwn(value.details,'category') && !safeText(value.details.category, 200)) throw new Error('Published snapshot product details are invalid.');
  if (!Array.isArray(value.choices) || value.choices.length > 2 || !Array.isArray(value.combinations) || value.combinations.length === 0 || value.combinations.length > 10_000
    || !Array.isArray(value.images) || value.images.length === 0 || value.images.length > 100) throw new Error('Published snapshot product collections are invalid.');
  const valueKeys = new Set<string>();
  for (const choice of value.choices) {
    if (!object(choice) || !exact(choice,['key','name','values']) || !safeKey(choice.key) || !safeText(choice.name,100) || !Array.isArray(choice.values) || !choice.values.length || choice.values.length > 100) throw new Error('Published snapshot choices are invalid.');
    for (const item of choice.values) {
      if (!object(item) || !exact(item,['key','label']) || !safeKey(item.key) || valueKeys.has(item.key) || !safeText(item.label,100)) throw new Error('Published snapshot choice values are invalid.');
      valueKeys.add(item.key);
    }
  }
  const tuples = new Set<string>(); const variants = new Set<number>();
  for (const item of value.combinations) {
    if (!object(item) || !exact(item,['inventory','price','valueKeys','variantId']) || !Array.isArray(item.valueKeys)
      || item.valueKeys.length !== value.choices.length || item.valueKeys.some(key => !valueKeys.has(key)) || new Set(item.valueKeys).size !== item.valueKeys.length
      || !positive(item.variantId) || variants.has(item.variantId) || !finitePrice(item.price) || !nonnegative(item.inventory)) throw new Error('Published snapshot combinations are invalid.');
    const tuple = JSON.stringify(item.valueKeys); if (tuples.has(tuple)) throw new Error('Published snapshot combinations are invalid.'); tuples.add(tuple); variants.add(item.variantId);
  }
  value.images.forEach((item, index) => {
    if (!object(item) || !exact(item,['assignment','order','url']) || item.order !== index || typeof item.assignment !== 'string'
      || item.assignment !== 'all' && !valueKeys.has(item.assignment) || typeof item.url !== 'string') throw new Error('Published snapshot images are invalid.');
  });
  if (Object.hasOwn(value,'minimumOrderQuantity') && !positive(value.minimumOrderQuantity)) throw new Error('Published snapshot minimum order quantity is invalid.');
  return value as CataloguePublishedProduct;
}
function validateMedia(value: unknown, catalogueId: string, product: CataloguePublishedProduct): CataloguePublishedSnapshotMedia[] {
  if (!Array.isArray(value) || value.length !== product.images.length || value.length > 100) throw new Error('Published snapshot media is invalid.');
  const ids = new Set<string>(); let total = 0;
  return value.map((raw, index) => {
    if (!object(raw) || !exact(raw,['assignment','bytes','contentType','file','mediaId','order','originalName','sha256']) || typeof raw.mediaId !== 'string' || !UUID.test(raw.mediaId) || ids.has(raw.mediaId)
      || !safeText(raw.originalName,255) || /[\\/\u0000-\u001f]/.test(raw.originalName) || !['image/jpeg','image/png','image/webp'].includes(String(raw.contentType))
      || !positive(raw.bytes) || raw.bytes > MAX_ITEM_BYTES || typeof raw.sha256 !== 'string' || !HASH.test(raw.sha256) || raw.order !== index
      || raw.assignment !== product.images[index].assignment || raw.file !== `${raw.mediaId}.bin`
      || product.images[index].url !== `/catalogue-products-api?catalogueId=${encodeURIComponent(catalogueId)}&mediaId=${encodeURIComponent(raw.mediaId)}`) throw new Error('Published snapshot media is invalid.');
    ids.add(raw.mediaId); total += raw.bytes as number; return raw as CataloguePublishedSnapshotMedia;
  }).map(item => { if (total > MAX_TOTAL_BYTES) throw new Error('Published snapshot media exceeds the total byte limit.'); return item; });
}
function validateManifest(value: unknown, expectedOperationId: string): CataloguePublishedSnapshotManifest {
  if (!object(value) || !exact(value,['bundleProductId','catalogueId','createdAt','media','operationId','product','resultFingerprint64','version']) || value.version !== 1
    || value.operationId !== expectedOperationId || typeof value.catalogueId !== 'string' || !UUID.test(value.catalogueId) || !positive(value.bundleProductId)
    || typeof value.resultFingerprint64 !== 'string' || !HASH.test(value.resultFingerprint64) || !validTimestamp(value.createdAt)) throw corrupt(expectedOperationId);
  try { const product = validateProduct(value.product, value.catalogueId, value.bundleProductId); validateMedia(value.media, value.catalogueId, product); }
  catch { throw corrupt(expectedOperationId); }
  return value as CataloguePublishedSnapshotManifest;
}
async function statOrNull(target: string) { try { return await lstat(target); } catch (reason: any) { if (reason?.code === 'ENOENT') return null; throw reason; } }
async function syncDirectory(directory: string) { const handle = await open(directory, constants.O_RDONLY | DIRECTORY | NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }
async function secureRoot(root: string) {
  root = path.resolve(root); const parsed = path.parse(root); let current = parsed.root;
  for (const part of root.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    const parent = current; current = path.join(current, part); let stat = await statOrNull(current);
    if (!stat) { await mkdir(current,{mode:0o700}); await syncDirectory(parent); stat = await lstat(current); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Catalogue published snapshot root is unsafe.');
  }
  if (await realpath(root) !== root) throw new Error('Catalogue published snapshot root is unsafe.'); await chmod(root,0o700); return root;
}
async function readFileSafe(target: string, max: number) {
  const stat = await lstat(target); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > max) throw new Error('unsafe');
  const handle = await open(target, constants.O_RDONLY | NOFOLLOW); try { return await handle.readFile(); } finally { await handle.close(); }
}
async function readUnlocked(operationId: string, root: string) {
  root = await secureRoot(root); const directory = path.join(root,operationId); const stat = await statOrNull(directory); if (!stat) return null;
  try {
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe');
    const raw = await readFileSafe(path.join(directory,'manifest.json'),MAX_MANIFEST_BYTES); const manifest = validateManifest(JSON.parse(raw.toString('utf8')),operationId);
    const expected = ['manifest.json',...manifest.media.map(item=>item.file)].sort(); const actual = (await readdir(directory)).sort(); if (!isDeepStrictEqual(actual,expected)) throw new Error('files');
    for (const item of manifest.media) { const body = await readFileSafe(path.join(directory,item.file),MAX_ITEM_BYTES); if (body.length !== item.bytes || hash(body) !== item.sha256 || !signature(item.contentType,body)) throw new Error('bytes'); }
    return structuredClone(manifest);
  } catch { throw corrupt(operationId); }
}
function enqueue<T>(key: string, action: () => Promise<T>) { const prior=queues.get(key)??Promise.resolve(); const run=prior.then(action,action); const tail=run.then(()=>undefined,()=>undefined); queues.set(key,tail); return run.finally(()=>{if(queues.get(key)===tail)queues.delete(key);}); }

export async function readCataloguePublishedSnapshot(operationId: string, root = DEFAULT_ROOT) {
  assertOperationId(operationId);
  if (root === DEFAULT_ROOT && dataApiEnabled()) {
    const document = await remoteDocument<CataloguePublishedSnapshotManifest>('catalogue-published', operationId);
    return document ? validateManifest(document.value, operationId) : null;
  }
  return readUnlocked(operationId,root);
}
export async function createCataloguePublishedSnapshot(input: CreateCataloguePublishedSnapshotInput, root = DEFAULT_ROOT): Promise<CataloguePublishedSnapshotResult> {
  if (!object(input) || !exact(input,['bundleProductId','catalogueId','media','operationId','product','resultFingerprint64'])) throw new Error('An exact published snapshot input is required.');
  assertOperationId(input.operationId); if (typeof input.catalogueId !== 'string' || !UUID.test(input.catalogueId) || !positive(input.bundleProductId) || typeof input.resultFingerprint64 !== 'string' || !HASH.test(input.resultFingerprint64)) throw new Error('Published snapshot identity is invalid.');
  const product = validateProduct(input.product,input.catalogueId,input.bundleProductId);
  if (!Array.isArray(input.media)) throw new Error('Published snapshot media is invalid.');
  const bodies = input.media.map((item,index) => {
    if (!object(item) || !exact(item,['assignment','body','bytes','contentType','mediaId','order','originalName','sha256']) || !(item.body instanceof Uint8Array)) throw new Error('Published snapshot media is invalid.');
    const body=Buffer.from(item.body); if (body.length !== item.bytes || hash(body) !== item.sha256 || !signature(String(item.contentType),body)) throw new Error('Published snapshot media signature, bytes, or digest is invalid.');
    const {body: _body, ...metadata} = item;
    return { body, metadata:{...metadata,file:`${item.mediaId}.bin`} as CataloguePublishedSnapshotMedia };
  });
  validateMedia(bodies.map(item=>item.metadata),input.catalogueId,product);
  if (root === DEFAULT_ROOT && dataApiEnabled()) {
    const existing = await readCataloguePublishedSnapshot(input.operationId, root);
    const identity={operationId:input.operationId,catalogueId:input.catalogueId,bundleProductId:input.bundleProductId,resultFingerprint64:input.resultFingerprint64,product,media:bodies.map(item=>item.metadata)};
    if (existing) { const {version:_,createdAt:__,...stored}=existing; if (!isDeepStrictEqual(stored,identity)) throw new Error(`Catalogue published snapshot ${input.operationId} conflict.`); return {manifest:existing,idempotent:true}; }
    for (const item of bodies) await dataApiRequest(`/v1/media/${input.catalogueId}/${item.metadata.mediaId}`, {
      method:'POST', headers:{'content-type':item.metadata.contentType,'x-content-sha256':item.metadata.sha256,
        'x-media-metadata':Buffer.from(JSON.stringify({...item.metadata,visibility:'published'})).toString('base64url')}, body:item.body,
    });
    const manifest:CataloguePublishedSnapshotManifest={version:1,...identity,createdAt:new Date().toISOString()};
    return {manifest:validateManifest((await createRemoteDocument('catalogue-published',input.operationId,manifest,{revision:1,createdAt:manifest.createdAt,updatedAt:manifest.createdAt})).value,input.operationId),idempotent:false};
  }
  const key=`${path.resolve(root)}\0${input.operationId}`;
  return enqueue(key,async()=>{
    root=await secureRoot(root); const existing=await readUnlocked(input.operationId,root);
    const identity={operationId:input.operationId,catalogueId:input.catalogueId,bundleProductId:input.bundleProductId,resultFingerprint64:input.resultFingerprint64,product,media:bodies.map(item=>item.metadata)};
    if (existing) { const {version:_,createdAt:__,...stored}=existing; if (!isDeepStrictEqual(stored,identity)) throw new Error(`Catalogue published snapshot ${input.operationId} conflict.`); return {manifest:existing,idempotent:true}; }
    const createdAt=new Date().toISOString(); const manifest:CataloguePublishedSnapshotManifest={version:1,...identity,createdAt};
    const serialized=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`); if(serialized.length>MAX_MANIFEST_BYTES)throw new Error('Published snapshot manifest exceeds the byte limit.');
    const staging=path.join(root,`.tmp-${input.operationId}-${randomUUID()}`); await mkdir(staging,{mode:0o700}); await syncDirectory(root);
    try {
      for (const item of bodies) { const handle=await open(path.join(staging,item.metadata.file),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|NOFOLLOW,0o600); try{await handle.writeFile(item.body);await handle.sync();}finally{await handle.close();} }
      await syncDirectory(staging);
      const temp=path.join(staging,'.manifest.tmp'); const handle=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|NOFOLLOW,0o600); try{await handle.writeFile(serialized);await handle.sync();}finally{await handle.close();}
      await rename(temp,path.join(staging,'manifest.json')); await syncDirectory(staging);
      await rename(staging,path.join(root,input.operationId)); await syncDirectory(root);
      return {manifest:structuredClone(manifest),idempotent:false};
    } catch(reason) { await rm(staging,{recursive:true,force:true}); throw reason; }
  });
}
export async function readCataloguePublishedSnapshotMedia(operationId: string, mediaId: string, root = DEFAULT_ROOT) {
  assertOperationId(operationId); if (!UUID.test(mediaId)) throw new Error('A valid snapshot media ID is required.');
  if (root === DEFAULT_ROOT && dataApiEnabled()) {
    const manifest=await readCataloguePublishedSnapshot(operationId,root);if(!manifest)return null;const metadata=manifest.media.find(item=>item.mediaId===mediaId);if(!metadata)return null;
    const body=await dataApiBinary(`/v1/media/${manifest.catalogueId}/${mediaId}`);if(body.length!==metadata.bytes||hash(body)!==metadata.sha256||!signature(metadata.contentType,body))throw corrupt(operationId);
    return {...metadata,body};
  }
  const manifest=await readUnlocked(operationId,root); if(!manifest) return null; const metadata=manifest.media.find(item=>item.mediaId===mediaId); if(!metadata)return null;
  const body=await readFileSafe(path.join(path.resolve(root),operationId,metadata.file),MAX_ITEM_BYTES); if(body.length!==metadata.bytes||hash(body)!==metadata.sha256||!signature(metadata.contentType,body))throw corrupt(operationId);
  return {...metadata,body};
}
