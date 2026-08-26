import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createRemoteDocument, dataApiEnabled, remoteDocument, remoteDocuments, replaceRemoteDocument } from '@/lib/dataApiClient.server';

export type CataloguePublicationPhase = 'building' | 'bundle-published' | 'activation-uncertain' | 'activated' | 'retirement-uncertain' | 'previous-retired' | 'complete';
export type CataloguePublicationStepName = 'draft-created' | 'images-resolved' | 'options-resolved' | 'variants-resolved' | 'variants-normalized' | 'bundle-published' | 'activated' | 'previous-retired' | 'complete';
export type CataloguePublicationCompletedStep = { name: CataloguePublicationStepName; completedAt: string };
export type CataloguePublicationBinding = { valueKeys: string[]; variantId: number };
export type CataloguePublicationResolved = {
  options: Record<string, number>;
  values: Record<string, number>;
  images: Record<string, number>;
  variants: Record<string, number>;
};
export type CataloguePublicationJob = {
  version: 1;
  operationId: string;
  catalogueId: string;
  revision: number;
  phase: CataloguePublicationPhase;
  modelFingerprint64: string;
  previousBundleProductId: number | null;
  draftBundleProductId: number | null;
  completedSteps: CataloguePublicationCompletedStep[];
  resolved: CataloguePublicationResolved;
  bindings: CataloguePublicationBinding[];
  resultFingerprint64: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CreatePublicationJobInput = Pick<CataloguePublicationJob, 'operationId' | 'catalogueId' | 'modelFingerprint64' | 'previousBundleProductId'>;
export type CompletedPublicationEvidenceInput = Pick<CataloguePublicationJob,
  'operationId'|'catalogueId'|'modelFingerprint64'|'previousBundleProductId'|'draftBundleProductId'|'resolved'|'bindings'|'resultFingerprint64'>;

type Row = Record<string, unknown>;
type Updater = (job: CataloguePublicationJob) => CataloguePublicationJob | Promise<CataloguePublicationJob>;
type OpenHandle = Awaited<ReturnType<typeof open>>;

const DEFAULT_DIRECTORY = path.join(process.cwd(), '.data', 'catalogue-publications');
const JOB_KEYS = ['bindings', 'catalogueId', 'completedSteps', 'createdAt', 'draftBundleProductId', 'modelFingerprint64', 'operationId', 'phase', 'previousBundleProductId', 'resolved', 'resultFingerprint64', 'revision', 'updatedAt', 'version'];
const INPUT_KEYS = ['catalogueId', 'modelFingerprint64', 'operationId', 'previousBundleProductId'];
const RESOLVED_KEYS = ['images', 'options', 'values', 'variants'];
const STEP_KEYS = ['completedAt', 'name'];
const BINDING_KEYS = ['valueKeys', 'variantId'];
const STEPS: CataloguePublicationStepName[] = ['draft-created', 'images-resolved', 'options-resolved', 'variants-resolved', 'variants-normalized', 'bundle-published', 'activated', 'previous-retired', 'complete'];
const LEGACY_STEPS = ['draft-created', 'images-resolved', 'options-resolved', 'variants-resolved', 'bundle-published', 'activated', 'previous-retired', 'complete'];
const PHASE_RANK: Record<CataloguePublicationPhase, number> = { building: 0, 'bundle-published': 1, 'activation-uncertain': 2, activated: 3, 'retirement-uncertain': 4, 'previous-retired': 5, complete: 6 };
const PHASE_MAX_STEPS: Record<CataloguePublicationPhase, number> = { building: 5, 'bundle-published': 6, 'activation-uncertain': 6, activated: 7, 'retirement-uncertain': 7, 'previous-retired': 8, complete: 9 };
const MAX_COLLECTION_SIZE = 10_000;
const MAX_RECORD_BYTES = 1_048_576;
// ponytail: correct only for one PM2 fork worker; use a transactional store before clustering or adding external writers.
const operationQueues = new Map<string, Promise<void>>();
const object = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Row, keys: string[]) => isDeepStrictEqual(Object.keys(value).sort(), keys);
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const operationId = (value: unknown): value is string => fingerprint(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const clientKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && (() => { try { return new Date(value).toISOString() === value; } catch { return false; } })();
const jobFile = (id: string, directory: string) => path.join(directory, `${id}.json`);
const corruption = (id: string) => new Error(`Catalogue publication storage for ${id} is corrupt.`);

function assertOperationId(value: unknown): asserts value is string {
  if (!operationId(value)) throw new Error('A valid 64-character publication operation ID is required.');
}
function assertRevision(value: unknown): asserts value is number {
  if (!positiveInteger(value)) throw new Error('A positive safe expected revision is required.');
}
async function rejectSymlink(target: string, label: string, allowMissing = false) {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
    return stat;
  } catch (reason: any) {
    if (allowMissing && reason?.code === 'ENOENT') return null;
    throw reason;
  }
}
async function syncDirectory(directory: string) {
  const handle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function secureDirectory(directory: string) {
  const resolved = path.resolve(directory); const root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    const parent = current; current = path.join(current, part);
    let stat = await rejectSymlink(current, `Catalogue publication path ancestor ${current}`, true);
    if (!stat) {
      try { await mkdir(current, { mode: 0o700 }); await syncDirectory(parent); }
      catch (reason: any) { if (reason?.code !== 'EEXIST') throw reason; }
      stat = await rejectSymlink(current, `Catalogue publication path ancestor ${current}`);
    }
    if (!stat?.isDirectory()) throw new Error(`Catalogue publication path ancestor ${current} is not safe.`);
  }
  if (await realpath(resolved) !== resolved) throw new Error('Catalogue publication directory is not safely contained.');
  await chmod(resolved, 0o700);
  return resolved;
}
async function noFollowRead(target: string) {
  const handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try { return await handle.readFile({ encoding: 'utf8' }); } finally { await handle.close(); }
}

