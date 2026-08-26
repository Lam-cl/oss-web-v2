import { isDeepStrictEqual } from 'node:util';
import type { CatalogueMediaMetadata } from './catalogueMedia.server';
import type { CatalogueProductRecord } from './catalogueProduct.server';
import type { CataloguePublicationJob } from './cataloguePublication.server';
import type { CataloguePublishedSnapshotManifest } from '../cataloguePublishedSnapshot.server';

export type PublicationChangeState = 'clean' | 'dirty' | 'unknown';
export type PublicationChangeResult = {
  publicationChangeState: PublicationChangeState;
  publicationChangeReason?: string;
};

export type PublicationProviderProduct = {
  id: number;
  productVariants?: Array<{ id?: number; sku?: string }>;
};

type Evidence = {
  product: CatalogueProductRecord;
  jobs: CataloguePublicationJob[];
  snapshot: CataloguePublishedSnapshotManifest | null;
  media: CatalogueMediaMetadata[];
  providerProduct: PublicationProviderProduct | null;
  storageUncertain?: boolean;
};

const unknown = (reason: string): PublicationChangeResult => ({
  publicationChangeState: 'unknown',
  publicationChangeReason: reason,
});

function activeVersion(product: CatalogueProductRecord) {
  const active = product.bundleVersions.filter((version) => version.retiredAt === null);
  return product.status === 'published'
    && product.currentBundleProductId !== null
    && active.length === 1
    && active[0].bundleProductId === product.currentBundleProductId
    ? active[0]
    : null;
}

function currentProjection(product: CatalogueProductRecord) {
  const activeValues = new Set(product.model.choices.flatMap((choice) => (
    choice.values.filter((value) => !value.retired).map((value) => value.key)
  )));
  const details = {
    title: product.model.details.title,
    price: product.model.details.price,
    description: product.model.details.description,
    ...(product.model.details.category === undefined ? {} : { category: product.model.details.category }),
  };
  return {
    slug: product.slug,
    details,
    minimumOrderQuantity: product.model.details.minimumOrderQuantity ?? 1,
    choices: product.model.choices.map((choice) => ({
      key: choice.key,
      name: choice.name,
      values: choice.values.filter((value) => !value.retired).map((value) => ({ key: value.key, label: value.label })),
    })),
    combinations: product.model.combinations
      .filter((combination) => combination.valueKeys.every((key) => activeValues.has(key)))
      .map((combination) => ({
        valueKeys: combination.valueKeys,
        price: combination.price,
        inventory: combination.inventory,
      })),
  };
}

function snapshotProjection(snapshot: CataloguePublishedSnapshotManifest) {
  return {
    slug: snapshot.product.slug,
    details: snapshot.product.details,
    minimumOrderQuantity: snapshot.product.minimumOrderQuantity ?? 1,
    choices: snapshot.product.choices,
    combinations: snapshot.product.combinations.map(({ variantId: _variantId, ...combination }) => combination),
  };
}

function currentMediaProjection(media: CatalogueMediaMetadata[]) {
  return [...media].sort((left, right) => left.order - right.order).map((item) => ({
    mediaId: item.mediaId,
    originalName: item.originalName,
    contentType: item.contentType,
    bytes: item.bytes,
    sha256: item.sha256,
    order: item.order,
    assignment: item.assignment,
  }));
}

function snapshotMediaProjection(snapshot: CataloguePublishedSnapshotManifest) {
  return snapshot.media.map(({ file: _file, ...item }) => item);
}

