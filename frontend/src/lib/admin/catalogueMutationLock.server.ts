import { dataApiEnabled, dataApiRequest, ToneWowDataApiError } from '@/lib/dataApiClient.server';

export class CatalogueMutationBusyError extends Error {
  readonly status = 409;
  constructor() {
    super('This product is being published or updated. Wait for it to finish before editing, changing photos, or publishing again.');
    this.name = 'CatalogueMutationBusyError';
  }
}

const localLocks = new Set<string>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// One shared product lock covers publication, edits and media mutations across
// Vercel instances. A busy request fails before its action can mutate anything.
// The 600s lease exceeds the publication route's explicit Vercel 300s limit;
// PM2 deployments must enforce that bound or add renewal before clustering.
export async function withCatalogueMutationLock<T>(catalogueId: string, action: () => Promise<T>): Promise<T> {
  if (!UUID.test(catalogueId)) throw new Error('A valid catalogue ID is required.');
  if (localLocks.has(catalogueId)) throw new CatalogueMutationBusyError();
  localLocks.add(catalogueId);
  let lease: { token: string } | undefined;
  const leasePath = `/v1/locks/${encodeURIComponent(`catalogue-mutation:${catalogueId}`)}`;
  try {
    if (dataApiEnabled()) {
      try {
        lease = await dataApiRequest<{ token: string }>(leasePath, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ttlSeconds: 600 }),
        });
        if (!lease || typeof lease.token !== 'string' || !lease.token.trim()) throw new Error('Product mutation lock could not be verified.');
      } catch (reason) {
        if (reason instanceof ToneWowDataApiError && reason.code === 'LEASE_HELD') throw new CatalogueMutationBusyError();
        throw reason;
      }
    }
    return await action();
  } finally {
    if (lease && typeof lease.token === 'string' && lease.token.trim()) {
      // Failed release stays locked until expiry; do not mask the action result.
      await dataApiRequest(leasePath, {
        method: 'DELETE', headers: { 'x-lease-token': lease.token },
      }).catch(() => undefined);
    }
    localLocks.delete(catalogueId);
  }
}

export function serializeCatalogueMutation<A extends [string, ...unknown[]], R>(action: (...args: A) => Promise<R>) {
  return (...args: A): Promise<R> => withCatalogueMutationLock(args[0], () => action(...args));
}