function validateResolved(value: unknown): CataloguePublicationResolved {
  if (!object(value) || !exactKeys(value, RESOLVED_KEYS)) throw new Error('Publication resolved maps are invalid.');
  const result = {} as CataloguePublicationResolved;
  for (const kind of RESOLVED_KEYS as Array<keyof CataloguePublicationResolved>) {
    const map = value[kind];
    if (!object(map)) throw new Error('Publication resolved maps are invalid.');
    const entries = Object.entries(map);
    if (entries.length > MAX_COLLECTION_SIZE || entries.some(([key, id]) => !clientKey(key) || !positiveInteger(id))
      || new Set(entries.map(([, id]) => id)).size !== entries.length) throw new Error('Publication resolved client keys and IDs are invalid.');
    result[kind] = Object.fromEntries(entries) as Record<string, number>;
  }
  return result;
}
function validateJob(value: unknown, expectedId?: string): CataloguePublicationJob {
  if (!object(value) || !exactKeys(value, JOB_KEYS)
    || value.version !== 1 || !operationId(value.operationId) || expectedId !== undefined && value.operationId !== expectedId
    || !uuid(value.catalogueId) || !positiveInteger(value.revision)
    || typeof value.phase !== 'string' || !(value.phase in PHASE_RANK)
    || !fingerprint(value.modelFingerprint64)
    || value.previousBundleProductId !== null && !positiveInteger(value.previousBundleProductId)
    || value.draftBundleProductId !== null && !positiveInteger(value.draftBundleProductId)
    || value.resultFingerprint64 !== null && !fingerprint(value.resultFingerprint64)
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || value.updatedAt < value.createdAt
    || !Array.isArray(value.completedSteps) || value.completedSteps.length > STEPS.length
    || !Array.isArray(value.bindings) || value.bindings.length > MAX_COLLECTION_SIZE) throw new Error('A valid catalogue publication job is required.');
  const phase = value.phase as CataloguePublicationPhase;
  const createdAt = value.createdAt as string; const updatedAt = value.updatedAt as string;
  const completedSteps = value.completedSteps as unknown[];
  let priorTime = createdAt;
  completedSteps.forEach((raw, index) => {
    if (!object(raw) || !exactKeys(raw, STEP_KEYS) || raw.name !== STEPS[index] || !timestamp(raw.completedAt)
      || raw.completedAt < priorTime || raw.completedAt > updatedAt) throw new Error('Publication completed steps must be exact, typed, and ordered.');
    priorTime = raw.completedAt as string;
  });
  const names = new Set(completedSteps.map((item) => (item as Row).name));
  const resolved = validateResolved(value.resolved);
  const bindings = value.bindings as unknown[];
  const tupleKeys = new Set<string>(); const bindingIds = new Set<number>();
  for (const raw of bindings) {
    if (!object(raw) || !exactKeys(raw, BINDING_KEYS) || !Array.isArray(raw.valueKeys) || raw.valueKeys.length === 0
      || raw.valueKeys.length > MAX_COLLECTION_SIZE || !positiveInteger(raw.variantId)
      || raw.valueKeys.some((key) => !clientKey(key) || !Object.hasOwn(resolved.values, key))
      || new Set(raw.valueKeys).size !== raw.valueKeys.length) throw new Error('Publication variant bindings are invalid.');
    const tuple = JSON.stringify(raw.valueKeys);
    if (tupleKeys.has(tuple) || bindingIds.has(raw.variantId)) throw new Error('Publication variant bindings must be unique.');
    tupleKeys.add(tuple); bindingIds.add(raw.variantId);
  }
  const resolvedVariantIds = new Set(Object.values(resolved.variants));
  if (bindingIds.size !== resolvedVariantIds.size || Array.from(bindingIds).some((id) => !resolvedVariantIds.has(id)))
    throw new Error('Every resolved variant must have exactly one publication binding.');
  const requiredStep: Partial<Record<CataloguePublicationPhase, CataloguePublicationStepName>> = {
    'bundle-published': 'bundle-published', 'activation-uncertain': 'bundle-published', activated: 'activated',
    'retirement-uncertain': 'activated', 'previous-retired': 'previous-retired', complete: 'complete',
  };
  if (completedSteps.length > PHASE_MAX_STEPS[phase]
    || (value.draftBundleProductId !== null) !== names.has('draft-created')
    || phase !== 'building' && value.draftBundleProductId === null
    || requiredStep[phase] && !names.has(requiredStep[phase]!)
    || PHASE_RANK[phase] >= PHASE_RANK['bundle-published'] && (bindings.length === 0 || resolvedVariantIds.size === 0 || !names.has('variants-normalized'))
    || names.has('activated') && !names.has('bundle-published')
    || names.has('previous-retired') && !names.has('activated')
    || phase === 'complete' && value.resultFingerprint64 === null
    || phase !== 'complete' && value.resultFingerprint64 !== null) throw new Error(`Publication ${phase} phase invariants are invalid.`);
  return value as CataloguePublicationJob;
}
function normalizeLegacyJob(value: unknown) {
  if (!object(value) || !Array.isArray(value.completedSteps)) return value;
  const names = value.completedSteps.map((step) => object(step) ? step.name : undefined);
  if (names.includes('variants-normalized') || names.length !== LEGACY_STEPS.length
    || !isDeepStrictEqual(names, LEGACY_STEPS)) return value;
  const published = value.completedSteps[4];
  if (!object(published) || !timestamp(published.completedAt)) return value;
  return { ...value, completedSteps: [
    ...value.completedSteps.slice(0, 4),
    { name: 'variants-normalized', completedAt: published.completedAt },
    ...value.completedSteps.slice(4),
  ] };
}
function assertMonotonic(current: CataloguePublicationJob, next: CataloguePublicationJob) {
  if (PHASE_RANK[next.phase] < PHASE_RANK[current.phase]) throw new Error('Publication phase transitions must be monotonic.');
  const allowed: Record<CataloguePublicationPhase, CataloguePublicationPhase[]> = {
    building: ['building', 'bundle-published'], 'bundle-published': ['bundle-published', 'activation-uncertain', 'activated'],
    'activation-uncertain': ['activation-uncertain', 'activated'], activated: ['activated', 'retirement-uncertain', 'previous-retired'],
    'retirement-uncertain': ['retirement-uncertain', 'previous-retired'], 'previous-retired': ['previous-retired', 'complete'], complete: ['complete'],
  };
  if (!allowed[current.phase].includes(next.phase)) throw new Error(`Publication phase transition from ${current.phase} to ${next.phase} is invalid.`);
  if (next.completedSteps.length < current.completedSteps.length
    || !isDeepStrictEqual(next.completedSteps.slice(0, current.completedSteps.length), current.completedSteps)) throw new Error('Publication completed steps are append-only and ordered.');
  for (const kind of RESOLVED_KEYS as Array<keyof CataloguePublicationResolved>) {
    for (const [key, id] of Object.entries(current.resolved[kind])) if (next.resolved[kind][key] !== id) throw new Error('Publication resolved mappings are append-only.');
  }
  for (const binding of current.bindings) if (!next.bindings.some((item) => isDeepStrictEqual(item, binding))) throw new Error('Publication bindings are append-only.');
  if (current.draftBundleProductId !== null && next.draftBundleProductId !== current.draftBundleProductId) throw new Error('Publication draft Bundle product ID is immutable once resolved.');
}

