import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'fs/promises';
import path from 'path';
import { isDeepStrictEqual } from 'util';

export type CatalogueMediaMetadata = {
  mediaId: string;
  catalogueId: string;
  originalName: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: number;
  sha256: string;
  order: number;
  assignment: 'all' | string;
  createdAt: string;
};

export type CatalogueMedia = CatalogueMediaMetadata & { body: Buffer };
export type CatalogueMediaBody = Blob | ArrayBuffer | Uint8Array;
export type AddCatalogueMediaInput = {
  name: string;
  type: CatalogueMediaMetadata['contentType'];
  body: CatalogueMediaBody;
  order: number;
  assignment: 'all' | string;
};
export type UpdateCatalogueMediaInput = { order?: number; assignment?: 'all' | string };
export type CatalogueMediaRemoval = {
  operationId: string;
  catalogueId: string;
  status: 'prepared' | 'committed' | 'rolled_back';
  removed: CatalogueMediaMetadata[];
  createdAt: string;
  updatedAt: string;
};
export type CatalogueMediaStore = {
  addCatalogueMedia(catalogueId: string, input: AddCatalogueMediaInput): Promise<CatalogueMediaMetadata>;
  listCatalogueMedia(catalogueId: string): Promise<CatalogueMediaMetadata[]>;
  readVerifiedCatalogueMedia(catalogueId: string, mediaId: string): Promise<CatalogueMedia>;
  updateCatalogueMedia(catalogueId: string, mediaId: string, patch: UpdateCatalogueMediaInput): Promise<CatalogueMediaMetadata>;
  removeCatalogueMedia(catalogueId: string, mediaId: string): Promise<CatalogueMediaMetadata>;
  finalizeCatalogueMediaRemoval(catalogueId: string, operationId: string, mediaIds: string[]): Promise<CatalogueMediaRemoval>;
  getCatalogueMediaRemoval(catalogueId: string, operationId: string): Promise<CatalogueMediaRemoval | null>;
};

type Manifest = { media: CatalogueMediaMetadata[] };
type FileHandle = Awaited<ReturnType<typeof open>>;

const DEFAULT_DIRECTORY = path.join(process.cwd(), '.data', 'catalogue-media');
const MAX_ITEM_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ITEMS = 100;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_TRANSACTION_BYTES = 1024 * 1024;

const INPUT_KEYS = ['assignment', 'body', 'name', 'order', 'type'];
const METADATA_KEYS = ['assignment', 'bytes', 'catalogueId', 'contentType', 'createdAt', 'mediaId', 'order', 'originalName', 'sha256'];
const UPDATE_KEYS = new Set(['assignment', 'order']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOFOLLOW = constants.O_NOFOLLOW || 0;
const DIRECTORY = constants.O_DIRECTORY || 0;
const queues = new Map<string, Promise<void>>();
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.every((key): key is string => typeof key === 'string') && isDeepStrictEqual(ownKeys.sort(), keys);
};
const validOrder = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const corrupt = (catalogueId: string) => new Error(`Catalogue media storage for ${catalogueId} is corrupt.`);
const unsafe = (target: string) => new Error(`Unsafe symlink or filesystem object at ${target}.`);

function assertCatalogueId(value: unknown): asserts value is string {
  if (!uuid(value)) throw new Error('A valid catalogue ID is required.');
}

function assertMediaId(value: unknown): asserts value is string {
  if (!uuid(value)) throw new Error('A valid media ID is required.');
}

function assertOperationId(value: unknown): asserts value is string {
  if (!uuid(value)) throw new Error('A valid media removal operation ID is required.');
}

function normalizeName(value: unknown) {
  if (typeof value !== 'string') throw new Error('A valid media name is required.');
  const name = value.trim();
  if (!name || name === '.' || name === '..' || Buffer.byteLength(name, 'utf8') > 255
    || /[\\/\u0000-\u001f\u007f]/.test(name)
    || path.posix.basename(name) !== name || path.win32.basename(name) !== name) {
    throw new Error('A safe media basename of at most 255 bytes is required.');
  }
  return name;
}

function normalizeContentType(value: unknown): CatalogueMediaMetadata['contentType'] {
  if (value !== 'image/jpeg' && value !== 'image/png' && value !== 'image/webp') {
    throw new Error('Media content type must be exactly image/jpeg, image/png, or image/webp.');
  }
  return value;
}

