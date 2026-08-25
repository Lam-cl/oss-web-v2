import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, opendir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION = /^[a-f0-9]{64}$/;
const ARCHIVE_ID = /^\d{8}T\d{9}Z$/;
const NOFOLLOW = constants.O_NOFOLLOW || 0;
const DIRECTORY = constants.O_DIRECTORY || 0;
const MAX_ARCHIVE_DEPTH = 8;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_DIRECTORIES = 1_000;
const MAX_ARCHIVE_FILES = 1_000;
const MAX_ARCHIVE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 100 * 1024 * 1024;
const queues = new Map<string, Promise<void>>();
type Row = Record<string, unknown>;

export type CatalogueArchiveFile = { source: string; archived: string; bytes: number; sha256: string };
export type CatalogueArchiveManifest = {
  version: 1;
  state: 'archived';
  catalogueId: string;
  revision: number;
  archivedAt: string;
  archiveId: string;
  files: CatalogueArchiveFile[];
  rollback: { destinations: Array<{ source: string; archived: string }> };
};
export type CatalogueArchiveResult = { manifest: CatalogueArchiveManifest; idempotent: boolean };
export type CatalogueArchiveOptions = { dataDirectory?: string; now?: () => Date };

type PreparedManifest = Omit<CatalogueArchiveManifest, 'state'> & { state: 'prepared' | 'archived' };
type Move = { source: string; destination: string; sourceParent: string; destinationParent: string };
type TraversalBudget = { entries: number; directories: number; files: number; bytes: number; maxFiles?: number };

export class CatalogueArchiveError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 500 = 400) {
    super(message); this.name = 'CatalogueArchiveError';
  }
}

const object = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const positiveRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const relativeSafe = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !path.isAbsolute(value)
  && path.normalize(value) === value && value !== '..' && !value.startsWith(`..${path.sep}`);
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const isoTimestamp = (value: unknown): value is string => typeof value === 'string' && (() => { try { return new Date(value).toISOString() === value; } catch { return false; } })();

