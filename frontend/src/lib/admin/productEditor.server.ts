import { createHash } from 'crypto';
import { normalizeProductEditorSpec, type ProductEditorSpec } from './productEditor';
import { fingerprintBundleProduct, normalizeBundleProduct, type NormalizedBundleProduct } from './productBundleState';
import { planProductSave, type ProductImageUpload, type ProductSaveOperation } from './productSavePlan';
import type { ProductCompletedStep, ProductControlRecord, ProductPendingOperation, PendingStepKind } from './productControl.server';

type Row = Record<string, unknown>;
export type ExistingProductUpload = ProductImageUpload & { body: unknown; sha256?: string };
type VerifiedUpload = ProductImageUpload & { body: unknown; sha256: string };
export type ExistingProductSaveRequest = { productId: number; baselineFingerprint: string; spec: unknown; uploads?: ExistingProductUpload[] };
export type ProductSaveUpstream = {
  fetchProduct(productId: number): Promise<unknown>;
  uploadImage(productId: number, upload: VerifiedUpload): Promise<void>;
  createOption(productId: number, choice: Extract<ProductSaveOperation, { kind: 'create-option' }>['choice']): Promise<void>;
  addOptionValues(productId: number, operation: Extract<ProductSaveOperation, { kind: 'add-option-values' }>): Promise<void>;
  createVariants(productId: number, variants: ResolvedCreateVariant[]): Promise<void>;
  updateVariants(productId: number, variants: Extract<ProductSaveOperation, { kind: 'update-variants' }>['variants']): Promise<void>;
  removeImages(productId: number, imageIds: number[]): Promise<void>;
  orderImages(productId: number, imageIds: number[]): Promise<void>;
  updateProduct(productId: number, payload: Extract<ProductSaveOperation, { kind: 'update-product' }>['payload']): Promise<void>;
};
export type ExistingProductSaveDependencies = {
  upstream: ProductSaveUpstream;
  lock<T>(productId: number, action: () => Promise<T>): Promise<T>;
  readControl(productId: number): Promise<ProductControlRecord | null>;
  // The product lock is already held. This must be the deliberately unlocked control writer.
  writeControl(record: ProductControlRecord): Promise<ProductControlRecord>;
  now?: () => string;
};
type ResolvedCreateVariant = { valueKeys: string[]; valueIds: number[]; selections: Array<{ optionId: number; optionName: string; valueId: number; valueLabel: string }>; price: number; inventory: number; sku?: string };
type Step = ProductCompletedStep;

