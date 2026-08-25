import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { createRemoteDocument, dataApiEnabled, remoteDocument, replaceRemoteDocument, withRemoteLease } from "../dataApiClient.server";

export type SimToneVariantBinding = {
  label: "Tone Excel" | "Tone Plus";
  valueId: number;
  variantId: number;
  sku: string;
};
export type SimVariantMigrationPhase =
  | "prepared"
  | "provider-mutating"
  | "provider-verified"
  | "projection-synced"
  | "compensating"
  | "compensated"
  | "complete";
export type SimVariantMigrationJob = {
  version: 1;
  operationId: string;
  requestFingerprint: string;
  productId: 39 | 40;
  revision: number;
  phase: SimVariantMigrationPhase;
  before: unknown | null;
  bindings: SimToneVariantBinding[];
  completedSteps: string[];
  reconciledTimeouts: string[];
  providerFingerprint: string | null;
  projectionActivated: boolean;
  createdAt: string;
  updatedAt: string;
};
export type SimVariantMigrationStore = {
  withProductLock<T>(productId: 39 | 40, run: () => Promise<T>): Promise<T>;
  read(id: string): Promise<SimVariantMigrationJob | null>;
  create(
    input: Pick<
      SimVariantMigrationJob,
      "operationId" | "requestFingerprint" | "productId"
    >,
  ): Promise<SimVariantMigrationJob>;
  update(
    id: string,
    revision: number,
    mutate: (
      job: SimVariantMigrationJob,
    ) => SimVariantMigrationJob | Promise<SimVariantMigrationJob>,
  ): Promise<SimVariantMigrationJob>;
};

const HASH = /^[a-f0-9]{64}$/;
const queues = new Map<string, Promise<void>>();
const APP_DATA_ROOT = "/www/wwwroot/tonewow.xifuhalim.com/.data";
export const simDataRoot = (
  candidate = process.env.TONEWOW_DATA_DIR || APP_DATA_ROOT,
) => {
  if (!path.isAbsolute(candidate) || path.normalize(candidate) !== candidate)
    throw new Error("ToneWow data root must be an absolute normalized path.");
  return candidate;
};

function valid(value: any, id?: string): value is SimVariantMigrationJob {
  return (
    value?.version === 1 &&
    HASH.test(value.operationId) &&
    (!id || value.operationId === id) &&
    HASH.test(value.requestFingerprint) &&
    [39, 40].includes(value.productId) &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    [
      "prepared",
      "provider-mutating",
      "provider-verified",
      "projection-synced",
      "compensating",
      "compensated",
      "complete",
    ].includes(value.phase) &&
    Array.isArray(value.bindings) &&
    value.bindings.every(
      (binding: any) =>
        ["Tone Excel", "Tone Plus"].includes(binding?.label) &&
        Number.isSafeInteger(binding.valueId) &&
        binding.valueId > 0 &&
        Number.isSafeInteger(binding.variantId) &&
        binding.variantId > 0 &&
        typeof binding.sku === "string" &&
        binding.sku,
    ) &&
    Array.isArray(value.completedSteps) &&
    Array.isArray(value.reconciledTimeouts) &&
    (value.providerFingerprint === null ||
      HASH.test(value.providerFingerprint)) &&
    typeof value.projectionActivated === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

const file = (id: string, directory: string) =>
  path.join(directory, `${id}.json`);
async function atomic(job: SimVariantMigrationJob, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const target = file(job.operationId, directory),
    temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(job, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, target);
    await chmod(target, 0o600);
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (reason) {
    try {
      await handle?.close();
    } catch {}
    try {
      await unlink(temp);
    } catch {}
    throw reason;
  }
}
function queued<T>(key: string, run: () => Promise<T>) {
  const prior = queues.get(key) || Promise.resolve(),
    result = prior.then(run, run),
    tail = result.then(
      () => undefined,
      () => undefined,
    );
  queues.set(key, tail);
  return result.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
}

export function createSimVariantMigrationStore(
  dataRoot?: string,
): SimVariantMigrationStore {
  const remote=dataRoot===undefined&&dataApiEnabled(),root = simDataRoot(dataRoot),
    directory = path.join(root, "sim-tone-variant-migrations"),
    locks = path.join(root, "sim-product-locks");
  return {
    async withProductLock(productId, run) {
      if (productId !== 39 && productId !== 40)
        throw new Error("Valid SIM product lock ID required.");
      if(remote)return withRemoteLease(`sim-product-${productId}`,run);
      const lock = path.join(locks, `product-${productId}.lock`);
      await mkdir(locks, { recursive: true, mode: 0o700 });
      await chmod(locks, 0o700);
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          await mkdir(lock, { mode: 0o700 });
          break;
        } catch (reason: any) {
          if (reason?.code !== "EEXIST") throw reason;
          if (Date.now() >= deadline)
            throw new Error(`SIM product ${productId} lock is already held.`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      try {
        return await run();
      } finally {
        await rmdir(lock);
      }
    },
    async read(id) {
      if (!HASH.test(id))
        throw new Error("Valid SIM migration operation ID required.");
      if(remote){const document=await remoteDocument<SimVariantMigrationJob>('sim-tone-variant-migrations',id);if(!document)return null;if(document.revision!==document.value.revision||!valid(document.value,id))throw new Error("SIM migration checkpoint is corrupt.");return structuredClone(document.value);}
      try {
        const value = JSON.parse(await readFile(file(id, directory), "utf8"));
        if (!valid(value, id)) throw new Error();
        return structuredClone(value);
      } catch (reason: any) {
        if (reason?.code === "ENOENT") return null;
        throw new Error("SIM migration checkpoint is corrupt.");
      }
    },
    async create(input) {
      if (
        !input ||
        !HASH.test(input.operationId) ||
        !HASH.test(input.requestFingerprint) ||
        ![39, 40].includes(input.productId)
      )
        throw new Error("Valid SIM migration checkpoint input required.");
      return queued(input.operationId, async () => {
        if (await this.read(input.operationId))
          throw new Error("SIM migration checkpoint already exists.");
        const now = new Date().toISOString();
        const job: SimVariantMigrationJob = {
          version: 1,
          ...input,
          revision: 1,
          phase: "prepared",
          before: null,
          bindings: [],
          completedSteps: [],
          reconciledTimeouts: [],
          providerFingerprint: null,
          projectionActivated: false,
          createdAt: now,
          updatedAt: now,
        };
        if(remote)await createRemoteDocument('sim-tone-variant-migrations',job.operationId,job);
        else await atomic(job, directory);
        return structuredClone(job);
      });
    },
    async update(id, revision, mutate) {
      return queued(id, async () => {
        const current = await this.read(id);
        if (!current) throw new Error("SIM migration checkpoint not found.");
        if (current.revision !== revision)
          throw new Error(
            `SIM migration checkpoint revision conflict: expected ${revision}, found ${current.revision}.`,
          );
        const proposed = await mutate(structuredClone(current));
        const next = {
          ...proposed,
          version: 1 as const,
          operationId: current.operationId,
          requestFingerprint: current.requestFingerprint,
          productId: current.productId,
          revision: revision + 1,
          createdAt: current.createdAt,
          updatedAt: new Date().toISOString(),
        };
        if (!valid(next, id))
          throw new Error("Invalid SIM migration checkpoint mutation.");
        if(remote)await replaceRemoteDocument('sim-tone-variant-migrations',id,revision,next);
        else await atomic(next, directory);
        return structuredClone(next);
      });
    },
  };
}
export const defaultSimVariantMigrationStore = createSimVariantMigrationStore();