function normalizedSku(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function expectedSku(product: CatalogueProductRecord, valueKeys: string[], explicitSku: string | undefined, index: number) {
  const labels = new Map(product.model.choices.flatMap((choice) => choice.values.map((value) => [value.key, value.label] as const)));
  return normalizedSku(explicitSku || [product.model.details.title, ...valueKeys.map((key) => labels.get(key) || key)].join('-')) || `PRODUCT-${index + 1}`;
}

function providerSkusMatch(product: CatalogueProductRecord, snapshot: CataloguePublishedSnapshotManifest, provider: PublicationProviderProduct) {
  const variants = provider.productVariants || [];
  const providerById = new Map(variants.map((variant) => [variant.id, variant]));
  const expectedIds = new Set(snapshot.product.combinations.map((combination) => combination.variantId));
  const simManaged = (product.currentBundleProductId === 39 || product.currentBundleProductId === 40)
    && /^sim$/i.test(product.model.details.category?.trim() || '');
  if (simManaged ? Array.from(expectedIds).some((id) => !providerById.has(id))
    : variants.length !== expectedIds.size || variants.some((variant) => !variant.id || !expectedIds.has(variant.id))) return null;
  const currentByTuple = new Map(product.model.combinations.map((combination, index) => [
    JSON.stringify(combination.valueKeys),
    { combination, index },
  ]));
  const suffix = new RegExp(`-TW${product.catalogueId.slice(0, 8).toUpperCase()}V[1-9][0-9]*$`);
  for (const published of snapshot.product.combinations) {
    const current = currentByTuple.get(JSON.stringify(published.valueKeys));
    const providerVariant = providerById.get(published.variantId);
    if (!current || typeof providerVariant?.sku !== 'string' || !simManaged && !suffix.test(providerVariant.sku.toUpperCase())) return null;
    const providerCanonicalSku = simManaged ? normalizedSku(providerVariant.sku) : providerVariant.sku.toUpperCase().replace(suffix, '');
    if (providerCanonicalSku !== expectedSku(product, current.combination.valueKeys, current.combination.sku, current.index)) return false;
  }
  return true;
}

export function evaluatePublicationChangeState(evidence: Evidence): PublicationChangeResult {
  const { product } = evidence;
  if (product.status === 'draft' && product.currentBundleProductId === null) return { publicationChangeState: 'dirty' };
  const active = activeVersion(product);
  if (!active) return unknown('Active Bundle publication identity is missing or ambiguous.');
  if (evidence.storageUncertain) return unknown('Publication job evidence could not be read safely.');
  const matchingJobs = evidence.jobs.filter((job) => job.phase === 'complete'
    && job.catalogueId === product.catalogueId
    && job.draftBundleProductId === active.bundleProductId
    && job.resultFingerprint64 === active.fingerprint);
  if (matchingJobs.length !== 1) return unknown(matchingJobs.length
    ? 'More than one completed publication job matches the active Bundle version.'
    : 'A completed publication job for the active Bundle version is missing.');
  const job = matchingJobs[0];
  const snapshot = evidence.snapshot;
  if (!snapshot || snapshot.operationId !== job.operationId
    || snapshot.catalogueId !== product.catalogueId
    || snapshot.bundleProductId !== active.bundleProductId
    || snapshot.resultFingerprint64 !== active.fingerprint) {
    return unknown('The published snapshot is missing or does not match the active Bundle version.');
  }
  const boundVariantIds = new Set(job.bindings.map((binding) => binding.variantId));
  const snapshotVariantIds = new Set(snapshot.product.combinations.map((combination) => combination.variantId));
  if (boundVariantIds.size !== snapshotVariantIds.size
    || Array.from(boundVariantIds).some((variantId) => !snapshotVariantIds.has(variantId))) {
    return unknown('Publication variant bindings do not match the published snapshot.');
  }
  if (!evidence.providerProduct || evidence.providerProduct.id !== active.bundleProductId) {
    return unknown('The active Bundle product could not be verified.');
  }
  const skuMatch = providerSkusMatch(product, snapshot, evidence.providerProduct);
  if (skuMatch === null) return unknown('The active Bundle variant identities or SKU evidence are incomplete.');
  if (!isDeepStrictEqual(currentProjection(product), snapshotProjection(snapshot))
    || !isDeepStrictEqual(currentMediaProjection(evidence.media), snapshotMediaProjection(snapshot))
    || skuMatch === false) return { publicationChangeState: 'dirty' };
  return { publicationChangeState: 'clean' };
}
