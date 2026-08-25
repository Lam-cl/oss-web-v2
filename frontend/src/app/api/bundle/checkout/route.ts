import { NextRequest, NextResponse } from 'next/server';
import { getProductMinimumOrderQuantity } from '@/lib/minimumOrderQuantity';
import { isProductSetupDraft } from '@/lib/productSetup';

const BUNDLE_API = 'https://bundleapi.tonewow.com/api';
const GKASH_STAGING_HOST = 'api-staging.pay.asia';
const MERCHANDISE_SHIPPING_RM = 10;
const SHIPPING_FEE_SLUG = 'flat-rate-delivery-fee';

type CheckoutItem = {
  productId: number;
  variantId: number;
  quantity: number;
};

type BundleProduct = {
  id: number;
  title?: string;
  name?: string;
  slug?: string;
  description?: string;
  price: number | string;
  tags?: Array<string | { name?: string | null }>;
  productVariants?: Array<{
    id: number;
    price: number | string;
    inventory?: number;
  }>;
};

class CheckoutValidationError extends Error {}

function amountFromOrder(data: Record<string, unknown>) {
  const order = data.order;
  const rawAmount = order && typeof order === 'object'
    ? (order as Record<string, unknown>).total ?? (order as Record<string, unknown>).totalAmount
    : null;
  const amount = Number(rawAmount);
  return Number.isFinite(amount) ? amount : null;
}

function splitName(fullName: unknown) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' '),
  };
}

function bundleCheckoutAddress(
  value: unknown,
  fallback: { name: string; email: string; phone: string },
) {
  const address = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const split = splitName(address.fullName || fallback.name);

  const firstName = String(address.firstName || split.firstName);
  const lastName = String(address.lastName || split.lastName);
  const phone = String(address.phone || address.phoneNumber || fallback.phone);

  return {
    firstName,
    lastName,
    fullName: String(address.fullName || `${firstName} ${lastName}`.trim()),
    email: String(address.email || fallback.email),
    phone,
    phoneNumber: phone,
    address: String(address.address || ''),
    city: String(address.city || ''),
    state: String(address.state || ''),
    country: String(address.country || 'Malaysia'),
    postalCode: String(address.postalCode || ''),
    idNumber: String(address.idNumber || ''),
  };
}

function paymentParamsFromResponse(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const params = Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (result, [key, entry]) => {
      if (entry !== undefined && entry !== null) result[key] = String(entry);
      return result;
    },
    {},
  );

  return Object.keys(params).length > 0 ? params : null;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
    const requestHost = forwardedHost || request.headers.get('host');
    return Boolean(requestHost) && new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

