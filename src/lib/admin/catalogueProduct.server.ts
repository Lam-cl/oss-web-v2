import { randomUUID } from 'crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'fs/promises';
import path from 'path';
import { isDeepStrictEqual } from 'util';
import { normalizeProductEditorSpec, type ProductEditorSpec } from './productEditor';
import { createRemoteDocument, dataApiEnabled, remoteDocument, remoteDocuments, replaceRemoteDocument } from '@/lib/dataApiClient.server';

export type CatalogueBundleVersion = {
  bundleProductId: number;
  fingerprint: string;
  publishedAt: string;
  retiredAt: string | null;
};

export type CatalogueProductRecord = {
  version: 1;
  catalogueId: string;
  revision: number;
  status: 'draft' | 'published';
  slug: string;
  model: ProductEditorSpec;
  currentBundleProductId: number | null;
  bundleVersions: CatalogueBundleVersion[];
  createdAt: string;
  updatedAt: string;
};

const CATALOGUE_PRODUCT_DIRECTORY = path.join(process.cwd(), '.data', 'catalogue-products');
const recordKeys = ['bundleVersions', 'catalogueId', 'createdAt', 'currentBundleProductId', 'model', 'revision', 'slug', 'status', 'updatedAt', 'version'];
const versionKeys = ['bundleProductId', 'fingerprint', 'publishedAt', 'retiredAt'];
const queues = new Map<string, Promise<void>>();
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const timestamp = (value: unknown): value is string => typeof value === 'string' && (() => { try { return new Date(value).toISOString() === value; } catch { return false; } })();
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => isDeepStrictEqual(Object.keys(value).sort(), keys);
const fileFor = (catalogueId: string, directory: string) => path.join(directory, `${catalogueId}.json`);
const corrupt = (catalogueId: string) => new Error(`Catalogue product storage for ${catalogueId} is corrupt.`);

function assertCatalogueId(value: unknown): asserts value is string {
  if (!uuid(value)) throw new Error('A valid catalogue ID is required.');
}

function normalizeSlug(value: unknown) {
  if (typeof value !== 'string') throw new Error('A valid product slug is required.');
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug || slug.length > 128) throw new Error('A valid product slug of at most 128 characters is required.');
  return slug;
}

function validateRecord(value: unknown, expectedId?: string): CatalogueProductRecord {
  if (!object(value) || !exactKeys(value, recordKeys)) throw new Error('A valid catalogue product is required.');
  if (value.version !== 1
    || !uuid(value.catalogueId) || expectedId !== undefined && value.catalogueId !== expectedId
    || !positiveInteger(value.revision)
    || value.status !== 'draft' && value.status !== 'published'
    || typeof value.slug !== 'string' || normalizeSlug(value.slug) !== value.slug
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || value.updatedAt < value.createdAt
    || value.currentBundleProductId !== null && !positiveInteger(value.currentBundleProductId)
    || !Array.isArray(value.bundleVersions)) throw new Error('A valid catalogue product is required.');

  let model: ProductEditorSpec;
  try { model = normalizeProductEditorSpec(value.model); } catch { throw new Error('A valid catalogue product is required.'); }
  const rawModel = value.model as Record<string, unknown>;
  const rawDetails = object(rawModel.details) ? rawModel.details : {};
  const comparableModel = Object.hasOwn(rawDetails, 'minimumOrderQuantity')
    ? model
    : { ...model, details: Object.fromEntries(Object.entries(model.details).filter(([key]) => key !== 'minimumOrderQuantity')) };
  if (!isDeepStrictEqual(comparableModel, value.model)) throw new Error('A valid catalogue product is required.');

  const bundleIds = new Set<number>();
  let previous: CatalogueBundleVersion | undefined;
  for (const rawVersion of value.bundleVersions) {
    if (!object(rawVersion) || !exactKeys(rawVersion, versionKeys)
      || !positiveInteger(rawVersion.bundleProductId) || bundleIds.has(rawVersion.bundleProductId)
      || typeof rawVersion.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(rawVersion.fingerprint)
      || !timestamp(rawVersion.publishedAt)
      || rawVersion.retiredAt !== null && (!timestamp(rawVersion.retiredAt) || rawVersion.retiredAt < rawVersion.publishedAt)) {
      throw new Error('A valid catalogue product is required.');
    }
    const version = rawVersion as CatalogueBundleVersion;
    if (version.publishedAt < value.createdAt || version.publishedAt > value.updatedAt
      || version.retiredAt !== null && (version.retiredAt < value.createdAt || version.retiredAt > value.updatedAt)
      || previous && (version.publishedAt < previous.publishedAt
        || previous.retiredAt === null || previous.retiredAt > version.publishedAt)) {
      throw new Error('A valid catalogue product is required.');
    }
    bundleIds.add(version.bundleProductId);
    previous = version;
  }

  const active = value.bundleVersions.filter((version) => version.retiredAt === null);
  if (active.length > 1
    || value.status === 'draft' && (value.currentBundleProductId !== null || active.length !== 0)
    || value.status === 'published' && (active.length !== 1 || active[0].bundleProductId !== value.currentBundleProductId)) {
    throw new Error('A valid catalogue product is required.');
  }
  return { ...value, model } as CatalogueProductRecord;
}