export class ProductSaveError extends Error { constructor(message: string, public status = 422) { super(message); } }
const rows = (value: unknown) => Array.isArray(value) ? value as Row[] : [];
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const ids = (value: unknown) => rows(value).flatMap((item) => id(item.id) ? [item.id] : []);
const own = (value: Row, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const tupleKey = (keys: string[]) => createHash('sha256').update(JSON.stringify(keys)).digest('hex');
const operationId = (productId: number, baseline: string, spec: ProductEditorSpec, uploads: VerifiedUpload[]) => createHash('sha256').update(JSON.stringify({ productId, baseline, spec, uploads: uploads.map(({ key, name, order, sha256 }) => ({ key, name, order, sha256 })) })).digest('hex');
function exact<T>(values: T[], message: string): T { if (values.length !== 1) throw new ProductSaveError(message, 502); return values[0]; }
function options(product: NormalizedBundleProduct) { return rows(product.options); }
function images(product: NormalizedBundleProduct) { return rows(product.images); }
function variants(product: NormalizedBundleProduct) { return rows(product.productVariants); }
function selected(variant: Row) { return new Map(rows(variant.selectedOptions).flatMap((entry) => typeof entry.optionName === 'string' && typeof entry.optionValue === 'string' ? [[entry.optionName, entry.optionValue] as const] : [])); }
const hasVariantRelationships = (product: NormalizedBundleProduct) => variants(product).some((variant) => own(variant, 'selectedOptions') && (!Array.isArray(variant.selectedOptions) || variant.selectedOptions.length > 0));

async function uploadBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (typeof Blob !== 'undefined' && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new ProductSaveError('Each product upload requires a bytes, Blob, ArrayBuffer, or Uint8Array body.', 400);
}
async function verifyUploads(raw: unknown, spec: ProductEditorSpec): Promise<VerifiedUpload[]> {
  if (!Array.isArray(raw)) throw new ProductSaveError('Product uploads must be an array.', 400);
  const verified: VerifiedUpload[] = [];
  const keys = new Set<string>(), orders = new Set(spec.existingImages.filter((image) => !image.remove).map((image) => image.order));
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProductSaveError('Each product upload must be an object.', 400);
    const upload = value as Record<string, unknown>, fields = Reflect.ownKeys(upload);
    if (fields.some((field) => typeof field !== 'string') || !same((fields as string[]).sort(), upload.sha256 === undefined ? ['body', 'key', 'name', 'order'] : ['body', 'key', 'name', 'order', 'sha256'])) throw new ProductSaveError('Each product upload must have exactly key, name, order, body, and optional sha256 fields.', 400);
    if (typeof upload.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(upload.key) || keys.has(upload.key)) throw new ProductSaveError('Each product upload requires a unique stable key.', 400);
    if (typeof upload.name !== 'string' || !upload.name || upload.name.length > 255 || upload.name !== upload.name.trim() || upload.name === '.' || upload.name === '..' || /[\/\\\u0000-\u001f\u007f-\u009f]/.test(upload.name)) throw new ProductSaveError('Each product upload requires a safe filename.', 400);
    if (typeof upload.order !== 'number' || !Number.isSafeInteger(upload.order) || upload.order < 0 || orders.has(upload.order)) throw new ProductSaveError('Each product upload requires a unique nonnegative order.', 400);
    let bytes: Uint8Array;
    try { bytes = await uploadBytes(upload.body); } catch (error) { if (error instanceof ProductSaveError) throw error; throw new ProductSaveError('Product upload body could not be read.', 400); }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (upload.sha256 !== undefined && (typeof upload.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(upload.sha256) || upload.sha256 !== digest)) throw new ProductSaveError('Product upload sha256 does not match its body.', 400);
    keys.add(upload.key); orders.add(upload.order);
    verified.push({ key: upload.key, name: upload.name, order: upload.order, body: bytes, sha256: digest });
  }
  return verified;
}
function valueMaps(spec: ProductEditorSpec) {
  const byKey = new Map<string, { optionId: number; optionName: string; valueId: number; valueLabel: string }>();
  for (const choice of spec.choices) for (const value of choice.values) {
    if (!id(choice.optionId) || !id(value.valueId)) throw new ProductSaveError('Pending product checkpoint has unresolved structure.', 409);
    byKey.set(value.key, { optionId: choice.optionId, optionName: choice.name, valueId: value.valueId, valueLabel: value.label });
  }
  return byKey;
}
function semanticVariants(product: NormalizedBundleProduct, keys: string[], spec: ProductEditorSpec) {
  const map = valueMaps(spec), wanted = keys.map((key) => map.get(key)!);
  return variants(product).filter((variant) => {
    if (!own(variant, 'selectedOptions')) return false;
    const selection = selected(variant);
    return selection.size === wanted.length && wanted.every((item) => selection.get(item.optionName) === item.valueLabel);
  });
}
function applyResolved(spec: ProductEditorSpec, pending: ProductPendingOperation) {
  for (const choice of spec.choices) {
    choice.optionId = choice.optionId ?? pending.resolved.optionIds[choice.key];
    for (const value of choice.values) value.valueId = value.valueId ?? pending.resolved.valueIds[value.key];
  }
  for (const combination of spec.combinations) combination.variantId = combination.variantId ?? pending.resolved.variantIds[tupleKey(combination.valueKeys)];
}
function blankPending(operationIdValue: string, startedAt: string): ProductPendingOperation {
  return { operationId: operationIdValue, startedAt, phase: 'applying', completedSteps: [], resultFingerprint: null, resolved: { optionIds: {}, valueIds: {}, imageIds: {}, variantIds: {} } };
}
const clonePending = (pending: ProductPendingOperation): ProductPendingOperation => structuredClone(pending);
function expectedImageIds(spec: ProductEditorSpec, uploads: VerifiedUpload[], pending: ProductPendingOperation) {
  const result = [...spec.existingImages.filter((x) => !x.remove).map((x) => ({ id: x.imageId, order: x.order })), ...uploads.map((x) => ({ id: pending.resolved.imageIds[x.key], order: x.order }))].sort((a, b) => a.order - b.order).map((x) => x.id);
  if (!result.every(id)) throw new ProductSaveError('Pending product checkpoint has unresolved images.', 409);
  return result as number[];
}
function ensureResolved(spec: ProductEditorSpec, uploads: VerifiedUpload[], pending: ProductPendingOperation) {
  valueMaps(spec); expectedImageIds(spec, uploads, pending);
  if (!spec.combinations.every((combination) => id(combination.variantId))) throw new ProductSaveError('Pending product checkpoint has unresolved variants.', 409);
}
function candidateControl(productId: number, spec: ProductEditorSpec, uploads: VerifiedUpload[], pending: ProductPendingOperation, fingerprint: string, completedAt: string, previous: ProductControlRecord): ProductControlRecord {
  ensureResolved(spec, uploads, pending);
  const values = valueMaps(spec);
  const orderedImages = [...spec.existingImages.filter((x) => !x.remove).map((x) => ({ order: x.order, imageId: x.imageId, assignment: x.assignment })), ...uploads.map((x) => ({ order: x.order, imageId: pending.resolved.imageIds[x.key], assignment: 'all' as const }))].sort((a, b) => a.order - b.order);
  return { version: 1, productId, updatedAt: completedAt, upstreamFingerprint: fingerprint, category: spec.details.category ?? previous.category, optionOrder: spec.choices.map((x) => x.optionId!), valueOrder: Object.fromEntries(spec.choices.map((x) => [String(x.optionId), x.values.map((v) => v.valueId!)])), hiddenValueIds: spec.choices.flatMap((x) => x.values.filter((v) => v.retired).map((v) => v.valueId!)), imageAssignments: orderedImages.map((x) => ({ imageId: x.imageId, valueId: x.assignment === 'all' ? null : values.get(x.assignment)!.valueId })), variantBindings: spec.combinations.map((x) => ({ valueIds: x.valueKeys.map((key) => values.get(key)!.valueId), variantId: x.variantId! })), pendingOperation: null, lastCompletedOperation: { operationId: pending.operationId, resultFingerprint: fingerprint, completedAt } };
}
function verifyFinal(product: NormalizedBundleProduct, spec: ProductEditorSpec, uploads: VerifiedUpload[], pending: ProductPendingOperation, previous: ProductControlRecord) {
  ensureResolved(spec, uploads, pending);
  const authoritativeRelationships = hasVariantRelationships(product);
  if (product.title !== spec.details.title || product.price !== spec.details.price || product.description !== spec.details.description) throw new ProductSaveError('Product save verification failed.', 502);
  if (!same(ids(product.images), expectedImageIds(spec, uploads, pending))) throw new ProductSaveError('Product image verification failed.', 502);
  for (const choice of spec.choices) {
    const option = exact(options(product).filter((x) => x.id === choice.optionId && x.name === choice.name), 'Product structure verification failed.');
    for (const value of choice.values) exact(rows(option.values).filter((x) => x.id === value.valueId && x.value === value.label), 'Product structure verification failed.');
  }
  for (const combination of spec.combinations) {
    const target = exact(variants(product).filter((x) => x.id === combination.variantId), 'Product variant verification failed.');
    if (target.price !== combination.price || target.inventory !== combination.inventory || (target.sku ?? undefined) !== combination.sku) throw new ProductSaveError('Product variant verification failed.', 502);
    if (authoritativeRelationships) {
      const semantic = exact(semanticVariants(product, combination.valueKeys, spec), 'Product variant relationship verification failed.');
      if (semantic.id !== combination.variantId) throw new ProductSaveError('Product variant relationship verification failed.', 502);
    }
  }
  const retiredIds = new Set(spec.choices.flatMap((choice) => choice.values.filter((value) => value.retired).map((value) => value.valueId!)));
  for (const binding of previous.variantBindings.filter((binding) => binding.valueIds.some((valueId) => retiredIds.has(valueId)))) {
    const variant = exact(variants(product).filter((x) => x.id === binding.variantId), 'Retired product variant verification failed.');
    if (variant.inventory !== 0) throw new ProductSaveError('Retired product variant verification failed.', 502);
  }
}
async function safeFetch(upstream: ProductSaveUpstream, productId: number) { try { return normalizeBundleProduct(await upstream.fetchProduct(productId)); } catch { throw new ProductSaveError('Product save could not read Bundle product state.', 502); } }
async function safeRead(dependencies: ExistingProductSaveDependencies, productId: number) { try { return await dependencies.readControl(productId); } catch { throw new ProductSaveError('Product save could not read local control state.', 503); } }
async function safeMutation(kind: string, action: () => Promise<void>) { try { await action(); } catch { throw new ProductSaveError(`Product save could not complete ${kind}.`, 502); } }
function descriptor(index: number, kind: PendingStepKind, itemKey?: string): Step { return itemKey === undefined ? { index, kind } : { index, kind, itemKey }; }
function buildSteps(spec: ProductEditorSpec, uploads: VerifiedUpload[], control: ProductControlRecord): Step[] {
  const steps: Step[] = [];
  const add = (kind: PendingStepKind, itemKey?: string) => steps.push(descriptor(steps.length, kind, itemKey));
  uploads.forEach((upload) => add('upload-images', upload.key));
  spec.choices.filter((choice) => !id(choice.optionId)).forEach((choice) => add('create-option', choice.key));
  spec.choices.filter((choice) => id(choice.optionId) && choice.values.some((value) => !id(value.valueId) && !value.retired)).forEach((choice) => add('add-option-values', choice.key));
  spec.combinations.filter((combination) => !id(combination.variantId)).forEach((combination) => add('create-variants', tupleKey(combination.valueKeys)));
  const updateIds: number[] = [];
  for (const combination of spec.combinations) if (id(combination.variantId) && !updateIds.includes(combination.variantId)) updateIds.push(combination.variantId);
  const retired = new Set(spec.choices.flatMap((choice) => choice.values.filter((value) => value.retired && id(value.valueId)).map((value) => value.valueId!)));
  for (const binding of control.variantBindings) if (binding.valueIds.some((valueId) => retired.has(valueId)) && !updateIds.includes(binding.variantId)) updateIds.push(binding.variantId);
  updateIds.forEach((variantId) => add('update-variants', String(variantId)));
  if (spec.existingImages.some((image) => image.remove)) add('remove-images');
  if (uploads.length || spec.existingImages.some((image) => image.remove) || !same(control.imageAssignments.map((image) => image.imageId), spec.existingImages.filter((image) => !image.remove).sort((a, b) => a.order - b.order).map((image) => image.imageId))) add('order-images');
  add('update-control');
  add('update-product');
  return steps;
}
function assertCheckpointPrefix(pending: ProductPendingOperation, steps: Step[]) {
  if (pending.completedSteps.length > steps.length || pending.completedSteps.some((step, index) => !same(step, steps[index]))) throw new ProductSaveError('Pending product checkpoint is impossible for this save request.', 409);
}

