import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { dataApiEnabled, dataApiRequest, remoteDocument, replaceRemoteDocument, withRemoteLease } from '../dataApiClient.server';
import { isDeepStrictEqual } from "node:util";
import {
  normalizeProductEditorSpec,
  type ProductEditorSpec,
} from "./productEditor";
import {
  fingerprintBundleProduct,
  normalizeBundleProduct,
} from "./productBundleState";
import type { SimVariantProjectionChange } from "./simVariantMigration.server";

export const SIM_ADOPTION_BUNDLE_IDS = [39, 40] as const;
export const SIM_ADOPTION_MINIMUM_ORDER_QUANTITY = 2;
const ALLOWED = new Set([
  23, 24, 25, 26, 27, 28, 29, 32, 33, 34, 35, 36, 39, 40,
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const NOFOLLOW = constants.O_NOFOLLOW || 0;
const REQUIRED_AUDITS = [
  "/root/legacy-merchandise-23-36-migration-audit-2026-08-24.json",
  "/root/legacy-merchandise-23-36-migration-table-2026-08-24.csv",
  "/root/legacy-merchandise-relationship-audit-2026-08-24.json",
  "/root/legacy-merchandise-import-mapping.json",
].sort();
const REQUIRED_SIM_AUDITS = [
  "/root/bundle-sim-identity-contract.json",
  "/root/legacy-merchandise-provider-2026-08-24.json",
  "/root/legacy-merchandise-storefront-live-2026-08-24.json",
].sort();
export const SIM_ADOPTION_LOCKED_FIELDS = [
  "managementDomain",
  "bundleProductId",
  "variantId",
  "sku",
  "slug",
  "title",
  "option",
  "requiresSimAssignment",
  "tracksInventory",
  "shippingGroup",
  "minimumOrderQuantity",
] as const;
const SIM_IDENTITIES = {
  39: {
    title: "SUPERLITE SIM",
    slug: "superlite-sim",
    price: 10,
    optionId: 36,
    valueId: 71,
    variantId: 106,
    sku: "SIM-SUPERLITE",
    imageId: 192,
  },
  40: {
    title: "BIZ SIM",
    slug: "biz-sim",
    price: 128,
    optionId: 37,
    valueId: 72,
    variantId: 107,
    sku: "SIM-BIZ",
    imageId: 193,
  },
} as const;
const queues = new Map<string, Promise<void>>();
type Row = Record<string, unknown>;
type CheckpointName =
  | "source-verified"
  | "media-verified"
  | "media-activated"
  | "adoption-activated";
type MediaBinding = {
  mediaId: string;
  imageId: number;
  url: string;
  sha256: string;
  bytes: number;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  order: number;
  assignment: "all" | string;
};
type ValueBinding = { valueKey: string; valueId: number };
type VariantBinding = { valueKeys: string[]; variantId: number };
type Evidence = {
  auditFiles: Array<{ path: string; sha256: string }>;
  relationshipEvidence: Array<{
    valueKeys: string[];
    kind: string;
    reason: string;
  }>;
};
export type SimManagementProfile = {
  domain: "SIM";
  requiresSimAssignment: true;
  tracksInventory: true;
  shippingGroup: "sim";
  minimumOrderQuantity: 2;
};
export type LegacyAdoptionSpec = {
  schemaVersion: 1;
  approval: { approved: true; approvedBy: string; approvedAt: string };
  bundleProductId: number;
  catalogueId: string;
  slug: string;
  expectedSourceFingerprint: string;
  model: ProductEditorSpec;
  providerBindings: {
    optionIds: number[];
    valueBindings: ValueBinding[];
    variantBindings: VariantBinding[];
    imageBindings: MediaBinding[];
  };
  exclusions: { hiddenValueIds: number[]; orphanVariantIds: number[] };
  evidence: Evidence;
  managementProfile?: SimManagementProfile;
};
export type LegacyAdoptionProjection = {
  catalogueId: string;
  slug: string;
  details: ProductEditorSpec["details"];
  choices: Array<{
    key: string;
    name: string;
    values: Array<{ key: string; label: string }>;
  }>;
  combinations: Array<{
    valueKeys: string[];
    variantId: number;
    price: number;
    inventory: number;
  }>;
  images: Array<{ url: string; order: number; assignment: string }>;
  bundleProductId: number;
  managementDomain?: "SIM";
  minimumOrderQuantity?: 2;
  requiresSimAssignment?: true;
  tracksInventory?: true;
  shippingGroup?: "sim";
};
export type CatalogueAdoptionRecord = {
  version: 1;
  status: "active" | "superseded";
  bundleProductId: number;
  catalogueId: string;
  sourceFingerprint: string;
  approvedSpecFingerprint: string;
  activatedProjection: LegacyAdoptionProjection;
  providerBindings: LegacyAdoptionSpec["providerBindings"];
  exclusions: LegacyAdoptionSpec["exclusions"];
  evidence: Evidence;
  managementProfile?: SimManagementProfile;
  mediaHashes: Array<{
    mediaId: string;
    imageId: number;
    sha256: string;
    bytes: number;
    contentType: string;
    url: string;
  }>;
  checkpoints: Array<{ name: CheckpointName; completedAt: string }>;
  activatedAt: string;
  supersededAt: string | null;
  replacementBundleProductId: number | null;
};
export type AdoptionDependencies = {
  readBundleProduct(id: number): Promise<unknown>;
  downloadMedia(
    url: string,
  ): Promise<{ body: Uint8Array; contentType: string }>;
};
type RollbackCheckpointName =
  | "adoption-moved"
  | "media-moved"
  | "product-moved";
export type AdoptionOptions = {
  dataDirectory?: string;
  afterCheckpoint?: (name: CheckpointName) => Promise<void> | void;
  afterRollbackCheckpoint?: (
    name: RollbackCheckpointName,
  ) => Promise<void> | void;
  now?: () => Date;
};
export type AdoptionReadOptions = {
  dataDirectory?: string;
  afterProjectionRename?: (
    name: "adoption-renamed" | "product-renamed",
  ) => Promise<void> | void;
};

export class CatalogueAdoptionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "CatalogueAdoptionError";
  }
}
const object = (value: unknown): value is Row =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: Row, keys: string[]) =>
  isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  (() => {
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  })();
const stableKey = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : object(value)
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const rootOf = (options: AdoptionReadOptions) =>
  path.resolve(options.dataDirectory || path.join(process.cwd(), ".data"));
const adoptionFile = (root: string, id: number) =>
  path.join(root, "catalogue-imports", "by-bundle", `${id}.json`);
const productFile = (root: string, id: string) =>
  path.join(root, "catalogue-products", `${id}.json`);
const mediaDirectory = (root: string, id: string) =>
  path.join(root, "catalogue-media", id);
function signature(type: string, body: Uint8Array) {
  if (type === "image/png")
    return (
      body.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => body[i] === x)
    );
  if (type === "image/jpeg")
    return (
      body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255
    );
  return (
    body.length >= 12 &&
    Buffer.from(body.subarray(0, 4)).toString() === "RIFF" &&
    Buffer.from(body.subarray(8, 12)).toString() === "WEBP"
  );
}
async function statOrNull(target: string) {
  try {
    return await lstat(target);
  } catch (reason: any) {
    if (reason?.code === "ENOENT") return null;
    throw reason;
  }
}
const contained = (root: string, target: string) =>
  target === root || target.startsWith(`${root}${path.sep}`);
