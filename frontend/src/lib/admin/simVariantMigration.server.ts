import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fingerprintBundleProduct } from "./productBundleState";
import {
  defaultSimVariantMigrationStore,
  type SimToneVariantBinding,
  type SimVariantMigrationJob,
  type SimVariantMigrationStore,
} from "./simVariantMigrationStore.server";

type Row = Record<string, any>;
type ProductId = 39 | 40;
type Label = "Tone Excel" | "Tone Plus";
export const SIM_TONE_VARIANT_PLAN = {
  39: {
    title: "SUPERLITE SIM",
    slug: "superlite-sim",
    optionId: 36,
    legacyValueId: 71,
    legacyVariantId: 106,
    legacySku: "SIM-SUPERLITE",
    imageId: 192,
    expectedInventory: 87,
    variants: [
      { label: "Tone Excel" as const, inventory: 44 },
      { label: "Tone Plus" as const, inventory: 43 },
    ],
  },
  40: {
    title: "BIZ SIM",
    slug: "biz-sim",
    optionId: 37,
    legacyValueId: 72,
    legacyVariantId: 107,
    legacySku: "SIM-BIZ",
    imageId: 193,
    expectedInventory: 90,
    variants: [
      { label: "Tone Excel" as const, inventory: 45 },
      { label: "Tone Plus" as const, inventory: 45 },
    ],
  },
} as const;
export type SimVariantProjectionChange = {
  mode: "activate" | "restore";
  productId: ProductId;
  expectedSourceFingerprint: string;
  providerFingerprint?: string;
  optionId: number;
  optionName: "Variant";
  legacyValueId: number;
  legacyVariantId: number;
  variants: Array<{
    label: Label;
    valueKey: "tone-excel" | "tone-plus";
    valueId: number;
    variantId: number;
    sku: string;
    price: number;
    inventory: number;
  }>;
  before?: unknown;
};
export type SimVariantMigrationDependencies = {
  checkpoints?: SimVariantMigrationStore;
  readProduct(id: ProductId): Promise<unknown>;
  updateOptionValues(
    id: ProductId,
    optionId: number,
    change: { name: "Pack"; values: Array<{ value: string }> },
  ): Promise<void>;
  createVariant(id: ProductId, optionName: "Pack", label: Label): Promise<void>;
  updateOption(
    id: ProductId,
    optionId: number,
    change: { name: "Pack" | "Variant" },
  ): Promise<void>;
  updateVariants(
    id: ProductId,
    rows: Array<{ id: number; sku: string; price: number; inventory: number }>,
  ): Promise<void>;
  synchronizeProjection(change: SimVariantProjectionChange): Promise<void>;
  verifyProjection(change: SimVariantProjectionChange): Promise<void>;
};
export class SimVariantMigrationError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "SimVariantMigrationError";
  }
}
const object = (value: unknown): value is Row =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const canonical = (value: any): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : object(value)
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const unwrap = (value: unknown) =>
  object(value) && object(value.data) ? value.data : value;
const row = (value: unknown) => {
  const result = unwrap(value);
  if (!object(result))
    throw new SimVariantMigrationError(
      "SIM provider readback is invalid.",
      502,
    );
  return result;
};
const variants = (product: Row) =>
  Array.isArray(product.productVariants)
    ? product.productVariants.filter(object)
    : Array.isArray(product.variants)
      ? product.variants.filter(object)
      : [];
const option = (product: Row) =>
  Array.isArray(product.options) &&
  product.options.length === 1 &&
  object(product.options[0])
    ? product.options[0]
    : null;
const values = (product: Row) => {
  const current = option(product);
  return current && Array.isArray(current.values)
    ? current.values.filter(object)
    : [];
};
const images = (product: Row) =>
  Array.isArray(product.images)
    ? product.images
        .filter(object)
        .map((image) => ({
          id: image.id,
          url: image.url,
          order: image.order,
          sha256: image.sha256,
        }))
    : [];
const ids = (items: Row[]) => new Set(items.map((item) => item.id));
const added = (before: Set<unknown>, after: Set<unknown>) =>
  Array.from(after).filter((id) => !before.has(id));
export function fingerprintSimToneVariantProduct(value: unknown) {
  try {
    return fingerprintBundleProduct(value);
  } catch {
    throw new SimVariantMigrationError(
      "SIM provider readback cannot be fingerprinted.",
      502,
    );
  }
}

