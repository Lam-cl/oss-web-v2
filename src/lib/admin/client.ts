export class AdminApiError extends Error {
  constructor(message: string, public status: number, public payload: Record<string, any>) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export type AdminRequestInit = RequestInit & { timeoutMs?: number };

export async function adminFetch<T = any>(path: string, init?: AdminRequestInit): Promise<T> {
  let response: Response;
  try {
    const { timeoutMs = 20_000, ...requestInit } = init || {};
    response = await fetch(`/admin-api/${path.replace(/^\//, '')}`, {
      ...requestInit,
      cache: 'no-store',
      signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs),
      headers: { ...(requestInit.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...requestInit.headers },
    });
  } catch (problem) {
    if (problem instanceof Error && problem.name === 'TimeoutError') {
      throw new AdminApiError('The request timed out. Please try again.', 504, {});
    }
    throw problem;
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error('Your session has expired.');
  }
  if (!response.ok) throw new AdminApiError(payload.message || 'The request failed.', response.status, payload);
  return payload as T;
}
