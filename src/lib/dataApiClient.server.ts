type DataEnvelope<T> = { data: T };

export class ToneWowDataApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export function dataApiEnabled() {
  return Boolean(process.env.TONEWOW_DATA_API_URL?.trim() && process.env.TONEWOW_DATA_API_TOKEN?.trim());
}

export async function dataApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.TONEWOW_DATA_API_URL?.trim().replace(/\/$/, '');
  const token = process.env.TONEWOW_DATA_API_TOKEN?.trim();
  if (!base || !token) throw new ToneWowDataApiError('ToneWow Data API is not configured.', 503, 'NOT_CONFIGURED');
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...init.headers },
    cache: 'no-store',
    signal: init.signal || AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as DataEnvelope<T> | { error?: { code?: string; message?: string } } | null;
  if (!response.ok || !payload || !('data' in payload)) {
    const error = payload && 'error' in payload ? payload.error : null;
    throw new ToneWowDataApiError(error?.message || `ToneWow Data API request failed (${response.status}).`, response.status, error?.code || 'DATA_API_ERROR');
  }
  return payload.data;
}

export async function dataApiBinary(path: string): Promise<Buffer> {
  const base = process.env.TONEWOW_DATA_API_URL?.trim().replace(/\/$/, '');
  const token = process.env.TONEWOW_DATA_API_TOKEN?.trim();
  if (!base || !token) throw new ToneWowDataApiError('ToneWow Data API is not configured.', 503, 'NOT_CONFIGURED');
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ToneWowDataApiError(`ToneWow Data API binary request failed (${response.status}).`, response.status, 'DATA_API_ERROR');
  return Buffer.from(await response.arrayBuffer());
}

export type RemoteDocument<T> = { key: string; revision: number; value: T; createdAt: string; updatedAt: string };
export const remoteDocuments = <T>(namespace: string) => dataApiRequest<Array<RemoteDocument<T>>>(`/v1/state/${namespace}`);
export const remoteDocument = async <T>(namespace: string, key: string) => {
  try { return await dataApiRequest<RemoteDocument<T>>(`/v1/state/${namespace}/${encodeURIComponent(key)}`); }
  catch (error) { if (error instanceof ToneWowDataApiError && error.status === 404) return null; throw error; }
};
type DocumentMetadata = { revision: number; createdAt: string; updatedAt: string };
const metadataFor = <T>(value: T, metadata?: DocumentMetadata) => {
  if (metadata) return metadata;
  const candidate = value as T & Partial<DocumentMetadata>;
  if (!Number.isSafeInteger(candidate.revision) || !candidate.createdAt || !candidate.updatedAt) throw new Error('Remote document metadata is required.');
  return candidate as T & DocumentMetadata;
};
export const createRemoteDocument = <T>(namespace: string, key: string, value: T, metadata?: DocumentMetadata) => {
  const document = metadataFor(value, metadata);
  return (
  dataApiRequest<RemoteDocument<T>>(`/v1/state/${namespace}/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: document.revision, value, createdAt: document.createdAt, updatedAt: document.updatedAt }),
  }));
};
export const replaceRemoteDocument = <T>(namespace: string, key: string, expectedRevision: number, value: T, metadata?: DocumentMetadata) => {
  const document = metadataFor(value, metadata);
  return (
  dataApiRequest<RemoteDocument<T>>(`/v1/state/${namespace}/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-expected-revision': String(expectedRevision) },
    body: JSON.stringify({ revision: document.revision, value, createdAt: document.createdAt, updatedAt: document.updatedAt }),
  }));
};

export async function readRemoteSingleton<T>(namespace: string, fallback: () => T): Promise<T> {
  const document = await remoteDocument<T>(namespace, 'singleton');
  return document ? document.value : fallback();
}

export async function mutateRemoteSingleton<T>(namespace: string, fallback: () => T, mutate: (value: T) => T | Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await remoteDocument<T>(namespace, 'singleton');
    const value = await mutate(structuredClone(current?.value ?? fallback()));
    const now = new Date().toISOString();
    try {
      if (!current) await createRemoteDocument(namespace, 'singleton', value, { revision: 1, createdAt: now, updatedAt: now });
      else await replaceRemoteDocument(namespace, 'singleton', current.revision, value, { revision: current.revision + 1, createdAt: current.createdAt, updatedAt: now });
      return value;
    } catch (error) {
      if (!(error instanceof ToneWowDataApiError) || error.status !== 409 || attempt === 4) throw error;
    }
  }
  throw new ToneWowDataApiError('ToneWow Data API update did not converge.', 409, 'REVISION_CONFLICT');
}