function assertBase(product: Row, id: ProductId, expectedImages?: unknown) {
  const plan = SIM_TONE_VARIANT_PLAN[id],
    legacy = variants(product).find((item) => item.id === plan.legacyVariantId),
    currentOption = option(product),
    standard = values(product).find((item) => item.id === plan.legacyValueId);
  if (
    product.id !== id ||
    product.name !== plan.title ||
    product.title !== plan.title ||
    product.slug !== plan.slug ||
    product.type !== "MERCHANDISE" ||
    product.requiresSimAssignment !== true ||
    product.tracksInventory !== true ||
    product.deletedAt != null ||
    !legacy ||
    legacy.productId !== id ||
    legacy.sku !== plan.legacySku ||
    !currentOption ||
    currentOption.id !== plan.optionId ||
    !["Pack", "Variant"].includes(currentOption.name) ||
    standard?.value !== "Standard" ||
    images(product).length !== 1 ||
    images(product)[0].id !== plan.imageId
  )
    throw new SimVariantMigrationError(
      "Locked SIM product, historical variant, option, or media identity drifted.",
    );
  if (expectedImages && !isDeepStrictEqual(images(product), expectedImages))
    throw new SimVariantMigrationError(
      "SIM image IDs, URLs, order, or digests changed.",
      502,
    );
  return { legacy, currentOption };
}
function assertInitial(product: Row, id: ProductId) {
  const { legacy, currentOption } = assertBase(product, id),
    plan = SIM_TONE_VARIANT_PLAN[id];
  if (
    currentOption.name !== "Pack" ||
    values(product).length !== 1 ||
    variants(product).length !== 1 ||
    Number(legacy.inventory) !== plan.expectedInventory
  )
    throw new SimVariantMigrationError(
      `SIM migration requires exact untouched inventory ${plan.expectedInventory} before mutation.`,
    );
}
function bindingIn(product: Row, binding: SimToneVariantBinding) {
  return (
    values(product).some(
      (value) => value.id === binding.valueId && value.value === binding.label,
    ) &&
    variants(product).some(
      (variant) =>
        variant.id === binding.variantId && variant.sku === binding.sku,
    )
  );
}
function recoveryBinding(
  product: Row,
  before: Row,
  id: ProductId,
  bindings: SimToneVariantBinding[],
  target: (typeof SIM_TONE_VARIANT_PLAN)[ProductId]["variants"][number],
) {
  const plan = SIM_TONE_VARIANT_PLAN[id],
    index = plan.variants.findIndex((item) => item.label === target.label),
    sequential =
      index === bindings.length &&
      bindings.every((binding, bindingIndex) =>
        binding.label === plan.variants[bindingIndex]?.label &&
        bindingIn(product, binding),
      ),
    targetValues = values(product).filter((item) => item.value === target.label),
    beforeIds = ids(variants(before)),
    boundIds = new Set(bindings.map((binding) => binding.variantId)),
    unbound = variants(product).filter(
      (item) => !beforeIds.has(item.id) && !boundIds.has(item.id),
    );
  if (!unbound.length) return null;
  if (
    !sequential ||
    targetValues.length !== 1 ||
    !Number.isSafeInteger(targetValues[0].id) ||
    unbound.length !== 1 ||
    !Number.isSafeInteger(unbound[0].id) ||
    typeof unbound[0].sku !== "string" ||
    !unbound[0].sku
  )
    throw new SimVariantMigrationError(
      `Ambiguous ${target.label} provider recovery; failing closed.`,
      503,
    );
  return {
    label: target.label,
    valueId: targetValues[0].id,
    variantId: unbound[0].id,
    sku: unbound[0].sku,
  } as SimToneVariantBinding;
}
function legacyExact(current: Row, before: Row, id: ProductId) {
  const legacyId = SIM_TONE_VARIANT_PLAN[id].legacyVariantId,
    actual = variants(current).find((item) => item.id === legacyId),
    expected = variants(before).find((item) => item.id === legacyId);
  return Boolean(
    actual &&
      expected &&
      actual.sku === expected.sku &&
      Number(actual.price) === Number(expected.price) &&
      Number(actual.inventory) === Number(expected.inventory),
  );
}
const diagnostic = (reason: unknown) =>
  (reason instanceof Error ? reason.message : "unknown error")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, 300);
async function checkpoint(
  store: SimVariantMigrationStore,
  job: SimVariantMigrationJob,
  mutate: (next: SimVariantMigrationJob) => void,
) {
  return store.update(job.operationId, job.revision, (next) => {
    mutate(next);
    return next;
  });
}

