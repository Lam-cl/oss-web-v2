import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { formatProductDescription } from "../productDescription";
import { fingerprintBundleProduct } from "./productBundleState";
import {
  defaultSimUpdateCheckpoints,
  type SimUpdateCheckpointStore,
  type SimUpdateJob,
} from "./simProductUpdateStore.server";
import {
  buildSimVariantProjectionChange,
  type SimVariantProjectionChange,
} from "./simVariantMigration.server";

type Row = Record<string, any>;
type ProductId = 39 | 40;
type Label = "Tone Excel" | "Tone Plus";
export type SimProductVariantRow = {
  label: Label;
  valueId: number;
  variantId: number;
  sku: string;
  price: number;
  inventory: number;
};
export type SimProductUpdateRequest = {
  productId: ProductId;
  expectedFingerprint: string;
  description: string;
  productDetails: string;
  price: number;
  variants: SimProductVariantRow[];
};
export type SimProductUpdateDependencies = {
  checkpoints?: SimUpdateCheckpointStore;
  readProduct(id: number): Promise<unknown>;
  updateMetadata(
    id: number,
    change: { description: string; price: number },
  ): Promise<void>;
  updateVariants(
    id: number,
    rows: Array<{ id: number; sku: string; price: number; inventory: number }>,
  ): Promise<void>;
  readShippingGroup(id: number, slug: string): Promise<unknown>;
  ensureShippingGroup(id: number, slug: string, group: "sim"): Promise<void>;
  restoreProduct(id: number, before: unknown): Promise<void>;
  synchronizeProjection(change: SimVariantProjectionChange): Promise<void>;
  verifyProjection(change: SimVariantProjectionChange): Promise<void>;
};
export class SimProductUpdateError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = "SimProductUpdateError";
  }
}
const IDENTITIES = {
  39: {
    legacyVariantId: 106,
    title: "SUPERLITE SIM",
    slug: "superlite-sim",
    legacySku: "SIM-SUPERLITE",
    optionId: 36,
    legacyValueId: 71,
  },
  40: {
    legacyVariantId: 107,
    title: "BIZ SIM",
    slug: "biz-sim",
    legacySku: "SIM-BIZ",
    optionId: 37,
    legacyValueId: 72,
  },
} as const;
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
    createHash("sha256").update(value).digest("hex"),
  unwrap = (value: unknown) =>
    object(value) && object(value.data) ? value.data : value;
const row = (value: unknown) => {
  const result = unwrap(value);
  if (!object(result))
    throw new SimProductUpdateError("SIM product readback is invalid.", 502);
  return result;
};
const VOLATILE_PROVIDER_TIMESTAMPS = new Set(["createdAt", "updatedAt"]);
const semanticProviderValue = (value: any): any =>
  Array.isArray(value)
    ? value.map(semanticProviderValue)
    : object(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !VOLATILE_PROVIDER_TIMESTAMPS.has(key))
            .map(([key, child]) => [key, semanticProviderValue(child)]),
        )
      : value;
export function semanticallyEqualSimProviderProduct(
  left: unknown,
  right: unknown,
) {
  return isDeepStrictEqual(
    semanticProviderValue(unwrap(left)),
    semanticProviderValue(unwrap(right)),
  );
}
const variants = (product: Row) =>
  Array.isArray(product.productVariants)
    ? product.productVariants.filter(object)
    : Array.isArray(product.variants)
      ? product.variants.filter(object)
      : [];
