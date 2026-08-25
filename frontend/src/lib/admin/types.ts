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

export const asLabel = (value: string | { name?: string; title?: string }) => typeof value === 'string' ? value : value.name || value.title || '';
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
export const orderTotal = (order: Order) => order.totalAmount ?? order.total ?? order.grandTotal ?? order.amount ?? 0;