export function buildSimVariantProjectionChange(input: {
  productId: ProductId;
  expectedSourceFingerprint: string;
  providerFingerprint: string;
  variants: Array<{
    label: Label;
    valueId: number;
    variantId: number;
    sku: string;
    price: number;
    inventory: number;
  }>;
  mode?: "activate" | "restore";
  before?: unknown;
}): SimVariantProjectionChange {
  const plan = SIM_TONE_VARIANT_PLAN[input.productId];
  return {
    mode: input.mode || "activate",
    productId: input.productId,
    expectedSourceFingerprint: input.expectedSourceFingerprint,
    providerFingerprint: input.providerFingerprint,
    optionId: plan.optionId,
    optionName: "Variant",
    legacyValueId: plan.legacyValueId,
    legacyVariantId: plan.legacyVariantId,
    variants: input.variants.map((item) => ({
      ...item,
      valueKey: item.label === "Tone Excel" ? "tone-excel" : "tone-plus",
    })),
    before: input.before,
  };
}
function projectionChange(
  id: ProductId,
  before: Row,
  bindings: SimToneVariantBinding[],
  mode: "activate" | "restore",
  providerFingerprint?: string,
): SimVariantProjectionChange {
  const plan = SIM_TONE_VARIANT_PLAN[id],
    price = Number(before.price);
  return buildSimVariantProjectionChange({
    productId: id,
    expectedSourceFingerprint: fingerprintSimToneVariantProduct(before),
    providerFingerprint:
      providerFingerprint || fingerprintSimToneVariantProduct(before),
    mode,
    before: mode === "restore" ? structuredClone(before) : undefined,
    variants: bindings.map((binding) => ({
      label: binding.label,
      valueId: binding.valueId,
      variantId: binding.variantId,
      sku: binding.sku,
      price,
      inventory: plan.variants.find((item) => item.label === binding.label)!
        .inventory,
    })),
  });
}
function finalState(
  product: Row,
  id: ProductId,
  bindings: SimToneVariantBinding[],
  originalImages: unknown,
) {
  const plan = SIM_TONE_VARIANT_PLAN[id],
    { legacy, currentOption } = assertBase(product, id, originalImages);
  if (
    currentOption.name !== "Pack" ||
    values(product).length !== 3 ||
    variants(product).length !== 3 ||
    bindings.length !== 2 ||
    new Set(bindings.map((item) => item.valueId)).size !== 2 ||
    new Set(bindings.map((item) => item.variantId)).size !== 2 ||
    legacy.inventory !== 0
  )
    throw new SimVariantMigrationError(
      "Final SIM variant structure is incomplete or has extra identities.",
      502,
    );
  const price = Number(product.price);
  for (const binding of bindings) {
    if (!bindingIn(product, binding))
      throw new SimVariantMigrationError(
        `Authoritative ${binding.label} provider binding is missing.`,
        502,
      );
    const planned = plan.variants.find((item) => item.label === binding.label)!,
      variant = variants(product).find((item) => item.id === binding.variantId);
    if (
      Number(variant?.price) !== price ||
      Number(variant?.inventory) !== planned.inventory
    )
      throw new SimVariantMigrationError(
        `${binding.label} price or stock readback is incorrect.`,
        502,
      );
  }
}
async function reconcileCall(
  call: () => Promise<void>,
  read: () => Promise<Row>,
  verify: (current: Row) => void,
) {
  let timedOut = false;
  try {
    await call();
  } catch {
    timedOut = true;
  }
  const current = await read();
  verify(current);
  return { current, timedOut };
}

