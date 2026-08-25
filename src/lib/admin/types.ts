import { pickupDateFromAddress, pickupStatus } from '../pickup';

export type ProductImage = { id: number; url: string; order: number };
export type OptionValue = { id: number; value: string; imageUrl?: string | null; priceAdjustment?: number; absolutePrice?: number };
export type ProductOption = { id: number; name: string; type?: string; values: OptionValue[] };
export type ProductVariant = { id: number; sku: string; price: number; inventory: number; weight?: number | null; selectedOptions?: unknown[] };
export type Product = {
  id: number; name?: string; title: string; description: string; type: 'MOBILE' | 'MERCHANDISE'; price: number;
  shippingCost: number; weight: number; slug: string; deletedAt?: string | null; createdAt: string; updatedAt: string;
  categories: Array<string | { id?: number; name?: string; title?: string }>;
  tags: Array<string | { id?: number; name?: string; title?: string }>;
  images: ProductImage[]; options: ProductOption[]; productVariants: ProductVariant[];
};
export type Order = Record<string, any> & { id: number; status: string; createdAt: string; updatedAt?: string; total?: number; totalAmount?: number; trackingCode?: string; imei?: string };
export type Paged<T> = { data: T[]; meta?: { total: number; page: number; limit: number; totalPages: number } };

export const paginationPages = (current: number, total: number) => {
  const count = Math.min(5, Math.max(1, total));
  const start = Math.min(
    Math.max(1, current - Math.floor(count / 2)),
    Math.max(1, total - count + 1),
  );
  return Array.from({ length: count }, (_, index) => start + index);
};

