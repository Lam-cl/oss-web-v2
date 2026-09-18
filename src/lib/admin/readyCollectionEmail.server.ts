import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { orderDeliveryOption, type Order } from "@/lib/admin/types";
import { simDataRoot } from "@/lib/admin/simVariantMigrationStore.server";
import { createRemoteDocument, dataApiEnabled, remoteDocument, replaceRemoteDocument, withRemoteLease } from "@/lib/dataApiClient.server";

export type ReadyEmailPhase =
  | "status-updating"
  | "status-unknown"
  | "status-updated"
  | "attempting"
  | "sent"
  | "unknown"
  | "failed";
export type ReadyEmailMarker = {
  version: 2;
  orderId: number;
  phase: ReadyEmailPhase;
  updatedAt: string;
};
export type ReadyEmailResult =
  | { outcome: "sent" | "unknown" | "failed"; statusUpdated: true }
  | { outcome: "status-unknown"; statusUpdated: false };

export class ReadyCollectionEmailError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

const phases: ReadyEmailPhase[] = [
  "status-updating", "status-unknown", "status-updated", "attempting", "sent", "unknown", "failed",
];
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
const phaseMarker = (orderId: number, phase: ReadyEmailPhase): ReadyEmailMarker => ({
  version: 2,
  orderId,
  phase,
  updatedAt: new Date().toISOString(),
});

const parseMarker = (value: unknown, id: number): ReadyEmailMarker => {
  if (!value || typeof value !== "object") throw new Error();
  const candidate = value as Record<string, unknown>;
  if (candidate.orderId !== id || typeof candidate.updatedAt !== "string") throw new Error();
  if (candidate.version === 2 && phases.includes(candidate.phase as ReadyEmailPhase)) {
    return candidate as ReadyEmailMarker;
  }
  if (candidate.version === 1 && candidate.statusUpdated === true &&
    ["attempting", "sent", "unknown", "failed"].includes(String(candidate.outcome))) {
    return phaseMarker(id, candidate.outcome as ReadyEmailPhase);
  }
  throw new Error();
};

