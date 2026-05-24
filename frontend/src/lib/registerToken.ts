import { randomUUID, sign, verify } from 'crypto';

type RegistrationPayloadInput = {
  serial?: string;
  twe?: string;
  twp?: string;
};

type RegistrationTokenPayload = RegistrationPayloadInput & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
};

export type RegistrationTransport = {
  clipboardText: string;
  token?: string;
  legacyPayload: string;
  isSigned: boolean;
};

const DEFAULT_TWE = '8937777';
const DEFAULT_ISSUER = 'shop.tonewow.com';
const DEFAULT_AUDIENCE = 'com.mywow2.app';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function normalizePem(value?: string) {
  return value?.trim().replace(/\\n/g, '\n') || '';
}

function getTokenTtlSeconds() {
  const ttl = Number(process.env.REGISTER_TOKEN_TTL_SECONDS);
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : DEFAULT_TTL_SECONDS;
}

export function buildLegacyRegistrationPayload(input: RegistrationPayloadInput) {
  const payload = new URLSearchParams();
  const serial = input.serial?.trim();
  const twe = input.twe?.trim();
  const twp = input.twp?.trim();

  if (serial) payload.set('serial', serial);
  if (twp) payload.set('twp', twp);
  else if (twe) payload.set('twe', twe);
  else if (!serial) payload.set('twe', DEFAULT_TWE);

  return payload.toString();
}

function buildTokenPayload(input: RegistrationPayloadInput): RegistrationTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  const payload: RegistrationTokenPayload = {
    iss: process.env.REGISTER_TOKEN_ISSUER || DEFAULT_ISSUER,
    aud: process.env.REGISTER_TOKEN_AUDIENCE || DEFAULT_AUDIENCE,
    iat: now,
    exp: now + getTokenTtlSeconds(),
    jti: randomUUID(),
  };

  const serial = input.serial?.trim();
  const twe = input.twe?.trim();
  const twp = input.twp?.trim();

  if (serial) payload.serial = serial;
  if (twp) payload.twp = twp;
  else if (twe) payload.twe = twe;
  else if (!serial) payload.twe = DEFAULT_TWE;

  return payload;
}

export function createRegistrationToken(input: RegistrationPayloadInput) {
  return createSignedToken(buildTokenPayload(input));
}

export function createSignedToken(payload: Record<string, unknown>) {
  const privateKey = normalizePem(process.env.REGISTER_TOKEN_PRIVATE_KEY_PEM);
  if (!privateKey) return '';

  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid: process.env.REGISTER_TOKEN_KEY_ID || 'v1',
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64Url(signature)}`;
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '='), 'base64');
}

export function verifySignedToken(token: string) {
  const publicKey = normalizePem(process.env.REGISTER_TOKEN_PUBLIC_KEY_PEM);
  if (!publicKey) throw new Error('REGISTER_TOKEN_PUBLIC_KEY_PEM is not configured');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8')) as { alg?: string; kid?: string };
  if (header.alg !== 'ES256') throw new Error('Unsupported token algorithm');
  if (header.kid && header.kid !== (process.env.REGISTER_TOKEN_KEY_ID || 'v1')) throw new Error('Unknown token key id');

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const valid = verify('sha256', Buffer.from(signingInput), {
    key: publicKey,
    dsaEncoding: 'ieee-p1363',
  }, base64UrlDecode(encodedSignature));
  if (!valid) throw new Error('Invalid token signature');

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8')) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('Token expired');
  if (payload.iss && payload.iss !== (process.env.REGISTER_TOKEN_ISSUER || DEFAULT_ISSUER)) throw new Error('Token issuer mismatch');
  if (payload.aud && payload.aud !== (process.env.REGISTER_TOKEN_AUDIENCE || DEFAULT_AUDIENCE)) throw new Error('Token audience mismatch');

  return payload;
}

export function createRegistrationTransport(input: RegistrationPayloadInput): RegistrationTransport {
  const legacyPayload = buildLegacyRegistrationPayload(input);
  const token = createRegistrationToken(input);

  if (token) {
    return {
      clipboardText: `tonewow_register_token:${token}`,
      token,
      legacyPayload,
      isSigned: true,
    };
  }

  return {
    clipboardText: `tonewow_register:${legacyPayload}`,
    legacyPayload,
    isSigned: false,
  };
}