export const asLabel = (value: string | { name?: string; title?: string }) => typeof value === 'string' ? value : value.name || value.title || '';
export const canonicalCatalogueSku = (value: unknown) => typeof value === 'string' ? value.replace(/-TW[0-9a-f]{8}V[1-9][0-9]*$/, '') : '';
export const money = (value: unknown) => `RM ${Number(value || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dateTime = (value: unknown) => value ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(value))) : '—';
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const record = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const addressName = (value: unknown) => {
  const address = record(value);
  return text(address.fullName)
    || text(address.name)
    || [text(address.firstName), text(address.lastName)].filter(Boolean).join(' ');
};

const isGuestPlaceholder = (value: string) => [
  'guest',
  'guest customer',
  'guest user',
].includes(value.toLowerCase());

const firstRealName = (...values: string[]) => (
  values.find((value) => value && !isGuestPlaceholder(value)) || ''
);

export const orderCustomer = (order: Order) => firstRealName(
  addressName(order.shippingAddresses),
  addressName(order.shippingAddress),
  addressName(order.deliveryAddress),
  addressName(order.billingAddress),
  text(order.customerName),
  text(order.customer?.name),
  text(order.user?.name),
  text(order.name),
) || 'Guest customer';

export const orderEmail = (order: Order) => {
  const shippingRecord = record(order.shippingAddresses);
  const shipping = record(order.shippingAddress);
  const delivery = record(order.deliveryAddress);
  const billing = record(order.billingAddress);
  return text(shippingRecord.email)
    || text(shipping.email)
    || text(delivery.email)
    || text(billing.email)
    || text(order.customerEmail)
    || text(order.customer?.email)
    || text(order.user?.email)
    || text(order.email)
    || '—';
};

export const orderCustomerId = (order: Order) => {
  const billing = record(order.billingAddress || order.billingAddresses);
  const shipping = record(order.shippingAddresses || order.shippingAddress || order.deliveryAddress);
  return text(order.customerID || order.customerId)
    || text(billing.idNumber || billing.customerID || billing.customerId)
    || text(shipping.idNumber || shipping.customerID || shipping.customerId);
};

export const orderPhone = (order: Order) => {
  const shippingRecord = record(order.shippingAddresses);
  const shipping = record(order.shippingAddress);
  const delivery = record(order.deliveryAddress);
  const billing = record(order.billingAddress);
  return text(shippingRecord.phone || shippingRecord.phoneNumber)
    || text(shipping.phone || shipping.phoneNumber)
    || text(delivery.phone || delivery.phoneNumber)
    || text(billing.phone || billing.phoneNumber)
    || text(order.customerPhone)
    || text(order.customer?.phone)
    || text(order.user?.phone)
    || text(order.phone)
    || '—';
};
export const isPaymentConfirmedOrder = (order: Order) => (
  ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(text(order.status).toUpperCase())
);

export const isFulfilmentListOrder = (order: Order) => (
  isPaymentConfirmedOrder(order) || text(order.status).toUpperCase() === 'CANCELLED'
);

export const orderPaymentStatus = (order: Order) => {
  const fulfilmentStatus = text(order.status).toUpperCase();
  if (['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(fulfilmentStatus)) return 'PAID';
  const payment = record(order.payment || order.paymentDetails);
  return text(payment.status || order.paymentStatus).toUpperCase() || fulfilmentStatus || '—';
};

const latestPaymentTransaction = (order: Order) => {
  const transactions = Array.isArray(order.transactions)
    ? [...order.transactions].sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0))
    : [];
  return transactions.find((transaction) => text(transaction?.status).toUpperCase() === 'COMPLETED')
    || transactions[0]
    || {};
};

export const orderPaymentMethod = (order: Order) => {
  const transaction = latestPaymentTransaction(order);
  const payment = record(order.payment || order.paymentDetails);
  const legacyMethod = typeof order.paymentMethod === 'object'
    ? order.paymentMethod?.name
    : order.paymentMethod;
  return text(transaction.paymentMethod)
    || text(payment.method || payment.paymentMethod)
    || text(legacyMethod)
    || '—';
};

export const orderPaymentReference = (order: Order) => {
  const transaction = latestPaymentTransaction(order);
  const payment = record(order.payment || order.paymentDetails);
  return text(transaction.transactionId)
    || text(payment.reference || payment.transactionId)
    || text(order.paymentReference)
    || '—';
};

export const orderGatewayReference = (order: Order) => {
  const transaction = latestPaymentTransaction(order);
  const payment = record(order.payment || order.paymentDetails);
  const transactionRaw = record(transaction.rawResponse || transaction.gatewayResponse || transaction.metadata);
  const paymentRaw = record(payment.rawResponse || payment.gatewayResponse || payment.metadata);
  return text(order.cartId || order.cartID)
    || text(transaction.gatewayReference || transaction.gkashReference || transaction.POID || transaction.poid)
    || text(transactionRaw.gatewayReference || transactionRaw.POID || transactionRaw.poid)
    || text(payment.gatewayReference || payment.gkashReference || payment.POID || payment.poid)
    || text(paymentRaw.gatewayReference || paymentRaw.POID || paymentRaw.poid)
    || text(order.gatewayReference || order.gkashReference || order.POID || order.poid)
    || '—';
};

export const orderDeliveryOption = (order: Order) => {
  const explicit = text(order.deliveryOption).toUpperCase();
  if (explicit === 'DELIVER' || explicit === 'PICKUP') return explicit;

  const address = record(
    order.shippingAddresses || order.shippingAddress || order.deliveryAddress,
  );
  const addressText = text(address.address || address.address1);
  if (/self\s*pick\s*up/i.test(addressText)) return 'PICKUP';
  if (addressText || text(address.city) || text(address.state) || text(address.postalCode || address.postcode)) {
    return 'DELIVER';
  }
  return '—';
};

export const orderPickupDate = (order: Order) => {
  const address = record(order.shippingAddresses || order.shippingAddress || order.deliveryAddress);
  return pickupDateFromAddress(address.address || address.address1);
};

export const orderFulfilmentStatus = (order: Order) => (
  orderDeliveryOption(order) === 'PICKUP'
    ? pickupStatus(text(order.status)).replaceAll('_', ' ')
    : text(order.status).toUpperCase()
);

export const orderTotal = (order: Order) => order.totalAmount ?? order.total ?? order.grandTotal ?? order.amount ?? 0;