async function secureDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

type SyncHandle = {
  writeFile(data: string, encoding: BufferEncoding): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
};
type CatalogueProductOpen = (file: string, flags: string, mode?: number) => Promise<SyncHandle>;
const defaultOpen: CatalogueProductOpen = (file, flags, mode) => open(file, flags, mode);

async function atomicWrite(record: CatalogueProductRecord, directory: string, openFile: CatalogueProductOpen) {
  await secureDirectory(directory);
  const file = fileFor(record.catalogueId, directory);
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await openFile(temp, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    await chmod(file, 0o600);
    const directoryHandle = await openFile(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (reason) {
    try { await unlink(temp); } catch { /* best-effort cleanup */ }
    throw reason;
  }
}

// ponytail: this lock deliberately supports one Node process; replace it with a cross-process lock before clustering.
function withCatalogueProductLock<T>(catalogueId: string, action: () => Promise<T>, directory: string): Promise<T> {
  const key = fileFor(catalogueId, directory);
  const previous = queues.get(key) || Promise.resolve();
  const result = previous.then(action, action);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}

export async function readCatalogueProduct(catalogueId: string, directory = CATALOGUE_PRODUCT_DIRECTORY): Promise<CatalogueProductRecord | null> {
  assertCatalogueId(catalogueId);
  if (directory === CATALOGUE_PRODUCT_DIRECTORY && dataApiEnabled()) {
    const document = await remoteDocument<CatalogueProductRecord>('catalogue-products', catalogueId);
    return document ? validateRecord(document.value, catalogueId) : null;
  }
  try {
    await secureDirectory(directory);
    const file = fileFor(catalogueId, directory);
    const raw = await readFile(file, 'utf8');
    await chmod(file, 0o600);
    return validateRecord(JSON.parse(raw), catalogueId);
  } catch (reason: any) {
    if (reason?.code === 'ENOENT') return null;
    throw corrupt(catalogueId);
  }
}

async function writeCatalogueProductUnlocked(
  record: CatalogueProductRecord,
  directory = CATALOGUE_PRODUCT_DIRECTORY,
  openFile: CatalogueProductOpen = defaultOpen,
): Promise<CatalogueProductRecord> {
  const snapshot = validateRecord(structuredClone(record));
  await atomicWrite(snapshot, directory, openFile);
  return structuredClone(snapshot);
}

export async function createCatalogueProduct(model: unknown, slug: unknown, directory = CATALOGUE_PRODUCT_DIRECTORY): Promise<CatalogueProductRecord> {
  const normalizedModel = normalizeProductEditorSpec(model);
  const normalizedSlug = normalizeSlug(slug);
  const catalogueId = randomUUID();
  const create = async () => {
    const now = new Date().toISOString();
    const record: CatalogueProductRecord = {
      version: 1,
      catalogueId,
      revision: 1,
      status: 'draft',
      slug: normalizedSlug,
      model: normalizedModel,
      currentBundleProductId: null,
      bundleVersions: [],
      createdAt: now,
      updatedAt: now,
    };
    if (directory === CATALOGUE_PRODUCT_DIRECTORY && dataApiEnabled()) {
      return validateRecord((await createRemoteDocument('catalogue-products', catalogueId, record)).value, catalogueId);
    }
    return writeCatalogueProductUnlocked(record, directory);
  };
  return directory === CATALOGUE_PRODUCT_DIRECTORY && dataApiEnabled() ? create() : withCatalogueProductLock(catalogueId, create, directory);
}

export async function updateCatalogueProduct(
  catalogueId: string,
  expectedRevision: number,
  updater: (record: CatalogueProductRecord) => CatalogueProductRecord | Promise<CatalogueProductRecord>,
  directory = CATALOGUE_PRODUCT_DIRECTORY,
): Promise<CatalogueProductRecord> {
  assertCatalogueId(catalogueId);
  if (!positiveInteger(expectedRevision)) throw new Error('A valid expected revision is required.');
  if (typeof updater !== 'function') throw new Error('A catalogue product updater is required.');
  if (directory === CATALOGUE_PRODUCT_DIRECTORY && dataApiEnabled()) {
    const current = await readCatalogueProduct(catalogueId, directory);
    if (!current) throw new Error(`Catalogue product ${catalogueId} was not found.`);
    if (current.revision !== expectedRevision) throw new Error(`Catalogue product revision conflict: expected ${expectedRevision}, found ${current.revision}.`);
    const proposed = await updater(structuredClone(current));
    const next = validateRecord({ ...proposed, catalogueId: current.catalogueId, revision: current.revision + 1,
      slug: normalizeSlug(proposed.slug), model: normalizeProductEditorSpec(proposed.model), createdAt: current.createdAt,
      updatedAt: new Date().toISOString() }, catalogueId);
    return validateRecord((await replaceRemoteDocument('catalogue-products', catalogueId, expectedRevision, next)).value, catalogueId);
  }
  return withCatalogueProductLock(catalogueId, async () => {
    const current = await readCatalogueProduct(catalogueId, directory);
    if (!current) throw new Error(`Catalogue product ${catalogueId} was not found.`);
    if (current.revision !== expectedRevision) throw new Error(`Catalogue product revision conflict: expected ${expectedRevision}, found ${current.revision}.`);
    const updaterResult = await updater(structuredClone(current));
    let proposed: unknown;
    try { proposed = structuredClone(updaterResult); } catch { throw new Error('A valid catalogue product is required.'); }
    if (!object(proposed)) throw new Error('A valid catalogue product is required.');
    const next = validateRecord({
      ...proposed,
      catalogueId: current.catalogueId,
      revision: current.revision + 1,
      slug: normalizeSlug(proposed.slug),
      model: normalizeProductEditorSpec(proposed.model),
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }, catalogueId);
    return writeCatalogueProductUnlocked(next, directory);
  }, directory);
}

export async function listCatalogueProducts(directory = CATALOGUE_PRODUCT_DIRECTORY): Promise<CatalogueProductRecord[]> {
  if (directory === CATALOGUE_PRODUCT_DIRECTORY && dataApiEnabled()) {
    return (await remoteDocuments<CatalogueProductRecord>('catalogue-products')).map((item) => validateRecord(item.value, item.key)).sort((left, right) => left.catalogueId.localeCompare(right.catalogueId));
  }
  let entries;
  try { entries = await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true }); }
  catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
  const products: CatalogueProductRecord[] = [];
  for (const entry of entries) if (entry.isFile() && /^[0-9a-f-]{36}\.json$/.test(entry.name)) {
    const product = await readCatalogueProduct(entry.name.slice(0, -5), directory); if (product) products.push(product);
  }
  return products.sort((left, right) => left.catalogueId.localeCompare(right.catalogueId));
}
