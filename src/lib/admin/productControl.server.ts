import { chmod, mkdir, open, readFile, rename, unlink } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { createRemoteDocument, dataApiEnabled, remoteDocument, replaceRemoteDocument, withRemoteLease } from '../dataApiClient.server';

export type ProductImageAssignment = { imageId: number; valueId: number | null };
export type ProductVariantBinding = { valueIds: number[]; variantId: number };
export type PendingStepKind =
  | 'upload-images'
  | 'create-option'
  | 'add-option-values'
  | 'create-variants'
  | 'update-variants'
  | 'remove-images'
  | 'order-images'
  | 'update-control'
  | 'update-product';
export type ProductCompletedStep = { index: number; kind: PendingStepKind; itemKey?: string };
export type ProductPendingOperation = {
  operationId: string;
  startedAt: string;
  phase: 'applying' | 'bundle-complete';
  completedSteps: ProductCompletedStep[];
  resultFingerprint: string | null;
  resolved: {
    optionIds: Record<string, number>;
    valueIds: Record<string, number>;
    imageIds: Record<string, number>;
    variantIds: Record<string, number>;
  };
};
export type ProductControlRecord = {
  version: 1;
  productId: number;
  updatedAt: string;
  upstreamFingerprint: string;
  category: string | null;
  optionOrder: number[];
  valueOrder: Record<string, number[]>;
  hiddenValueIds: number[];
  imageAssignments: ProductImageAssignment[];
  variantBindings: ProductVariantBinding[];
  pendingOperation: ProductPendingOperation | null;
  lastCompletedOperation: null | {
    operationId: string;
    resultFingerprint: string;
    completedAt: string;
  };
};

export const PRODUCT_CONTROL_DIRECTORY = path.join(process.cwd(), '.data', 'product-control');
const queues = new Map<string, Promise<void>>();
const keys = ['version', 'productId', 'updatedAt', 'upstreamFingerprint', 'category', 'optionOrder', 'valueOrder', 'hiddenValueIds', 'imageAssignments', 'variantBindings', 'pendingOperation', 'lastCompletedOperation'].sort();
const pendingKeys = ['operationId', 'startedAt', 'phase', 'completedSteps', 'resultFingerprint', 'resolved'].sort();
const resolvedKeys = ['optionIds', 'valueIds', 'imageIds', 'variantIds'].sort();
const completedOperationKeys = ['operationId', 'resultFingerprint', 'completedAt'].sort();
const stepKinds: PendingStepKind[] = ['upload-images', 'create-option', 'add-option-values', 'create-variants', 'update-variants', 'remove-images', 'order-images', 'update-control', 'update-product'];
const stepKindSet = new Set<string>(stepKinds);
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const corrupt = (productId: number) => new Error(`Product control storage for product ${productId} is corrupt.`);
const fileFor = (productId: number, directory: string) => path.join(directory, `${productId}.json`);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isTimestamp = (value: unknown): value is string => typeof value === 'string' && (() => { try { return new Date(value).toISOString() === value; } catch { return false; } })();
const unique = (values: number[]) => new Set(values).size === values.length;
const stableKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function validCompletedStep(value: unknown): value is ProductCompletedStep {
  if (!isObject(value)) return false;
  const expectedKeys = Object.prototype.hasOwnProperty.call(value, 'itemKey')
    ? ['index', 'itemKey', 'kind']
    : ['index', 'kind'];
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys)
    && typeof value.index === 'number' && Number.isSafeInteger(value.index) && value.index >= 0
    && typeof value.kind === 'string' && stepKindSet.has(value.kind)
    && (!Object.prototype.hasOwnProperty.call(value, 'itemKey') || stableKey(value.itemKey));
}

function validCompletedOperation(value: unknown): value is NonNullable<ProductControlRecord['lastCompletedOperation']> {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(completedOperationKeys)
    && hash(value.operationId)
    && hash(value.resultFingerprint)
    && isTimestamp(value.completedAt);
}

function validResolvedMap(value: unknown): value is Record<string, number> {
  return isObject(value) && Object.entries(value).every(([key, id]) => stableKey(key) && validId(id));
}

function validResolved(value: unknown): value is ProductPendingOperation['resolved'] {
  return isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(resolvedKeys)
    && resolvedKeys.every((key) => validResolvedMap(value[key]));
}