export async function migrateSimToneVariants(
  input: { productId: ProductId; expectedFingerprint: string; apply?: boolean },
  deps: SimVariantMigrationDependencies,
) {
  if (
    !object(input) ||
    ![39, 40].includes(input.productId) ||
    typeof input.expectedFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedFingerprint)
  )
    throw new SimVariantMigrationError(
      "Exact SIM product ID and CAS fingerprint are required.",
      400,
    );
  const id = input.productId;
  if (input.apply !== true) {
    const initial = row(await deps.readProduct(id));
    assertInitial(initial, id);
    if (fingerprintSimToneVariantProduct(initial) !== input.expectedFingerprint)
      throw new SimVariantMigrationError(
        "SIM migration compare-and-swap conflict.",
      );
    return {
      phase: "dry-run" as const,
      productId: id,
      expectedFingerprint: input.expectedFingerprint,
      plan: structuredClone(SIM_TONE_VARIANT_PLAN[id]),
    };
  }
  const store = deps.checkpoints ?? defaultSimVariantMigrationStore,
    requestFingerprint = hash(
      canonical({
        productId: id,
        expectedFingerprint: input.expectedFingerprint,
      }),
    ),
    operationId = requestFingerprint;
  return store.withProductLock(id, async () => {
    let job =
      (await store.read(operationId)) ??
      (await store.create({ operationId, requestFingerprint, productId: id }));
    if (job.requestFingerprint !== requestFingerprint || job.productId !== id)
      throw new SimVariantMigrationError(
        "SIM migration checkpoint conflicts with this request.",
      );
    if (job.phase === "complete") {
      const before = row(job.before),
        current = row(await deps.readProduct(id));
      finalState(current, id, job.bindings, images(before));
      if (fingerprintSimToneVariantProduct(current) !== job.providerFingerprint)
        throw new SimVariantMigrationError(
          "Completed SIM migration fingerprint drifted.",
        );
      await deps.verifyProjection(
        projectionChange(
          id,
          before,
          job.bindings,
          "activate",
          job.providerFingerprint!,
        ),
      );
      return {
        phase: "complete" as const,
        productId: id,
        bindings: job.bindings,
        fingerprint: job.providerFingerprint,
        reconciledTimeouts: job.reconciledTimeouts,
      };
    }
    if (job.phase === "compensated") {
      const before = row(job.before),
        current = row(await deps.readProduct(id)),
        plan = SIM_TONE_VARIANT_PLAN[id],
        legacy = variants(current).find(
          (item) => item.id === plan.legacyVariantId,
        );
      assertBase(current, id, images(before));
      if (
        option(current)?.name !== "Pack" ||
        Number(legacy?.inventory) !== plan.expectedInventory ||
        variants(current)
          .filter((item) => item.id !== plan.legacyVariantId)
          .some((item) => Number(item.inventory) !== 0)
      )
        throw new SimVariantMigrationError(
          "Compensated SIM provider state drifted.",
          503,
        );
      await deps.verifyProjection(
        projectionChange(id, before, job.bindings, "restore"),
      );
      return {
        phase: "compensated" as const,
        productId: id,
        bindings: job.bindings,
        reconciledTimeouts: job.reconciledTimeouts,
      };
    }
    let before: Row;
    if (job.before === null) {
      before = row(await deps.readProduct(id));
      assertInitial(before, id);
      if (
        fingerprintSimToneVariantProduct(before) !== input.expectedFingerprint
      )
        throw new SimVariantMigrationError(
          "SIM migration compare-and-swap conflict.",
        );
      job = await checkpoint(store, job, (next) => {
        next.before = structuredClone(before);
        next.phase = "provider-mutating";
      });
    } else before = row(job.before);
    const originalImages = images(before),
      plan = SIM_TONE_VARIANT_PLAN[id];
    if (job.phase === "compensating") {
      const current = row(await deps.readProduct(id)),
        beforeIds = ids(variants(before)),
        generated = variants(current).filter((item) => !beforeIds.has(item.id));
      assertBase(current, id, originalImages);
      if (
        option(current)?.name === "Pack" &&
        legacyExact(current, before, id) &&
        generated.every((item) => Number(item.inventory) === 0)
      ) {
        const restore = projectionChange(id, before, job.bindings, "restore");
        if (job.projectionActivated) await deps.synchronizeProjection(restore);
        await deps.verifyProjection(restore);
        job = await checkpoint(store, job, (next) => {
          next.phase = "compensated";
          next.projectionActivated = false;
        });
        return {
          phase: "compensated" as const,
          productId: id,
          bindings: job.bindings,
          reconciledTimeouts: job.reconciledTimeouts,
        };
      }
      const next = plan.variants[job.bindings.length],
        total = variants(current).reduce(
          (sum, item) => sum + Number(item.inventory),
          0,
        ),
        recovered =
          next && Number.isFinite(total)
            ? recoveryBinding(current, before, id, job.bindings, next)
            : null;
      if (!recovered || total !== plan.expectedInventory)
        throw new SimVariantMigrationError(
          "Compensating SIM state is neither exact legacy nor uniquely recoverable; failing closed.",
          503,
        );
      job = await checkpoint(store, job, (checkpointed) => {
        checkpointed.bindings.push(recovered);
        checkpointed.completedSteps.push(`recovered:${recovered.label}`);
        checkpointed.phase = "provider-mutating";
      });
    }
    if (job.phase === "provider-mutating") {
      const current = row(await deps.readProduct(id)),
        next = plan.variants[job.bindings.length];
      assertBase(current, id, originalImages);
      if (next) {
        const recovered = recoveryBinding(
          current,
          before,
          id,
          job.bindings,
          next,
        );
        if (recovered)
          job = await checkpoint(store, job, (checkpointed) => {
            checkpointed.bindings.push(recovered);
            checkpointed.completedSteps.push(`recovered:${recovered.label}`);
          });
      }
    }
    let projectionActivated = job.projectionActivated;
    try {
      let current = row(await deps.readProduct(id));
      assertBase(current, id, originalImages);
      for (const target of plan.variants) {
        let binding = job.bindings.find((item) => item.label === target.label);
        current = row(await deps.readProduct(id));
        assertBase(current, id, originalImages);
        if (!values(current).some((item) => item.value === target.label)) {
          const beforeValueIds = ids(values(current)),
            beforeVariantIds = ids(variants(current)),
            labels = [
              ...values(current).map((item) => ({ value: String(item.value) })),
              { value: target.label },
            ];
          const result = await reconcileCall(
            () =>
              deps.updateOptionValues(id, plan.optionId, {
                name: "Pack",
                values: labels,
              }),
            async () => row(await deps.readProduct(id)),
            (after) => {
              const valueAdds = added(beforeValueIds, ids(values(after))),
                variantAdds = added(beforeVariantIds, ids(variants(after)));
              if (
                valueAdds.length !== 1 ||
                variantAdds.length !== 0 ||
                values(after).filter((item) => item.value === target.label)
                  .length !== 1
              )
                throw new Error(
                  `Appending ${target.label} changed an unexpected value/variant ID set.`,
                );
            },
          );
          current = result.current;
          job = await checkpoint(store, job, (next) => {
            next.completedSteps.push(`value:${target.label}`);
            if (result.timedOut)
              next.reconciledTimeouts.push(`value:${target.label}`);
          });
        }
        if (!binding) {
          const targetValue = values(current).find(
              (item) => item.value === target.label,
            ),
            beforeValueIds = ids(values(current)),
            beforeVariantIds = ids(variants(current));
          if (!targetValue || !Number.isSafeInteger(targetValue.id))
            throw new Error(`Exact ${target.label} value ID is unavailable.`);
          const result = await reconcileCall(
            () => deps.createVariant(id, "Pack", target.label),
            async () => row(await deps.readProduct(id)),
            (after) => {
              const valueAdds = added(beforeValueIds, ids(values(after))),
                variantAdds = added(beforeVariantIds, ids(variants(after)));
              if (valueAdds.length !== 0 || variantAdds.length !== 1)
                throw new Error(
                  `Creating ${target.label} changed more than one provider identity.`,
                );
            },
          );
          current = result.current;
          const variantId = added(beforeVariantIds, ids(variants(current)))[0],
            created = variants(current).find((item) => item.id === variantId);
          if (
            !created ||
            !Number.isSafeInteger(created.id) ||
            typeof created.sku !== "string" ||
            !created.sku
          )
            throw new Error(
              `Exact generated ${target.label} variant ID/SKU could not be reconciled.`,
            );
          binding = {
            label: target.label,
            valueId: targetValue.id,
            variantId: created.id,
            sku: created.sku,
          };
          job = await checkpoint(store, job, (next) => {
            next.bindings.push(binding!);
            next.completedSteps.push(`created:${target.label}`);
            if (result.timedOut)
              next.reconciledTimeouts.push(`created:${target.label}`);
          });
        } else if (!bindingIn(current, binding))
          throw new Error(`${target.label} checkpoint binding drifted.`);
      }
      if (!job.completedSteps.includes("option-verified")) {
        current = row(await deps.readProduct(id));
        assertBase(current, id, originalImages);
        if (option(current)?.name !== "Pack")
          throw new Error("Provider SIM option name drifted before variant activation.");
        job = await checkpoint(store, job, (next) => {
          next.completedSteps.push("option-verified");
        });
      }
      const price = Number(before.price),
        legacy = variants(before).find(
          (item) => item.id === plan.legacyVariantId,
        );
      if (!Number.isFinite(price) || !legacy)
        throw new Error(
          "Canonical SIM price or legacy variant is unavailable.",
        );
      const updates = [
        ...job.bindings.map((binding) => ({
          id: binding.variantId,
          sku: binding.sku,
          price,
          inventory: plan.variants.find((item) => item.label === binding.label)!
            .inventory,
        })),
        { id: plan.legacyVariantId, sku: plan.legacySku, price, inventory: 0 },
      ];
      if (!job.completedSteps.includes("stock-normalized")) {
        const result = await reconcileCall(
          () => deps.updateVariants(id, updates),
          async () => row(await deps.readProduct(id)),
          (after) => finalState(after, id, job.bindings, originalImages),
        );
        current = result.current;
        job = await checkpoint(store, job, (next) => {
          next.completedSteps.push("stock-normalized");
          if (result.timedOut) next.reconciledTimeouts.push("stock-normalized");
          next.phase = "provider-verified";
          next.providerFingerprint = fingerprintSimToneVariantProduct(current);
        });
      }
      current = row(await deps.readProduct(id));
      finalState(current, id, job.bindings, originalImages);
      const providerFingerprint = fingerprintSimToneVariantProduct(current);
      if (job.providerFingerprint !== providerFingerprint)
        throw new Error(
          "Provider fingerprint changed before projection synchronization.",
        );
      if (!projectionActivated) {
        const change = projectionChange(
          id,
          before,
          job.bindings,
          "activate",
          providerFingerprint,
        );
        let timeout = false;
        try {
          await deps.synchronizeProjection(change);
        } catch {
          timeout = true;
          await deps.synchronizeProjection(change);
        }
        projectionActivated = true;
        await deps.verifyProjection(change);
        job = await checkpoint(store, job, (next) => {
          next.completedSteps.push("projection-synced");
          next.phase = "projection-synced";
          next.projectionActivated = true;
          if (timeout) next.reconciledTimeouts.push("projection-synced");
        });
      }
      job = await checkpoint(store, job, (next) => {
        next.phase = "complete";
      });
      return {
        phase: "complete" as const,
        productId: id,
        bindings: job.bindings,
        fingerprint: providerFingerprint,
        reconciledTimeouts: job.reconciledTimeouts,
      };
    } catch (reason) {
      try {
        job = await checkpoint(store, job, (next) => {
          next.phase = "compensating";
        });
        let current = row(await deps.readProduct(id));
        assertBase(current, id, originalImages);
        const legacy = variants(before).find(
          (item) => item.id === plan.legacyVariantId,
        );
        if (!legacy) throw new Error("Legacy compensation snapshot missing.");
        const beforeIds = ids(variants(before)),
          generated = variants(current).filter(
            (item) => !beforeIds.has(item.id),
          );
        if (generated.length || !legacyExact(current, before, id)) {
          if (generated.some((item) => typeof item.sku !== "string" || !item.sku))
            throw new Error("Generated compensation variant SKU missing.");
          await deps.updateVariants(id, [
            ...generated.map((item) => ({
              id: item.id,
              sku: item.sku,
              price: Number(item.price ?? before.price),
              inventory: 0,
            })),
            {
              id: plan.legacyVariantId,
              sku: plan.legacySku,
              price: Number(legacy.price),
              inventory: Number(legacy.inventory),
            },
          ]);
        }
        if (option(current)?.name !== "Pack")
          await deps.updateOption(id, plan.optionId, { name: "Pack" });
        if (projectionActivated)
          await deps.synchronizeProjection(
            projectionChange(id, before, job.bindings, "restore"),
          );
        current = row(await deps.readProduct(id));
        assertBase(current, id, originalImages);
        if (
          option(current)?.name !== "Pack" ||
          Number(
            variants(current).find((item) => item.id === plan.legacyVariantId)
              ?.inventory,
          ) !== Number(legacy.inventory) ||
          variants(current)
            .filter((item) => !beforeIds.has(item.id))
            .some((item) => Number(item.inventory) !== 0)
        )
          throw new Error("Compensation provider readback failed.");
        if (projectionActivated)
          await deps.verifyProjection(
            projectionChange(id, before, job.bindings, "restore"),
          );
        job = await checkpoint(store, job, (next) => {
          next.phase = "compensated";
          next.projectionActivated = false;
        });
      } catch (compensation) {
        throw new SimVariantMigrationError(
          `SIM migration failed (${diagnostic(reason)}) and compensation failed (${diagnostic(compensation)}).`,
          503,
        );
      }
      throw new SimVariantMigrationError(
        `SIM migration failed; new identities were preserved and hidden/zeroed: ${diagnostic(reason)}`,
        502,
      );
    }
  });
}