async function durableWrite(job: CataloguePublicationJob, directory: string, createOnly = false) {
  directory = await secureDirectory(directory);
  const target = jobFile(job.operationId, directory);
  const existing = await rejectSymlink(target, 'Catalogue publication checkpoint', true);
  if (existing && !existing.isFile()) throw new Error('Catalogue publication checkpoint is not safe.');
  if (createOnly && existing) throw new Error(`Catalogue publication job ${job.operationId} already exists.`);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`; let handle: OpenHandle | undefined;
  try {
    handle = await open(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    const serialized = `${JSON.stringify(job, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES) throw new Error('Catalogue publication checkpoint exceeds the storage limit.');
    await handle.writeFile(serialized, 'utf8'); await handle.sync(); await handle.close(); handle = undefined;
    await rejectSymlink(target, 'Catalogue publication checkpoint', true);
    await rename(temp, target); await chmod(target, 0o600); await syncDirectory(directory);
  } catch (reason) {
    try { await handle?.close(); } catch { /* cleanup */ }
    try { await unlink(temp); } catch { /* cleanup */ }
    throw reason;
  }
}
function enqueue<T>(id: string, directory: string, action: () => Promise<T>) {
  const key = `${path.resolve(directory)}\0${id}`; const prior = operationQueues.get(key) ?? Promise.resolve();
  const run = prior.then(action); const tail = run.then(() => undefined, () => undefined);
  operationQueues.set(key, tail);
  return run.finally(() => { if (operationQueues.get(key) === tail) operationQueues.delete(key); });
}
async function readUnlocked(id: string, directory: string) {
  directory = await secureDirectory(directory);
  const target = jobFile(id, directory);
  try {
    const stat = await rejectSymlink(target, 'Catalogue publication checkpoint');
    if (!stat?.isFile()) throw corruption(id);
    const raw = await noFollowRead(target);
    if (Buffer.byteLength(raw) > MAX_RECORD_BYTES) throw corruption(id);
    return structuredClone(validateJob(normalizeLegacyJob(JSON.parse(raw)), id));
  } catch (reason: any) {
    if (reason?.code === 'ENOENT') return null;
    if (String(reason?.message).includes('symlink')) throw reason;
    throw corruption(id);
  }
}
async function updateUnlocked(id: string, expectedRevision: number, updater: Updater, directory: string) {
  const current = await readUnlocked(id, directory);
  if (!current) throw new Error(`Catalogue publication job ${id} was not found.`);
  if (current.revision !== expectedRevision) throw new Error(`Catalogue publication revision conflict: expected ${expectedRevision}, found ${current.revision}.`);
  let proposed: unknown;
  try { proposed = structuredClone(await updater(structuredClone(current))); } catch (reason) {
    if (reason instanceof Error) throw reason; throw new Error('A valid catalogue publication updater result is required.');
  }
  if (!object(proposed)) throw new Error('A valid catalogue publication updater result is required.');
  if (current.phase === 'complete') {
    if (!isDeepStrictEqual(proposed, current)) throw new Error('Completed catalogue publication jobs are immutable.');
    return structuredClone(current);
  }
  const now = new Date().toISOString();
  const next = validateJob({ ...proposed, version: 1, operationId: current.operationId, catalogueId: current.catalogueId,
    revision: current.revision + 1, modelFingerprint64: current.modelFingerprint64, previousBundleProductId: current.previousBundleProductId,
    createdAt: current.createdAt, updatedAt: now < current.updatedAt ? current.updatedAt : now }, id);
  assertMonotonic(current, next); await durableWrite(next, directory); return structuredClone(next);
}

