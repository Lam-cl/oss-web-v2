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
import { simDataRoot } from "./simVariantMigrationStore.server";

export type SimUpdatePhase =
  | "prepared"
  | "mutating"
  | "rolling-back"
  | "rolled-back"
  | "complete";
export type SimUpdateJob = {
  version: 1;
  operationId: string;
  requestFingerprint: string;
  productId: 39 | 40;
  variantId: 106 | 107;
  revision: number;
  phase: SimUpdatePhase;
  before: unknown | null;
  uploadedImageId: number | null;
  finalFingerprint: string | null;
  rollbackFingerprint: string | null;
  completedSteps: string[];
  reconciledTimeouts: string[];
  createdAt: string;
  updatedAt: string;
};
export type SimUpdateJobInput = Pick<
  SimUpdateJob,
  "operationId" | "requestFingerprint" | "productId" | "variantId"
>;
export type SimUpdateCheckpointStore = {
  withProductLock<T>(productId: 39 | 40, run: () => Promise<T>): Promise<T>;
  read(id: string): Promise<SimUpdateJob | null>;
  create(input: SimUpdateJobInput): Promise<SimUpdateJob>;
  update(
    id: string,
    revision: number,
    mutate: (job: SimUpdateJob) => SimUpdateJob | Promise<SimUpdateJob>,
  ): Promise<SimUpdateJob>;
};
const queues = new Map<string, Promise<void>>();
const validHash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const validOptionalHash = (v: unknown): v is string | null =>
  v === null || validHash(v);
const valid = (v: any, id?: string): v is SimUpdateJob =>
  v &&
  v.version === 1 &&
  validHash(v.operationId) &&
  (!id || v.operationId === id) &&
  validHash(v.requestFingerprint) &&
  ((v.productId === 39 && v.variantId === 106) ||
    (v.productId === 40 && v.variantId === 107)) &&
  Number.isSafeInteger(v.revision) &&
  v.revision > 0 &&
  ["prepared", "mutating", "rolling-back", "rolled-back", "complete"].includes(
    v.phase,
  ) &&
  validOptionalHash(v.finalFingerprint) &&
  validOptionalHash(v.rollbackFingerprint) &&
  Array.isArray(v.completedSteps) &&
  Array.isArray(v.reconciledTimeouts) &&
  typeof v.createdAt === "string" &&
  typeof v.updatedAt === "string";
const file = (id: string, dir: string) => path.join(dir, `${id}.json`);
async function atomic(job: SimUpdateJob, dir: string, exclusive = false) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const target = file(job.operationId, dir),
    temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let h;
  try {
    h = await open(temp, "wx", 0o600);
    await h.writeFile(`${JSON.stringify(job, null, 2)}\n`);
    await h.sync();
    await h.close();
    h = undefined;
    if (exclusive) {
      try {
        const x = await open(target, "wx", 0o600);
        await x.close();
      } catch (e: any) {
        if (e?.code === "EEXIST")
          throw new Error("SIM update checkpoint already exists.");
        throw e;
      }
    }
    await rename(temp, target);
    await chmod(target, 0o600);
    const d = await open(dir, "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } catch (e) {
    try {
      await h?.close();
    } catch {}
    try {
      await unlink(temp);
    } catch {}
    throw e;
  }
}
function queue<T>(key: string, fn: () => Promise<T>) {
  const prior = queues.get(key) ?? Promise.resolve(),
    run = prior.then(fn, fn),
    tail = run.then(
      () => undefined,
      () => undefined,
    );
  queues.set(key, tail);
  return run.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
}
export function createSimUpdateCheckpointStore(
  dataRoot?: string,
): SimUpdateCheckpointStore {
  const remote=dataRoot===undefined&&dataApiEnabled(),root = simDataRoot(dataRoot),
    directory = path.join(root, "sim-product-updates");
  return {
    // Atomic lock directories serialize all Node processes sharing this durable store. A crashed owner leaves the lock behind deliberately: recovery is operator-driven and fail-closed rather than risking concurrent mutations.
    async withProductLock(productId, run) {
      if (productId !== 39 && productId !== 40)
        throw new Error("Valid SIM product lock ID required.");
      if(remote)return withRemoteLease(`sim-product-${productId}`,run);
      const locks = path.join(root, "sim-product-locks"),
        lock = path.join(locks, `product-${productId}.lock`);
      await mkdir(locks, { recursive: true, mode: 0o700 });
      await chmod(locks, 0o700);
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          await mkdir(lock, { mode: 0o700 });
          break;
        } catch (e: any) {
          if (e?.code !== "EEXIST") throw e;
          if (Date.now() >= deadline)
            throw new Error(`SIM product ${productId} lock is already held.`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      try {
        return await run();
      } finally {
        await rmdir(lock);
      }
    },
    async read(id) {
      if (!validHash(id))
        throw new Error("Valid SIM update operation ID required.");
      if(remote){const document=await remoteDocument<SimUpdateJob>('sim-product-updates',id);if(!document)return null;if(document.revision!==document.value.revision||!valid(document.value,id))throw new Error("SIM update checkpoint is corrupt.");return structuredClone(document.value);}
      try {
        const value = JSON.parse(await readFile(file(id, directory), "utf8"));
        if (!valid(value, id)) throw new Error();
        return structuredClone(value);
      } catch (e: any) {
        if (e?.code === "ENOENT") return null;
        throw new Error("SIM update checkpoint is corrupt.");
      }
    },
    async create(input) {
      if (
        !input ||
        !validHash(input.operationId) ||
        !validHash(input.requestFingerprint) ||
        !(
          (input.productId === 39 && input.variantId === 106) ||
          (input.productId === 40 && input.variantId === 107)
        )
      )
        throw new Error("Valid SIM update checkpoint input required.");
      return queue(input.operationId, async () => {
        if (await this.read(input.operationId))
          throw new Error("SIM update checkpoint already exists.");
        const now = new Date().toISOString(),
          job: SimUpdateJob = {
            version: 1,
            ...input,
            revision: 1,
            phase: "prepared",
            before: null,
            uploadedImageId: null,
            finalFingerprint: null,
            rollbackFingerprint: null,
            completedSteps: [],
            reconciledTimeouts: [],
            createdAt: now,
            updatedAt: now,
          };
        if(remote)await createRemoteDocument('sim-product-updates',job.operationId,job);
        else await atomic(job, directory);
        return structuredClone(job);
      });
    },
    async update(id, revision, mutate) {
      return queue(id, async () => {
        const current = await this.read(id);
        if (!current) throw new Error("SIM update checkpoint not found.");
        if (current.revision !== revision)
          throw new Error(
            `SIM update checkpoint revision conflict: expected ${revision}, found ${current.revision}.`,
          );
        const proposed = await mutate(structuredClone(current));
        const next = {
          ...proposed,
          version: 1,
          operationId: current.operationId,
          requestFingerprint: current.requestFingerprint,
          productId: current.productId,
          variantId: current.variantId,
          revision: revision + 1,
          createdAt: current.createdAt,
          updatedAt: new Date().toISOString(),
        };
        if (!valid(next, id))
          throw new Error("Invalid SIM update checkpoint mutation.");
        if(remote)await replaceRemoteDocument('sim-product-updates',id,revision,next);
        else await atomic(next, directory);
        return structuredClone(next);
      });
    },
  };
}
export const defaultSimUpdateCheckpoints = createSimUpdateCheckpointStore();
