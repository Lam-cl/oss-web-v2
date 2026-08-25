export const ADMIN_COOKIE = 'tonewow_admin_session';
export const ADMIN_ROLES = ['ADMIN', 'STAFF'] as const;
export const SESSION_MAX_AGE = 60 * 60 * 24;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminSession = {
  token: string;
  user: {
    id?: number;
    email: string;
    role: AdminRole;
    name?: string;
  };
  expiresAt: number;
};

type RemoteSession = { actor: AdminSession['user']; bundleToken: string; expiresAt: string };

const encoder = new TextEncoder();

function base64UrlEncode(value: string) {
  if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64url');
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string) {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64url').toString('utf8');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(padded);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('ADMIN_SESSION_SECRET must contain at least 32 characters');
  return secret;
}

function remoteSessionConfig() {
  const base = process.env.TONEWOW_DATA_API_URL?.trim().replace(/\/$/, '');
  const token = process.env.TONEWOW_DATA_API_TOKEN?.trim();
  return base && token ? { base, token } : null;
}

async function remoteSessionRequest<T>(path: string, init: RequestInit = {}) {
  const config = remoteSessionConfig();
  if (!config) throw new Error('ToneWow Data API is not configured.');
  const response = await fetch(`${config.base}${path}`, {
    ...init,
    headers: { accept: 'application/json', authorization: `Bearer ${config.token}`, ...init.headers },
    cache: 'no-store',
    signal: init.signal || AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as { data?: T } | null;
  if (!response.ok || !payload?.data) throw new Error(`Remote session request failed (${response.status}).`);
  return payload.data;
}

async function sign(payload: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(getSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function createSessionCookie(session: AdminSession) {
  if (remoteSessionConfig()) {
    const sessionId = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    await remoteSessionRequest('/v1/admin-sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, actor: session.user, bundleToken: session.token, expiresAt: new Date(session.expiresAt).toISOString() }),
    });
    return `v1.${sessionId}`;
  }
  const payload = base64UrlEncode(JSON.stringify(session));
  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionCookie(cookie?: string | null): Promise<AdminSession | null> {
  if (!cookie) return null;
  try {
    if (cookie.startsWith('v1.')) {
      const [version, sessionId, extra] = cookie.split('.');
      if (version !== 'v1' || !/^[A-Za-z0-9_-]{43}$/.test(sessionId || '') || extra || !remoteSessionConfig()) return null;
      const session = await remoteSessionRequest<RemoteSession>(`/v1/admin-sessions/${sessionId}`);
      const expiresAt = Date.parse(session.expiresAt);
      if (!session.bundleToken || !session.actor?.email || !ADMIN_ROLES.includes(session.actor.role) || expiresAt <= Date.now()) return null;
      return { token: session.bundleToken, user: session.actor, expiresAt };
    }
    const [payload, signature, extra] = cookie.split('.');
    if (!payload || !signature || extra || !safeEqual(signature, await sign(payload))) return null;
    const session = JSON.parse(base64UrlDecode(payload)) as AdminSession;
    if (!session.token || !session.user?.email || !ADMIN_ROLES.includes(session.user.role) || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function revokeSessionCookie(cookie?: string | null) {
  if (!cookie?.startsWith('v1.') || !remoteSessionConfig()) return;
  const [version, sessionId, extra] = cookie.split('.');
  if (version !== 'v1' || !/^[A-Za-z0-9_-]{43}$/.test(sessionId || '') || extra) return;
  await remoteSessionRequest(`/v1/admin-sessions/${sessionId}`, { method: 'DELETE' });
}

export function jwtExpiry(token: string) {
  try {
    const payload = JSON.parse(base64UrlDecode(token.split('.')[1] || '')) as { exp?: number };
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
