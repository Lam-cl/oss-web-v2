export type SimUnit = {
  unitKey: string;
  orderItemId: string;
  productName: string;
  unitNumber: number;
  quantity: number;
  label: string;
};
export type SimPrefixOption = {
  id: string;
  prefix: string;
  label: string;
  telcoId: number;
};
export type SimAssignment = SimUnit & {
  prefixId: string;
  prefix: string;
  serial: string;
  locked: boolean;
};
export type SimVariantBinding = Record<
  number,
  { label: "Tone Excel" | "Tone Plus"; productCode: "TWE" | "TWP" }
>;

const text = (value: unknown) => String(value ?? "").trim();
const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? (value as Record<string, any>) : {};

export function indexLegacySimVariantBindings(payload: unknown) {
  const bindings: SimVariantBinding = {};
  const products = record(payload).products;
  for (const product of Array.isArray(products) ? products : [])
    for (const combination of product.combinations || []) {
      const label = product.choices?.[0]?.values?.find((entry: any) =>
        combination.valueKeys?.includes(entry.key),
      )?.label;
      if (label === "Tone Excel" || label === "Tone Plus")
        bindings[combination.variantId] = {
          label,
          productCode: label === "Tone Excel" ? "TWE" : "TWP",
        };
    }
  return bindings;
}

const categoryNames = (
  item: Record<string, any>,
  product: Record<string, any>,
) => {
  const values =
    product.categories ||
    item.categories ||
    (item.category ? [item.category] : []);
  return (Array.isArray(values) ? values : [values]).map((value) =>
    text(
      typeof value === "string"
        ? value
        : record(value).name || record(value).title,
    ).toLowerCase(),
  );
};

export function isSimOrderItem(value: unknown) {
  const item = record(value);
  const product = record(item.product);
  const name = text(
    product.title || product.name || item.productName || item.name,
  );
  const slug = text(product.slug || item.slug).toLowerCase();
  const type = text(item.type || product.type).toLowerCase();
  if (/(delivery|shipping)[\s_-]*fee/i.test(`${slug} ${name}`)) return false;
  if (["superlite-sim", "biz-sim"].includes(slug) || type === "sim")
    return true;
  if (categoryNames(item, product).includes("sim cards")) return true;
  return /\bsim\b/i.test(name);
}

export function itemVariantId(value: unknown) {
  const item = record(value);
  const id = Number(
    record(item.variant).id || item.variantId || record(item.productVariant).id,
  );
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function deriveSimUnits(
  order: Record<string, any>,
  bindings: SimVariantBinding = {},
): SimUnit[] {
  const items = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.orderItems)
      ? order.orderItems
      : [];
  return items.flatMap((value: unknown, index: number) => {
    const item = record(value);
    if (!isSimOrderItem(item)) return [];
    const product = record(item.product);
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    if (!quantity) return [];
    const productName =
      text(product.title || product.name || item.productName || item.name) ||
      `SIM item ${index + 1}`;
    const authoritative = bindings[itemVariantId(item) || 0];
    const variantLabel: string =
      authoritative?.label ||
      text(
        item.variantLabel ||
          record(item.variant).label ||
          record(item.variant).name ||
          record(item.productVariant).label ||
          record(item.productVariant).name,
      );
    const displayName =
      variantLabel && variantLabel !== "Standard"
        ? `${productName} · ${variantLabel}`
        : productName;
    const orderItemId = text(item.id || item.orderItemId);
    const productIdentity = text(
      product.id || item.productId || product.slug || item.slug || productName,
    )
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const variantIdentity = text(
      record(item.variant).id ||
        item.variantId ||
        record(item.productVariant).id ||
        item.sku ||
        record(item.variant).sku,
    );
    const lineKey = orderItemId
      ? `item-${orderItemId}`
      : `product-${productIdentity}${variantIdentity ? `-variant-${variantIdentity}` : ""}-index-${index}`;
    return Array.from({ length: quantity }, (_, unitIndex) => ({
      unitKey: `${lineKey}:${unitIndex + 1}`,
      orderItemId,
      productName: displayName,
      unitNumber: unitIndex + 1,
      quantity,
      label: `${displayName} · Unit ${unitIndex + 1} of ${quantity}`,
    }));
  });
}

export const isValidSimPrefix = (value: string) => /^\d{9}$/.test(value);
export const isValidSimSerial = (value: string) => /^\d{11}$/.test(value);
export const isCompleteSimAssignment = (
  value: Pick<SimAssignment, "prefix" | "serial">,
) => isValidSimPrefix(value.prefix) && isValidSimSerial(value.serial);