export function createReadyCollectionEmailStore(dataRoot?: string) {
  const remote=dataRoot===undefined&&dataApiEnabled(),root = simDataRoot(dataRoot);
  const directory = path.join(root, "ready-collection-email");
  const markerFile = (id: number) => path.join(directory, `${id}.json`);
  const lockFile = (id: number) => path.join(directory, `${id}.lock`);

  async function write(id: number, marker: ReadyEmailMarker) {
    if (!validId(id) || marker.orderId !== id || marker.version !== 2 ||
      !phases.includes(marker.phase) || typeof marker.updatedAt !== "string") throw new Error("Invalid ready-email marker.");
    if(remote){const current=await remoteDocument<ReadyEmailMarker>('ready-collection-email',String(id)),now=new Date().toISOString();if(current)await replaceRemoteDocument('ready-collection-email',String(id),current.revision,marker,{revision:current.revision+1,createdAt:current.createdAt,updatedAt:now});else await createRemoteDocument('ready-collection-email',String(id),marker,{revision:1,createdAt:now,updatedAt:now});return;}
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const target = markerFile(id);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(marker, null, 2)}\n`);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temp, target);
      await chmod(target, 0o600);
      const directoryHandle = await open(directory, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (reason) {
      try { await handle?.close(); } catch {}
      try { await unlink(temp); } catch {}
      throw reason;
    }
  }

  return {
    async read(id: number): Promise<ReadyEmailMarker | null> {
      if (!validId(id)) throw new Error("A positive order ID is required.");
      if(remote){const document=await remoteDocument<ReadyEmailMarker>('ready-collection-email',String(id));return document?parseMarker(document.value,id):null;}
      try {
        return parseMarker(JSON.parse(await readFile(markerFile(id), "utf8")), id);
      } catch (reason: any) {
        if (reason?.code === "ENOENT") return null;
        throw new Error("Ready-email marker is corrupt; operation stopped safely.");
      }
    },
    write,
    async withOrderLock<T>(id: number, run: () => Promise<T>): Promise<T> {
      if (!validId(id)) throw new Error("A positive order ID is required.");
      if(remote)return withRemoteLease(`ready-email-${id}`,run);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const lock = lockFile(id);
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          const handle = await open(lock, "wx", 0o600);
          await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
          await handle.sync();
          await handle.close();
          break;
        } catch (reason: any) {
          if (reason?.code !== "EEXIST") throw reason;
          try {
            const owner = JSON.parse(await readFile(lock, "utf8"));
            if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
              try { process.kill(owner.pid, 0); } catch (problem: any) {
                if (problem?.code === "ESRCH") { await unlink(lock); continue; }
              }
            }
          } catch {
            // ponytail: wait for an in-flight lock write; fail closed at the deadline.
            try { if (Date.now() - (await stat(lock)).mtimeMs > 60_000) throw new Error("Ready-email lock is corrupt; operation stopped safely."); } catch (problem: any) { if (problem?.code !== "ENOENT") throw problem; }
          }
          if (Date.now() >= deadline) throw new Error(`Ready-email order ${id} lock is already held.`);
          await pause();
        }
      }
      try { return await run(); }
      finally { await unlink(lock); }
    },
  };
}

export type ReadyCollectionAdapter = {
  store: ReturnType<typeof createReadyCollectionEmailStore>;
  readOrder: (id: number) => Promise<Order>;
  updateStatus: (id: number) => Promise<void>;
  sendEmail: (id: number) => Promise<Response>;
};

const result = (marker: ReadyEmailMarker): ReadyEmailResult => {
  if (["sent", "unknown", "failed"].includes(marker.phase)) {
    return { outcome: marker.phase as "sent" | "unknown" | "failed", statusUpdated: true };
  }
  if (marker.phase === "attempting") return { outcome: "unknown", statusUpdated: true };
  return { outcome: "status-unknown", statusUpdated: false };
};
const statusOf = (order: Order) => String(order.status).toUpperCase();
const isPickup = (order: Order) => orderDeliveryOption(order) === "PICKUP";
const isTransientStatusFailure = (reason: unknown) => {
  const status = Number((reason as { status?: unknown } | null)?.status);
  return !Number.isFinite(status) || status === 408 || status === 429 || status >= 500;
};

export async function orchestrateReadyCollectionEmail(
  orderId: number,
  requestedStatus: string,
  adapter: ReadyCollectionAdapter,
): Promise<ReadyEmailResult> {
  if (!validId(orderId)) throw new ReadyCollectionEmailError("A positive order ID is required.", 400);
  if (!["READY_FOR_COLLECTION", "PROCESSING"].includes(requestedStatus)) throw new ReadyCollectionEmailError("Requested status must be READY_FOR_COLLECTION or PROCESSING.", 400);
  return adapter.store.withOrderLock(orderId, async () => {
    const persist = async (phase: ReadyEmailPhase) => {
      const value = phaseMarker(orderId, phase);
      await adapter.store.write(orderId, value);
      return value;
    };
    const statusUnknown = (): ReadyEmailResult => ({ outcome: "status-unknown", statusUpdated: false });

    const reconcile = async (mayRetryStatus: boolean): Promise<boolean> => {
      let order: Order;
      try {
        order = await adapter.readOrder(orderId);
      } catch {
        await persist("status-unknown");
        return false;
      }
      if (!isPickup(order)) {
        await persist("status-unknown");
        return false;
      }
      const status = statusOf(order);
      if (status === "PROCESSING") {
        await persist("status-updated");
        return true;
      }
      if (status !== "PAID" || !mayRetryStatus) {
        await persist("status-unknown");
        return false;
      }

      await persist("status-updating");
      try {
        await adapter.updateStatus(orderId);
      } catch (reason) {
        if (!isTransientStatusFailure(reason)) {
          await persist("status-unknown");
          throw reason;
        }
        return reconcile(false);
      }
      await persist("status-updated");
      return true;
    };

    const existing = await adapter.store.read(orderId);
    if (existing) {
      if (["sent", "unknown", "failed"].includes(existing.phase)) return result(existing);
      if (existing.phase === "attempting") return result(await persist("unknown"));
      if (existing.phase === "status-updating" || existing.phase === "status-unknown") {
        if (!(await reconcile(true))) return statusUnknown();
      }
      // status-updated (or a reconciled status marker) is safe to continue to the email intent.
    } else {
      const order = await adapter.readOrder(orderId);
      if (!isPickup(order) || statusOf(order) !== "PAID") {
        throw new ReadyCollectionEmailError("Only a PAID pickup order can be marked Ready for Collection.");
      }
      await persist("status-updating");
      let statusUpdateSucceeded = false;
      try {
        await adapter.updateStatus(orderId);
        statusUpdateSucceeded = true;
      } catch (reason) {
        if (!isTransientStatusFailure(reason)) {
          await persist("status-unknown");
          throw reason;
        }
        if (!(await reconcile(true))) return statusUnknown();
      }
      if (statusUpdateSucceeded) await persist("status-updated");
    }

    await persist("attempting");
    let emailPhase: "sent" | "unknown" | "failed";
    try {
      const response = await adapter.sendEmail(orderId);
      emailPhase = response.ok ? "sent" : response.status >= 400 && response.status < 500 ? "failed" : "unknown";
    } catch {
      emailPhase = "unknown";
    }
    return result(await persist(emailPhase));
  });
}

export const defaultReadyCollectionEmailStore = createReadyCollectionEmailStore();
