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
  const payload = base64UrlEncode(JSON.stringify(session));
  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionCookie(cookie?: string | null): Promise<AdminSession | null> {
  if (!cookie) return null;
  try {
    const [payload, signature, extra] = cookie.split('.');
    if (!payload || !signature || extra || !safeEqual(signature, await sign(payload))) return null;
    const session = JSON.parse(base64UrlDecode(payload)) as AdminSession;
    if (!session.token || !session.user?.email || !ADMIN_ROLES.includes(session.user.role) || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function jwtExpiry(token: string) {
  try {
    const payload = JSON.parse(base64UrlDecode(token.split('.')[1] || '')) as { exp?: number };
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