export async function saveExistingProduct(request: ExistingProductSaveRequest, dependencies: ExistingProductSaveDependencies) {
  if (!id(request.productId) || !/^[a-f0-9]{64}$/.test(request.baselineFingerprint)) throw new ProductSaveError('A valid product save request is required.', 400);
  let spec: ProductEditorSpec;
  try { spec = normalizeProductEditorSpec(request.spec); } catch { throw new ProductSaveError('A valid product save request is required.', 400); }
  const uploads = await verifyUploads(request.uploads === undefined ? [] : request.uploads, spec);
  const opId = operationId(request.productId, request.baselineFingerprint, spec, uploads), now = dependencies.now || (() => new Date().toISOString());

  return dependencies.lock(request.productId, async () => {
    let current = await safeFetch(dependencies.upstream, request.productId);
    const initialFingerprint = fingerprintBundleProduct(current);
    const control = await safeRead(dependencies, request.productId);
    if (!control) throw new ProductSaveError('Product control state is missing.', 409);

    if (control.lastCompletedOperation?.operationId === opId && control.lastCompletedOperation.resultFingerprint === initialFingerprint) {
      return { changed: true, recovered: true, product: current, fingerprint: initialFingerprint };
    }

    let pending = control.pendingOperation ? clonePending(control.pendingOperation) : null;
    if (pending && pending.operationId !== opId) throw new ProductSaveError('A different product save is pending.', 409);
    if (pending && request.baselineFingerprint !== control.upstreamFingerprint) throw new ProductSaveError('Pending product checkpoint has a bogus baseline.', 409);
    const originalSpec = structuredClone(spec);
    const steps = buildSteps(originalSpec, uploads, control);
    if (pending) assertCheckpointPrefix(pending, steps);

    const writePending = async (next: ProductPendingOperation, message = 'Product save could not persist local checkpoint.') => {
      try { await dependencies.writeControl({ ...control, updatedAt: now(), pendingOperation: next }); pending = clonePending(next); } catch { throw new ProductSaveError(message, 503); }
    };
    const completed = (step: Step) => pending!.completedSteps.some((value) => same(value, step));
    const checkpoint = async (step: Step, update?: (next: ProductPendingOperation) => void) => {
      const next = clonePending(pending!); if (update) update(next);
      if (!completed(step)) next.completedSteps.push(step);
      const expected = steps[next.completedSteps.length - 1];
      if (!same(step, expected)) throw new ProductSaveError('Product save attempted an out-of-order checkpoint.', 409);
      await writePending(next);
    };
    const reload = async () => { current = await safeFetch(dependencies.upstream, request.productId); };

    if (!pending) {
      if (request.baselineFingerprint !== initialFingerprint) throw new ProductSaveError('This product changed; reload before saving.', 409);
      if (control.upstreamFingerprint !== initialFingerprint) throw new ProductSaveError('Product control fingerprint does not match Bundle.', 409);
      let plan: ProductSaveOperation[];
      try { plan = planProductSave({ current, control, spec, uploads }); } catch { throw new ProductSaveError('Product save request conflicts with verified Bundle state.', 422); }
      if (!plan.length) return { changed: false, product: current, fingerprint: initialFingerprint };
      pending = blankPending(opId, now());
      await writePending(pending, 'Product save could not persist local control.');
    } else {
      applyResolved(spec, pending);
      if (pending.phase === 'bundle-complete') {
        if (pending.resultFingerprint !== initialFingerprint) throw new ProductSaveError('Pending completion checkpoint fingerprint does not match Bundle.', 409);
        verifyFinal(current, spec, uploads, pending, control);
        const final = candidateControl(request.productId, spec, uploads, pending, initialFingerprint, now(), control);
        try { await dependencies.writeControl(final); } catch { throw new ProductSaveError('Bundle save completed, but local control could not be committed.', 503); }
        return { changed: true, recovered: true, product: current, fingerprint: initialFingerprint };
      }
    }

    let cursor = 0;
    for (const upload of uploads) {
      const step = steps[cursor++]; if (completed(step)) continue;
      const accounted = new Set([...control.imageAssignments.map((x) => x.imageId), ...Object.values(pending!.resolved.imageIds)]);
      let candidates = images(current).filter((x) => id(x.id) && !accounted.has(x.id));
      if (candidates.length > 1) throw new ProductSaveError('Pending upload is ambiguous; expected exactly one new image.', 502);
      if (!candidates.length) { await safeMutation(`upload:${upload.key}`, () => dependencies.upstream.uploadImage(request.productId, upload)); await reload(); candidates = images(current).filter((x) => id(x.id) && !accounted.has(x.id)); }
      const image = exact(candidates, 'Each upload must produce exactly one new image ID.');
      await checkpoint(step, (next) => { next.resolved.imageIds[upload.key] = image.id as number; });
    }

    for (const choice of originalSpec.choices.filter((x) => !id(x.optionId))) {
      const step = steps[cursor++]; if (completed(step)) continue;
      let candidates = options(current).filter((x) => x.name === choice.name && id(x.id) && !control.optionOrder.includes(x.id));
      if (candidates.length > 1) throw new ProductSaveError(`Option resolution for ${choice.name} is ambiguous.`, 502);
      if (!candidates.length) { await safeMutation(`create-option:${choice.key}`, () => dependencies.upstream.createOption(request.productId, { choiceKey: choice.key, name: choice.name, values: choice.values.filter((v) => !v.retired).map((v) => ({ valueKey: v.key, label: v.label })) })); await reload(); candidates = options(current).filter((x) => x.name === choice.name && id(x.id) && !control.optionOrder.includes(x.id)); }
      const option = exact(candidates, `Expected exactly one new option named ${choice.name}.`);
      const resolvedValues = new Map<string, number>();
      for (const value of choice.values.filter((v) => !v.retired)) resolvedValues.set(value.key, exact(rows(option.values).filter((x) => x.value === value.label && id(x.id)), `Expected exactly one value named ${value.label}.`).id as number);
      await checkpoint(step, (next) => { next.resolved.optionIds[choice.key] = option.id as number; for (const [key, valueId] of Array.from(resolvedValues.entries())) next.resolved.valueIds[key] = valueId; }); applyResolved(spec, pending!);
    }

    for (const choice of originalSpec.choices.filter((x) => id(x.optionId) && x.values.some((v) => !id(v.valueId) && !v.retired))) {
      const step = steps[cursor++]; if (completed(step)) continue;
      const unresolved = choice.values.filter((v) => !id(v.valueId) && !v.retired);
      const option = exact(options(current).filter((x) => x.id === choice.optionId), 'Existing option disappeared during save.');
      const found = new Map<string, number>();
      for (const value of unresolved) { const matches = rows(option.values).filter((x) => x.value === value.label && id(x.id)); if (matches.length > 1) throw new ProductSaveError(`Value resolution for ${value.label} is ambiguous.`, 502); if (matches.length === 1) found.set(value.key, matches[0].id as number); }
      const missing = unresolved.filter((v) => !found.has(v.key));
      if (missing.length) { await safeMutation(`add-values:${choice.key}`, () => dependencies.upstream.addOptionValues(request.productId, { kind: 'add-option-values', scope: 'bundle', optionId: choice.optionId!, choiceKey: choice.key, values: missing.map((v) => ({ valueKey: v.key, label: v.label })) })); await reload(); }
      const after = exact(options(current).filter((x) => x.id === choice.optionId), 'Existing option disappeared during save.');
      for (const value of unresolved) found.set(value.key, exact(rows(after.values).filter((x) => x.value === value.label && id(x.id)), `Expected exactly one value named ${value.label}.`).id as number);
      await checkpoint(step, (next) => { for (const [key, valueId] of Array.from(found.entries())) next.resolved.valueIds[key] = valueId; }); applyResolved(spec, pending!);
    }

    applyResolved(spec, pending!);
    for (const combination of originalSpec.combinations.filter((x) => !id(x.variantId))) {
      const key = tupleKey(combination.valueKeys), step = steps[cursor++]; if (completed(step)) continue;
      const accounted = new Set([...control.variantBindings.map((x) => x.variantId), ...Object.values(pending!.resolved.variantIds)]);
      const authoritativeRelationships = hasVariantRelationships(current);
      const allSemantic = semanticVariants(current, combination.valueKeys, spec);
      if (allSemantic.length > 1) throw new ProductSaveError(`Variant resolution for ${key} is ambiguous.`, 502);
      if (allSemantic.length === 1 && accounted.has(allSemantic[0].id as number)) throw new ProductSaveError(`Variant resolution for ${key} conflicts with an existing controlled variant.`, 502);
      let semantic = allSemantic.filter((x) => id(x.id) && !accounted.has(x.id));
      let candidate: Row | undefined = semantic[0];
      if (!candidate && authoritativeRelationships && variants(current).some((x) => id(x.id) && !accounted.has(x.id))) throw new ProductSaveError(`Variant relationship resolution for ${key} is malformed.`, 502);
      if (!candidate && !authoritativeRelationships) {
        const anonymous = variants(current).filter((x) => id(x.id) && !accounted.has(x.id) && (!own(x, 'selectedOptions') || Array.isArray(x.selectedOptions) && x.selectedOptions.length === 0));
        if (anonymous.length > 1) throw new ProductSaveError(`Variant resolution for ${key} is ambiguous.`, 502);
        candidate = anonymous[0];
      }
      if (!candidate) {
        const before = new Set(ids(current.productVariants)), map = valueMaps(spec);
        const resolved: ResolvedCreateVariant = { valueKeys: combination.valueKeys, valueIds: combination.valueKeys.map((x) => map.get(x)!.valueId), selections: combination.valueKeys.map((x) => map.get(x)!), price: combination.price, inventory: combination.inventory, ...(combination.sku === undefined ? {} : { sku: combination.sku }) };
        await safeMutation(`create-variant:${JSON.stringify(combination.valueKeys)}`, () => dependencies.upstream.createVariants(request.productId, [resolved])); await reload();
        const created = variants(current).filter((x) => id(x.id) && !before.has(x.id));
        candidate = exact(created, `Expected exactly one newly-created variant for ${key}.`);
        if (hasVariantRelationships(current)) {
          semantic = semanticVariants(current, combination.valueKeys, spec);
          const exactSemantic = exact(semantic, `Variant resolution for ${key} is ambiguous.`);
          if (exactSemantic.id !== candidate.id) throw new ProductSaveError(`Variant resolution for ${key} is ambiguous.`, 502);
        }
      }
      await checkpoint(step, (next) => { next.resolved.variantIds[key] = candidate!.id as number; }); applyResolved(spec, pending!);
    }

    const createdIds = new Set(Object.values(pending!.resolved.variantIds));
    const retiredIds = new Set(spec.choices.flatMap((choice) => choice.values.filter((value) => value.retired).map((value) => value.valueId!)));
    const updateIds: number[] = [];
    for (const combination of originalSpec.combinations) if (id(combination.variantId) && !updateIds.includes(combination.variantId)) updateIds.push(combination.variantId);
    for (const binding of control.variantBindings) if (binding.valueIds.some((valueId) => retiredIds.has(valueId)) && !updateIds.includes(binding.variantId)) updateIds.push(binding.variantId);
    for (const variantId of updateIds) {
      const step = steps[cursor++]; if (completed(step)) continue;
      const target = exact(variants(current).filter((x) => x.id === variantId), 'Product variant disappeared during save.');
      const combination = spec.combinations.find((x) => x.variantId === variantId);
      const patch: { variantId: number; price?: number; inventory?: number; sku?: string | null } = { variantId };
      if (combination && !createdIds.has(variantId)) { if (target.price !== combination.price) patch.price = combination.price; if (target.inventory !== combination.inventory) patch.inventory = combination.inventory; if ((target.sku ?? undefined) !== combination.sku) patch.sku = combination.sku ?? null; }
      if (control.variantBindings.some((binding) => binding.variantId === variantId && binding.valueIds.some((valueId) => retiredIds.has(valueId))) && target.inventory !== 0) patch.inventory = 0;
      const matches = (row: Row) => Object.entries(patch).every(([field, value]) => field === 'variantId' ? row.id === value : row[field] === value);
      if (!matches(target)) { await safeMutation(`update-variant:${variantId}`, () => dependencies.upstream.updateVariants(request.productId, [patch])); await reload(); }
      if (!matches(exact(variants(current).filter((x) => x.id === variantId), 'Product variant disappeared during save.'))) throw new ProductSaveError('Product variant update verification failed.', 502);
      await checkpoint(step);
    }

    const removeIds = spec.existingImages.filter((x) => x.remove).map((x) => x.imageId);
    if (removeIds.length) { const step = steps[cursor++]; if (!completed(step)) { if (removeIds.some((imageId) => ids(current.images).includes(imageId))) { await safeMutation('remove-images', () => dependencies.upstream.removeImages(request.productId, removeIds)); await reload(); } if (removeIds.some((imageId) => ids(current.images).includes(imageId))) throw new ProductSaveError('Product image removal verification failed.', 502); await checkpoint(step); } }
    const orderNeeded = uploads.length || removeIds.length || !same(control.imageAssignments.map((x) => x.imageId), spec.existingImages.filter((x) => !x.remove).sort((a, b) => a.order - b.order).map((x) => x.imageId));
    if (orderNeeded) { const step = steps[cursor++]; if (!completed(step)) { const desired = expectedImageIds(spec, uploads, pending!); if (!same(ids(current.images), desired)) { await safeMutation('order-images', () => dependencies.upstream.orderImages(request.productId, desired)); await reload(); } if (!same(ids(current.images), desired)) throw new ProductSaveError('Product image order verification failed.', 502); await checkpoint(step); } }

    { const step = steps[cursor++]; if (!completed(step)) await checkpoint(step); }
    { const step = steps[cursor++]; if (!completed(step)) { const payload: Extract<ProductSaveOperation, { kind: 'update-product' }>['payload'] = {}; if (current.title !== spec.details.title) payload.title = spec.details.title; if (current.price !== spec.details.price) payload.price = spec.details.price; if (current.description !== spec.details.description) payload.description = spec.details.description; if (Object.keys(payload).length) { await safeMutation('update-product', () => dependencies.upstream.updateProduct(request.productId, payload)); await reload(); } if (current.title !== spec.details.title || current.price !== spec.details.price || current.description !== spec.details.description) throw new ProductSaveError('Product metadata verification failed.', 502); await checkpoint(step); } }

    if (cursor !== steps.length) throw new ProductSaveError('Product save planner/checkpoint order disagreed.', 409);
    applyResolved(spec, pending!); verifyFinal(current, spec, uploads, pending!, control);
    const fingerprint = fingerprintBundleProduct(current), bundleComplete = clonePending(pending!); bundleComplete.phase = 'bundle-complete'; bundleComplete.resultFingerprint = fingerprint;
    await writePending(bundleComplete, 'Bundle save completed, but completion checkpoint could not be persisted.');
    const final = candidateControl(request.productId, spec, uploads, bundleComplete, fingerprint, now(), control);
    try { await dependencies.writeControl(final); } catch { throw new ProductSaveError('Bundle save completed, but local control could not be committed.', 503); }
    return { changed: true, recovered: control.pendingOperation !== null, product: current, fingerprint };
  });
}