function normalizeOrder(value: unknown) {
  if (!validOrder(value)) throw new Error('Media order must be a nonnegative safe integer.');
  return value;
}

function normalizeAssignment(value: unknown) {
  if (typeof value !== 'string') throw new Error('Media assignment must be all or a stable ProductEditor value key.');
  const assignment = value.trim();
  if (assignment === 'all') return assignment;
  if (!assignment || assignment.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(assignment)) {
    throw new Error('Media assignment must be all or a stable ProductEditor value key.');
  }
  return assignment;
}

function assertBodySize(bytes: number) {
  if (bytes <= 0 || bytes > MAX_ITEM_BYTES) throw new Error('Media body bytes must be positive and no larger than 10 MB.');
}

async function normalizeBody(value: unknown) {
  let body: Buffer;
  if (value instanceof ArrayBuffer) {
    assertBodySize(value.byteLength);
    body = Buffer.from(value.slice(0));
  } else if (value instanceof Uint8Array) {
    assertBodySize(value.byteLength);
    body = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    body = Buffer.from(body);
  } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
    assertBodySize(value.size);
    const bytes = await value.arrayBuffer();
    assertBodySize(bytes.byteLength);
    body = Buffer.from(new Uint8Array(bytes));
  } else {
    throw new Error('Media body must be a Blob, ArrayBuffer, Buffer, or Uint8Array.');
  }
  assertBodySize(body.length);
  return body;
}

function hasSignature(contentType: CatalogueMediaMetadata['contentType'], body: Uint8Array) {
  if (contentType === 'image/jpeg') return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return body.length >= signature.length && signature.every((byte, index) => body[index] === byte);
  }
  return body.length >= 12
    && Buffer.from(body.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(body.subarray(8, 12)).toString('ascii') === 'WEBP';
}

function assertSignature(contentType: CatalogueMediaMetadata['contentType'], body: Uint8Array) {
  if (!hasSignature(contentType, body)) throw new Error(`Media body signature does not match ${contentType}.`);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function validateMetadata(value: unknown, expectedCatalogueId: string): CatalogueMediaMetadata {
  if (!object(value) || !exactKeys(value, METADATA_KEYS)
    || !uuid(value.mediaId) || value.catalogueId !== expectedCatalogueId
    || normalizeName(value.originalName) !== value.originalName
    || normalizeContentType(value.contentType) !== value.contentType
    || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > MAX_ITEM_BYTES
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || normalizeOrder(value.order) !== value.order
    || normalizeAssignment(value.assignment) !== value.assignment
    || !validTimestamp(value.createdAt)) throw corrupt(expectedCatalogueId);
  return value as CatalogueMediaMetadata;
}

async function lstatOrNull(target: string) {
  try { return await lstat(target); }
  catch (reason: any) { if (reason?.code === 'ENOENT') return null; throw reason; }
}

async function ensureDirectory(target: string, create: boolean) {
  const details = await lstatOrNull(target);
  if (!details) {
    if (!create) throw unsafe(target);
    await mkdir(target, { mode: 0o700 });
  }
  const verified = await lstat(target);
  if (verified.isSymbolicLink() || !verified.isDirectory()) throw unsafe(target);
}

async function ensureRoot(directory: string) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) throw new Error('Catalogue media store root must be an absolute normalized path.');
  const parsed = path.parse(directory);
  let current = parsed.root;
  for (const component of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    await ensureDirectory(current, true);
  }
  if (await realpath(directory) !== directory) throw unsafe(directory);
  await chmod(directory, 0o700);
}

async function assertRegular(target: string, allowMissing = false) {
  const details = await lstatOrNull(target);
  if (!details) {
    if (allowMissing) return false;
    throw unsafe(target);
  }
  if (details.isSymbolicLink() || !details.isFile()) throw unsafe(target);
  return true;
}

async function openRegular(target: string, flags = constants.O_RDONLY): Promise<FileHandle> {
  await assertRegular(target);
  let handle: FileHandle;
  try { handle = await open(target, flags | NOFOLLOW); }
  catch (reason: any) { if (reason?.code === 'ELOOP') throw unsafe(target); throw reason; }
  const details = await handle.stat();
  if (!details.isFile()) { await handle.close(); throw unsafe(target); }
  return handle;
}