export async function createPublicationJob(input: CreatePublicationJobInput, directory = DEFAULT_DIRECTORY): Promise<CataloguePublicationJob> {
  if (!object(input) || !exactKeys(input, INPUT_KEYS) || !operationId(input.operationId) || !uuid(input.catalogueId)
    || !fingerprint(input.modelFingerprint64) || input.previousBundleProductId !== null && !positiveInteger(input.previousBundleProductId)) throw new Error('A valid exact catalogue publication job input is required.');
  const create = async () => {
    const existing = directory === DEFAULT_DIRECTORY && dataApiEnabled()
      ? await readPublicationJob(input.operationId, directory)
      : await readUnlocked(input.operationId, directory);
    if (existing) throw new Error(`Catalogue publication job ${input.operationId} already exists.`);
    const now = new Date().toISOString();
    const job = validateJob({ version: 1, operationId: input.operationId, catalogueId: input.catalogueId, revision: 1, phase: 'building',
      modelFingerprint64: input.modelFingerprint64, previousBundleProductId: input.previousBundleProductId, draftBundleProductId: null,
      completedSteps: [], resolved: { options: {}, values: {}, images: {}, variants: {} }, bindings: [], resultFingerprint64: null,
      createdAt: now, updatedAt: now }, input.operationId);
    if (directory === DEFAULT_DIRECTORY && dataApiEnabled()) return validateJob((await createRemoteDocument('catalogue-publications', input.operationId, job)).value, input.operationId);
    await durableWrite(job, directory, true); return structuredClone(job);
  };
  return directory === DEFAULT_DIRECTORY && dataApiEnabled() ? create() : enqueue(input.operationId, directory, create);
}
export async function readPublicationJob(id: string, directory = DEFAULT_DIRECTORY): Promise<CataloguePublicationJob | null> {
  assertOperationId(id);
  if (directory === DEFAULT_DIRECTORY && dataApiEnabled()) {
    const document = await remoteDocument<CataloguePublicationJob>('catalogue-publications', id);
    return document ? validateJob(document.value, id) : null;
  }
  return readUnlocked(id, directory);
}
export async function updatePublicationJob(id: string, expectedRevision: number, updater: Updater, directory = DEFAULT_DIRECTORY): Promise<CataloguePublicationJob> {
  assertOperationId(id); assertRevision(expectedRevision); if (typeof updater !== 'function') throw new Error('A catalogue publication updater is required.');
  if (directory === DEFAULT_DIRECTORY && dataApiEnabled()) {
    const current = await readPublicationJob(id, directory); if (!current) throw new Error(`Catalogue publication job ${id} was not found.`);
    if (current.revision !== expectedRevision) throw new Error(`Catalogue publication revision conflict: expected ${expectedRevision}, found ${current.revision}.`);
    const proposed = structuredClone(await updater(structuredClone(current)));
    if (current.phase === 'complete') {
      if (!isDeepStrictEqual(proposed, current)) throw new Error('Completed catalogue publication jobs are immutable.');
      return current;
    }
    const now = new Date().toISOString();
    const next = validateJob({ ...proposed, version: 1, operationId: current.operationId, catalogueId: current.catalogueId,
      revision: current.revision + 1, modelFingerprint64: current.modelFingerprint64, previousBundleProductId: current.previousBundleProductId,
      createdAt: current.createdAt, updatedAt: now < current.updatedAt ? current.updatedAt : now }, id);
    assertMonotonic(current, next);
    return validateJob((await replaceRemoteDocument('catalogue-publications', id, expectedRevision, next)).value, id);
  }
  return enqueue(id, directory, () => updateUnlocked(id, expectedRevision, updater, directory));
}

