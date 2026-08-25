export class AdminApiError extends Error {
  constructor(message: string, public status: number, public payload: Record<string, any>) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export async function adminFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/admin-api/${path.replace(/^\//, '')}`, { ...init, cache: 'no-store', headers: { ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...init?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error('Sesi anda telah tamat.');
  }
  if (!response.ok) throw new AdminApiError(payload.message || 'Permintaan tidak berjaya.', response.status, payload);
  return payload as T;
}