async function syncDirectory(directory: string) {
  const details = await lstat(directory);
  if (details.isSymbolicLink() || !details.isDirectory()) throw unsafe(directory);
  const handle = await open(directory, constants.O_RDONLY | DIRECTORY | NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function secureChildDirectory(parent: string, target: string) {
  const existing = await lstatOrNull(target);
  if (!existing) {
    await mkdir(target, { mode: 0o700 });
    await syncDirectory(parent);
  } else if (existing.isSymbolicLink() || !existing.isDirectory()) throw unsafe(target);
  await chmod(target, 0o700);
  if (await realpath(path.dirname(target)) !== parent || await realpath(target) !== target) throw unsafe(target);
}

// This store intentionally supports one Node process only. Production must stay
// in PM2 fork mode with one worker and must not have external media writers.
function withProcessQueue<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) || Promise.resolve();
  const result = previous.then(action, action);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}

async function durableReplace(target: string, data: string | Uint8Array, directory: string) {
  await assertRegular(target, true);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let handle: FileHandle | null = null;
  let committed = false;
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
    if (typeof data === 'string') await handle.writeFile(data, 'utf8');
    else await handle.writeFile(data);
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temp, target);
    committed = true;
    await syncDirectory(directory);
  } catch (reason) {
    if (handle) try { await handle.close(); } catch { /* best effort */ }
    try { await unlink(temp); } catch { /* best effort */ }
    if (committed) throw new CommittedWriteError(reason);
    throw reason;
  }
}