export async function listPublicationJobs(directory = DEFAULT_DIRECTORY): Promise<CataloguePublicationJob[]> {
  if (directory === DEFAULT_DIRECTORY && dataApiEnabled()) {
    return (await remoteDocuments<CataloguePublicationJob>('catalogue-publications')).map((item) => validateJob(item.value, item.key)).sort((left, right) => left.operationId.localeCompare(right.operationId));
  }
  let entries;
  try { entries = await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true }); }
  catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
  const jobs: CataloguePublicationJob[] = [];
  for (const entry of entries) if (entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name)) {
    const job = await readPublicationJob(entry.name.slice(0, -5), directory); if (job) jobs.push(job);
  }
  return jobs.sort((left, right) => left.operationId.localeCompare(right.operationId));
}

export async function createCompletedPublicationEvidence(input: CompletedPublicationEvidenceInput, directory = DEFAULT_DIRECTORY) {
  if (!object(input)) throw new Error('Exact completed publication evidence is required.');
  const existing = await readPublicationJob(String(input.operationId), directory);
  if (existing) {
    const identity = ({ operationId, catalogueId, modelFingerprint64, previousBundleProductId, draftBundleProductId, resolved, bindings, resultFingerprint64 }: CataloguePublicationJob) => (
      { operationId, catalogueId, modelFingerprint64, previousBundleProductId, draftBundleProductId, resolved, bindings, resultFingerprint64 }
    );
    if (existing.phase !== 'complete' || !isDeepStrictEqual(identity(existing), input)) throw new Error(`Catalogue publication evidence ${input.operationId} conflicts.`);
    return existing;
  }
  const now = new Date().toISOString();
  const job = validateJob({ ...input, version: 1, revision: 1, phase: 'complete', createdAt: now, updatedAt: now,
    completedSteps: STEPS.map((name) => ({ name, completedAt: now })) }, input.operationId);
  if (directory === DEFAULT_DIRECTORY && dataApiEnabled()) {
    return validateJob((await createRemoteDocument('catalogue-publications', job.operationId, job)).value, job.operationId);
  }
  await enqueue(job.operationId, directory, () => durableWrite(job, directory, true));
  return structuredClone(job);
}
