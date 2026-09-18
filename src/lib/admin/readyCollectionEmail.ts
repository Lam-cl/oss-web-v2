import { adminFetch } from "@/lib/admin/client";

export type ReadyCollectionEmailResult =
  | { outcome: "sent" | "unknown" | "failed"; statusUpdated: true }
  | { outcome: "status-unknown"; statusUpdated: false };

export function markReadyForCollection(orderId: number) {
  return adminFetch<ReadyCollectionEmailResult>(
    `orders/${orderId}/ready-for-collection-email`,
    { method: "POST", body: JSON.stringify({ status: "READY_FOR_COLLECTION" }) },
  );
}