function assertId(productId: unknown): asserts productId is number {
  if (!validId(productId)) throw new Error('A valid product ID is required.');
}

function validateRecord(value: unknown, expectedProductId?: number): ProductControlRecord {
  if (!isObject(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) throw new Error('A valid product control record is required.');
  if (value.version !== 1 || !validId(value.productId) || (expectedProductId !== undefined && value.productId !== expectedProductId)) throw new Error('A valid product control record is required.');
  if (!isTimestamp(value.updatedAt) || !hash(value.upstreamFingerprint) || (value.category !== null && typeof value.category !== 'string')) throw new Error('A valid product control record is required.');
  if (!Array.isArray(value.optionOrder) || !value.optionOrder.every(validId) || !unique(value.optionOrder)) throw new Error('A valid product control record is required.');
  if (!isObject(value.valueOrder) || Object.keys(value.valueOrder).length !== value.optionOrder.length) throw new Error('A valid product control record is required.');
  const optionKeys = new Set(value.optionOrder.map(String));
  const allValueIds: number[] = [];
  const valueOptionIds = new Map<number, string>();
  for (const [optionId, rawIds] of Object.entries(value.valueOrder)) {
    if (!optionKeys.has(optionId) || !Array.isArray(rawIds) || !rawIds.every(validId) || !unique(rawIds)) throw new Error('A valid product control record is required.');
    allValueIds.push(...rawIds);
    for (const valueId of rawIds) valueOptionIds.set(valueId, optionId);
  }
  if (!unique(allValueIds)) throw new Error('A valid product control record is required.');
  const valueIds = new Set(allValueIds);
  if (!Array.isArray(value.hiddenValueIds) || !value.hiddenValueIds.every(validId) || !unique(value.hiddenValueIds) || value.hiddenValueIds.some((id) => !valueIds.has(id))) throw new Error('A valid product control record is required.');
  if (!Array.isArray(value.imageAssignments)) throw new Error('A valid product control record is required.');
  const imageIds: number[] = [];
  for (const item of value.imageAssignments) {
    if (!isObject(item) || Object.keys(item).sort().join() !== 'imageId,valueId' || !validId(item.imageId) || (item.valueId !== null && (!validId(item.valueId) || !valueIds.has(item.valueId)))) throw new Error('A valid product control record is required.');
    imageIds.push(item.imageId);
  }
  if (!unique(imageIds)) throw new Error('A valid product control record is required.');
  if (!Array.isArray(value.variantBindings)) throw new Error('A valid product control record is required.');
  const bindingKeys = new Set<string>(), variantIds: number[] = [];
  for (const item of value.variantBindings) {
    if (!isObject(item) || Object.keys(item).sort().join() !== 'valueIds,variantId' || !Array.isArray(item.valueIds) || !item.valueIds.every(validId) || !unique(item.valueIds) || item.valueIds.some((id) => !valueIds.has(id)) || !validId(item.variantId)) throw new Error('A valid product control record is required.');
    if (item.valueIds.length !== value.optionOrder.length || new Set(item.valueIds.map((id) => valueOptionIds.get(id))).size !== value.optionOrder.length) throw new Error('A valid product control record is required.');
    const key = [...item.valueIds].sort((a, b) => a - b).join(':');
    if (bindingKeys.has(key)) throw new Error('A valid product control record is required.');
    bindingKeys.add(key); variantIds.push(item.variantId);
  }
  if (!unique(variantIds)) throw new Error('A valid product control record is required.');
  if (value.pendingOperation !== null) {
    const pending = value.pendingOperation;
    if (!isObject(pending) || JSON.stringify(Object.keys(pending).sort()) !== JSON.stringify(pendingKeys)
      || !hash(pending.operationId)
      || !isTimestamp(pending.startedAt) || (pending.phase !== 'applying' && pending.phase !== 'bundle-complete')
      || !Array.isArray(pending.completedSteps) || !pending.completedSteps.every(validCompletedStep)
      || new Set(pending.completedSteps.map((step) => JSON.stringify([step.index, step.kind, step.itemKey ?? null]))).size !== pending.completedSteps.length
      || (pending.phase === 'applying' ? pending.resultFingerprint !== null : !hash(pending.resultFingerprint))
      || !validResolved(pending.resolved)) throw new Error('A valid product control record is required.');
  }
  if (value.lastCompletedOperation !== null && !validCompletedOperation(value.lastCompletedOperation)) throw new Error('A valid product control record is required.');
  return value as ProductControlRecord;
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
export type ProductControlOpen = (file: string, flags: string, mode?: number) => Promise<SyncHandle>;
const defaultOpen: ProductControlOpen = (file, flags, mode) => open(file, flags, mode);

async function atomicWriteProductControl(
  record: ProductControlRecord,
  directory: string,
  openFile: ProductControlOpen = defaultOpen,
) {
  await secureDirectory(directory);
  const file = fileFor(record.productId, directory), temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const tempHandle = await openFile(temp, 'wx', 0o600);
    try {
      await tempHandle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }
    await rename(temp, file);
    await chmod(file, 0o600);
    const directoryHandle = await openFile(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (reason) {
    try { await unlink(temp); } catch { /* best effort cleanup */ }
    throw reason;
  }
}

// Ponytail: this in-process lock is correct only for the current single PM2 worker; it must be replaced before clustering.
export function withProductLock<T>(productId: number, action: () => Promise<T>, directory = PRODUCT_CONTROL_DIRECTORY): Promise<T> {
  assertId(productId);
  if (typeof action !== 'function') throw new Error('A product action is required.');
  if(directory===PRODUCT_CONTROL_DIRECTORY&&dataApiEnabled())return withRemoteLease(`product-control-${productId}`,action);
  const key = fileFor(productId, directory), previous = queues.get(key) || Promise.resolve();
  const result = previous.then(action, action), settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}

export async function readProductControl(productId: number, directory = PRODUCT_CONTROL_DIRECTORY): Promise<ProductControlRecord | null> {
  assertId(productId);
  if(directory===PRODUCT_CONTROL_DIRECTORY&&dataApiEnabled()){const document=await remoteDocument<ProductControlRecord>('product-control',String(productId));return document?structuredClone(validateRecord(document.value,productId)):null;}
  try {
    await secureDirectory(directory);
    const file = fileFor(productId, directory);
    const raw = await readFile(file, 'utf8');
    await chmod(file, 0o600);
    return validateRecord(JSON.parse(raw), productId);
  } catch (reason: any) {
    if (reason?.code === 'ENOENT') return null;
    throw corrupt(productId);
  }
}

export async function writeProductControl(
  record: ProductControlRecord,
  directory = PRODUCT_CONTROL_DIRECTORY,
  openFile: ProductControlOpen = defaultOpen,
): Promise<ProductControlRecord> {
  let valid: ProductControlRecord;
  try { valid = validateRecord(record); } catch { throw new Error('A valid product control record is required.'); }
  return withProductLock(valid.productId, async () => { if(directory===PRODUCT_CONTROL_DIRECTORY&&dataApiEnabled())await writeRemoteProductControl(valid);else await atomicWriteProductControl(valid, directory, openFile); return valid; }, directory);
}

// Only call while already inside withProductLock for this product; this writer deliberately does not acquire the non-reentrant lock.
export async function writeProductControlUnlocked(
  record: ProductControlRecord,
  directory = PRODUCT_CONTROL_DIRECTORY,
  openFile: ProductControlOpen = defaultOpen,
): Promise<ProductControlRecord> {
  let valid: ProductControlRecord;
  try { valid = validateRecord(record); } catch { throw new Error('A valid product control record is required.'); }
  if(directory===PRODUCT_CONTROL_DIRECTORY&&dataApiEnabled())await writeRemoteProductControl(valid);else await atomicWriteProductControl(valid, directory, openFile);
  return valid;
}

async function writeRemoteProductControl(record:ProductControlRecord){const key=String(record.productId),current=await remoteDocument<ProductControlRecord>('product-control',key);if(current)await replaceRemoteDocument('product-control',key,current.revision,record,{revision:current.revision+1,createdAt:current.createdAt,updatedAt:record.updatedAt});else await createRemoteDocument('product-control',key,record,{revision:1,createdAt:record.updatedAt,updatedAt:record.updatedAt});}