async function ensureSafeRoot(root: string, create = true) {
  const resolved = path.resolve(root),
    parsed = path.parse(resolved);
  let current = parsed.root;
  for (const component of resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, component);
    let stat = await statOrNull(current);
    if (!stat && create) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (reason: any) {
        if (reason?.code !== "EEXIST") throw reason;
      }
      stat = await statOrNull(current);
    }
    if (!stat) {
      if (create)
        throw new CatalogueAdoptionError(
          `Unsafe adoption directory ${current}.`,
          500,
        );
      return false;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new CatalogueAdoptionError(
        `Unsafe adoption directory ancestor ${current}.`,
        500,
      );
    if ((await realpath(current)) !== current)
      throw new CatalogueAdoptionError(
        `Unsafe adoption directory realpath ${current}.`,
        500,
      );
  }
  return true;
}
async function assertSafeAncestors(target: string) {
  const resolved = path.resolve(target),
    parsed = path.parse(resolved),
    parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of parts.slice(0, -1)) {
    current = path.join(current, component);
    const stat = await statOrNull(current);
    if (!stat) return;
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (await realpath(current)) !== current
    )
      throw new CatalogueAdoptionError(
        `Unsafe adoption path ancestor ${current}.`,
        500,
      );
  }
}
async function ensureDirectory(root: string, target: string) {
  const resolved = path.resolve(target);
  if (!contained(root, resolved))
    throw new CatalogueAdoptionError(
      "Adoption path escapes its data root.",
      500,
    );
  await ensureSafeRoot(root);
  const relative = path.relative(root, resolved);
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat = await statOrNull(current);
    if (!stat) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (reason: any) {
        if (reason?.code !== "EEXIST") throw reason;
      }
      stat = await statOrNull(current);
    }
    if (
      !stat ||
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (await realpath(current)) !== current
    )
      throw new CatalogueAdoptionError(
        `Unsafe adoption directory ${current}.`,
        500,
      );
    await chmod(current, 0o700);
  }
}
async function syncPath(target: string) {
  const handle = await open(target, constants.O_RDONLY | NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(target: string) {
  await syncPath(target);
}
async function durableRename(
  root: string,
  source: string,
  destination: string,
) {
  if (
    !contained(root, path.resolve(source)) ||
    !contained(root, path.resolve(destination))
  )
    throw new CatalogueAdoptionError(
      "Adoption rename escapes its data root.",
      500,
    );
  await ensureDirectory(root, path.dirname(source));
  await ensureDirectory(root, path.dirname(destination));
  await rename(source, destination);
  await syncPath(destination);
  for (const directory of Array.from(
    new Set([path.dirname(source), path.dirname(destination)]),
  ))
    await syncDirectory(directory);
}
async function atomicJson(
  root: string,
  target: string,
  value: unknown,
  createOnly = false,
) {
  await ensureDirectory(root, path.dirname(target));
  const existing = await statOrNull(target);
  if (existing && (existing.isSymbolicLink() || !existing.isFile()))
    throw new CatalogueAdoptionError("Unsafe adoption record.", 500);
  if (createOnly && existing)
    throw new CatalogueAdoptionError(
      "Legacy Bundle product is already adopted.",
    );
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await durableRename(root, temp, target);
  await chmod(target, 0o600);
  await syncPath(target);
  await syncDirectory(path.dirname(target));
}
async function readJson(target: string) {
  await assertSafeAncestors(target);
  const stat = await statOrNull(target);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new CatalogueAdoptionError("Unsafe adoption record.", 500);
  const handle = await open(target, constants.O_RDONLY | NOFOLLOW);
  try {
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}
function enqueue<T>(key: string, action: () => Promise<T>) {
  const prior = queues.get(key) || Promise.resolve();
  const run = prior.then(action, action);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  return run.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
}

export function fingerprintLegacyAdoptionSource(source: unknown) {
  return fingerprintBundleProduct(source);
}
function validateSpec(raw: unknown): LegacyAdoptionSpec {
  if (!object(raw) || !ALLOWED.has(raw.bundleProductId as number))
    throw new CatalogueAdoptionError(
      "Exact approved legacy adoption spec is invalid or outside the approved scope.",
      400,
    );
  const isSim = SIM_ADOPTION_BUNDLE_IDS.includes(
      raw.bundleProductId as 39 | 40,
    ),
    keys = [
      "schemaVersion",
      "approval",
      "bundleProductId",
      "catalogueId",
      "slug",
      "expectedSourceFingerprint",
      "model",
      "providerBindings",
      "exclusions",
      "evidence",
      ...(isSim ? ["managementProfile"] : []),
    ];
  if (
    !exact(raw, keys) ||
    raw.schemaVersion !== 1 ||
    !UUID.test(String(raw.catalogueId)) ||
    typeof raw.slug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug) ||
    !DIGEST.test(String(raw.expectedSourceFingerprint))
  )
    throw new CatalogueAdoptionError(
      "Exact approved legacy adoption spec is invalid or outside the approved scope.",
      400,
    );
  if (
    isSim &&
    (!object(raw.managementProfile) ||
      !exact(raw.managementProfile, [
        "domain",
        "requiresSimAssignment",
        "tracksInventory",
        "shippingGroup",
        "minimumOrderQuantity",
      ]) ||
      raw.managementProfile.domain !== "SIM" ||
      raw.managementProfile.requiresSimAssignment !== true ||
      raw.managementProfile.tracksInventory !== true ||
      raw.managementProfile.shippingGroup !== "sim" ||
      raw.managementProfile.minimumOrderQuantity !==
        SIM_ADOPTION_MINIMUM_ORDER_QUANTITY)
  )
    throw new CatalogueAdoptionError(
      "The exact locked SIM management profile is required.",
      400,
    );
  if (
    !object(raw.approval) ||
    !exact(raw.approval, ["approved", "approvedBy", "approvedAt"]) ||
    raw.approval.approved !== true ||
    typeof raw.approval.approvedBy !== "string" ||
    !raw.approval.approvedBy.trim() ||
    !timestamp(raw.approval.approvedAt)
  )
    throw new CatalogueAdoptionError(
      "Explicit approval evidence is required.",
      400,
    );
  let model: ProductEditorSpec;
  try {
    model = normalizeProductEditorSpec(raw.model);
  } catch {
    throw new CatalogueAdoptionError(
      "Legacy adoption ProductEditor model is invalid.",
      400,
    );
  }
  const rawModel = raw.model as Row;
  const rawDetails = object(rawModel.details) ? rawModel.details : {};
  const comparableModel = Object.hasOwn(rawDetails, "minimumOrderQuantity")
    ? model
    : {
        ...model,
        details: Object.fromEntries(
          Object.entries(model.details).filter(
            ([key]) => key !== "minimumOrderQuantity",
          ),
        ),
      };
  if (!isDeepStrictEqual(comparableModel, raw.model))
    throw new CatalogueAdoptionError(
      "Legacy adoption model must already be normalized.",
      400,
    );
  const bindings = raw.providerBindings,
    exclusions = raw.exclusions,
    evidence = raw.evidence;
  if (
    !object(bindings) ||
    !exact(bindings, [
      "optionIds",
      "valueBindings",
      "variantBindings",
      "imageBindings",
    ]) ||
    !object(exclusions) ||
    !exact(exclusions, ["hiddenValueIds", "orphanVariantIds"]) ||
    !object(evidence) ||
    !exact(evidence, ["auditFiles", "relationshipEvidence"])
  )
    throw new CatalogueAdoptionError(
      "Exact provider bindings, exclusions and evidence are required.",
      400,
    );
  const ids = (value: unknown, label: string) => {
    if (
      !Array.isArray(value) ||
      value.some((id) => !positive(id)) ||
      new Set(value).size !== value.length
    )
      throw new CatalogueAdoptionError(
        `${label} must contain unique positive IDs.`,
        400,
      );
    return value as number[];
  };
  const optionIds = ids(bindings.optionIds, "Option IDs"),
    hiddenValueIds = ids(exclusions.hiddenValueIds, "Hidden value IDs"),
    orphanVariantIds = ids(exclusions.orphanVariantIds, "Orphan variant IDs");
  if (
    !Array.isArray(bindings.valueBindings) ||
    bindings.valueBindings.some(
      (item) =>
        !object(item) ||
        !exact(item, ["valueKey", "valueId"]) ||
        !stableKey(item.valueKey) ||
        !positive(item.valueId),
    )
  )
    throw new CatalogueAdoptionError("Value mappings are invalid.", 400);
  if (
    !Array.isArray(bindings.variantBindings) ||
    bindings.variantBindings.some(
      (item) =>
        !object(item) ||
        !exact(item, ["valueKeys", "variantId"]) ||
        !Array.isArray(item.valueKeys) ||
        item.valueKeys.some((key) => !stableKey(key)) ||
        !positive(item.variantId),
    )
  )
    throw new CatalogueAdoptionError("Variant mappings are invalid.", 400);
  if (
    !Array.isArray(bindings.imageBindings) ||
    !bindings.imageBindings.length ||
    bindings.imageBindings.some(
      (item) =>
        !object(item) ||
        !exact(item, [
          "mediaId",
          "imageId",
          "url",
          "sha256",
          "bytes",
          "contentType",
          "order",
          "assignment",
        ]) ||
        !UUID.test(String(item.mediaId)) ||
        !positive(item.imageId) ||
        typeof item.url !== "string" ||
        !/^https:\/\//.test(item.url) ||
        !DIGEST.test(String(item.sha256)) ||
        !positive(item.bytes) ||
        !["image/jpeg", "image/png", "image/webp"].includes(
          String(item.contentType),
        ) ||
        !Number.isSafeInteger(item.order) ||
        Number(item.order) < 0 ||
        !(item.assignment === "all" || stableKey(item.assignment)),
    )
  )
    throw new CatalogueAdoptionError("Media mappings are invalid.", 400);
  const unique = (values: unknown[], label: string) => {
    if (new Set(values.map((value) => canonical(value))).size !== values.length)
      throw new CatalogueAdoptionError(`Duplicate ${label}.`, 400);
  };
  unique(
    bindings.valueBindings.map((item) => (item as Row).valueKey),
    "value keys",
  );
  unique(
    bindings.valueBindings.map((item) => (item as Row).valueId),
    "value IDs",
  );
  unique(
    bindings.variantBindings.map((item) => (item as Row).valueKeys),
    "variant tuples",
  );
  unique(
    bindings.variantBindings.map((item) => (item as Row).variantId),
    "variant IDs",
  );
  unique(
    bindings.imageBindings.map((item) => (item as Row).mediaId),
    "media IDs",
  );
  unique(
    bindings.imageBindings.map((item) => (item as Row).imageId),
    "image IDs",
  );
  unique(
    bindings.imageBindings.map((item) => (item as Row).order),
    "media orders",
  );
  const requiredAudits = isSim ? REQUIRED_SIM_AUDITS : REQUIRED_AUDITS;
  if (
    !Array.isArray(evidence.auditFiles) ||
    evidence.auditFiles.some(
      (item) =>
        !object(item) ||
        !exact(item, ["path", "sha256"]) ||
        typeof item.path !== "string" ||
        !DIGEST.test(String(item.sha256)),
    ) ||
    !isDeepStrictEqual(
      evidence.auditFiles.map((item: any) => item.path).sort(),
      requiredAudits,
    )
  )
    throw new CatalogueAdoptionError(
      "All exact migration audit artifacts are required.",
      400,
    );
  if (
    !Array.isArray(evidence.relationshipEvidence) ||
    evidence.relationshipEvidence.some(
      (item) =>
        !object(item) ||
        !exact(item, ["valueKeys", "kind", "reason"]) ||
        !Array.isArray(item.valueKeys) ||
        item.valueKeys.some((key) => !stableKey(key)) ||
        ![
          "verified-native",
          "verified-recorded",
          "candidate-order-pattern",
          "candidate-unique-sku",
        ].includes(String(item.kind)) ||
        typeof item.reason !== "string" ||
        !item.reason.trim(),
    )
  )
    throw new CatalogueAdoptionError(
      "Approved relationship evidence is incomplete or ambiguous.",
      400,
    );
  unique(
    evidence.relationshipEvidence.map((item) => (item as Row).valueKeys),
    "relationship evidence tuples",
  );
  const variantTuples = (bindings.variantBindings as VariantBinding[])
      .map((item) => canonical(item.valueKeys))
      .sort(),
    evidenceTuples = (
      evidence.relationshipEvidence as Evidence["relationshipEvidence"]
    )
      .map((item) => canonical(item.valueKeys))
      .sort();
  if (!isDeepStrictEqual(evidenceTuples, variantTuples))
    throw new CatalogueAdoptionError(
      "Every exact variant tuple requires one approved relationship evidence mapping.",
      400,
    );
  return {
    ...raw,
    model,
    providerBindings: {
      optionIds,
      valueBindings: bindings.valueBindings as ValueBinding[],
      variantBindings: bindings.variantBindings as VariantBinding[],
      imageBindings: bindings.imageBindings as MediaBinding[],
    },
    exclusions: { hiddenValueIds, orphanVariantIds },
    evidence: evidence as Evidence,
  } as LegacyAdoptionSpec;
}
function sourceRows(raw: unknown) {
  const source = normalizeBundleProduct(raw) as Row;
  const options = Array.isArray(source.options)
      ? source.options.filter(object)
      : [],
    variants = Array.isArray(source.productVariants)
      ? source.productVariants.filter(object)
      : [],
    images = Array.isArray(source.images) ? source.images.filter(object) : [];
  return { source, options, variants, images };
}
function verifyMapping(spec: LegacyAdoptionSpec, raw: unknown) {
  const { source, options, variants, images } = sourceRows(raw);
  if (source.id !== spec.bundleProductId)
    throw new CatalogueAdoptionError(
      "Bundle source product ID does not match approved exact ID.",
    );
  const sourceOptionIds = options.map((item) => item.id),
    sourceValueIds = options.flatMap((item) =>
      Array.isArray(item.values)
        ? item.values.filter(object).map((value) => value.id)
        : [],
    ),
    sourceVariantIds = variants.map((item) => item.id),
    sourceImageIds = images.map((item) => item.id);
  const exactIds = (actual: unknown[], expected: number[], label: string) => {
    if (
      actual.some((id) => !positive(id)) ||
      !isDeepStrictEqual(
        [...actual].sort((a: any, b: any) => a - b),
        [...expected].sort((a, b) => a - b),
      )
    )
      throw new CatalogueAdoptionError(
        `${label} mapping is incomplete or ambiguous.`,
      );
  };
  exactIds(sourceOptionIds, spec.providerBindings.optionIds, "Option");
  exactIds(
    sourceValueIds,
    [
      ...spec.providerBindings.valueBindings.map((x) => x.valueId),
      ...spec.exclusions.hiddenValueIds,
    ],
    "Value/hidden",
  );
  exactIds(
    sourceVariantIds,
    [
      ...spec.providerBindings.variantBindings.map((x) => x.variantId),
      ...spec.exclusions.orphanVariantIds,
    ],
    "Variant/orphan",
  );
  exactIds(
    sourceImageIds,
    spec.providerBindings.imageBindings.map((x) => x.imageId),
    "Image",
  );
  const modelOptions = spec.model.choices.map((choice) => choice.optionId),
    modelValues = spec.model.choices.flatMap((choice) =>
      choice.values.map((value) => ({
        valueKey: value.key,
        valueId: value.valueId,
      })),
    ),
    modelVariants = spec.model.combinations.map((combination) => ({
      valueKeys: combination.valueKeys,
      variantId: combination.variantId,
    }));
  exactIds(modelOptions, spec.providerBindings.optionIds, "Model option");
  const canonicalSet = (values: unknown[]) => values.map(canonical).sort();
  if (
    !isDeepStrictEqual(
      canonicalSet(modelValues),
      canonicalSet(spec.providerBindings.valueBindings),
    )
  )
    throw new CatalogueAdoptionError(
      "Model value mapping must exactly equal approved provider bindings.",
    );
  if (
    !isDeepStrictEqual(
      canonicalSet(modelVariants),
      canonicalSet(spec.providerBindings.variantBindings),
    )
  )
    throw new CatalogueAdoptionError(
      "Model variant mapping must exactly equal approved provider bindings.",
    );
  const modelImages = spec.model.existingImages.map((image) => ({
      imageId: image.imageId,
      order: image.order,
      assignment: image.assignment,
      remove: image.remove,
    })),
    approvedImages = spec.providerBindings.imageBindings.map((image) => ({
      imageId: image.imageId,
      order: image.order,
      assignment: image.assignment,
      remove: false,
    }));
  if (
    !isDeepStrictEqual(canonicalSet(modelImages), canonicalSet(approvedImages))
  )
    throw new CatalogueAdoptionError(
      "Model existing image mapping must exactly equal approved media bindings.",
    );
  for (const media of spec.providerBindings.imageBindings) {
    const image = images.find((item) => item.id === media.imageId);
    if (
      !image ||
      image.url !== media.url ||
      Number(image.order) !== media.order
    )
      throw new CatalogueAdoptionError(
        "Provider media source drift was detected.",
      );
  }
  if (spec.managementProfile) {
    const identity =
        SIM_IDENTITIES[spec.bundleProductId as keyof typeof SIM_IDENTITIES],
      candidate = object(raw) && "data" in raw ? raw.data : raw,
      provider = object(candidate) ? candidate : {};
    const choice = spec.model.choices[0],
      value = choice?.values[0],
      combination = spec.model.combinations[0],
      variant = variants[0];
    if (
      !identity ||
      provider.requiresSimAssignment !== true ||
      provider.tracksInventory !== true ||
      provider.slug !== identity.slug ||
      source.title !== identity.title ||
      source.price !== identity.price ||
      spec.slug !== identity.slug ||
      spec.model.details.title !== identity.title ||
      spec.model.details.price !== identity.price ||
      typeof spec.model.details.category !== "string" ||
      !/^SIM(?: Card)?$/i.test(spec.model.details.category.trim()) ||
      spec.model.choices.length !== 1 ||
      choice?.key !== "pack" ||
      choice?.name !== "Pack" ||
      choice?.optionId !== identity.optionId ||
      choice.values.length !== 1 ||
      value?.key !== "standard" ||
      value?.label !== "Standard" ||
      value?.valueId !== identity.valueId ||
      value?.retired !== false ||
      spec.model.combinations.length !== 1 ||
      combination?.variantId !== identity.variantId ||
      combination?.sku !== identity.sku ||
      !isDeepStrictEqual(combination?.valueKeys, ["standard"]) ||
      variants.length !== 1 ||
      variant?.id !== identity.variantId ||
      variant?.sku !== identity.sku ||
      images.length !== 1 ||
      images[0]?.id !== identity.imageId
    )
      throw new CatalogueAdoptionError(
        "Exact locked SIM product, variant, SKU, slug, flags, and Pack=Standard identity is invalid or has drifted.",
      );
  }
}
function projection(spec: LegacyAdoptionSpec): LegacyAdoptionProjection {
  const choices = spec.model.choices.map((choice) => ({
    key: choice.key,
    name: choice.name,
    values: choice.values
      .filter((value) => !value.retired)
      .map((value) => ({ key: value.key, label: value.label })),
  }));
  const active = new Set(
    choices.flatMap((choice) => choice.values.map((value) => value.key)),
  );
  const variants = new Map(
    spec.providerBindings.variantBindings.map((item) => [
      canonical(item.valueKeys),
      item.variantId,
    ]),
  );
  const combinations = spec.model.combinations
    .filter((item) => item.valueKeys.every((key) => active.has(key)))
    .map((item) => {
      const variantId = variants.get(canonical(item.valueKeys));
      if (!variantId)
        throw new CatalogueAdoptionError(
          "Activated projection variant binding is incomplete.",
        );
      return {
        valueKeys: [...item.valueKeys],
        variantId,
        price: item.price,
        inventory: item.inventory,
      };
    });
  return {
    catalogueId: spec.catalogueId,
    slug: spec.slug,
    details: structuredClone(spec.model.details),
    choices,
    combinations,
    images: [...spec.providerBindings.imageBindings]
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        url: `/catalogue-products-api?catalogueId=${encodeURIComponent(spec.catalogueId)}&mediaId=${encodeURIComponent(item.mediaId)}`,
        order: item.order,
        assignment: item.assignment,
      })),
    bundleProductId: spec.bundleProductId,
    ...(spec.managementProfile
      ? {
          managementDomain: "SIM" as const,
          minimumOrderQuantity: SIM_ADOPTION_MINIMUM_ORDER_QUANTITY as 2,
          requiresSimAssignment: true as const,
          tracksInventory: true as const,
          shippingGroup: "sim" as const,
        }
      : {}),
  };
}
export function enrichCatalogueProductWithAdoption<T extends Row>(
  product: T,
  adoption: CatalogueAdoptionRecord | null,
) {
  if (
    adoption?.status !== "active" ||
    adoption.catalogueId !== product.catalogueId ||
    adoption.bundleProductId !== product.currentBundleProductId ||
    adoption.managementProfile?.domain !== "SIM"
  )
    return product;
  const model = object(product.model) ? product.model : {};
  const details = object(model.details) ? model.details : {};
  return {
    ...product,
    model: {
      ...model,
      details: {
        ...details,
        category: "SIM Card",
      },
    },
    managementDomain: "SIM" as const,
    minimumOrderQuantity: SIM_ADOPTION_MINIMUM_ORDER_QUANTITY as 2,
    providerFingerprint: adoption.sourceFingerprint,
    lockedFields: [...SIM_ADOPTION_LOCKED_FIELDS],
    capabilities: { saveSimChanges: true },
  };
}
async function verifyAudits(spec: LegacyAdoptionSpec) {
  for (const item of spec.evidence.auditFiles) {
    let body;
    try {
      body = await readFile(item.path);
    } catch {
      throw new CatalogueAdoptionError(
        `Required audit artifact is unavailable: ${item.path}.`,
        400,
      );
    }
    if (hash(body) !== item.sha256)
      throw new CatalogueAdoptionError(
        `Audit artifact drift detected: ${item.path}.`,
        409,
      );
  }
}
async function verifyActivatedMedia(root: string, spec: LegacyAdoptionSpec) {
  const directory = mediaDirectory(root, spec.catalogueId),
    expected = [...spec.providerBindings.imageBindings].sort(
      (a, b) => a.order - b.order,
    ),
    expectedNames = [
      "manifest.json",
      ...expected.map((item) => `${item.mediaId}.bin`),
    ].sort();
  await assertSafeAncestors(path.join(directory, "entry"));
  const directoryStat = await statOrNull(directory);
  if (
    !directoryStat ||
    directoryStat.isSymbolicLink() ||
    !directoryStat.isDirectory()
  )
    throw new CatalogueAdoptionError(
      "Activated legacy media directory is unsafe or incomplete.",
      500,
    );
  const names = (await readdir(directory)).sort();
  if (!isDeepStrictEqual(names, expectedNames))
    throw new CatalogueAdoptionError(
      "Activated legacy media manifest or file set does not match the approved spec.",
    );
  let parsed: unknown;
  try {
    const handle = await open(
      path.join(directory, "manifest.json"),
      constants.O_RDONLY | NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024)
        throw new Error("invalid manifest");
      parsed = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    throw new CatalogueAdoptionError(
      "Activated legacy media manifest is corrupt.",
      500,
    );
  }
  if (
    !object(parsed) ||
    !exact(parsed, ["media"]) ||
    !Array.isArray(parsed.media) ||
    parsed.media.length !== expected.length
  )
    throw new CatalogueAdoptionError(
      "Activated legacy media manifest does not match the approved spec.",
    );
  for (let index = 0; index < expected.length; index++) {
    const item = expected[index],
      metadata = parsed.media[index];
    const expectedMetadata = {
      mediaId: item.mediaId,
      catalogueId: spec.catalogueId,
      originalName: `legacy-${item.imageId}.${item.contentType === "image/png" ? "png" : item.contentType === "image/jpeg" ? "jpg" : "webp"}`,
      contentType: item.contentType,
      bytes: item.bytes,
      sha256: item.sha256,
      order: item.order,
      assignment: item.assignment,
    };
    if (
      !object(metadata) ||
      !exact(metadata, [...Object.keys(expectedMetadata), "createdAt"]) ||
      !timestamp(metadata.createdAt) ||
      Object.entries(expectedMetadata).some(
        ([key, value]) => metadata[key] !== value,
      )
    )
      throw new CatalogueAdoptionError(
        `Activated legacy media metadata drift for image ${item.imageId}.`,
      );
    let body: Buffer;
    try {
      const handle = await open(
        path.join(directory, `${item.mediaId}.bin`),
        constants.O_RDONLY | NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== item.bytes)
          throw new Error("invalid binary");
        body = await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch {
      throw new CatalogueAdoptionError(
        `Activated legacy media file is unsafe or incomplete for image ${item.imageId}.`,
        500,
      );
    }
    if (
      body.length !== item.bytes ||
      hash(body) !== item.sha256 ||
      !signature(item.contentType, body)
    )
      throw new CatalogueAdoptionError(
        `Activated legacy media digest, size or signature drift for image ${item.imageId}.`,
      );
  }
}
async function findBundleOwner(root: string, bundleId: number) {
  const directory = path.join(root, "catalogue-products");
  await assertSafeAncestors(path.join(directory, "entry"));
  let entries;
  try {
    entries = await readdir(directory);
  } catch (reason: any) {
    if (reason?.code === "ENOENT") return null;
    throw reason;
  }
  for (const name of entries) {
    if (!UUID.test(name.slice(0, -5)) || !name.endsWith(".json")) continue;
    const item = await readJson(path.join(directory, name));
    if (object(item) && item.currentBundleProductId === bundleId)
      return item.catalogueId as string;
  }
  return null;
}
function validateRecord(value: unknown, id: number): CatalogueAdoptionRecord {
  if (
    !object(value) ||
    value.version !== 1 ||
    !["active", "superseded"].includes(String(value.status)) ||
    value.bundleProductId !== id ||
    !UUID.test(String(value.catalogueId)) ||
    !DIGEST.test(String(value.sourceFingerprint)) ||
    !DIGEST.test(String(value.approvedSpecFingerprint)) ||
    !object(value.activatedProjection) ||
    !object(value.providerBindings) ||
    !object(value.exclusions) ||
    !object(value.evidence) ||
    !Array.isArray(value.mediaHashes) ||
    !Array.isArray(value.checkpoints) ||
    !timestamp(value.activatedAt) ||
    (value.supersededAt !== null && !timestamp(value.supersededAt)) ||
    (value.replacementBundleProductId !== null &&
      !positive(value.replacementBundleProductId))
  )
    throw new CatalogueAdoptionError(
      `Catalogue adoption storage for Bundle ${id} is corrupt.`,
      500,
    );
  if (
    (value.status === "active" &&
      (value.supersededAt !== null ||
        value.replacementBundleProductId !== null)) ||
    (value.status === "superseded" &&
      (value.supersededAt === null ||
        value.replacementBundleProductId === null))
  )
    throw new CatalogueAdoptionError(
      `Catalogue adoption storage for Bundle ${id} is corrupt.`,
      500,
    );
  return value as CatalogueAdoptionRecord;
}
export async function readCatalogueAdoptionByBundle(
  bundleProductId: number,
  options: AdoptionReadOptions = {},
): Promise<CatalogueAdoptionRecord | null> {
  if (!positive(bundleProductId))
    throw new CatalogueAdoptionError(
      "A positive Bundle product ID is required.",
      400,
    );
  if (options.dataDirectory === undefined && dataApiEnabled()) {
    const document = await remoteDocument<CatalogueAdoptionRecord>('catalogue-adoptions', String(bundleProductId));
    return document ? structuredClone(validateRecord(document.value, bundleProductId)) : null;
  }
  const root = rootOf(options);
  if (!(await ensureSafeRoot(root, false))) return null;
  const value = await readJson(adoptionFile(root, bundleProductId));
  return value === null
    ? null
    : structuredClone(validateRecord(value, bundleProductId));
}

type ProjectionTransaction = {
  version: 1;
  productId: 39 | 40;
  catalogueId: string;
  beforeAdoption: Row;
  beforeProduct: Row;
  nextAdoption: Row;
  nextProduct: Row;
};

const projectionTransactionDirectory = (root: string, id: number) =>
  path.join(
    root,
    "catalogue-imports",
    "sim-projection-transactions",
    String(id),
  );

async function recoverProjectionTransaction(
  root: string,
  id: 39 | 40,
  options: AdoptionReadOptions,
) {
  const directory = projectionTransactionDirectory(root, id),
    journalPath = path.join(directory, "journal.json");
  const raw = await readJson(journalPath);
  if (raw === null) return null;
  if (
    !object(raw) ||
    raw.version !== 1 ||
    raw.productId !== id ||
    !UUID.test(String(raw.catalogueId)) ||
    !object(raw.beforeAdoption) ||
    !object(raw.beforeProduct) ||
    !object(raw.nextAdoption) ||
    !object(raw.nextProduct)
  )
    throw new CatalogueAdoptionError(
      "SIM projection recovery journal is corrupt.",
      500,
    );
  const journal = raw as ProjectionTransaction;
  const targets = [
    {
      name: "adoption-renamed" as const,
      target: adoptionFile(root, id),
      stage: path.join(directory, "adoption.next.json"),
      next: journal.nextAdoption,
    },
    {
      name: "product-renamed" as const,
      target: productFile(root, journal.catalogueId),
      stage: path.join(directory, "product.next.json"),
      next: journal.nextProduct,
    },
  ];
  for (const item of targets) {
    const live = await readJson(item.target);
    if (isDeepStrictEqual(live, item.next)) continue;
    if (
      !isDeepStrictEqual(
        live,
        item.name === "adoption-renamed"
          ? journal.beforeAdoption
          : journal.beforeProduct,
      )
    )
      throw new CatalogueAdoptionError(
        "SIM projection recovery found ambiguous live state.",
        500,
      );
    if ((await readJson(item.stage)) === null)
      await atomicJson(root, item.stage, item.next, true);
    await durableRename(root, item.stage, item.target);
    await options.afterProjectionRename?.(item.name);
  }
  if (
    !isDeepStrictEqual(
      await readJson(targets[0].target),
      journal.nextAdoption,
    ) ||
    !isDeepStrictEqual(await readJson(targets[1].target), journal.nextProduct)
  )
    throw new CatalogueAdoptionError(
      "SIM projection transaction verification failed.",
      500,
    );
  await rm(directory, { recursive: true, force: true });
  await syncDirectory(path.dirname(directory));
  return journal;
}

async function commitProjectionPair(
  root: string,
  id: 39 | 40,
  catalogueId: string,
  beforeAdoption: Row,
  beforeProduct: Row,
  nextAdoption: Row,
  nextProduct: Row,
  options: AdoptionReadOptions,
) {
  const directory = projectionTransactionDirectory(root, id);
  if (await statOrNull(directory))
    throw new CatalogueAdoptionError(
      "SIM projection transaction is already pending recovery.",
      503,
    );
  await ensureDirectory(root, directory);
  const journal: ProjectionTransaction = {
    version: 1,
    productId: id,
    catalogueId,
    beforeAdoption: structuredClone(beforeAdoption),
    beforeProduct: structuredClone(beforeProduct),
    nextAdoption: structuredClone(nextAdoption),
    nextProduct: structuredClone(nextProduct),
  };
  await atomicJson(
    root,
    path.join(directory, "adoption.before.json"),
    beforeAdoption,
    true,
  );
  await atomicJson(
    root,
    path.join(directory, "product.before.json"),
    beforeProduct,
    true,
  );
  await atomicJson(
    root,
    path.join(directory, "adoption.next.json"),
    nextAdoption,
    true,
  );
  await atomicJson(
    root,
    path.join(directory, "product.next.json"),
    nextProduct,
    true,
  );
  await atomicJson(root, path.join(directory, "journal.json"), journal, true);
  return recoverProjectionTransaction(root, id, options);
}

export async function verifySimVariantProjection(
  change: SimVariantProjectionChange,
  options: AdoptionReadOptions = {},
) {
  if (options.dataDirectory === undefined && dataApiEnabled()) {
    const adoptionDocument = await remoteDocument<CatalogueAdoptionRecord>('catalogue-adoptions', String(change.productId));
    if (!adoptionDocument) throw new CatalogueAdoptionError('SIM adoption is unavailable or not active.');
    const adoption = validateRecord(adoptionDocument.value, change.productId);
    const productDocument = await remoteDocument<Row>('catalogue-products', adoption.catalogueId);
    const product = productDocument?.value;
    const expected = change.mode === 'restore' ? change.expectedSourceFingerprint : change.providerFingerprint;
    const bundleVersions = object(product) && Array.isArray(product.bundleVersions) ? product.bundleVersions : [];
    if (adoption.status !== 'active' || !DIGEST.test(String(expected)) || adoption.sourceFingerprint !== expected
      || !object(product) || !object(bundleVersions[0]) || bundleVersions[0].fingerprint !== expected) {
      throw new CatalogueAdoptionError('SIM provider/Catalogue/adoption fingerprints are not synchronized.', 503);
    }
    if (change.mode === 'activate' && !isDeepStrictEqual(adoption.activatedProjection.combinations.map((item) => ({
      variantId: item.variantId, price: item.price, inventory: item.inventory,
    })), change.variants.map((item) => ({ variantId: item.variantId, price: item.price, inventory: item.inventory })))) {
      throw new CatalogueAdoptionError('SIM activated projection matrix is not synchronized.', 503);
    }
    return { catalogueId: adoption.catalogueId, fingerprint: expected };
  }
  const root = rootOf(options);
  await ensureSafeRoot(root);
  await recoverProjectionTransaction(root, change.productId, options);
  const adoption = await readCatalogueAdoptionByBundle(change.productId, {
    dataDirectory: root,
  });
  if (!adoption || adoption.status !== "active")
    throw new CatalogueAdoptionError(
      "SIM adoption is unavailable or not active.",
    );
  const product = await readJson(productFile(root, adoption.catalogueId));
  const expected =
    change.mode === "restore"
      ? change.expectedSourceFingerprint
      : change.providerFingerprint;
  const bundleVersions =
    object(product) && Array.isArray(product.bundleVersions)
      ? product.bundleVersions
      : [];
  if (
    !DIGEST.test(String(expected)) ||
    adoption.sourceFingerprint !== expected ||
    !object(product) ||
    !object(bundleVersions[0]) ||
    bundleVersions[0].fingerprint !== expected
  )
    throw new CatalogueAdoptionError(
      "SIM provider/Catalogue/adoption fingerprints are not synchronized.",
      503,
    );
  if (
    change.mode === "activate" &&
    !isDeepStrictEqual(
      adoption.activatedProjection.combinations.map((item) => ({
        variantId: item.variantId,
        price: item.price,
        inventory: item.inventory,
      })),
      change.variants.map((item) => ({
        variantId: item.variantId,
        price: item.price,
        inventory: item.inventory,
      })),
    )
  )
    throw new CatalogueAdoptionError(
      "SIM activated projection matrix is not synchronized.",
      503,
    );
  return { catalogueId: adoption.catalogueId, fingerprint: expected };
}

export async function synchronizeSimVariantProjection(
  change: SimVariantProjectionChange,
  options: AdoptionReadOptions = {},
) {
  if (
    !change ||
    !SIM_ADOPTION_BUNDLE_IDS.includes(change.productId) ||
    change.optionName !== "Variant" ||
    !["activate", "restore"].includes(change.mode)
  )
    throw new CatalogueAdoptionError(
      "Exact SIM variant projection change required.",
      400,
    );
  if (options.dataDirectory === undefined && dataApiEnabled()) {
    return withRemoteLease(`sim-projection-${change.productId}`, async () => {
      const adoptionDocument = await remoteDocument<CatalogueAdoptionRecord>('catalogue-adoptions', String(change.productId));
      if (!adoptionDocument) throw new CatalogueAdoptionError('SIM adoption is unavailable or not active.');
      const current = validateRecord(adoptionDocument.value, change.productId);
      const productDocument = await remoteDocument<Row>('catalogue-products', current.catalogueId);
      const product = productDocument?.value;
      if (current.status !== 'active' || current.managementProfile?.domain !== 'SIM' || !productDocument || !object(product)
        || !object(product.model) || product.currentBundleProductId !== change.productId || !Array.isArray(product.bundleVersions)
        || product.bundleVersions.length !== 1 || product.bundleVersions[0]?.fingerprint !== current.sourceFingerprint) {
        throw new CatalogueAdoptionError('SIM Catalogue/adoption projection is not synchronized.');
      }
      if (change.mode === 'restore') {
        await dataApiRequest(`/v1/sim-projections/${change.productId}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
            mode: 'restore', catalogueId: current.catalogueId,
            expectedAdoptionRevision: adoptionDocument.revision, expectedProductRevision: productDocument.revision,
          }),
        });
        return { mode: 'restore' as const, catalogueId: current.catalogueId };
      }
      if (current.sourceFingerprint === change.providerFingerprint) {
        return { mode: 'activate' as const, catalogueId: current.catalogueId, revision: Number(product.revision) };
      }
      if (current.sourceFingerprint !== change.expectedSourceFingerprint) throw new CatalogueAdoptionError('SIM adoption CAS fingerprint drifted.');
      if (!DIGEST.test(String(change.providerFingerprint)) || change.variants.length !== 2
        || !isDeepStrictEqual(change.variants.map((item) => item.label), ['Tone Excel', 'Tone Plus'])
        || new Set(change.variants.map((item) => item.valueId)).size !== 2
        || new Set(change.variants.map((item) => item.variantId)).size !== 2) {
        throw new CatalogueAdoptionError('Authoritative SIM provider bindings are incomplete.', 400);
      }
      const values = change.variants.map((item) => ({ key: item.valueKey, valueId: item.valueId, label: item.label, retired: false }));
      const combinations = change.variants.map((item) => ({ valueKeys: [item.valueKey], variantId: item.variantId,
        sku: item.sku, price: item.price, inventory: item.inventory }));
      const choices = [{ key: 'variant', optionId: change.optionId, name: 'Variant', values }];
      const model = { ...product.model, choices, combinations };
      const activatedProjection = { ...current.activatedProjection,
        choices: choices.map((choice) => ({ key: choice.key, name: choice.name,
          values: choice.values.map((value) => ({ key: value.key, label: value.label })) })),
        combinations: change.variants.map((item) => ({ valueKeys: [item.valueKey], variantId: item.variantId,
          price: item.price, inventory: item.inventory })) };
      const providerBindings = { ...current.providerBindings, optionIds: [change.optionId],
        valueBindings: change.variants.map((item) => ({ valueKey: item.valueKey, valueId: item.valueId })),
        variantBindings: change.variants.map((item) => ({ valueKeys: [item.valueKey], variantId: item.variantId })) };
      const evidence = { ...current.evidence, relationshipEvidence: change.variants.map((item) => ({
        valueKeys: [item.valueKey], kind: 'verified-recorded', reason: `Generated provider IDs read back after creating ${item.label}.`,
      })) };
      const nextAdoption = { ...current, sourceFingerprint: change.providerFingerprint!, activatedProjection, providerBindings,
        exclusions: { hiddenValueIds: [change.legacyValueId], orphanVariantIds: [change.legacyVariantId] }, evidence };
      const nextProduct = { ...product, revision: Number(product.revision) + 1, model,
        bundleVersions: [{ ...product.bundleVersions[0], fingerprint: change.providerFingerprint }], updatedAt: new Date().toISOString() };
      await dataApiRequest(`/v1/sim-projections/${change.productId}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          mode: 'activate', catalogueId: current.catalogueId,
          expectedAdoptionRevision: adoptionDocument.revision, expectedProductRevision: productDocument.revision,
          nextAdoption, nextProduct,
        }),
      });
      return { mode: 'activate' as const, catalogueId: current.catalogueId, revision: nextProduct.revision };
    });
  }
  const root = rootOf(options),
    key = `${root}\0${change.productId}`;
  return enqueue(key, async () => {
    await ensureSafeRoot(root);
    const recovered = await recoverProjectionTransaction(
      root,
      change.productId,
      options,
    );
    if (
      recovered &&
      change.mode === "activate" &&
      recovered.nextAdoption.sourceFingerprint === change.providerFingerprint
    )
      return {
        mode: "activate" as const,
        catalogueId: recovered.catalogueId,
        revision: Number(recovered.nextProduct.revision),
      };
    const current = await readCatalogueAdoptionByBundle(change.productId, {
      dataDirectory: root,
    });
    if (
      !current ||
      current.status !== "active" ||
      current.managementProfile?.domain !== "SIM"
    )
      throw new CatalogueAdoptionError(
        "SIM adoption is unavailable or not active.",
      );
    if (
      change.mode === "activate" &&
      current.sourceFingerprint !== change.expectedSourceFingerprint
    )
      throw new CatalogueAdoptionError("SIM adoption CAS fingerprint drifted.");
    const product = await readJson(productFile(root, current.catalogueId));
    if (
      !object(product) ||
      !object(product.model) ||
      product.currentBundleProductId !== change.productId ||
      !Array.isArray(product.bundleVersions) ||
      product.bundleVersions.length !== 1 ||
      product.bundleVersions[0]?.fingerprint !== current.sourceFingerprint
    )
      throw new CatalogueAdoptionError(
        "SIM Catalogue/adoption projection is not synchronized.",
      );
    const backup = path.join(
        root,
        "catalogue-imports",
        "sim-variant-projection-backups",
        `${change.productId}.json`,
      ),
      saved = await readJson(backup);
    if (change.mode === "restore") {
      if (!object(saved) || !object(saved.adoption) || !object(saved.product))
        throw new CatalogueAdoptionError(
          "SIM projection compensation backup is unavailable.",
          500,
        );
      await commitProjectionPair(
        root,
        change.productId,
        current.catalogueId,
        current as unknown as Row,
        product,
        saved.adoption,
        saved.product,
        options,
      );
      return { mode: "restore" as const, catalogueId: current.catalogueId };
    }
    if (
      !DIGEST.test(String(change.providerFingerprint)) ||
      change.variants.length !== 2 ||
      !isDeepStrictEqual(
        change.variants.map((item) => item.label),
        ["Tone Excel", "Tone Plus"],
      ) ||
      new Set(change.variants.map((item) => item.valueId)).size !== 2 ||
      new Set(change.variants.map((item) => item.variantId)).size !== 2
    )
      throw new CatalogueAdoptionError(
        "Authoritative SIM provider bindings are incomplete.",
        400,
      );
    await atomicJson(root, backup, { version: 1, adoption: current, product });
    const values = change.variants.map((item) => ({
      key: item.valueKey,
      valueId: item.valueId,
      label: item.label,
      retired: false,
    }));
    const combinations = change.variants.map((item) => ({
      valueKeys: [item.valueKey],
      variantId: item.variantId,
      sku: item.sku,
      price: item.price,
      inventory: item.inventory,
    }));
    const choices = [
      { key: "variant", optionId: change.optionId, name: "Variant", values },
    ];
    const model = { ...product.model, choices, combinations };
    const activatedProjection = {
      ...current.activatedProjection,
      choices: choices.map((choice) => ({
        key: choice.key,
        name: choice.name,
        values: choice.values.map((value) => ({
          key: value.key,
          label: value.label,
        })),
      })),
      combinations: change.variants.map((item) => ({
        valueKeys: [item.valueKey],
        variantId: item.variantId,
        price: item.price,
        inventory: item.inventory,
      })),
    };
    const providerBindings = {
      ...current.providerBindings,
      optionIds: [change.optionId],
      valueBindings: change.variants.map((item) => ({
        valueKey: item.valueKey,
        valueId: item.valueId,
      })),
      variantBindings: change.variants.map((item) => ({
        valueKeys: [item.valueKey],
        variantId: item.variantId,
      })),
    };
    const evidence = {
      ...current.evidence,
      relationshipEvidence: change.variants.map((item) => ({
        valueKeys: [item.valueKey],
        kind: "verified-recorded",
        reason: `Generated provider IDs read back after creating ${item.label}.`,
      })),
    };
    const nextAdoption = {
      ...current,
      sourceFingerprint: change.providerFingerprint!,
      activatedProjection,
      providerBindings,
      exclusions: {
        hiddenValueIds: [change.legacyValueId],
        orphanVariantIds: [change.legacyVariantId],
      },
      evidence,
    };
    const nextProduct = {
      ...product,
      revision: Number(product.revision) + 1,
      model,
      bundleVersions: [
        {
          ...product.bundleVersions[0],
          fingerprint: change.providerFingerprint,
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    // Recoverable, not atomic: a durable journal finishes either rename after a crash.
    await commitProjectionPair(
      root,
      change.productId,
      current.catalogueId,
      current as unknown as Row,
      product,
      nextAdoption,
      nextProduct,
      options,
    );
    return {
      mode: "activate" as const,
      catalogueId: current.catalogueId,
      revision: nextProduct.revision,
    };
  });
}
function expectedCompletedAdoption(
  spec: LegacyAdoptionSpec,
  specFingerprint: string,
  activatedAt: string,
): CatalogueAdoptionRecord {
  return {
    version: 1,
    status: "active",
    bundleProductId: spec.bundleProductId,
    catalogueId: spec.catalogueId,
    sourceFingerprint: spec.expectedSourceFingerprint,
    approvedSpecFingerprint: specFingerprint,
    activatedProjection: projection(spec),
    providerBindings: structuredClone(spec.providerBindings),
    exclusions: structuredClone(spec.exclusions),
    evidence: structuredClone(spec.evidence),
    ...(spec.managementProfile
      ? { managementProfile: structuredClone(spec.managementProfile) }
      : {}),
    mediaHashes: spec.providerBindings.imageBindings.map((item) => ({
      mediaId: item.mediaId,
      imageId: item.imageId,
      sha256: item.sha256,
      bytes: item.bytes,
      contentType: item.contentType,
      url: item.url,
    })),
    checkpoints: [
      "source-verified",
      "media-verified",
      "media-activated",
      "adoption-activated",
    ].map((name) => ({
      name: name as CheckpointName,
      completedAt: activatedAt,
    })),
    activatedAt,
    supersededAt: null,
    replacementBundleProductId: null,
  };
}
function expectedAdoptedProduct(spec: LegacyAdoptionSpec, activatedAt: string) {
  return {
    version: 1,
    catalogueId: spec.catalogueId,
    revision: 1,
    status: "published",
    slug: spec.slug,
    model: spec.model,
    currentBundleProductId: spec.bundleProductId,
    bundleVersions: [
      {
        bundleProductId: spec.bundleProductId,
        fingerprint: spec.expectedSourceFingerprint,
        publishedAt: activatedAt,
        retiredAt: null,
      },
    ],
    createdAt: activatedAt,
    updatedAt: activatedAt,
  };
}

export async function adoptLegacyBundleProduct(
  rawSpec: unknown,
  deps: AdoptionDependencies,
  options: AdoptionOptions = {},
) {
  const spec = validateSpec(rawSpec);
  if (
    !deps ||
    typeof deps.readBundleProduct !== "function" ||
    typeof deps.downloadMedia !== "function"
  )
    throw new CatalogueAdoptionError(
      "Read-only Bundle and media dependencies are required.",
      500,
    );
  const root = rootOf(options),
    key = `${root}\0${spec.bundleProductId}`;
  return enqueue(key, async () => {
    await ensureSafeRoot(root);
    const specFingerprint = hash(canonical(spec));
    const existing = await readCatalogueAdoptionByBundle(spec.bundleProductId, {
      dataDirectory: root,
    });
    if (existing) {
      if (
        existing.approvedSpecFingerprint !== specFingerprint ||
        existing.catalogueId !== spec.catalogueId
      )
        throw new CatalogueAdoptionError(
          "Legacy Bundle product is already adopted by a different exact spec.",
        );
      if (
        existing.status !== "active" ||
        !isDeepStrictEqual(
          existing,
          expectedCompletedAdoption(
            spec,
            specFingerprint,
            existing.activatedAt,
          ),
        )
      )
        throw new CatalogueAdoptionError(
          "Completed adoption record does not exactly match the approved spec.",
        );
      await verifyActivatedMedia(root, spec);
      const currentSource = await deps.readBundleProduct(spec.bundleProductId);
      if (
        fingerprintLegacyAdoptionSource(currentSource) !==
        spec.expectedSourceFingerprint
      )
        throw new CatalogueAdoptionError(
          "Bundle source fingerprint drift was detected.",
        );
      verifyMapping(spec, currentSource);
      const product = await readJson(productFile(root, spec.catalogueId));
      if (product) {
        if (
          !isDeepStrictEqual(
            product,
            expectedAdoptedProduct(spec, existing.activatedAt),
          )
        )
          throw new CatalogueAdoptionError(
            "Completed adoption Catalogue product does not exactly match the approved spec.",
          );
        return { adoption: existing, product, idempotent: true };
      }
      const resumed = await writeProduct(root, spec, existing);
      return { adoption: existing, product: resumed, idempotent: false };
    }
    const owner = await findBundleOwner(root, spec.bundleProductId);
    if (owner)
      throw new CatalogueAdoptionError(
        `Duplicate Bundle adoption: product ${spec.bundleProductId} is already owned by ${owner}.`,
      );
    await verifyAudits(spec);
    const raw = await deps.readBundleProduct(spec.bundleProductId);
    const actual = fingerprintLegacyAdoptionSource(raw);
    if (actual !== spec.expectedSourceFingerprint)
      throw new CatalogueAdoptionError(
        "Bundle source fingerprint drift was detected.",
      );
    verifyMapping(spec, raw);
    const now = (options.now || (() => new Date()))().toISOString();
    const checkpoint = async (name: CheckpointName) => {
      await options.afterCheckpoint?.(name);
    };
    await checkpoint("source-verified");
    const mediaTarget = mediaDirectory(root, spec.catalogueId);
    const priorMedia = await statOrNull(mediaTarget);
    if (priorMedia) {
      await verifyActivatedMedia(root, spec);
      await checkpoint("media-verified");
      await checkpoint("media-activated");
    } else {
      const staged = path.join(
        root,
        "catalogue-imports",
        "staging",
        `${spec.bundleProductId}-${specFingerprint}`,
      );
      await assertSafeAncestors(staged);
      const stagedStat = await statOrNull(staged);
      if (stagedStat) {
        if (stagedStat.isSymbolicLink() || !stagedStat.isDirectory())
          throw new CatalogueAdoptionError(
            "Unsafe staged media directory.",
            500,
          );
        await rm(staged, { recursive: true, force: true });
        await syncDirectory(path.dirname(staged));
      }
      await ensureDirectory(root, staged);
      const metadata = [];
      for (const item of [...spec.providerBindings.imageBindings].sort(
        (a, b) => a.order - b.order,
      )) {
        const downloaded = await deps.downloadMedia(item.url),
          body = Buffer.from(downloaded.body);
        if (
          downloaded.contentType !== item.contentType ||
          body.length !== item.bytes ||
          hash(body) !== item.sha256 ||
          !signature(item.contentType, body)
        )
          throw new CatalogueAdoptionError(
            `Legacy media digest, size, type or signature drift for image ${item.imageId}.`,
          );
        await fspWrite(root, path.join(staged, `${item.mediaId}.bin`), body);
        metadata.push({
          mediaId: item.mediaId,
          catalogueId: spec.catalogueId,
          originalName: `legacy-${item.imageId}.${item.contentType === "image/png" ? "png" : item.contentType === "image/jpeg" ? "jpg" : "webp"}`,
          contentType: item.contentType,
          bytes: item.bytes,
          sha256: item.sha256,
          order: item.order,
          assignment: item.assignment,
          createdAt: now,
        });
      }
      await fspWrite(
        root,
        path.join(staged, "manifest.json"),
        Buffer.from(`${JSON.stringify({ media: metadata }, null, 2)}\n`),
      );
      await checkpoint("media-verified");
      await ensureDirectory(root, path.dirname(mediaTarget));
      await durableRename(root, staged, mediaTarget);
      await checkpoint("media-activated");
    }
    const record: CatalogueAdoptionRecord = {
      version: 1,
      status: "active",
      bundleProductId: spec.bundleProductId,
      catalogueId: spec.catalogueId,
      sourceFingerprint: actual,
      approvedSpecFingerprint: specFingerprint,
      activatedProjection: projection(spec),
      providerBindings: structuredClone(spec.providerBindings),
      exclusions: structuredClone(spec.exclusions),
      evidence: structuredClone(spec.evidence),
      ...(spec.managementProfile
        ? { managementProfile: structuredClone(spec.managementProfile) }
        : {}),
      mediaHashes: spec.providerBindings.imageBindings.map((item) => ({
        mediaId: item.mediaId,
        imageId: item.imageId,
        sha256: item.sha256,
        bytes: item.bytes,
        contentType: item.contentType,
        url: item.url,
      })),
      checkpoints: [
        "source-verified",
        "media-verified",
        "media-activated",
        "adoption-activated",
      ].map((name) => ({ name: name as CheckpointName, completedAt: now })),
      activatedAt: now,
      supersededAt: null,
      replacementBundleProductId: null,
    };
    await atomicJson(
      root,
      adoptionFile(root, spec.bundleProductId),
      record,
      true,
    );
    await checkpoint("adoption-activated");
    const product = await writeProduct(root, spec, record);
    return { adoption: record, product, idempotent: false };
  });
}
async function fspWrite(root: string, target: string, body: Buffer) {
  await ensureDirectory(root, path.dirname(target));
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(body);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(target));
}
async function writeProduct(
  root: string,
  spec: LegacyAdoptionSpec,
  record: CatalogueAdoptionRecord,
) {
  const target = productFile(root, spec.catalogueId),
    existing = await readJson(target);
  if (existing) {
    if (
      object(existing) &&
      existing.currentBundleProductId === spec.bundleProductId
    )
      return existing;
    throw new CatalogueAdoptionError(
      "Catalogue product ID is already occupied.",
    );
  }
  const now = record.activatedAt;
  const product = {
    version: 1,
    catalogueId: spec.catalogueId,
    revision: 1,
    status: "published",
    slug: spec.slug,
    model: spec.model,
    currentBundleProductId: spec.bundleProductId,
    bundleVersions: [
      {
        bundleProductId: spec.bundleProductId,
        fingerprint: spec.expectedSourceFingerprint,
        publishedAt: now,
        retiredAt: null,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  await atomicJson(root, target, product, true);
  return product;
}
export async function supersedeCatalogueAdoption(
  bundleProductId: number,
  replacementBundleProductId: number,
  options: AdoptionOptions = {},
) {
  if (
    !positive(replacementBundleProductId) ||
    replacementBundleProductId === bundleProductId
  )
    throw new CatalogueAdoptionError(
      "A distinct positive replacement Bundle product ID is required.",
      400,
    );
  if (options.dataDirectory === undefined && dataApiEnabled()) {
    const document = await remoteDocument<CatalogueAdoptionRecord>('catalogue-adoptions', String(bundleProductId));
    if (!document) throw new CatalogueAdoptionError('Catalogue adoption was not found.', 404);
    const current = validateRecord(document.value, bundleProductId);
    if (current.managementProfile?.domain === 'SIM' && current.status === 'active') throw new CatalogueAdoptionError('Active SIM adoption has a locked field policy and cannot be replaced by the generic publication workflow.');
    if (current.status === 'superseded') {
      if (current.replacementBundleProductId !== replacementBundleProductId) throw new CatalogueAdoptionError('Adoption is already superseded by a different replacement.');
      return current;
    }
    const now = (options.now || (() => new Date()))().toISOString();
    const next = validateRecord({...current,status:'superseded',supersededAt:now,replacementBundleProductId},bundleProductId);
    return validateRecord((await replaceRemoteDocument('catalogue-adoptions',String(bundleProductId),document.revision,next,{revision:document.revision+1,createdAt:current.activatedAt,updatedAt:now})).value,bundleProductId);
  }
  const root = rootOf(options);
  return enqueue(`${root}\0${bundleProductId}`, async () => {
    await ensureSafeRoot(root);
    const current = await readCatalogueAdoptionByBundle(bundleProductId, {
      dataDirectory: root,
    });
    if (!current)
      throw new CatalogueAdoptionError(
        "Catalogue adoption was not found.",
        404,
      );
    if (
      current.managementProfile?.domain === "SIM" &&
      current.status === "active"
    )
      throw new CatalogueAdoptionError(
        "Active SIM adoption has a locked field policy and cannot be replaced by the generic publication workflow.",
      );
    if (current.status === "superseded") {
      if (current.replacementBundleProductId !== replacementBundleProductId)
        throw new CatalogueAdoptionError(
          "Adoption is already superseded by a different replacement.",
        );
      return current;
    }
    const next = {
      ...current,
      status: "superseded" as const,
      supersededAt: (options.now || (() => new Date()))().toISOString(),
      replacementBundleProductId,
    };
    await atomicJson(root, adoptionFile(root, bundleProductId), next);
    return next;
  });
}

type RollbackJournal = {
  version: 1;
  bundleProductId: number;
  catalogueId: string;
  archiveId: string;
  rolledBackAt: string;
  status: "moving" | "completed";
  completedMoves: RollbackCheckpointName[];
  adoptionFingerprint: string;
};
function validateJournal(
  value: unknown,
  bundleProductId: number,
  archiveId: string,
): RollbackJournal {
  const ordered: RollbackCheckpointName[] = [
    "adoption-moved",
    "media-moved",
    "product-moved",
  ];
  if (
    !object(value) ||
    !exact(value, [
      "version",
      "bundleProductId",
      "catalogueId",
      "archiveId",
      "rolledBackAt",
      "status",
      "completedMoves",
      "adoptionFingerprint",
    ]) ||
    value.version !== 1 ||
    value.bundleProductId !== bundleProductId ||
    value.archiveId !== archiveId ||
    !UUID.test(String(value.catalogueId)) ||
    !timestamp(value.rolledBackAt) ||
    String(value.rolledBackAt).replace(/[-:.]/g, "") !== archiveId ||
    !["moving", "completed"].includes(String(value.status)) ||
    !Array.isArray(value.completedMoves) ||
    !isDeepStrictEqual(
      value.completedMoves,
      ordered.slice(0, value.completedMoves.length),
    ) ||
    (value.status === "completed" &&
      value.completedMoves.length !== ordered.length) ||
    !DIGEST.test(String(value.adoptionFingerprint))
  )
    throw new CatalogueAdoptionError(
      "Rollback recovery journal is corrupt or incomplete.",
      500,
    );
  return value as RollbackJournal;
}
async function verifyRollbackPayload(
  archiveDirectory: string,
  journal: RollbackJournal,
) {
  const adoptionRaw = await readJson(
      path.join(archiveDirectory, "adoption.json"),
    ),
    adoption = validateRecord(adoptionRaw, journal.bundleProductId);
  if (
    adoption.status !== "active" ||
    adoption.catalogueId !== journal.catalogueId ||
    hash(canonical(adoption)) !== journal.adoptionFingerprint
  )
    throw new CatalogueAdoptionError(
      "Archived adoption record does not match its recovery journal.",
      500,
    );
  const product = await readJson(path.join(archiveDirectory, "product.json"));
  if (
    !object(product) ||
    product.catalogueId !== journal.catalogueId ||
    product.currentBundleProductId !== journal.bundleProductId ||
    !Array.isArray(product.bundleVersions) ||
    product.bundleVersions.length !== 1 ||
    product.bundleVersions[0]?.bundleProductId !== journal.bundleProductId
  )
    throw new CatalogueAdoptionError(
      "Archived Catalogue product is incomplete or ambiguous.",
      500,
    );
  const mediaRoot = path.join(archiveDirectory, "media"),
    mediaStat = await statOrNull(mediaRoot);
  if (!mediaStat || mediaStat.isSymbolicLink() || !mediaStat.isDirectory())
    throw new CatalogueAdoptionError(
      "Archived media directory is incomplete or unsafe.",
      500,
    );
  const bindings = [...adoption.providerBindings.imageBindings].sort(
      (a, b) => a.order - b.order,
    ),
    names = (await readdir(mediaRoot)).sort(),
    expectedNames = [
      "manifest.json",
      ...bindings.map((item) => `${item.mediaId}.bin`),
    ].sort();
  if (!isDeepStrictEqual(names, expectedNames))
    throw new CatalogueAdoptionError(
      "Archived media file set is incomplete.",
      500,
    );
  const mediaManifest = await readJson(path.join(mediaRoot, "manifest.json"));
  if (
    !object(mediaManifest) ||
    !exact(mediaManifest, ["media"]) ||
    !Array.isArray(mediaManifest.media) ||
    mediaManifest.media.length !== bindings.length
  )
    throw new CatalogueAdoptionError(
      "Archived media manifest is incomplete.",
      500,
    );
  for (const binding of bindings) {
    const metadata = mediaManifest.media.find(
      (item: unknown) => object(item) && item.mediaId === binding.mediaId,
    );
    if (
      !object(metadata) ||
      metadata.catalogueId !== journal.catalogueId ||
      metadata.sha256 !== binding.sha256 ||
      metadata.bytes !== binding.bytes ||
      metadata.contentType !== binding.contentType ||
      metadata.order !== binding.order ||
      metadata.assignment !== binding.assignment
    )
      throw new CatalogueAdoptionError(
        "Archived media metadata does not match adoption evidence.",
        500,
      );
    const body = await readFile(path.join(mediaRoot, `${binding.mediaId}.bin`));
    if (
      body.length !== binding.bytes ||
      hash(body) !== binding.sha256 ||
      !signature(binding.contentType, body)
    )
      throw new CatalogueAdoptionError(
        "Archived media content does not match adoption evidence.",
        500,
      );
  }
  return {
    adoptionFingerprint: hash(canonical(adoption)),
    productFingerprint: hash(canonical(product)),
    mediaManifestFingerprint: hash(canonical(mediaManifest)),
  };
}
async function verifyCompletedRollback(
  archiveDirectory: string,
  journal: RollbackJournal,
) {
  if (
    journal.status !== "completed" ||
    !isDeepStrictEqual(journal.completedMoves, [
      "adoption-moved",
      "media-moved",
      "product-moved",
    ])
  )
    throw new CatalogueAdoptionError(
      "Rollback journal has not reached a verified completion checkpoint.",
      500,
    );
  const fingerprints = await verifyRollbackPayload(archiveDirectory, journal),
    manifest = await readJson(path.join(archiveDirectory, "manifest.json"));
  const expected = {
    version: 1,
    bundleProductId: journal.bundleProductId,
    catalogueId: journal.catalogueId,
    rolledBackAt: journal.rolledBackAt,
    files: ["adoption.json", "media", "product.json"],
    ...fingerprints,
  };
  if (!object(manifest) || !isDeepStrictEqual(manifest, expected))
    throw new CatalogueAdoptionError(
      "Rollback manifest is missing, incomplete or does not match archived files.",
      500,
    );
  return manifest;
}
async function verifyRollbackRemovedActiveState(
  root: string,
  journal: RollbackJournal,
) {
  for (const target of [
    adoptionFile(root, journal.bundleProductId),
    mediaDirectory(root, journal.catalogueId),
    productFile(root, journal.catalogueId),
  ])
    if (await statOrNull(target))
      throw new CatalogueAdoptionError(
        "Completed rollback still has active adoption state.",
        500,
      );
}

export async function rollbackCatalogueAdoption(
  bundleProductId: number,
  options: AdoptionOptions = {},
) {
  if (!positive(bundleProductId))
    throw new CatalogueAdoptionError(
      "A positive Bundle product ID is required.",
      400,
    );
  const root = rootOf(options);
  return enqueue(`${root}\0${bundleProductId}`, async () => {
    await ensureSafeRoot(root);
    const archiveRoot = path.join(
      root,
      "catalogue-imports",
      "rollback",
      String(bundleProductId),
    );
    await ensureDirectory(root, archiveRoot);
    let pending: { directory: string; journal: RollbackJournal } | null = null,
      completed: {
        directory: string;
        journal: RollbackJournal;
        manifest: Row;
      } | null = null;
    const archiveNames = (await readdir(archiveRoot)).sort().reverse();
    for (const archiveId of archiveNames) {
      const directory = path.join(archiveRoot, archiveId),
        stat = await statOrNull(directory);
      if (!stat || stat.isSymbolicLink() || !stat.isDirectory())
        throw new CatalogueAdoptionError(
          "Rollback archive contains an unsafe entry.",
          500,
        );
      const raw = await readJson(path.join(directory, "journal.json"));
      if (raw === null)
        throw new CatalogueAdoptionError(
          "Incomplete rollback directory has no durable recovery journal.",
          500,
        );
      const journal = validateJournal(raw, bundleProductId, archiveId);
      if (journal.status === "completed") {
        const manifest = await verifyCompletedRollback(directory, journal);
        await verifyRollbackRemovedActiveState(root, journal);
        if (!completed) completed = { directory, journal, manifest };
        continue;
      }
      if (pending)
        throw new CatalogueAdoptionError(
          "Multiple incomplete rollback journals require manual recovery.",
          500,
        );
      pending = { directory, journal };
    }
    if (!pending && completed)
      return {
        idempotent: true,
        archiveDirectory: completed.directory,
        manifest: completed.manifest,
      };
    let current = await readCatalogueAdoptionByBundle(bundleProductId, {
        dataDirectory: root,
      }),
      archiveDirectory: string,
      journal: RollbackJournal;
    if (pending) {
      archiveDirectory = pending.directory;
      journal = pending.journal;
      if (
        current &&
        (current.catalogueId !== journal.catalogueId ||
          hash(canonical(current)) !== journal.adoptionFingerprint)
      )
        throw new CatalogueAdoptionError(
          "Active adoption does not match the rollback recovery journal.",
          500,
        );
    } else {
      if (!current)
        throw new CatalogueAdoptionError(
          "Catalogue adoption was not found.",
          404,
        );
      if (current.status === "superseded")
        throw new CatalogueAdoptionError(
          "Superseded adoption with a normal replacement cannot be rolled back.",
        );
      const product = await readJson(productFile(root, current.catalogueId));
      if (
        !object(product) ||
        product.currentBundleProductId !== bundleProductId ||
        !Array.isArray(product.bundleVersions) ||
        product.bundleVersions.length !== 1
      )
        throw new CatalogueAdoptionError(
          "Adoption rollback is blocked because Catalogue replacement state is ambiguous.",
        );
      const rolledBackAt = (options.now || (() => new Date()))().toISOString(),
        archiveId = rolledBackAt.replace(/[-:.]/g, "");
      archiveDirectory = path.join(archiveRoot, archiveId);
      if (await statOrNull(archiveDirectory))
        throw new CatalogueAdoptionError(
          "Rollback archive checkpoint already exists.",
          500,
        );
      await ensureDirectory(root, archiveDirectory);
      journal = {
        version: 1,
        bundleProductId,
        catalogueId: current.catalogueId,
        archiveId,
        rolledBackAt,
        status: "moving",
        completedMoves: [],
        adoptionFingerprint: hash(canonical(current)),
      };
      await atomicJson(
        root,
        path.join(archiveDirectory, "journal.json"),
        journal,
        true,
      );
    }
    const moves: Array<{
      name: RollbackCheckpointName;
      source: string;
      destination: string;
    }> = [
      {
        name: "adoption-moved",
        source: adoptionFile(root, bundleProductId),
        destination: path.join(archiveDirectory, "adoption.json"),
      },
      {
        name: "media-moved",
        source: mediaDirectory(root, journal.catalogueId),
        destination: path.join(archiveDirectory, "media"),
      },
      {
        name: "product-moved",
        source: productFile(root, journal.catalogueId),
        destination: path.join(archiveDirectory, "product.json"),
      },
    ];
    for (const move of moves) {
      const source = await statOrNull(move.source),
        destination = await statOrNull(move.destination);
      if ((source && destination) || (!source && !destination))
        throw new CatalogueAdoptionError(
          `Rollback checkpoint ${move.name} is ambiguous.`,
          500,
        );
      if (source) {
        if (source.isSymbolicLink())
          throw new CatalogueAdoptionError(
            `Rollback source ${move.name} is unsafe.`,
            500,
          );
        await durableRename(root, move.source, move.destination);
      }
      if (!journal.completedMoves.includes(move.name)) {
        journal = {
          ...journal,
          completedMoves: [...journal.completedMoves, move.name],
        };
        await atomicJson(
          root,
          path.join(archiveDirectory, "journal.json"),
          journal,
        );
      }
      await options.afterRollbackCheckpoint?.(move.name);
    }
    const fingerprints = await verifyRollbackPayload(archiveDirectory, journal),
      manifest = {
        version: 1,
        bundleProductId,
        catalogueId: journal.catalogueId,
        rolledBackAt: journal.rolledBackAt,
        files: ["adoption.json", "media", "product.json"],
        ...fingerprints,
      };
    const existingManifest = await readJson(
      path.join(archiveDirectory, "manifest.json"),
    );
    if (existingManifest === null)
      await atomicJson(
        root,
        path.join(archiveDirectory, "manifest.json"),
        manifest,
        true,
      );
    else if (!isDeepStrictEqual(existingManifest, manifest))
      throw new CatalogueAdoptionError(
        "Rollback manifest conflicts with verified archived files.",
        500,
      );
    journal = { ...journal, status: "completed" };
    await atomicJson(
      root,
      path.join(archiveDirectory, "journal.json"),
      journal,
    );
    await verifyCompletedRollback(archiveDirectory, journal);
    return { idempotent: false, archiveDirectory, manifest };
  });
}
