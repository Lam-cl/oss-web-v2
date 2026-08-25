import { createHash } from "node:crypto";
import { BUNDLE_API, readUpstream } from "./server";
import {
  readShippingSettings,
  saveShippingSettings,
} from "../shippingSettings.server";
import type { SimProductUpdateDependencies } from "./simProductUpdate.server";
import {
  synchronizeSimVariantProjection,
  verifySimVariantProjection,
} from "./catalogueAdoption.server";
import { simDataRoot } from "./simVariantMigrationStore.server";
type Row = Record<string, any>;
type Fetcher = typeof fetch;
const MAX = 10 * 1024 * 1024,
  object = (v: unknown): v is Row =>
    Boolean(v) && typeof v === "object" && !Array.isArray(v),
  rows = (v: unknown) => (Array.isArray(v) ? v.filter(object) : []);
function providerMessage(payload: unknown) {
  const candidate = object(payload)
    ? typeof payload.message === "string"
      ? payload.message
      : object(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : typeof payload.error === "string"
          ? payload.error
          : ""
    : "";
  return candidate
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\b(bearer|authorization|token|secret|password|api[-_ ]?key)\b\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 200);
}
export class SimProductBundleAdapterError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "SimProductBundleAdapterError";
  }
}
export function createSimProductBundleAdapter(
  token: string,
  fetcher: Fetcher = fetch,
): SimProductUpdateDependencies {
  if (typeof token !== "string" || !token || token.length > 8192)
    throw new SimProductBundleAdapterError("Valid Bundle token required.", 500);
  const shippingBefore = new Map<
    number,
    {
      slug: string;
      idPresent: boolean;
      idValue: unknown;
      slugPresent: boolean;
      slugValue: unknown;
    }
  >();
  const headers = () =>
    new Headers({
      authorization: "Bearer " + token,
      accept: "application/json",
    });
  async function call(path: string, init: RequestInit = {}) {
    let response;
    try {
      response = await fetcher(`${BUNDLE_API}/${path}`, {
        ...init,
        headers: init.headers ?? headers(),
        cache: "no-store",
      });
    } catch {
      throw new SimProductBundleAdapterError(
        "Bundle SIM update request failed.",
      );
    }
    const payload = await readUpstream(response);
    if (!response.ok) {
      const detail = providerMessage(payload);
      throw new SimProductBundleAdapterError(
        `Bundle rejected SIM update (${response.status})${detail ? `: ${detail}` : ""}.`,
        response.status,
      );
    }
    return payload;
  }
  async function bytes(url: unknown) {
    if (typeof url !== "string")
      throw new SimProductBundleAdapterError("Bundle image URL missing.");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new SimProductBundleAdapterError("Bundle image URL invalid.");
    }
    if (parsed.protocol !== "https:")
      throw new SimProductBundleAdapterError(
        "Bundle image URL must use HTTPS.",
      );
    const response = await fetcher(parsed, { cache: "no-store" });
    if (!response.ok)
      throw new SimProductBundleAdapterError(
        "Bundle image storage readback failed.",
      );
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX)
      throw new SimProductBundleAdapterError("Bundle image is too large.");
    const body = new Uint8Array(await response.arrayBuffer());
    if (!body.length || body.length > MAX)
      throw new SimProductBundleAdapterError(
        "Bundle image storage readback is invalid.",
      );
    return body;
  }
  async function readRaw(id: number): Promise<Row> {
    const raw = await call(`products/${id}`),
      p = object(raw) && object(raw.data) ? raw.data : raw;
    if (!object(p) || p.id !== id)
      throw new SimProductBundleAdapterError(
        "Bundle SIM product readback identity failed.",
      );
    const images: Row[] = [];
    for (const image of rows(p.images)) {
      const body = await bytes(image.url);
      images.push({
        ...image,
        sha256: createHash("sha256").update(body).digest("hex"),
      });
    }
    return { ...p, images };
  }
  function imageIdentity(p: Row) {
    const images = rows(p.images);
    if (
      !images.length ||
      images.some(
        (image) =>
          !Number.isSafeInteger(image.id) ||
          typeof image.url !== "string" ||
          typeof image.sha256 !== "string" ||
          !Number.isSafeInteger(image.order),
      )
    )
      throw new SimProductBundleAdapterError(
        "Exact original SIM image identity readback is incomplete.",
      );
    return images.map((image) => ({
      id: image.id,
      url: image.url,
      sha256: image.sha256,
      order: image.order,
    }));
  }
  function assertImages(original: unknown, current: Row) {
    if (JSON.stringify(original) !== JSON.stringify(imageIdentity(current)))
      throw new SimProductBundleAdapterError(
        "Exact original SIM image identity changed; image must remain unchanged.",
        503,
      );
  }
  function metadataForm(p: Row, description: string, price: number) {
    const form = new FormData();
    form.set("title", String(p.title));
    form.set("description", description);
    form.set("type", String(p.type));
    form.set("price", String(price));
    form.set("shippingCost", String(p.shippingCost ?? 0));
    form.set("weight", String(p.weight ?? 0));
    return form;
  }
  async function updateMetadata(
    id: number,
    change: { description: string; price: number },
  ) {
    const before = await readRaw(id),
      images = imageIdentity(before);
    await call(`products/${id}`, {
      method: "PUT",
      headers: headers(),
      body: metadataForm(before, change.description, change.price),
    });
    assertImages(images, await readRaw(id));
  }
  async function updateVariants(
    id: number,
    changes: Array<{
      id: number;
      sku: string;
      price: number;
      inventory: number;
    }>,
  ) {
    const p = await readRaw(id),
      images = imageIdentity(p),
      provider = rows(p.productVariants);
    if (
      changes.length !== 2 ||
      changes.some(
        (change) =>
          !provider.some(
            (variant) => variant.id === change.id && variant.sku === change.sku,
          ),
      )
    )
      throw new SimProductBundleAdapterError(
        "Exact two-row SIM variant matrix is missing or drifted.",
        409,
      );
    await call(`products/${id}/batch-update`, {
      method: "POST",
      headers: new Headers({
        ...Object.fromEntries(headers()),
        "content-type": "application/json",
      }),
      body: JSON.stringify({ variants: changes }),
    });
    assertImages(images, await readRaw(id));
  }
  return {
    async readProduct(id) {
      return readRaw(id);
    },
    updateMetadata,
    updateVariants,
    synchronizeProjection: (change) =>
      synchronizeSimVariantProjection(change, {
        dataDirectory: simDataRoot(),
      }).then(() => undefined),
    verifyProjection: (change) =>
      verifySimVariantProjection(change, { dataDirectory: simDataRoot() }).then(
        () => undefined,
      ),
    async readShippingGroup(id, slug) {
      const s = await readShippingSettings(),
        key = String(id);
      if (!shippingBefore.has(id))
        shippingBefore.set(id, {
          slug,
          idPresent: Object.hasOwn(s.productGroups, key),
          idValue: s.productGroups[key],
          slugPresent: Object.hasOwn(s.productGroups, slug),
          slugValue: s.productGroups[slug],
        });
      return s.productGroups[key] ?? s.productGroups[slug] ?? null;
    },
    async ensureShippingGroup(id, slug, group) {
      if (![39, 40].includes(id))
        throw new SimProductBundleAdapterError(
          "Shipping mapping is restricted to SIM product IDs 39/40.",
          409,
        );
      const before = await readRaw(id),
        images = imageIdentity(before),
        s = await readShippingSettings();
      if (
        s.productGroups[String(id)] !== group ||
        s.productGroups[slug] !== group
      )
        await saveShippingSettings({
          ...s,
          productGroups: {
            ...s.productGroups,
            [String(id)]: group,
            [slug]: group,
          },
        });
      assertImages(images, await readRaw(id));
    },
    async restoreProduct(id, beforeValue) {
      if (!object(beforeValue))
        throw new SimProductBundleAdapterError(
          "SIM rollback snapshot invalid.",
          500,
        );
      const before = beforeValue as Row,
        images = imageIdentity(before),
        current = await readRaw(id),
        variants = rows(before.productVariants);
      assertImages(images, current);
      if (variants.length !== 3)
        throw new SimProductBundleAdapterError(
          "SIM rollback variant matrix snapshot invalid.",
          500,
        );
      await call(`products/${id}`, {
        method: "PUT",
        headers: headers(),
        body: metadataForm(
          before,
          String(before.description ?? ""),
          Number(before.price),
        ),
      });
      assertImages(images, await readRaw(id));
      await call(`products/${id}/batch-update`, {
        method: "POST",
        headers: new Headers({
          ...Object.fromEntries(headers()),
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          variants: variants.map((variant) => ({
            id: variant.id,
            sku: variant.sku,
            price: Number(variant.price),
            inventory: Number(variant.inventory),
          })),
        }),
      });
      assertImages(images, await readRaw(id));
      const shipping = shippingBefore.get(id);
      if (shipping) {
        const settings = await readShippingSettings(),
          groups = { ...settings.productGroups },
          key = String(id);
        if (shipping.idPresent) groups[key] = shipping.idValue as any;
        else delete groups[key];
        if (shipping.slugPresent)
          groups[shipping.slug] = shipping.slugValue as any;
        else delete groups[shipping.slug];
        if (
          groups[key] !== settings.productGroups[key] ||
          groups[shipping.slug] !== settings.productGroups[shipping.slug] ||
          Object.hasOwn(groups, key) !==
            Object.hasOwn(settings.productGroups, key) ||
          Object.hasOwn(groups, shipping.slug) !==
            Object.hasOwn(settings.productGroups, shipping.slug)
        )
          await saveShippingSettings({ ...settings, productGroups: groups });
      }
      assertImages(images, await readRaw(id));
    },
  };
}
