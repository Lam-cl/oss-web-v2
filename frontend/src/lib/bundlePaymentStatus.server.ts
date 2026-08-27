import { BUNDLE_API } from '@/lib/admin/server';
import { bundlePaymentProjection, type PaymentStatus } from '@/lib/paymentProcessing';

type Row = Record<string, any>;
const UPSTREAM_TIMEOUT_MS = 5_000;
const TOKEN_TTL_MS = 60_000;
let cachedToken: { value: string; expiresAt: number } | null = null;

async function payload(response: Response): Promise<Row> {
  const value = await response.json().catch(() => ({}));
  return value && typeof value === 'object' ? value as Row : {};
}

async function login() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const email = process.env.BUNDLE_STATUS_EMAIL;
  const password = process.env.BUNDLE_STATUS_PASSWORD;
  if (!email || !password) throw new Error('Bundle status credentials are unavailable.');
  const response = await fetch(`${BUNDLE_API}/auth/login`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const body = await payload(response);
  const token = body.token || body.accessToken || body.access_token || body.data?.token;
  if (!response.ok || typeof token !== 'string' || !token || token.length > 8192) {
    throw new Error('Bundle status authentication failed.');
  }
  cachedToken = { value: token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function orderRequest(orderId: number, retry = true): Promise<Row> {
  const token = await login();
  const response = await fetch(`${BUNDLE_API}/orders/${orderId}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (response.status === 401 && retry) {
    cachedToken = null;
    return orderRequest(orderId, false);
  }
  if (!response.ok) throw new Error('Bundle order status is unavailable.');
  const body = await payload(response);
  const order = body.data && typeof body.data === 'object' ? body.data as Row : body;
  if (Number(order.id ?? order.orderId) !== orderId) throw new Error('Bundle order identity mismatch.');
  return order;
}

export async function readBundlePaymentStatus(orderId: number): Promise<PaymentStatus> {
  return bundlePaymentProjection(await orderRequest(orderId));
}