class CommittedWriteError extends Error {
  constructor(readonly reason: unknown) {
    super(`Manifest was replaced but its directory sync failed: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
}

function paths(root: string, catalogueId: string) {
  const directory = path.join(root, catalogueId);
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    binary: (mediaId: string) => path.join(directory, `${mediaId}.bin`),
  };
}

function transactionPaths(root: string, catalogueId: string, operationId: string) {
  const catalogue = paths(root, catalogueId).directory;
  const transactions = path.join(catalogue, 'transactions');
  const directory = path.join(transactions, operationId);
  return { catalogue, transactions, directory, record: path.join(directory, 'record.json'), binary: (mediaId: string) => path.join(directory, `${mediaId}.bin`) };
}

function validateRemoval(value: unknown, catalogueId: string, operationId: string): CatalogueMediaRemoval {
  if (!object(value) || !exactKeys(value, ['catalogueId', 'createdAt', 'operationId', 'removed', 'status', 'updatedAt'])
    || value.catalogueId !== catalogueId || value.operationId !== operationId
    || value.status !== 'prepared' && value.status !== 'committed' && value.status !== 'rolled_back'
    || !validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt) || !Array.isArray(value.removed)
    || value.removed.length === 0 || value.removed.length > MAX_ITEMS) throw corrupt(catalogueId);
  const removed = value.removed.map(item => validateMetadata(item, catalogueId));
  if (new Set(removed.map(item => item.mediaId)).size !== removed.length) throw corrupt(catalogueId);
  return { ...(value as CatalogueMediaRemoval), removed };
}

async function prepareTransactionDirectory(root: string, catalogueId: string, operationId: string) {
  const location = transactionPaths(root, catalogueId, operationId);
  await secureChildDirectory(location.catalogue, location.transactions);
  await secureChildDirectory(location.transactions, location.directory);
  return location;
}

async function existingTransactionDirectory(root: string, catalogueId: string, operationId: string) {
  const location = transactionPaths(root, catalogueId, operationId);
  for (const [parent, target] of [
    [root, location.catalogue],
    [location.catalogue, location.transactions],
    [location.transactions, location.directory],
  ]) {
    const details = await lstatOrNull(target);
    if (!details) return null;
    if (details.isSymbolicLink() || !details.isDirectory()) throw unsafe(target);
    if (await realpath(path.dirname(target)) !== parent || await realpath(target) !== target) throw unsafe(target);
  }
  return location;
}

async function readRemoval(root: string, catalogueId: string, operationId: string): Promise<CatalogueMediaRemoval | null> {
  const location = await existingTransactionDirectory(root, catalogueId, operationId);
  if (!location) return null;
  if (!await assertRegular(location.record, true)) return null;
  let parsed: unknown;
  try {
    const handle = await openRegular(location.record);
    try {
      if ((await handle.stat()).size > MAX_TRANSACTION_BYTES) throw corrupt(catalogueId);
      parsed = JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
  } catch (reason: any) {
    if (/Unsafe symlink/.test(String(reason?.message))) throw reason;
    throw corrupt(catalogueId);
  }
  const removal = validateRemoval(parsed, catalogueId, operationId);
  for (const item of removal.removed) {
    const handle = await openRegular(location.binary(item.mediaId));
    try {
      const body = await handle.readFile();
      if (body.length !== item.bytes || createHash('sha256').update(body).digest('hex') !== item.sha256) throw corrupt(catalogueId);
    } finally { await handle.close(); }
  }
  return removal;
}

async function writeRemoval(root: string, removal: CatalogueMediaRemoval) {
  const location = await prepareTransactionDirectory(root, removal.catalogueId, removal.operationId);
  await durableReplace(location.record, `${JSON.stringify(removal, null, 2)}\n`, location.directory);
}

async function readMetadata(root: string, catalogueId: string): Promise<CatalogueMediaMetadata[]> {
  const location = paths(root, catalogueId);
  await secureChildDirectory(root, location.directory);
  const exists = await assertRegular(location.manifest, true);
  if (!exists) return [];
  let parsed: unknown;
  try {
    const handle = await openRegular(location.manifest);
    try {
      if ((await handle.stat()).size > MAX_MANIFEST_BYTES) throw corrupt(catalogueId);
      parsed = JSON.parse(await handle.readFile('utf8'));
    }
    finally { await handle.close(); }
  } catch (reason: any) {
    if (/Unsafe symlink/.test(String(reason?.message))) throw reason;
    throw corrupt(catalogueId);
  }
  if (!object(parsed) || !exactKeys(parsed, ['media']) || !Array.isArray(parsed.media)) throw corrupt(catalogueId);
  let metadata: CatalogueMediaMetadata[];
  try { metadata = parsed.media.map((item) => validateMetadata(item, catalogueId)); }
  catch { throw corrupt(catalogueId); }
  const ids = metadata.map((item) => item.mediaId);
  const orders = metadata.map((item) => item.order);
  const total = metadata.reduce((sum, item) => sum + item.bytes, 0);
  if (metadata.length > MAX_ITEMS || total > MAX_TOTAL_BYTES
    || new Set(ids).size !== ids.length || new Set(orders).size !== orders.length) throw corrupt(catalogueId);
  return metadata;
}

async function writeManifest(root: string, catalogueId: string, metadata: CatalogueMediaMetadata[]) {
  const location = paths(root, catalogueId);
  await durableReplace(location.manifest, `${JSON.stringify({ media: metadata } satisfies Manifest, null, 2)}\n`, location.directory);
}

function cleanupCandidate(name: string, referenced: Set<string>) {
  const binary = /^([0-9a-f-]{36})\.bin$/.exec(name);
  if (binary) return !referenced.has(name);
  return /^(?:manifest\.json|[0-9a-f-]{36}\.bin)\.\d+\.[0-9a-f-]{36}\.tmp$/.test(name)
    || /^[0-9a-f-]{36}\.[0-9a-f-]{36}\.trash$/.test(name);
}

async function cleanupUnreferenced(root: string, catalogueId: string, metadata: CatalogueMediaMetadata[]) {
  const location = paths(root, catalogueId);
  const referenced = new Set(metadata.map((item) => `${item.mediaId}.bin`));
  let changed = false;
  for (const name of await readdir(location.directory)) {
    if (!cleanupCandidate(name, referenced)) continue;
    const target = path.join(location.directory, name);
    const details = await lstatOrNull(target);
    if (!details) continue;
    if (details.isSymbolicLink() || !details.isFile()) throw unsafe(target);
    try { await unlink(target); changed = true; } catch { /* cleanup must not break healthy reads */ }
  }
  if (changed) try { await syncDirectory(location.directory); } catch { /* cleanup durability is best effort */ }
}

async function reconcileTrash(root: string, catalogueId: string, metadata: CatalogueMediaMetadata[]) {
  const location = paths(root, catalogueId);
  const referenced = new Set(metadata.map((item) => item.mediaId));
  const recoverable = new Map<string, string[]>();
  for (const name of await readdir(location.directory)) {
    const match = /^([0-9a-f-]{36})\.[0-9a-f-]{36}\.trash$/.exec(name);
    if (!match) continue;
    const target = path.join(location.directory, name);
    const details = await lstat(target);
    if (details.isSymbolicLink() || !details.isFile()) throw unsafe(target);
    if (referenced.has(match[1])) recoverable.set(match[1], [...(recoverable.get(match[1]) || []), target]);
  }
  for (const [mediaId, trashFiles] of Array.from(recoverable.entries())) {
    const binary = location.binary(mediaId);
    if (await assertRegular(binary, true)) continue;
    if (trashFiles.length !== 1) throw corrupt(catalogueId);
    await rename(trashFiles[0], binary);
    await syncDirectory(location.directory);
  }
}

async function readVerifiedBinary(root: string, catalogueId: string, item: CatalogueMediaMetadata) {
  const target = paths(root, catalogueId).binary(item.mediaId);
  try {
    const handle = await openRegular(target);
    try {
      await handle.chmod(0o600);
      if ((await handle.stat()).size !== item.bytes) throw corrupt(catalogueId);
      const body = await handle.readFile();
      if (body.length !== item.bytes || createHash('sha256').update(body).digest('hex') !== item.sha256
        || !hasSignature(item.contentType, body)) throw corrupt(catalogueId);
      return body;
    } finally { await handle.close(); }
  } catch (reason: any) {
    if (/Unsafe symlink/.test(String(reason?.message))) throw reason;
    throw corrupt(catalogueId);
  }
}

async function assertBinaryShape(root: string, catalogueId: string, item: CatalogueMediaMetadata) {
  const target = paths(root, catalogueId).binary(item.mediaId);
  try {
    const handle = await openRegular(target);
    try {
      await handle.chmod(0o600);
      if ((await handle.stat()).size !== item.bytes) throw corrupt(catalogueId);
    } finally { await handle.close(); }
  } catch (reason: any) {
    if (/Unsafe symlink/.test(String(reason?.message))) throw reason;
    throw corrupt(catalogueId);
  }
}

async function listMetadataUnlocked(root: string, catalogueId: string) {
  const metadata = await readMetadata(root, catalogueId);
  await reconcileTrash(root, catalogueId, metadata);
  for (const item of metadata) await assertBinaryShape(root, catalogueId, item);
  await cleanupUnreferenced(root, catalogueId, metadata);
  return [...metadata].sort((left, right) => left.order - right.order);
}

export function createCatalogueMediaStore(directory: string): CatalogueMediaStore {
  if (typeof directory !== 'string') throw new Error('A configured catalogue media store root is required.');
  const root = path.resolve(directory);
  if (root !== directory) throw new Error('Catalogue media store root must be an absolute normalized path.');

  async function locked<T>(catalogueId: string, action: () => Promise<T>) {
    assertCatalogueId(catalogueId);
    return withProcessQueue(`${root}:${catalogueId}`, async () => {
      await ensureRoot(root);
      return action();
    });
  }

  return {
    async addCatalogueMedia(catalogueId, input) {
      return locked(catalogueId, async () => {
        if (!object(input) || !exactKeys(input, INPUT_KEYS)) throw new Error('Catalogue media input must contain the exact known keys; unknown keys are rejected.');
        const originalName = normalizeName(input.name);
        const contentType = normalizeContentType(input.type);
        const order = normalizeOrder(input.order);
        const assignment = normalizeAssignment(input.assignment);
        const body = await normalizeBody(input.body);
        assertSignature(contentType, body);
        const current = await listMetadataUnlocked(root, catalogueId);
        if (current.length >= MAX_ITEMS) throw new Error('A catalogue may contain at most 100 media items.');
        if (current.reduce((sum, item) => sum + item.bytes, 0) + body.length > MAX_TOTAL_BYTES) throw new Error('Catalogue media may use at most 100 MiB total.');
        if (current.some((item) => item.order === order)) throw new Error(`Duplicate catalogue media order ${order}.`);
        const metadata: CatalogueMediaMetadata = {
          mediaId: randomUUID(), catalogueId, originalName, contentType, bytes: body.length,
          sha256: createHash('sha256').update(body).digest('hex'), order, assignment, createdAt: new Date().toISOString(),
        };
        const location = paths(root, catalogueId);
        const target = location.binary(metadata.mediaId);
        await durableReplace(target, body, location.directory);
        try { await writeManifest(root, catalogueId, [...current, metadata]); }
        catch (reason) {
          if (reason instanceof CommittedWriteError) throw reason;
          try { await unlink(target); await syncDirectory(location.directory); } catch { /* recovered on next locked access */ }
          throw reason;
        }
        return metadata;
      });
    },

    async listCatalogueMedia(catalogueId) {
      return locked(catalogueId, () => listMetadataUnlocked(root, catalogueId));
    },

    async readVerifiedCatalogueMedia(catalogueId, mediaId) {
      return locked(catalogueId, async () => {
        assertMediaId(mediaId);
        const current = await listMetadataUnlocked(root, catalogueId);
        const item = current.find((candidate) => candidate.mediaId === mediaId);
        if (!item) throw new Error(`Catalogue media ${mediaId} was not found.`);
        return { ...item, body: await readVerifiedBinary(root, catalogueId, item) };
      });
    },

    async updateCatalogueMedia(catalogueId, mediaId, patch) {
      return locked(catalogueId, async () => {
        assertMediaId(mediaId);
        if (!object(patch)) throw new Error('A valid catalogue media update is required.');
        const keys = Reflect.ownKeys(patch);
        if (keys.length === 0) throw new Error('Catalogue media update must contain at least one field; empty patches are rejected.');
        if (keys.some((key) => typeof key !== 'string' || !UPDATE_KEYS.has(key))) throw new Error('Catalogue media update contains unknown keys.');
        const requestedOrder = Object.prototype.hasOwnProperty.call(patch, 'order') ? normalizeOrder(patch.order) : undefined;
        const requestedAssignment = Object.prototype.hasOwnProperty.call(patch, 'assignment') ? normalizeAssignment(patch.assignment) : undefined;
        const current = await listMetadataUnlocked(root, catalogueId);
        const index = current.findIndex((item) => item.mediaId === mediaId);
        if (index < 0) throw new Error(`Catalogue media ${mediaId} was not found.`);
        const item = current[index];
        const order = requestedOrder ?? item.order;
        if (current.some((candidate, candidateIndex) => candidateIndex !== index && candidate.order === order)) throw new Error(`Duplicate catalogue media order ${order}.`);
        const updated = { ...item, order, assignment: requestedAssignment ?? item.assignment };
        await writeManifest(root, catalogueId, current.map((candidate, candidateIndex) => candidateIndex === index ? updated : candidate));
        return updated;
      });
    },

    async getCatalogueMediaRemoval(catalogueId, operationId) {
      return locked(catalogueId, async () => {
        assertOperationId(operationId);
        const removal = await readRemoval(root, catalogueId, operationId);
        if (!removal || removal.status !== 'prepared') return removal;
        const current = await listMetadataUnlocked(root, catalogueId);
        const present = removal.removed.filter(item => current.some(candidate => candidate.mediaId === item.mediaId)).length;
        if (present === removal.removed.length) return removal;
        if (present !== 0) throw corrupt(catalogueId);
        const committed = { ...removal, status: 'committed' as const, updatedAt: new Date().toISOString() };
        await writeRemoval(root, committed);
        return committed;
      });
    },

    async finalizeCatalogueMediaRemoval(catalogueId, operationId, mediaIds) {
      return locked(catalogueId, async () => {
        assertOperationId(operationId);
        if (!Array.isArray(mediaIds) || mediaIds.length === 0 || mediaIds.length > MAX_ITEMS) throw new Error('A non-empty bounded media removal set is required.');
        for (const mediaId of mediaIds) assertMediaId(mediaId);
        if (new Set(mediaIds).size !== mediaIds.length) throw new Error('Catalogue media removal IDs must be unique.');

        let removal = await readRemoval(root, catalogueId, operationId);
        let current: CatalogueMediaMetadata[];
        if (removal) {
          const requested = [...mediaIds].sort().join(',');
          const recorded = removal.removed.map(item => item.mediaId).sort().join(',');
          if (requested !== recorded) throw new Error('Media removal operation payload does not match its durable record.');
          if (removal.status !== 'prepared') return removal;
          current = await listMetadataUnlocked(root, catalogueId);
          const present = removal.removed.filter(item => current.some(candidate => candidate.mediaId === item.mediaId)).length;
          if (present === 0) {
            removal = { ...removal, status: 'committed', updatedAt: new Date().toISOString() };
            await writeRemoval(root, removal);
            return removal;
          }
          if (present !== removal.removed.length) throw corrupt(catalogueId);
        } else {
          current = await listMetadataUnlocked(root, catalogueId);
          const removed = mediaIds.map(mediaId => {
            const item = current.find(candidate => candidate.mediaId === mediaId);
            if (!item) throw new Error(`Catalogue media ${mediaId} was not found.`);
            return item;
          });
          const location = await prepareTransactionDirectory(root, catalogueId, operationId);
          for (const item of removed) {
            const body = await readVerifiedBinary(root, catalogueId, item);
            await durableReplace(location.binary(item.mediaId), body, location.directory);
          }
          const now = new Date().toISOString();
          removal = { operationId, catalogueId, status: 'prepared', removed, createdAt: now, updatedAt: now };
          await writeRemoval(root, removal);
        }

        try {
          const removedIds = new Set(removal.removed.map(item => item.mediaId));
          await writeManifest(root, catalogueId, current.filter(item => !removedIds.has(item.mediaId)));
        } catch (reason) {
          if (reason instanceof CommittedWriteError) throw reason;
          const rolledBack = { ...removal, status: 'rolled_back' as const, updatedAt: new Date().toISOString() };
          try { await writeRemoval(root, rolledBack); }
          catch (rollbackReason) { throw new Error(`Catalogue media removal failed and rollback state could not be persisted: ${String(reason)}; ${String(rollbackReason)}`); }
          throw reason;
        }
        const committed = { ...removal, status: 'committed' as const, updatedAt: new Date().toISOString() };
        await writeRemoval(root, committed);
        return committed;
      });
    },

    async removeCatalogueMedia(catalogueId, mediaId) {
      return locked(catalogueId, async () => {
        assertMediaId(mediaId);
        const current = await listMetadataUnlocked(root, catalogueId);
        const removed = current.find((item) => item.mediaId === mediaId);
        if (!removed) throw new Error(`Catalogue media ${mediaId} was not found.`);
        const location = paths(root, catalogueId);
        const binary = location.binary(mediaId);
        const trash = path.join(location.directory, `${mediaId}.${randomUUID()}.trash`);
        await assertRegular(binary);
        await assertRegular(trash, true);
        await rename(binary, trash);
        await syncDirectory(location.directory);
        try { await writeManifest(root, catalogueId, current.filter((item) => item.mediaId !== mediaId)); }
        catch (reason) {
          if (reason instanceof CommittedWriteError) {
            try { await assertRegular(trash); await unlink(trash); await syncDirectory(location.directory); } catch { /* committed */ }
            return removed;
          }
          try { await assertRegular(trash); await assertRegular(binary, true); await rename(trash, binary); await syncDirectory(location.directory); }
          catch { throw new Error(`Catalogue media remove failed and rollback could not be completed: ${String(reason)}`); }
          throw reason;
        }
        try { await assertRegular(trash); await unlink(trash); await syncDirectory(location.directory); } catch { /* committed remove succeeds; later list cleans trash */ }
        return removed;
      });
    },
  };
}

const defaultStore = createCatalogueMediaStore(DEFAULT_DIRECTORY);
export const addCatalogueMedia = defaultStore.addCatalogueMedia;
export const listCatalogueMedia = defaultStore.listCatalogueMedia;
export const readVerifiedCatalogueMedia = defaultStore.readVerifiedCatalogueMedia;
export const updateCatalogueMedia = defaultStore.updateCatalogueMedia;
export const removeCatalogueMedia = defaultStore.removeCatalogueMedia;
export const finalizeCatalogueMediaRemoval = defaultStore.finalizeCatalogueMediaRemoval;
export const getCatalogueMediaRemoval = defaultStore.getCatalogueMediaRemoval;