async function calculateExpectedAmount(items: CheckoutItem[], deliveryOption: string) {
  const response = await fetch(`${BUNDLE_API}/products?type=MERCHANDISE&limit=100`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Unable to verify merchandise prices');

  const payload = await response.json();
  const products = Array.isArray(payload?.data) ? payload.data as BundleProduct[] : [];
  const productMap = new Map(products.map((product) => [product.id, product]));
  const requestedByVariant = new Map<string, number>();

  let subtotalInCents = 0;
  for (const item of items) {
    if (!Number.isInteger(item.productId) || !Number.isInteger(item.variantId)
      || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new CheckoutValidationError('Invalid merchandise checkout item');
    }

    const product = productMap.get(item.productId);
    const variant = product?.productVariants?.find((entry) => entry.id === item.variantId);
    if (!product || !variant || isProductSetupDraft(product)) {
      throw new CheckoutValidationError('A merchandise item is no longer available');
    }
    if (product.slug === SHIPPING_FEE_SLUG) {
      throw new CheckoutValidationError('Invalid merchandise checkout item');
    }

    const inventory = Math.max(0, Math.floor(Number(variant.inventory) || 0));
    const stockKey = `${product.id}:${variant.id}`;
    const requestedQuantity = (requestedByVariant.get(stockKey) || 0) + item.quantity;
    if (requestedQuantity > inventory) {
      throw new CheckoutValidationError('One or more items exceed the current stock limit. Review your cart and try again.');
    }
    requestedByVariant.set(stockKey, requestedQuantity);

    const minimumOrderQuantity = getProductMinimumOrderQuantity(product);
    if (item.quantity < minimumOrderQuantity) {
      const productName = product.title || product.name || 'this product';
      throw new CheckoutValidationError(
        `Minimum order for ${productName} is ${minimumOrderQuantity} units.`,
      );
    }

    const unitPrice = Number(variant.price ?? product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('Unable to verify merchandise price');
    }
    subtotalInCents += Math.round(unitPrice * 100) * item.quantity;
  }

  const upstreamItems = [...items];
  if (deliveryOption === 'DELIVER') {
    const shippingProduct = products.find((product) => product.slug === SHIPPING_FEE_SLUG);
    const shippingVariant = shippingProduct?.productVariants?.[0];
    const shippingPrice = Number(shippingVariant?.price ?? shippingProduct?.price);
    if (!shippingProduct || !shippingVariant
      || Math.round(shippingPrice * 100) !== MERCHANDISE_SHIPPING_RM * 100) {
      throw new Error('RM10 delivery fee is not configured correctly in the Bundle API');
    }
    upstreamItems.push({
      productId: shippingProduct.id,
      variantId: shippingVariant.id,
      quantity: 1,
    });
    subtotalInCents += MERCHANDISE_SHIPPING_RM * 100;
  }

  return { expectedAmount: subtotalInCents / 100, upstreamItems };
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'Invalid checkout origin' }, { status: 403 });
    }

    const checkoutData = await request.json();
    const deliveryOption = checkoutData.deliveryOption;
    if (deliveryOption !== 'DELIVER' && deliveryOption !== 'PICKUP') {
      return NextResponse.json({ error: 'Invalid delivery option' }, { status: 400 });
    }
    if (!Array.isArray(checkoutData.items) || checkoutData.items.length === 0) {
      return NextResponse.json({ error: 'Your merchandise cart is empty' }, { status: 400 });
    }
    const { expectedAmount, upstreamItems } = await calculateExpectedAmount(
      checkoutData.items,
      deliveryOption,
    );
    const customerName = String(checkoutData.customerName || '').trim();
    const customerEmail = String(checkoutData.customerEmail || '').trim();
    const customerPhone = String(checkoutData.customerPhone || '').trim();
    if (!customerName || !customerEmail || !customerPhone) {
      return NextResponse.json({ error: 'Customer details are incomplete' }, { status: 400 });
    }

    const billingAddress = bundleCheckoutAddress(checkoutData.billingAddress, {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
    });
    const shippingAddress = bundleCheckoutAddress(checkoutData.shippingAddress, {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
    });
    const productCheckout = {
      customerName,
      customerEmail,
      customerPhone,
      customerType: 'retail',
      customerID: String(checkoutData.billingAddress?.idNumber || ''),
      description: String(checkoutData.description || 'tone wow merchandise order'),
      items: upstreamItems,
      billingAddress,
      shippingAddress,
      isGuest: true,
      deliveryOption,
      agentId: checkoutData.agentId || undefined,
      // /products/checkout ignores shippingCost. The verified RM10 fee product
      // included in upstreamItems remains the source of truth for delivery.
      shippingCost: 0,
      notes: String(checkoutData.notes || checkoutData.description || 'tone wow merchandise order'),
    };

    const response = await fetch(`${BUNDLE_API}/products/checkout`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(productCheckout),
      cache: 'no-store',
    });
    const body = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      return NextResponse.json(
        { error: 'Bundle API returned an invalid response' },
        { status: 502 },
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Unable to create merchandise checkout' },
        { status: response.status },
      );
    }

    const paymentUrl = typeof data.paymentUrl === 'string' ? data.paymentUrl : '';
    const paymentParams = paymentParamsFromResponse(data.paymentParams);
    let paymentHost = '';
    let paymentProtocol = '';
    try {
      const parsedPaymentUrl = new URL(paymentUrl);
      paymentHost = parsedPaymentUrl.hostname;
      paymentProtocol = parsedPaymentUrl.protocol;
    } catch {
      paymentHost = '';
    }
    if (!paymentUrl || !paymentParams
      || paymentProtocol !== 'https:' || paymentHost !== GKASH_STAGING_HOST) {
      return NextResponse.json(
        { error: 'GKash is not configured correctly for staging' },
        { status: 502 },
      );
    }

    const paymentAmount = amountFromOrder(data);
    if (paymentAmount === null || Math.round(paymentAmount * 100) !== Math.round(expectedAmount * 100)) {
      return NextResponse.json(
        {
          error: deliveryOption === 'DELIVER'
            ? 'Payment amount does not include the RM10 shipping fee. Payment was not opened.'
            : 'Payment amount does not match the verified order total. Payment was not opened.',
        },
        { status: 502 },
      );
    }

    const order = data.order && typeof data.order === 'object'
      ? data.order as Record<string, unknown>
      : {};
    const orderId = order.id ?? order.orderId ?? data.orderId;

    return NextResponse.json({
      success: true,
      orderId: orderId === undefined || orderId === null ? undefined : String(orderId),
      paymentUrl,
      paymentParams,
      redirectMethod: 'POST',
      shippingAmount: deliveryOption === 'DELIVER' ? MERCHANDISE_SHIPPING_RM : 0,
      totalAmount: expectedAmount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to initiate merchandise payment' },
      { status: error instanceof CheckoutValidationError ? 400 : 500 },
    );
  }
}
