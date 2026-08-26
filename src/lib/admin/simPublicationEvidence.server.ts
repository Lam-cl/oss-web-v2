import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readCatalogueAdoptionByBundle, SIM_ADOPTION_MINIMUM_ORDER_QUANTITY } from './catalogueAdoption.server';
import { listCatalogueMedia, readVerifiedCatalogueMedia } from './catalogueMedia.server';
import { readCatalogueProduct } from './catalogueProduct.server';
import { createCompletedPublicationEvidence } from './cataloguePublication.server';
import { createCataloguePublishedSnapshot, readCataloguePublishedSnapshot, type CataloguePublishedProduct } from '../cataloguePublishedSnapshot.server';

const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  : JSON.stringify(value);

export async function recordSimPublicationEvidence(productId: 39|40, fingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('A verified SIM provider fingerprint is required.');
  const adoption = await readCatalogueAdoptionByBundle(productId);
  if (!adoption || adoption.status !== 'active' || adoption.managementProfile?.domain !== 'SIM') throw new Error('Active SIM adoption evidence is unavailable.');
  const product = await readCatalogueProduct(adoption.catalogueId);
  const active = product?.bundleVersions.filter((version) => version.retiredAt === null) || [];
  if (!product || product.status !== 'published' || product.currentBundleProductId !== productId || active.length !== 1 || active[0].fingerprint !== fingerprint) {
    throw new Error('SIM Catalogue projection does not attest the provider fingerprint.');
  }
  const metadata = await listCatalogueMedia(product.catalogueId);
  if (!metadata.length) throw new Error('SIM publication media evidence is missing.');
  const uploads = await Promise.all([...metadata].sort((left, right) => left.order - right.order)
    .map((item) => readVerifiedCatalogueMedia(product.catalogueId, item.mediaId)));
  const choices = product.model.choices.map((choice) => ({ key: choice.key, name: choice.name,
    values: choice.values.filter((value) => !value.retired).map((value) => ({ key: value.key, label: value.label })) }));
  const activeKeys = new Set(choices.flatMap((choice) => choice.values.map((value) => value.key)));
  const combinations = product.model.combinations.filter((item) => item.valueKeys.every((key) => activeKeys.has(key))).map((item) => {
    if (!item.variantId) throw new Error('SIM publication variant evidence is missing.');
    return { valueKeys: [...item.valueKeys], variantId: item.variantId, price: item.price, inventory: item.inventory };
  });
  const publicProduct: CataloguePublishedProduct = {
    catalogueId: product.catalogueId, slug: product.slug,
    details: { title: product.model.details.title, price: product.model.details.price,
      description: product.model.details.description, ...(product.model.details.category ? { category: product.model.details.category } : {}) },
    choices, combinations,
    images: metadata.sort((left, right) => left.order - right.order).map((item) => ({
      url: `/catalogue-products-api?catalogueId=${encodeURIComponent(product.catalogueId)}&mediaId=${encodeURIComponent(item.mediaId)}`,
      order: item.order, assignment: item.assignment,
    })),
    bundleProductId: productId, minimumOrderQuantity: SIM_ADOPTION_MINIMUM_ORDER_QUANTITY,
  };
  const operationId = createHash('sha256').update(canonical({ kind: 'sim-in-place-publication-v1', fingerprint, publicProduct,
    media: metadata.map(({ mediaId, sha256, order, assignment }) => ({ mediaId, sha256, order, assignment })) })).digest('hex');
  const snapshotInput = { operationId, catalogueId: product.catalogueId, bundleProductId: productId,
    resultFingerprint64: fingerprint, product: publicProduct,
    media: uploads.map((item) => ({ mediaId: item.mediaId, originalName: item.originalName, contentType: item.contentType,
      bytes: item.bytes, sha256: item.sha256, order: item.order, assignment: item.assignment, body: item.body })) };
  await createCataloguePublishedSnapshot(snapshotInput);
  const snapshot = await readCataloguePublishedSnapshot(operationId);
  if (!snapshot || !isDeepStrictEqual(snapshot.product, publicProduct)) throw new Error('SIM published snapshot readback failed.');
  const resolved = {
    options: Object.fromEntries(product.model.choices.map((choice) => [choice.key, choice.optionId]).filter((entry): entry is [string,number] => Number.isSafeInteger(entry[1]))),
    values: Object.fromEntries(product.model.choices.flatMap((choice) => choice.values.filter((value) => !value.retired && value.valueId).map((value) => [value.key, value.valueId!]))),
    images: Object.fromEntries(metadata.map((item, index) => [item.mediaId, product.model.existingImages[index]?.imageId]).filter((entry): entry is [string,number] => Number.isSafeInteger(entry[1]))),
    variants: Object.fromEntries(combinations.map((item) => [`variant:${item.valueKeys.join(':')}`, item.variantId])),
  };
  const bindings = combinations.map((item) => ({ valueKeys: item.valueKeys, variantId: item.variantId }));
  const job = await createCompletedPublicationEvidence({ operationId, catalogueId: product.catalogueId, modelFingerprint64: fingerprint,
    previousBundleProductId: productId, draftBundleProductId: productId, resolved, bindings, resultFingerprint64: fingerprint });
  return { operationId, job, snapshot };
}
