import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readCatalogueProduct, type CatalogueProductRecord } from '@/lib/admin/catalogueProduct.server';
import { readPublicationJob, type CataloguePublicationJob } from '@/lib/admin/cataloguePublication.server';
import { readCatalogueAdoptionByBundle } from '@/lib/admin/catalogueAdoption.server';
import { readVerifiedCatalogueMedia } from '@/lib/admin/catalogueMedia.server';
import { readCataloguePublishedSnapshot, readCataloguePublishedSnapshotMedia, type CataloguePublishedProduct, type CataloguePublishedSnapshotManifest } from '@/lib/cataloguePublishedSnapshot.server';

const PRODUCT_DIRECTORY = path.join(process.cwd(), '.data', 'catalogue-products');
const PUBLICATION_DIRECTORY = path.join(process.cwd(), '.data', 'catalogue-publications');
const MAX_RECORDS = 1_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION = /^[a-f0-9]{64}$/;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const ACTIVATED_PHASES = new Set<CataloguePublicationJob['phase']>(['activated', 'retirement-uncertain', 'previous-retired', 'complete']);

async function names(directory: string, pattern: RegExp) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (reason: any) { if (reason?.code === 'ENOENT') return []; throw reason; }
  if (entries.length > MAX_RECORDS) throw new Error('Catalogue public projection record limit exceeded.');
  return entries.filter((entry) => entry.isFile() && pattern.test(entry.name)).map((entry) => entry.name.slice(0, -5)).sort();
}
async function publicationJobs() {
  const operationIds = await names(PUBLICATION_DIRECTORY, new RegExp(`^${OPERATION.source.slice(1, -1)}\\.json$`));
  const jobs: CataloguePublicationJob[] = [];
  for (const operationId of operationIds) { const job = await readPublicationJob(operationId); if (job) jobs.push(job); }
  return jobs;
}
function activeVersion(product: CatalogueProductRecord) {
  const active = product.bundleVersions.filter(version => version.retiredAt === null);
  return product.status === 'published' && positive(product.currentBundleProductId) && active.length === 1
    && active[0].bundleProductId === product.currentBundleProductId ? active[0] : null;
}
async function ordinarySnapshot(product: CatalogueProductRecord, jobs: CataloguePublicationJob[]): Promise<CataloguePublishedSnapshotManifest|null> {
  const active = activeVersion(product); if (!active) return null;
  const matching = jobs.filter(job => job.catalogueId === product.catalogueId && ACTIVATED_PHASES.has(job.phase)
    && job.draftBundleProductId === product.currentBundleProductId
    && (job.resultFingerprint64 === null || job.resultFingerprint64 === active.fingerprint));
  if (matching.length !== 1) return null;
  const job = matching[0], snapshot = await readCataloguePublishedSnapshot(job.operationId);
  if (!snapshot || snapshot.operationId !== job.operationId || snapshot.catalogueId !== product.catalogueId
    || snapshot.bundleProductId !== product.currentBundleProductId || snapshot.resultFingerprint64 !== active.fingerprint
    || snapshot.product.catalogueId !== product.catalogueId || snapshot.product.bundleProductId !== product.currentBundleProductId) return null;
  return snapshot;
}

export async function readCataloguePublicProjection(): Promise<{ products: CataloguePublishedProduct[] }> {
  const [productIds, jobs] = await Promise.all([
    names(PRODUCT_DIRECTORY, new RegExp(`^${UUID.source.slice(1, -1)}\\.json$`)), publicationJobs(),
  ]);
  const products: CataloguePublishedProduct[] = [];
  for (const catalogueId of productIds) {
    const product = await readCatalogueProduct(catalogueId);
    if (!product || product.status !== 'published') continue;
    const adoption = positive(product.currentBundleProductId) ? await readCatalogueAdoptionByBundle(product.currentBundleProductId) : null;
    if (adoption?.status === 'active') {
      const version = product.bundleVersions[0];
      const projection = adoption.activatedProjection;
      if (adoption.catalogueId === product.catalogueId
        && adoption.bundleProductId === product.currentBundleProductId
        && product.bundleVersions.length === 1
        && version?.bundleProductId === adoption.bundleProductId
        && version?.fingerprint === adoption.sourceFingerprint
        && version?.retiredAt === null
        && projection.catalogueId === product.catalogueId
        && projection.bundleProductId === adoption.bundleProductId) products.push(structuredClone(projection));
      continue;
    }
    const snapshot = await ordinarySnapshot(product, jobs); if (snapshot) products.push(structuredClone(snapshot.product));
  }
  const payload = { products };
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_RESPONSE_BYTES) throw new Error('Catalogue public projection response limit exceeded.');
  return payload;
}

export async function readCataloguePublicSnapshotMedia(catalogueId: string, mediaId: string) {
  if (!UUID.test(catalogueId) || !UUID.test(mediaId)) return null;
  const product = await readCatalogueProduct(catalogueId); if (!product || product.status !== 'published') return null;
  const adoption = positive(product.currentBundleProductId) ? await readCatalogueAdoptionByBundle(product.currentBundleProductId) : null;
  if (adoption?.status === 'active') {
    const version = activeVersion(product), expectedUrl = `/catalogue-products-api?catalogueId=${encodeURIComponent(catalogueId)}&mediaId=${encodeURIComponent(mediaId)}`;
    const image = adoption.activatedProjection.images.find(item => item.url === expectedUrl);
    const attestation = adoption.mediaHashes.find(item => item.mediaId === mediaId);
    if (!version || adoption.catalogueId !== catalogueId || adoption.bundleProductId !== product.currentBundleProductId
      || version.fingerprint !== adoption.sourceFingerprint || adoption.activatedProjection.catalogueId !== catalogueId
      || adoption.activatedProjection.bundleProductId !== adoption.bundleProductId || !image || !attestation) return null;
    const media = await readVerifiedCatalogueMedia(catalogueId, mediaId);
    if (media.sha256 !== attestation.sha256 || media.bytes !== attestation.bytes || media.contentType !== attestation.contentType
      || media.order !== image.order || media.assignment !== image.assignment) return null;
    return media;
  }
  const snapshot = await ordinarySnapshot(product, await publicationJobs()); if (!snapshot || !snapshot.media.some(item => item.mediaId === mediaId)) return null;
  return readCataloguePublishedSnapshotMedia(snapshot.operationId, mediaId);
}
