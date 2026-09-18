export const PAYMENT_POLL_START_SECONDS = 30;
export const PAYMENT_POLL_END_SECONDS = 120;
export const PAYMENT_POLL_INTERVAL_SECONDS = 5;
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Row = Record<string, any>;
export type PaymentState = 'processing' | 'success' | 'failed';
export type PaymentStatus = {
  state: PaymentState;
  orderId: number;
  transactionId: string;
  gatewayTxnId: string;
  amount: number;
  paymentMethod: string;
};

export function paymentPollingAction(elapsedSeconds: number) {
  if (elapsedSeconds > PAYMENT_POLL_END_SECONDS) return 'stop';
  if (elapsedSeconds < PAYMENT_POLL_START_SECONDS) return 'wait';
  return (elapsedSeconds - PAYMENT_POLL_START_SECONDS) % PAYMENT_POLL_INTERVAL_SECONDS === 0
    ? 'poll'
    : 'wait';
}

export function isBundlePaymentReference(value: unknown) {
  return /^16twoss[A-Za-z0-9]{13,121}$/.test(String(value || ''));
}

export function readPendingPayment(raw: string | null, now = Date.now()):
  { orderId: string; referenceNumber: string } | { error: 'missing' | 'expired' | 'invalid' } {
  if (!raw) return { error: 'missing' };
  try {
    const value = JSON.parse(raw) as Row;
    const orderId = String(value.orderId || '').trim();
    const referenceNumber = String(value.referenceNumber || value.cartid || value.cartId || '').trim();
    const storedAt = Number(value.storedAt);
    if (!Number.isFinite(storedAt) || now - storedAt > PENDING_MAX_AGE_MS) return { error: 'expired' };
    if (!/^\d+$/.test(orderId) || Number(orderId) <= 0 || !isBundlePaymentReference(referenceNumber)) return { error: 'invalid' };
    return { orderId, referenceNumber };
  } catch {
    return { error: 'invalid' };
  }
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

export function bundlePaymentProjection(order: Row): PaymentStatus {
  const transactions = Array.isArray(order.transactions)
    ? [...order.transactions].filter((item) => item && typeof item === 'object') as Row[]
    : [];
  const completed = transactions.find((item) => text(item.status).toUpperCase() === 'COMPLETED');
  const transaction = completed || transactions.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0] || {};
  const status = text(transaction.status).toUpperCase();
  const raw = record(transaction.rawResponse || transaction.gatewayResponse || transaction.metadata);
  const amount = Number(transaction.amount ?? order.totalAmount ?? order.total ?? order.amount ?? 0);
  return {
    state: status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'failed' : 'processing',
    orderId: Number(order.id ?? order.orderId),
    transactionId: String(transaction.id ?? '').trim(),
    gatewayTxnId: text(transaction.gatewayTxnId || transaction.gatewayTransactionId || transaction.gatewayReference || transaction.POID || transaction.poid || transaction.transactionId || raw.gatewayTxnId || raw.POID || raw.poid),
    amount: Number.isFinite(amount) ? amount : 0,
    paymentMethod: text(transaction.paymentMethod),
  };
}

export function paymentResultUrl(status: Partial<PaymentStatus>) {
  if (status.state === 'processing') return '';
  const params = new URLSearchParams({
    status: status.state === 'success' ? 'success' : 'failure',
    orderId: String(status.orderId || ''),
  });
  if (status.transactionId) params.set('transactionId', status.transactionId);
  if (status.gatewayTxnId) params.set('gatewayTxnId', status.gatewayTxnId);
  if (status.state === 'failed') params.set('reason', 'Payment failed');
  return `/payment/${status.state === 'success' ? 'success' : 'failed'}?${params}`;
}
