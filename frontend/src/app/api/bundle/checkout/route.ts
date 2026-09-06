import { NextRequest, NextResponse } from "next/server";
import { getProductMinimumOrderQuantity } from "@/lib/minimumOrderQuantity";
import { isProductSetupDraft } from "@/lib/productSetup";
import { calculateCourierCharge, type CourierLine } from "@/lib/shipping";
import { readShippingSettings } from "@/lib/shippingSettings.server";
import {
  isKualaLumpurWorkingDay,
  malaysiaDate,
  minimumPickupDate,
  pickupDateFromAddress,
} from "@/lib/pickup";
import {
  saveBillingAddress,
  savePaymentReference,
} from "@/lib/admin/orderMetadata.server";
import { readCataloguePublicProjection } from "@/lib/cataloguePublicProjection.server";
import { mergeBundleMerchandiseProducts, type BundleMerchandiseProduct } from "@/data/merchandise";

const BUNDLE_API = "https://bundleapi.tonewow.com/api";
const GKASH_STAGING_HOST = "api-staging.pay.asia";
const SHIPPING_FEE_UNIT_RM = 10;
const SHIPPING_FEE_SLUG = "flat-rate-delivery-fee";

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
  categories?: Array<{ name?: string | null }>;
  productVariants?: Array<{
    id: number;
    price: number | string;
    inventory?: number;
  }>;
};

class CheckoutValidationError extends Error {}

function amountFromOrder(data: Record<string, unknown>) {
  const order = data.order;
  const rawAmount =
    order && typeof order === "object"
      ? ((order as Record<string, unknown>).total ??
        (order as Record<string, unknown>).totalAmount)
      : null;
  const amount = Number(rawAmount);
  return Number.isFinite(amount) ? amount : null;
}

function splitName(fullName: unknown) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts.shift() || "",
    lastName: parts.join(" "),
  };
}

function bundleCheckoutAddress(
  value: unknown,
  fallback: { name: string; email: string; phone: string },
) {
  const address =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
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
    address: String(address.address || ""),
    city: String(address.city || ""),
    state: String(address.state || ""),
    country: String(address.country || "Malaysia"),
    postalCode: String(address.postalCode || ""),
    idNumber: String(address.idNumber || ""),
  };
}

function paymentParamsFromResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const params = Object.entries(value as Record<string, unknown>).reduce<
    Record<string, string>
  >((result, [key, entry]) => {
    if (entry !== undefined && entry !== null) result[key] = String(entry);
    return result;
  }, {});

  return Object.keys(params).length > 0 ? params : null;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",")[0]
      .trim();
    const requestHost = forwardedHost || request.headers.get("host");
    return Boolean(requestHost) && new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