const imageIdentity = (product: Row) => {
  const images = Array.isArray(product.images)
    ? product.images.filter(object)
    : [];
  if (
    images.length !== 1 ||
    images.some(
      (image) =>
        !Number.isSafeInteger(image.id) ||
        typeof image.url !== "string" ||
        !image.url ||
        typeof image.sha256 !== "string" ||
        !image.sha256 ||
        !Number.isSafeInteger(image.order),
    )
  )
    throw new SimProductUpdateError(
      "SIM original image identity readback is incomplete.",
      502,
    );
  return images.map((image) => ({
    id: image.id,
    url: image.url,
    sha256: image.sha256,
    order: image.order,
  }));
};
export function fingerprintSimProduct(value: unknown) {
  try {
    return fingerprintBundleProduct(value);
  } catch {
    throw new SimProductUpdateError("SIM product readback is invalid.", 502);
  }
}
function validateRequest(request: any) {
  if (
    object(request) &&
    (Object.hasOwn(request, "image") ||
      Object.hasOwn(request, "imageSha256") ||
      Object.hasOwn(request, "variantId") ||
      Object.hasOwn(request, "inventory"))
  )
    throw new SimProductUpdateError(
      "Exact two-row SIM variant matrix is required; scalar or image fields are not allowed.",
      400,
    );
  if (
    !object(request) ||
    ![39, 40].includes(request.productId) ||
    typeof request.expectedFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.expectedFingerprint) ||
    typeof request.description !== "string" ||
    request.description.length > 10000 ||
    typeof request.productDetails !== "string" ||
    request.productDetails.length > 10000 ||
    typeof request.price !== "number" ||
    !Number.isFinite(request.price) ||
    request.price < 0 ||
    !Array.isArray(request.variants) ||
    request.variants.length !== 2
  )
    throw new SimProductUpdateError(
      "Exact valid same-ID SIM metadata and two-row variant matrix are required.",
      400,
    );
  const expected = ["Tone Excel", "Tone Plus"];
  if (
    !isDeepStrictEqual(
      request.variants.map((item: any) => item?.label),
      expected,
    ) ||
    new Set(request.variants.map((item: any) => item?.valueId)).size !== 2 ||
    new Set(request.variants.map((item: any) => item?.variantId)).size !== 2 ||
    request.variants.some(
      (item: any) =>
        !Number.isSafeInteger(item.valueId) ||
        item.valueId <= 0 ||
        !Number.isSafeInteger(item.variantId) ||
        item.variantId <= 0 ||
        typeof item.sku !== "string" ||
        !item.sku ||
        typeof item.price !== "number" ||
        !Number.isFinite(item.price) ||
        item.price < 0 ||
        !Number.isSafeInteger(item.inventory) ||
        item.inventory < 0,
    )
  )
    throw new SimProductUpdateError(
      "Tone Excel and Tone Plus require unique authoritative IDs, SKUs, prices, and inventory.",
      400,
    );
}
function assertIdentity(
  product: Row,
  id: ProductId,
  matrix: SimProductVariantRow[],
) {
  const identity = IDENTITIES[id],
    providerVariants = variants(product),
    option =
      Array.isArray(product.options) && product.options.length === 1
        ? product.options[0]
        : null,
    values =
      object(option) && Array.isArray(option.values)
        ? option.values.filter(object)
        : [],
    legacy = providerVariants.find(
      (item) => item.id === identity.legacyVariantId,
    );
  if (
    product.id !== id ||
    product.name !== identity.title ||
    product.title !== identity.title ||
    product.slug !== identity.slug ||
    product.type !== "MERCHANDISE" ||
    product.requiresSimAssignment !== true ||
    product.tracksInventory !== true ||
    product.deletedAt != null ||
    !legacy ||
    legacy.sku !== identity.legacySku ||
    !option ||
    option.id !== identity.optionId ||
    option.name !== "Pack" ||
    !values.some(
      (item) => item.id === identity.legacyValueId && item.value === "Standard",
    ) ||
    legacy.inventory !== 0
  )
    throw new SimProductUpdateError(
      "SIM exact identity or preserved historical invariant failed.",
      409,
    );
  for (const requested of matrix) {
    const value = values.find((item) => item.id === requested.valueId),
      variant = providerVariants.find(
        (item) => item.id === requested.variantId,
      );
    if (
      value?.value !== requested.label ||
      !variant ||
      variant.sku !== requested.sku ||
      variant.id === identity.legacyVariantId
    )
      throw new SimProductUpdateError(
        "SIM authoritative variant binding drifted.",
        409,
      );
  }
  if (values.length !== 3 || providerVariants.length !== 3)
    throw new SimProductUpdateError(
      "SIM provider structure has unexpected local-only or extra variants.",
      409,
    );
}
function locked(product: Row) {
  return {
    id: product.id,
    name: product.name,
    title: product.title,
    slug: product.slug,
    type: product.type,
    requiresSimAssignment: product.requiresSimAssignment,
    tracksInventory: product.tracksInventory,
    deletedAt: product.deletedAt,
    categories: product.categories,
    tags: product.tags,
    options: product.options,
    variants: variants(product).map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku,
      weight: item.weight,
      order: item.order,
      selectedOptions: item.selectedOptions,
    })),
  };
}
function desired(
  product: Row,
  request: SimProductUpdateRequest,
  description: string,
) {
  return (
    product.description === description &&
    Number(product.price) === request.price &&
    request.variants.every((requested) => {
      const variant = variants(product).find(
        (item) => item.id === requested.variantId,
      );
      return (
        Number(variant?.price) === requested.price &&
        Number(variant?.inventory) === requested.inventory
      );
    })
  );
}
function finalState(
  before: Row,
  after: Row,
  request: SimProductUpdateRequest,
  description: string,
  originalImages: unknown,
) {
  assertIdentity(after, request.productId, request.variants);
  if (
    !isDeepStrictEqual(originalImages, imageIdentity(after)) ||
    !isDeepStrictEqual(locked(before), locked(after)) ||
    !desired(after, request, description)
  )
    throw new SimProductUpdateError(
      "SIM final exact matrix readback or locked invariant verification failed.",
      502,
    );
}
async function checkpoint(
  store: SimUpdateCheckpointStore,
  job: SimUpdateJob,
  mutate: (next: SimUpdateJob) => void,
) {
  return store.update(job.operationId, job.revision, (next) => {
    mutate(next);
    return next;
  });
}
async function finishRollback(
  store: SimUpdateCheckpointStore,
  job: SimUpdateJob,
  before: Row,
  request: SimProductUpdateRequest,
  deps: SimProductUpdateDependencies,
) {
  const restore = buildSimVariantProjectionChange({
      productId: request.productId,
      expectedSourceFingerprint: fingerprintSimProduct(before),
      providerFingerprint: fingerprintSimProduct(before),
      mode: "restore",
      before,
      variants: request.variants,
    }),
    activate = buildSimVariantProjectionChange({
      productId: request.productId,
      expectedSourceFingerprint: fingerprintSimProduct(before),
      providerFingerprint: fingerprintSimProduct(
        row(await deps.readProduct(request.productId)),
      ),
      variants: request.variants,
    });
  if (!job.completedSteps.includes("projection-restored")) {
    let activated =
        job.completedSteps.includes("projection-activated") ||
        job.completedSteps.includes("projection-synced"),
      baselineVerified = false;
    if (!activated) {
      try {
        await deps.verifyProjection(restore);
        baselineVerified = true;
      } catch {
        try {
          await deps.verifyProjection(activate);
          activated = true;
        } catch {
          throw new Error("rollback projection state is ambiguous");
        }
      }
    }
    if (activated) await deps.synchronizeProjection(restore);
    if (!baselineVerified) await deps.verifyProjection(restore);
    job = await checkpoint(store, job, (next) => {
      next.completedSteps.push("projection-restored");
    });
  } else await deps.verifyProjection(restore);
  await deps.restoreProduct(request.productId, structuredClone(before));
  const restored = row(await deps.readProduct(request.productId));
  if (
    !semanticallyEqualSimProviderProduct(restored, before) ||
    fingerprintSimProduct(restored) !== fingerprintSimProduct(before)
  )
    throw new Error("rollback exact readback mismatch");
  const rollbackFingerprint = fingerprintSimProduct(restored);
  return checkpoint(store, job, (next) => {
    next.rollbackFingerprint = rollbackFingerprint;
    next.phase = "rolled-back";
  });
}
export async function updateSimProductInPlace(
  request: SimProductUpdateRequest,
  deps: SimProductUpdateDependencies,
) {
  validateRequest(request);
  const store = deps.checkpoints ?? defaultSimUpdateCheckpoints,
    description = formatProductDescription(
      request.description,
      request.productDetails,
    ),
    requestFingerprint = hash(canonical(request)),
    operationId = requestFingerprint,
    identity = IDENTITIES[request.productId];
  return store.withProductLock(request.productId, async () => {
    let job =
      (await store.read(operationId)) ??
      (await store.create({
        operationId,
        requestFingerprint,
        productId: request.productId,
        variantId: identity.legacyVariantId,
      }));
    if (
      job.requestFingerprint !== requestFingerprint ||
      job.productId !== request.productId ||
      job.variantId !== identity.legacyVariantId
    )
      throw new SimProductUpdateError(
        "SIM update checkpoint conflicts with this request.",
        409,
      );
    if (job.phase === "complete") {
      const before = row(job.before),
        current = row(await deps.readProduct(request.productId));
      finalState(before, current, request, description, imageIdentity(before));
      const fingerprint = fingerprintSimProduct(current),
        change = buildSimVariantProjectionChange({
          productId: request.productId,
          expectedSourceFingerprint: fingerprintSimProduct(before),
          providerFingerprint: fingerprint,
          variants: request.variants,
        });
      if (
        (await deps.readShippingGroup(request.productId, identity.slug)) !==
          "sim" ||
        fingerprint !== job.finalFingerprint
      )
        throw new SimProductUpdateError(
          "SIM complete terminal verification failed.",
          502,
        );
      await deps.verifyProjection(change);
      return {
        operationId,
        productId: request.productId,
        phase: "complete" as const,
        fingerprint,
        reconciledTimeouts: job.reconciledTimeouts,
      };
    }
    if (job.phase === "rolling-back") {
      const before = row(job.before);
      try {
        job = await finishRollback(store, job, before, request, deps);
      } catch (rollback) {
        throw new SimProductUpdateError(
          `SIM update rollback recovery failed: ${rollback instanceof Error ? rollback.message : "unknown error"}`,
          503,
        );
      }
      return {
        operationId,
        productId: request.productId,
        phase: "rolled-back" as const,
        fingerprint: job.rollbackFingerprint!,
        reconciledTimeouts: job.reconciledTimeouts,
      };
    }
    if (job.phase === "rolled-back") {
      const before = row(job.before),
        current = row(await deps.readProduct(request.productId));
      if (
        !semanticallyEqualSimProviderProduct(current, before) ||
        fingerprintSimProduct(current) !== job.rollbackFingerprint
      )
        throw new SimProductUpdateError(
          "SIM rolled-back terminal snapshot mismatch.",
          502,
        );
      await deps.verifyProjection(
        buildSimVariantProjectionChange({
          productId: request.productId,
          expectedSourceFingerprint: fingerprintSimProduct(before),
          providerFingerprint: fingerprintSimProduct(before),
          mode: "restore",
          before,
          variants: request.variants,
        }),
      );
      return {
        operationId,
        productId: request.productId,
        phase: "rolled-back" as const,
        fingerprint: job.rollbackFingerprint,
        reconciledTimeouts: job.reconciledTimeouts,
      };
    }
    let before: Row;
    if (job.before === null) {
      before = row(await deps.readProduct(request.productId));
      assertIdentity(before, request.productId, request.variants);
      imageIdentity(before);
      if (fingerprintSimProduct(before) !== request.expectedFingerprint)
        throw new SimProductUpdateError(
          "SIM update compare-and-swap conflict.",
          409,
        );
      if (
        (await deps.readShippingGroup(request.productId, identity.slug)) !==
        "sim"
      )
        throw new SimProductUpdateError(
          "SIM shipping group invariant failed.",
          409,
        );
      job = await checkpoint(store, job, (next) => {
        next.before = structuredClone(before);
        next.phase = "mutating";
      });
    } else before = row(job.before);
    const originalImages = imageIdentity(before);
    let projectionActivated = job.completedSteps.includes("projection-synced");
    try {
      let current = row(await deps.readProduct(request.productId));
      assertIdentity(current, request.productId, request.variants);
      if (!isDeepStrictEqual(originalImages, imageIdentity(current)))
        throw new Error("SIM images changed.");
      if (!job.completedSteps.includes("metadata")) {
        let timeout = false;
        try {
          await deps.updateMetadata(request.productId, {
            description,
            price: request.price,
          });
        } catch {
          timeout = true;
        }
        current = row(await deps.readProduct(request.productId));
        if (
          current.description !== description ||
          Number(current.price) !== request.price
        )
          throw new Error("Metadata readback failed.");
        job = await checkpoint(store, job, (next) => {
          next.completedSteps.push("metadata");
          if (timeout) next.reconciledTimeouts.push("metadata");
        });
      }
      if (!job.completedSteps.includes("variants")) {
        let timeout = false;
        try {
          await deps.updateVariants(
            request.productId,
            request.variants.map((item) => ({
              id: item.variantId,
              sku: item.sku,
              price: item.price,
              inventory: item.inventory,
            })),
          );
        } catch {
          timeout = true;
        }
        current = row(await deps.readProduct(request.productId));
        assertIdentity(current, request.productId, request.variants);
        if (!desired(current, request, description))
          throw new Error("Variant matrix readback failed.");
        job = await checkpoint(store, job, (next) => {
          next.completedSteps.push("variants");
          if (timeout) next.reconciledTimeouts.push("variants");
        });
      }
      current = row(await deps.readProduct(request.productId));
      finalState(before, current, request, description, originalImages);
      await deps.ensureShippingGroup(request.productId, identity.slug, "sim");
      const verified = row(await deps.readProduct(request.productId));
      finalState(before, verified, request, description, originalImages);
      if (
        (await deps.readShippingGroup(request.productId, identity.slug)) !==
        "sim"
      )
        throw new Error("Shipping readback failed.");
      const finalFingerprint = fingerprintSimProduct(verified),
        change = buildSimVariantProjectionChange({
          productId: request.productId,
          expectedSourceFingerprint: fingerprintSimProduct(before),
          providerFingerprint: finalFingerprint,
          variants: request.variants,
        });
      if (!projectionActivated) {
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
          if (timeout) next.reconciledTimeouts.push("projection-synced");
        });
      }
      job = await checkpoint(store, job, (next) => {
        next.completedSteps.push("shipping-verified");
        next.finalFingerprint = finalFingerprint;
        next.phase = "complete";
      });
      return {
        operationId,
        productId: request.productId,
        phase: "complete" as const,
        fingerprint: finalFingerprint,
        reconciledTimeouts: job.reconciledTimeouts,
      };
    } catch (reason) {
      try {
        job = await checkpoint(store, job, (next) => {
          next.phase = "rolling-back";
          if (
            projectionActivated &&
            !next.completedSteps.includes("projection-activated")
          )
            next.completedSteps.push("projection-activated");
        });
        job = await finishRollback(store, job, before, request, deps);
      } catch (rollback) {
        throw new SimProductUpdateError(
          `SIM update rollback failed: ${rollback instanceof Error ? rollback.message : "unknown error"}`,
          503,
        );
      }
      throw new SimProductUpdateError(
        `SIM update failed and was rolled back: ${reason instanceof Error ? reason.message : "unknown error"}`,
        502,
      );
    }
  });
}