function assertCatalogueId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new CatalogueArchiveError('A valid catalogue ID is required.', 400);
}
function assertExpectedRevision(value: unknown): asserts value is number {
  if (!positiveRevision(value)) throw new CatalogueArchiveError('An exact positive revision is required.', 400);
}
async function statOrNull(target: string) {
  try { return await lstat(target); }
  catch (reason: any) { if (reason?.code === 'ENOENT') return null; throw reason; }
}
async function assertDirectory(target: string) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CatalogueArchiveError(`Archive path is not a safe directory: ${target}.`, 500);
}
async function syncDirectory(target: string) {
  await assertDirectory(target);
  const handle = await open(target, constants.O_RDONLY | DIRECTORY | NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function ensureDirectory(target: string) {
  const resolved = path.resolve(target);
  if (resolved !== target) throw new CatalogueArchiveError('Catalogue archive data root must be absolute and normalized.', 500);
  const parsed = path.parse(resolved); let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    const parent = current; current = path.join(current, part);
    const before = await statOrNull(current);
    if (!before) { await mkdir(current, { mode: 0o700 }); await syncDirectory(parent); }
    await assertDirectory(current);
  }
  if (await realpath(resolved) !== resolved) throw new CatalogueArchiveError('Catalogue archive data root is not safely contained.', 500);
  await chmod(resolved, 0o700);
}
async function ensureChild(parent: string, name: string) {
  if (!name || path.basename(name) !== name) throw new CatalogueArchiveError('Unsafe archive path component.', 500);
  const target = path.join(parent, name); const existing = await statOrNull(target);
  if (!existing) { await mkdir(target, { mode: 0o700 }); await syncDirectory(parent); }
  await assertDirectory(target);
  if (await realpath(path.dirname(target)) !== parent || await realpath(target) !== target) throw new CatalogueArchiveError('Archive path escaped its parent.', 500);
  await chmod(target, 0o700); return target;
}
async function readRegular(target: string, budget?: TraversalBudget) {
  const handle = await open(target, constants.O_RDONLY | NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error('not regular');
    if (!Number.isSafeInteger(opened.size) || opened.size < 0 || opened.size > MAX_ARCHIVE_FILE_BYTES)
      throw new CatalogueArchiveError(`Archive source exceeds the per-file byte limit: ${target}.`, 500);
    if (budget) {
      if (++budget.files > (budget.maxFiles || MAX_ARCHIVE_FILES)) throw new CatalogueArchiveError('Catalogue archive file limit exceeded.', 500);
      if (budget.bytes + opened.size > MAX_ARCHIVE_TOTAL_BYTES) throw new CatalogueArchiveError('Catalogue archive aggregate byte limit exceeded.', 500);
    }
    const chunks: Buffer[] = []; let position = 0;
    while (position < opened.size) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, opened.size - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead)); position += bytesRead;
    }
    const probe = Buffer.allocUnsafe(1); const extra = (await handle.read(probe, 0, 1, position)).bytesRead;
    const finished = await handle.stat();
    if (extra !== 0 || position !== opened.size || !finished.isFile() || finished.size !== opened.size
      || finished.dev !== opened.dev || finished.ino !== opened.ino || finished.mtimeMs !== opened.mtimeMs || finished.ctimeMs !== opened.ctimeMs)
      throw new CatalogueArchiveError(`Archive source changed while it was read: ${target}.`, 500);
    if (budget) budget.bytes += position;
    return Buffer.concat(chunks, position);
  }
  catch (reason) { if (reason instanceof CatalogueArchiveError) throw reason; throw new CatalogueArchiveError(`Archive source could not be read safely: ${target}.`, 500); }
  finally { await handle.close(); }
}
async function directoryEntries(directory: string, budget: TraversalBudget) {
  await assertDirectory(directory);
  if (++budget.directories > MAX_ARCHIVE_DIRECTORIES) throw new CatalogueArchiveError('Catalogue archive directory limit exceeded.', 500);
  const handle = await opendir(directory); const entries: import('node:fs').Dirent[] = [];
  for await (const entry of handle) {
    if (++budget.entries > MAX_ARCHIVE_ENTRIES) throw new CatalogueArchiveError('Catalogue archive traversal entry limit exceeded.', 500);
    entries.push(entry);
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
async function durableJson(target: string, value: unknown) {
  const directory = path.dirname(target); const temp = path.join(directory, `.manifest-${randomUUID()}.tmp`);
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, target); await chmod(target, 0o600); await syncDirectory(directory);
}
function archiveIdFor(date: Date) {
  const iso = date.toISOString();
  return iso.replace(/[-:.]/g, '');
}
async function walkFiles(root: string, relative = '', budget: TraversalBudget = { entries:0, directories:0, files:0, bytes:0 }, depth = 0, directories?: Set<string>): Promise<Array<{ relative: string; body: Buffer }>> {
  if (depth > MAX_ARCHIVE_DEPTH) throw new CatalogueArchiveError('Catalogue archive depth limit exceeded.', 500);
  const directory = relative ? path.join(root, relative) : root;
  const output: Array<{ relative: string; body: Buffer }> = [];
  for (const entry of await directoryEntries(directory, budget)) {
    if (entry.isSymbolicLink()) throw new CatalogueArchiveError(`Archive source contains a symlink: ${path.join(directory, entry.name)}.`, 500);
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) { directories?.add(child); output.push(...await walkFiles(root, child, budget, depth + 1, directories)); }
    else if (entry.isFile()) output.push({ relative: child, body: await readRegular(path.join(root, child), budget) });
    else throw new CatalogueArchiveError(`Archive source contains an unsafe filesystem object: ${path.join(root, child)}.`, 500);
  }
  return output;
}
function parseProduct(body: Buffer, catalogueId: string) {
  let value: unknown; try { value = JSON.parse(body.toString('utf8')); } catch { throw new CatalogueArchiveError('Catalogue product storage is corrupt.', 500); }
  if (!object(value) || value.catalogueId !== catalogueId || !positiveRevision(value.revision)
    || (value.status !== 'draft' && value.status !== 'published')
    || (value.currentBundleProductId !== null && !positiveRevision(value.currentBundleProductId))
    || !Array.isArray(value.bundleVersions)) throw new CatalogueArchiveError('Catalogue product storage is corrupt.', 500);
  const bundleIds = new Set<number>();
  for (const version of value.bundleVersions) {
    if (!object(version) || !positiveRevision(version.bundleProductId) || bundleIds.has(version.bundleProductId)
      || typeof version.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(version.fingerprint)
      || !isoTimestamp(version.publishedAt)
      || version.retiredAt !== null && !isoTimestamp(version.retiredAt)) throw new CatalogueArchiveError('Catalogue product storage is corrupt.', 500);
    bundleIds.add(version.bundleProductId);
  }
  return value;
}
async function publicationFiles(directory: string, catalogueId: string, budget: TraversalBudget) {
  const root = await statOrNull(directory); if (!root) return [];
  const matches: Array<{ name: string; operationId: string; body: Buffer }> = [];
  for (const entry of await directoryEntries(directory, budget)) {
    const match = /^([a-f0-9]{64})\.json$/.exec(entry.name); if (!match) continue;
    if (entry.isSymbolicLink() || !entry.isFile()) throw new CatalogueArchiveError(`Catalogue publication source is not safe: ${entry.name}.`, 500);
    const body = await readRegular(path.join(directory, entry.name), budget); let value: unknown;
    try { value = JSON.parse(body.toString('utf8')); } catch { throw new CatalogueArchiveError(`Catalogue publication ${match[1]} is corrupt.`, 500); }
    if (!object(value) || value.operationId !== match[1] || !OPERATION.test(String(value.operationId)) || !UUID.test(String(value.catalogueId)))
      throw new CatalogueArchiveError(`Catalogue publication ${match[1]} is corrupt.`, 500);
    if (value.catalogueId === catalogueId) matches.push({ name: entry.name, operationId: match[1], body });
  }
  return matches.sort((a, b) => a.name.localeCompare(b.name));
}
async function publishedSnapshots(directory: string, catalogueId: string, operationIds: string[], budget: TraversalBudget) {
  const root = await statOrNull(directory); if (!root) return [];
  await assertDirectory(directory);
  const snapshots: Array<{ operationId: string; files: Array<{ relative: string; body: Buffer }> }> = [];
  for (const operationId of operationIds) {
    const source = path.join(directory, operationId); const stat = await statOrNull(source); if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CatalogueArchiveError(`Catalogue published snapshot ${operationId} is not safe.`, 500);
    const files = await walkFiles(source, '', budget); const manifestFile = files.find(item => item.relative === 'manifest.json');
    if (!manifestFile) throw new CatalogueArchiveError(`Catalogue published snapshot ${operationId} has no manifest.`, 500);
    let manifest: unknown; try { manifest = JSON.parse(manifestFile.body.toString('utf8')); }
    catch { throw new CatalogueArchiveError(`Catalogue published snapshot ${operationId} manifest is corrupt.`, 500); }
    if (!object(manifest) || manifest.operationId !== operationId || manifest.catalogueId !== catalogueId)
      throw new CatalogueArchiveError(`Catalogue published snapshot ${operationId} identity is corrupt.`, 500);
    snapshots.push({ operationId, files });
  }
  return snapshots;
}
function validateManifest(value: unknown, expectedId: string): CatalogueArchiveManifest {
  if (!object(value) || value.version !== 1 || value.state !== 'archived' || value.catalogueId !== expectedId
    || !positiveRevision(value.revision) || typeof value.archivedAt !== 'string' || !ARCHIVE_ID.test(String(value.archiveId))
    || !Array.isArray(value.files) || !object(value.rollback) || !Array.isArray(value.rollback.destinations))
    throw new CatalogueArchiveError('Catalogue archive manifest is corrupt.', 500);
  const files = value.files as unknown[];
  if (files.length > MAX_ARCHIVE_FILES) throw new CatalogueArchiveError('Catalogue archive file limit exceeded.', 500);
  const sources = new Set<string>(), archived = new Set<string>();
  for (const item of files) if (!object(item) || !relativeSafe(item.source) || !relativeSafe(item.archived)
    || typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes < 0
    || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new CatalogueArchiveError('Catalogue archive manifest is corrupt.', 500);
  for (const item of files as Row[]) {
    if (item.archived === 'manifest.json' || sources.has(item.source as string) || archived.has(item.archived as string))
      throw new CatalogueArchiveError('Catalogue archive manifest is corrupt.', 500);
    sources.add(item.source as string); archived.add(item.archived as string);
  }
  const destinations = value.rollback.destinations as unknown[];
  if (destinations.length !== files.length || destinations.some((item, index) => !object(item)
    || item.source !== (files[index] as Row).source || item.archived !== (files[index] as Row).archived))
    throw new CatalogueArchiveError('Catalogue archive rollback manifest is corrupt.', 500);
  return value as CatalogueArchiveManifest;
}
async function existingArchive(archiveRoot: string, catalogueId: string) {
  const idRoot = path.join(archiveRoot, catalogueId); const stat = await statOrNull(idRoot); if (!stat) return [] as CatalogueArchiveManifest[];
  await assertDirectory(idRoot); const found: CatalogueArchiveManifest[] = [];
  const budget: TraversalBudget = { entries:0, directories:0, files:0, bytes:0, maxFiles:MAX_ARCHIVE_FILES + 1 };
  for (const entry of await directoryEntries(idRoot, budget)) {
    if (!ARCHIVE_ID.test(entry.name)) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new CatalogueArchiveError('Catalogue archive entry is not safe.', 500);
    const directory = path.join(idRoot, entry.name); const directories = new Set<string>();
    const tree = await walkFiles(directory, '', budget, 0, directories);
    const manifestFile = tree.find(file => file.relative === 'manifest.json');
    if (!manifestFile) throw new CatalogueArchiveError('Catalogue archive manifest is missing.', 500);
    let decoded: unknown; try { decoded = JSON.parse(manifestFile.body.toString('utf8')); }
    catch { throw new CatalogueArchiveError('Catalogue archive manifest is corrupt.', 500); }
    const manifest = validateManifest(decoded, catalogueId);
    if (manifest.archiveId !== entry.name) throw new CatalogueArchiveError('Catalogue archive manifest identity is corrupt.', 500);
    const byPath = new Map(tree.map(file => [file.relative, file.body]));
    const expectedFiles = new Set(['manifest.json', ...manifest.files.map(file => file.archived)]);
    if (byPath.size !== expectedFiles.size || tree.some(file => !expectedFiles.has(file.relative)))
      throw new CatalogueArchiveError('Catalogue archive contains an extra or unexpected file tree.', 500);
    const expectedDirectories = new Set<string>();
    for (const file of manifest.files) {
      let parent = path.dirname(file.archived);
      while (parent !== '.') { expectedDirectories.add(parent); parent = path.dirname(parent); }
      const body = byPath.get(file.archived);
      if (!body || body.length !== file.bytes || sha256(body) !== file.sha256) throw new CatalogueArchiveError('Catalogue archive checksum verification failed.', 500);
    }
    if (directories.size !== expectedDirectories.size || Array.from(directories).some(item => !expectedDirectories.has(item)))
      throw new CatalogueArchiveError('Catalogue archive contains an extra or unexpected directory tree.', 500);
    found.push(manifest);
  }
  return found.sort((a, b) => b.archiveId.localeCompare(a.archiveId));
}
function enqueue<T>(key: string, action: () => Promise<T>) {
  const prior = queues.get(key) || Promise.resolve(); const run = prior.then(action, action); const tail = run.then(() => undefined, () => undefined);
  queues.set(key, tail); return run.finally(() => { if (queues.get(key) === tail) queues.delete(key); });
}

export async function archiveCatalogueProduct(catalogueId: string, expectedRevision: number, options: CatalogueArchiveOptions = {}): Promise<CatalogueArchiveResult> {
  assertCatalogueId(catalogueId); assertExpectedRevision(expectedRevision);
  const dataDirectory = path.resolve(options.dataDirectory || path.join(process.cwd(), '.data'));
  if (options.dataDirectory && dataDirectory !== options.dataDirectory) throw new CatalogueArchiveError('Catalogue archive data root must be absolute and normalized.', 500);
  return enqueue(`${dataDirectory}\0${catalogueId}`, async () => {
    await ensureDirectory(dataDirectory);
    const productDirectory = await ensureChild(dataDirectory, 'catalogue-products');
    const mediaDirectory = await ensureChild(dataDirectory, 'catalogue-media');
    const publicationsDirectory = await ensureChild(dataDirectory, 'catalogue-publications');
    const archiveRoot = await ensureChild(dataDirectory, 'catalogue-archive');
    const productSource = path.join(productDirectory, `${catalogueId}.json`);
    const productStat = await statOrNull(productSource);
    if (!productStat) {
      const archived = await existingArchive(archiveRoot, catalogueId);
      const exact = archived.find(item => item.revision === expectedRevision);
      if (exact) return { manifest: exact, idempotent: true };
      if (archived.length) throw new CatalogueArchiveError('Catalogue product archive revision conflict.', 409);
      throw new CatalogueArchiveError('Catalogue product was not found.', 404);
    }
    const budget: TraversalBudget = { entries:0, directories:0, files:0, bytes:0 };
    const productBody = await readRegular(productSource, budget); const product = parseProduct(productBody, catalogueId);
    if (product.revision !== expectedRevision) throw new CatalogueArchiveError('Catalogue product revision conflict.', 409);
    const activeVersion = (product.bundleVersions as unknown[]).some(value => object(value) && value.retiredAt === null);
    if (product.status !== 'draft' || product.currentBundleProductId !== null || activeVersion)
      throw new CatalogueArchiveError('Unpublish this Catalogue product and confirm its Bundle version is retired before archiving.', 409);

    const mediaSource = path.join(mediaDirectory, catalogueId); const mediaStat = await statOrNull(mediaSource);
    if (mediaStat && (mediaStat.isSymbolicLink() || !mediaStat.isDirectory())) throw new CatalogueArchiveError('Catalogue media source is not safe.', 500);
    const mediaFiles = mediaStat ? await walkFiles(mediaSource, '', budget) : [];
    const publications = await publicationFiles(publicationsDirectory, catalogueId, budget);
    const publishedDirectory = path.join(dataDirectory, 'catalogue-published');
    const snapshots = await publishedSnapshots(publishedDirectory, catalogueId, publications.map(item => item.operationId), budget);
    const archivedAt = (options.now || (() => new Date()))().toISOString(); const archiveId = archiveIdFor(new Date(archivedAt));
    if (!ARCHIVE_ID.test(archiveId)) throw new CatalogueArchiveError('Catalogue archive timestamp is invalid.', 500);
    const catalogueArchiveRoot = await ensureChild(archiveRoot, catalogueId);
    if (await statOrNull(path.join(catalogueArchiveRoot, archiveId))) throw new CatalogueArchiveError('Catalogue archive timestamp already exists.', 409);
    const stagingName = `.tmp-${archiveId}-${randomUUID()}`; const staging = await ensureChild(catalogueArchiveRoot, stagingName);
    const mediaDestination = path.join(staging, 'media');
    const publicationDestination = await ensureChild(staging, 'publications');
    const publishedDestination = snapshots.length ? await ensureChild(staging, 'published') : null;
    const files: CatalogueArchiveFile[] = [
      { source: path.join('catalogue-products', `${catalogueId}.json`), archived: 'product.json', bytes: productBody.length, sha256: sha256(productBody) },
      ...mediaFiles.map(item => ({ source: path.join('catalogue-media', catalogueId, item.relative), archived: path.join('media', item.relative), bytes: item.body.length, sha256: sha256(item.body) })),
      ...publications.map(item => ({ source: path.join('catalogue-publications', item.name), archived: path.join('publications', item.name), bytes: item.body.length, sha256: sha256(item.body) })),
      ...snapshots.flatMap(snapshot => snapshot.files.map(item => ({ source: path.join('catalogue-published', snapshot.operationId, item.relative), archived: path.join('published', snapshot.operationId, item.relative), bytes: item.body.length, sha256: sha256(item.body) }))),
    ];
    const prepared: PreparedManifest = { version:1, state:'prepared', catalogueId, revision:expectedRevision, archivedAt, archiveId, files,
      rollback:{destinations:files.map(item => ({ source:item.source, archived:item.archived }))} };
    await durableJson(path.join(staging, 'manifest.json'), prepared);
    const moves: Move[] = [];
    if (mediaStat) moves.push({ source:mediaSource, destination:mediaDestination, sourceParent:mediaDirectory, destinationParent:staging });
    for (const snapshot of snapshots) moves.push({ source:path.join(publishedDirectory,snapshot.operationId), destination:path.join(publishedDestination!,snapshot.operationId), sourceParent:publishedDirectory, destinationParent:publishedDestination! });
    for (const item of publications) moves.push({ source:path.join(publicationsDirectory,item.name), destination:path.join(publicationDestination,item.name), sourceParent:publicationsDirectory, destinationParent:publicationDestination });
    moves.push({ source:productSource, destination:path.join(staging,'product.json'), sourceParent:productDirectory, destinationParent:staging });
    const completed: Move[] = [];
    try {
      for (const move of moves) { await rename(move.source, move.destination); completed.push(move); await syncDirectory(move.sourceParent); await syncDirectory(move.destinationParent); }
      const manifest = { ...prepared, state:'archived' as const }; await durableJson(path.join(staging,'manifest.json'), manifest);
      const finalDirectory = path.join(catalogueArchiveRoot, archiveId); await rename(staging, finalDirectory); await syncDirectory(catalogueArchiveRoot);
      return { manifest, idempotent:false };
    } catch (reason) {
      let rollbackFailure: unknown = null;
      for (const move of completed.reverse()) {
        try { await rename(move.destination, move.source); await syncDirectory(move.destinationParent); await syncDirectory(move.sourceParent); }
        catch (rollbackReason) { rollbackFailure ||= rollbackReason; }
      }
      if (!rollbackFailure) try { await rm(staging, { recursive:true, force:false }); await syncDirectory(catalogueArchiveRoot); } catch { /* preserve staging journal */ }
      if (rollbackFailure) throw new CatalogueArchiveError(`Catalogue archive failed; rollback data is preserved at ${staging}.`, 500);
      throw reason;
    }
  });
}