export async function calculateExpectedAmount(
  items: CheckoutItem[],
  deliveryOption: string,
  shippingState: string,
) {
  const response = await fetch(
    `${BUNDLE_API}/products?type=MERCHANDISE&limit=100`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("Unable to verify merchandise prices");

  const payload = await response.json();
  const products = Array.isArray(payload?.data)
    ? (payload.data as BundleProduct[])
    : [];
  const productMap = new Map(products.map((product) => [product.id, product]));
  const projectedProducts = new Map(
    (await readCataloguePublicProjection()).products
      .map((product) => [
        product.bundleProductId,
        {
          catalogueId: product.catalogueId,
          slug: product.slug,
          category: product.details?.category,
          variants: new Set(product.combinations.map((combination) => combination.variantId)),
          minimumOrderQuantity: product.minimumOrderQuantity ?? 1,
        },
      ]),
  );
  const legacyVariants = new Map(mergeBundleMerchandiseProducts(products as unknown as BundleMerchandiseProduct[])
    .flatMap((product) => product.apiProductId
      ? [[product.apiProductId, new Set(Object.values(product.variantIds || {}))] as const]
      : []));
  const aggregatedItems = new Map<string, CheckoutItem>();
  for (const item of items) {
    if (
      !Number.isInteger(item.productId) ||
      !Number.isInteger(item.variantId) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) throw new CheckoutValidationError("Invalid merchandise checkout item");
    const key = `${item.productId}:${item.variantId}`;
    const existing = aggregatedItems.get(key);
    const quantity = (existing?.quantity || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) throw new CheckoutValidationError("Invalid merchandise checkout item");
    aggregatedItems.set(key, { productId: item.productId, variantId: item.variantId, quantity });
  }
  const normalizedItems = Array.from(aggregatedItems.values());
  const courierLines: CourierLine[] = [];

  let subtotalInCents = 0;
  for (const item of normalizedItems) {
    const product = productMap.get(item.productId);
    const variant = product?.productVariants?.find(
      (entry) => entry.id === item.variantId,
    );
    if (!product || !variant || isProductSetupDraft(product)) {
      throw new CheckoutValidationError(
        "A merchandise item is no longer available",
      );
    }
    const projected = projectedProducts.get(item.productId);
    const authoritativeVariants = projected?.variants || legacyVariants.get(item.productId);
    if (!authoritativeVariants?.has(item.variantId)) {
      throw new CheckoutValidationError("Variant selection required");
    }
    if (product.slug === SHIPPING_FEE_SLUG) {
      throw new CheckoutValidationError("Invalid merchandise checkout item");
    }

    const inventory = Math.max(0, Math.floor(Number(variant.inventory) || 0));
    if (item.quantity > inventory) {
      throw new CheckoutValidationError(
        "One or more items exceed the current stock limit. Review your cart and try again.",
      );
    }
    const minimumOrderQuantity = projected?.minimumOrderQuantity ?? getProductMinimumOrderQuantity(product);
    if (item.quantity < minimumOrderQuantity) {
      const productName = product.title || product.name || "this product";
      throw new CheckoutValidationError(
        `Minimum order for ${productName} is ${minimumOrderQuantity} units.`,
      );
    }

    const unitPrice = Number(variant.price ?? product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error("Unable to verify merchandise price");
    }
    subtotalInCents += Math.round(unitPrice * 100) * item.quantity;
    courierLines.push({
      catalogueId: projected?.catalogueId,
      bundleProductId: product.id,
      slug: projected?.slug || product.slug,
      name: product.title || product.name,
      category: projected?.category || product.categories?.[0]?.name || undefined,
      quantity: item.quantity,
    });
  }

  const merchandiseSubtotal = subtotalInCents / 100;
  const upstreamItems = [...normalizedItems];
  let shippingAmount = 0;
  if (deliveryOption === "DELIVER") {
    const courier = calculateCourierCharge(courierLines, shippingState, await readShippingSettings());
    if (courier.unclassified.length > 0) {
      throw new CheckoutValidationError(
        `Delivery is not configured for: ${courier.unclassified.join(", ")}`,
      );
    }
    shippingAmount = courier.amount;

    const shippingProduct = products.find(
      (product) => product.slug === SHIPPING_FEE_SLUG,
    );
    const shippingVariants = shippingProduct?.productVariants || [];
    const shippingVariant = shippingVariants.length === 1 &&
      Number.isInteger(shippingVariants[0].id) && shippingVariants[0].id > 0
      ? shippingVariants[0]
      : undefined;
    const shippingPrice = Number(
      shippingVariant?.price ?? shippingProduct?.price,
    );
    if (
      !shippingProduct ||
      !shippingVariant ||
      Math.round(shippingPrice * 100) !== SHIPPING_FEE_UNIT_RM * 100
    ) {
      throw new Error(
        "RM10 delivery fee is not configured correctly in the Bundle API",
      );
    }
    if (shippingAmount > 0) {
      upstreamItems.push({
        productId: shippingProduct.id,
        variantId: shippingVariant.id,
        quantity: shippingAmount / SHIPPING_FEE_UNIT_RM,
      });
      subtotalInCents += shippingAmount * 100;
    }
  }

  return {
    merchandiseSubtotal,
    expectedAmount: subtotalInCents / 100,
    upstreamItems,
    shippingAmount,
  };
}

function voucherPreviewValues(payload: Record<string, any>) {
  const value =
    payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const discount = Number(
    value.discountAmount ??
      value.discount ??
      value.voucherDiscount ??
      value.amountOff,
  );
  return {
    discount: Number.isFinite(discount) && discount >= 0 ? discount : null,
  };
}

export function bundleCheckoutPayload(input: {
  checkoutData: Record<string, any>;
  upstreamItems: CheckoutItem[];
  billingAddress: ReturnType<typeof bundleCheckoutAddress>;
  shippingAddress: ReturnType<typeof bundleCheckoutAddress>;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryOption: string;
  paymentMethodId: string;
  voucherCode: string;
  expectedAmount: number;
}) {
  const {
    checkoutData,
    upstreamItems,
    billingAddress,
    shippingAddress,
    customerName,
    customerEmail,
    customerPhone,
    deliveryOption,
    paymentMethodId,
    voucherCode,
    expectedAmount,
  } = input;
  return {
    customerName,
    customerEmail,
    customerPhone,
    customerType: "retail",
    customerID: String(checkoutData.billingAddress?.idNumber || ""),
    description: String(
      checkoutData.description || "tone wow merchandise order",
    ),
    items: upstreamItems,
    billingAddress,
    shippingAddress,
    isGuest: true,
    deliveryOption,
    agentId: checkoutData.agentId || undefined,
    paymentMethodId,
    voucherCode: voucherCode || undefined,
    expectedTotal: expectedAmount,
    shippingCost: 0,
    notes: String(
      checkoutData.notes ||
        checkoutData.description ||
        "tone wow merchandise order",
    ),
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json(
        { error: "Invalid checkout origin" },
        { status: 403 },
      );
    }

    const checkoutData = await request.json();
    const deliveryOption = checkoutData.deliveryOption;
    if (deliveryOption !== "DELIVER" && deliveryOption !== "PICKUP") {
      return NextResponse.json(
        { error: "Invalid delivery option" },
        { status: 400 },
      );
    }
    if (!Array.isArray(checkoutData.items) || checkoutData.items.length === 0) {
      return NextResponse.json(
        { error: "Your merchandise cart is empty" },
        { status: 400 },
      );
    }
    const shippingState = String(
      checkoutData.shippingAddress?.state || "",
    ).trim();
    if (deliveryOption === "DELIVER" && !shippingState) {
      return NextResponse.json(
        { error: "Shipping state is required" },
        { status: 400 },
      );
    }
    const pickupDate = pickupDateFromAddress(
      checkoutData.shippingAddress?.address ||
        checkoutData.shippingAddress?.address1,
    );
    if (deliveryOption === "PICKUP" && !pickupDate) {
      return NextResponse.json(
        { error: "Collection date is required" },
        { status: 400 },
      );
    }
    const earliestPickupDate = minimumPickupDate(malaysiaDate());
    if (deliveryOption === "PICKUP" && !isKualaLumpurWorkingDay(pickupDate)) {
      return NextResponse.json(
        {
          error:
            "Collection is unavailable on weekends and Kuala Lumpur public holidays",
        },
        { status: 400 },
      );
    }
    if (deliveryOption === "PICKUP" && pickupDate < earliestPickupDate) {
      return NextResponse.json(
        { error: `Collection date must be ${earliestPickupDate} or later` },
        { status: 400 },
      );
    }
    const calculated = await calculateExpectedAmount(
      checkoutData.items,
      deliveryOption,
      shippingState,
    );
    const { upstreamItems, shippingAmount, merchandiseSubtotal } = calculated;
    const customerName = String(checkoutData.customerName || "").trim();
    const customerEmail = String(checkoutData.customerEmail || "").trim();
    const customerPhone = String(checkoutData.customerPhone || "").trim();
    if (!customerName || !customerEmail || !customerPhone) {
      return NextResponse.json(
        { error: "Customer details are incomplete" },
        { status: 400 },
      );
    }
    const paymentMethodId = String(checkoutData.paymentMethodId || "");
    if (!["16", "2", "3"].includes(paymentMethodId)) {
      return NextResponse.json(
        { error: "Select a valid payment method" },
        { status: 400 },
      );
    }
    const voucherCode = String(checkoutData.voucherCode || "")
      .trim()
      .toUpperCase();
    let voucherDiscount = 0;
    if (voucherCode) {
      const previewResponse = await fetch(`${BUNDLE_API}/vouchers/preview`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: voucherCode,
          items: checkoutData.items,
          customerEmail,
        }),
        cache: "no-store",
      });
      const previewPayload = await previewResponse.json().catch(() => ({}));
      if (!previewResponse.ok)
        return NextResponse.json(
          {
            error: previewPayload?.message || "Promo code is no longer valid.",
          },
          { status: 400 },
        );
      const preview = voucherPreviewValues(previewPayload);
      if (preview.discount === null || preview.discount > merchandiseSubtotal)
        return NextResponse.json(
          { error: "Voucher API returned an invalid discount." },
          { status: 502 },
        );
      voucherDiscount = preview.discount;
    }
    const expectedAmount = Math.max(
      0,
      Math.round(
        (merchandiseSubtotal - voucherDiscount + shippingAmount) * 100,
      ) / 100,
    );
    const clientExpectedTotal = Number(checkoutData.expectedTotal);
    if (
      !Number.isFinite(clientExpectedTotal) ||
      Math.round(clientExpectedTotal * 100) !== Math.round(expectedAmount * 100)
    ) {
      return NextResponse.json(
        {
          error: "Order total changed. Review the latest total and try again.",
        },
        { status: 409 },
      );
    }

    const billingAddress = bundleCheckoutAddress(checkoutData.billingAddress, {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
    });
    const shippingAddress = bundleCheckoutAddress(
      checkoutData.shippingAddress,
      {
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
      },
    );
    if (
      !billingAddress.address ||
      !billingAddress.city ||
      !billingAddress.state ||
      !/^\d{5}$/.test(billingAddress.postalCode)
    ) {
      return NextResponse.json(
        { error: "Billing address is incomplete" },
        { status: 400 },
      );
    }
    // /products/checkout ignores shippingCost. Delivery-fee product quantities remain authoritative.
    const productCheckout = bundleCheckoutPayload({
      checkoutData,
      upstreamItems,
      billingAddress,
      shippingAddress,
      customerName,
      customerEmail,
      customerPhone,
      deliveryOption,
      paymentMethodId,
      voucherCode,
      expectedAmount,
    });

    const response = await fetch(`${BUNDLE_API}/products/checkout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(productCheckout),
      cache: "no-store",
    });
    const body = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      return NextResponse.json(
        { error: "Bundle API returned an invalid response" },
        { status: 502 },
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || "Unable to create merchandise checkout" },
        { status: response.status },
      );
    }

    const paymentUrl =
      typeof data.paymentUrl === "string" ? data.paymentUrl : "";
    const paymentParams = paymentParamsFromResponse(data.paymentParams);
    let paymentHost = "";
    let paymentProtocol = "";
    try {
      const parsedPaymentUrl = new URL(paymentUrl);
      paymentHost = parsedPaymentUrl.hostname;
      paymentProtocol = parsedPaymentUrl.protocol;
    } catch {
      paymentHost = "";
    }
    if (
      !paymentUrl ||
      !paymentParams ||
      paymentProtocol !== "https:" ||
      paymentHost !== GKASH_STAGING_HOST
    ) {
      return NextResponse.json(
        { error: "GKash is not configured correctly for staging" },
        { status: 502 },
      );
    }

    const paymentAmount = amountFromOrder(data);
    if (
      paymentAmount === null ||
      Math.round(paymentAmount * 100) !== Math.round(expectedAmount * 100)
    ) {
      return NextResponse.json(
        {
          error:
            deliveryOption === "DELIVER"
              ? "Payment amount does not include the calculated shipping fee. Payment was not opened."
              : "Payment amount does not match the verified order total. Payment was not opened.",
        },
        { status: 502 },
      );
    }

    const order =
      data.order && typeof data.order === "object"
        ? (data.order as Record<string, unknown>)
        : {};
    const orderId = order.id ?? order.orderId ?? data.orderId;
    const numericOrderId = Number(orderId);
    if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
      return NextResponse.json(
        { error: "Bundle API did not return a valid order ID" },
        { status: 502 },
      );
    }
    const referenceNumber = String(
      order.cartId ?? order.cartID ?? data.cartId ?? data.cartID ?? "",
    ).trim();
    await saveBillingAddress(numericOrderId, billingAddress);
    if (referenceNumber)
      await savePaymentReference(numericOrderId, referenceNumber);
    if (referenceNumber) {
      const checkoutOrigin = new URL(String(request.headers.get("origin"))).origin;
      const returnUrl = new URL("/bundle/gkash-return", checkoutOrigin);
      returnUrl.searchParams.set("orderId", String(numericOrderId));
      returnUrl.searchParams.set("referenceNumber", referenceNumber);
      paymentParams.returnurl = returnUrl.toString();
    }

    return NextResponse.json({
      success: true,
      orderId: String(numericOrderId),
      referenceNumber: referenceNumber || undefined,
      paymentUrl,
      paymentParams,
      redirectMethod: "POST",
      shippingAmount,
      totalAmount: expectedAmount,
      voucherDiscount,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to initiate merchandise payment",
      },
      { status: error instanceof CheckoutValidationError ? 400 : 500 },
    );
  }
}
