import { createRemoteDocument, remoteDocument, replaceRemoteDocument, ToneWowDataApiError } from '@/lib/dataApiClient.server';

export type MerchandiseOrderEntry = { catalogueId: string; bundleProductId: number | null };
export type MerchandiseOrder = { revision: number; entries: MerchandiseOrderEntry[] };

const NAMESPACE = 'merchandise-order';
const KEY = 'all';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateMerchandiseOrderEntries(value: unknown): MerchandiseOrderEntry[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Product order must be a list of at most 1000 catalogue products.');
  const ids = new Set<string>();
  const entries = value.map((item): MerchandiseOrderEntry => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'bundleProductId,catalogueId'
      || typeof item.catalogueId !== 'string' || !UUID.test(item.catalogueId)
      || item.bundleProductId !== null && (!Number.isSafeInteger(item.bundleProductId) || item.bundleProductId <= 0)
      || ids.has(item.catalogueId)) throw new Error('Product order contains an invalid or duplicate catalogue ID.');
    ids.add(item.catalogueId);
    return { catalogueId: item.catalogueId, bundleProductId: item.bundleProductId };
  });
  return entries;
}

export async function readMerchandiseOrder(): Promise<MerchandiseOrder> {
  const document = await remoteDocument<{ entries: MerchandiseOrderEntry[] }>(NAMESPACE, KEY);
  return document
    ? { revision: document.revision, entries: validateMerchandiseOrderEntries(document.value?.entries) }
    : { revision: 0, entries: [] };
}

export async function saveMerchandiseOrder(expectedRevision: number, entries: MerchandiseOrderEntry[]): Promise<MerchandiseOrder> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('A valid order revision is required.');
  const valid = validateMerchandiseOrderEntries(entries);
  const current = await remoteDocument<{ entries: MerchandiseOrderEntry[] }>(NAMESPACE, KEY);
  if ((current?.revision ?? 0) !== expectedRevision) throw new ToneWowDataApiError('Product order changed. Reload and try again.', 409, 'REVISION_CONFLICT');
  const now = new Date().toISOString();
  const document = current
    ? await replaceRemoteDocument(NAMESPACE, KEY, expectedRevision, { entries: valid }, { revision: expectedRevision + 1, createdAt: current.createdAt, updatedAt: now })
    : await createRemoteDocument(NAMESPACE, KEY, { entries: valid }, { revision: 1, createdAt: now, updatedAt: now });
  return { revision: document.revision, entries: valid };
}
