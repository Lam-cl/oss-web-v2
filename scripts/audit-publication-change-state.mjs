import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { evaluatePublicationChangeState } from '../src/lib/admin/cataloguePublicationChangeState.server.ts';

const root = path.resolve(process.env.TONEWOW_AUDIT_DATA_DIR || path.join(process.cwd(), '.data'));
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const files = async (directory) => (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => path.join(directory, entry.name));

const productFiles = await files(path.join(root, 'catalogue-products'));
const jobFiles = await files(path.join(root, 'catalogue-publications'));
const jobs = await Promise.all(jobFiles.map(json));
const jobsByCatalogue = new Map();
for (const job of jobs) jobsByCatalogue.set(job.catalogueId, [...(jobsByCatalogue.get(job.catalogueId) || []), job]);

const response = await fetch('https://bundleapi.tonewow.com/api/products?type=MERCHANDISE&limit=1000');
if (!response.ok) throw new Error(`Bundle catalogue audit failed (${response.status}).`);
const payload = await response.json();
const providerById = new Map((payload.data || []).map((product) => [product.id, product]));

const results = [];
for (const file of productFiles) {
  const product = await json(file);
  const productJobs = jobsByCatalogue.get(product.catalogueId) || [];
  const active = product.bundleVersions.filter((version) => version.retiredAt === null);
  const matching = active.length === 1 ? productJobs.filter((job) => job.phase === 'complete'
    && job.draftBundleProductId === active[0].bundleProductId
    && job.resultFingerprint64 === active[0].fingerprint) : [];
  let snapshot = null;
  let storageUncertain = false;
  if (matching.length === 1) {
    try { snapshot = await json(path.join(root, 'catalogue-published', matching[0].operationId, 'manifest.json')); }
    catch { storageUncertain = true; }
  }
  let media = [];
  try { ({ media } = await json(path.join(root, 'catalogue-media', product.catalogueId, 'manifest.json'))); }
  catch { storageUncertain = true; }
  const state = evaluatePublicationChangeState({
    product, jobs: productJobs, snapshot, media,
    providerProduct: providerById.get(product.currentBundleProductId) || null,
    storageUncertain,
  });
  results.push({ title: product.model.details.title, bundleProductId: product.currentBundleProductId, ...state });
}

results.sort((left, right) => left.title.localeCompare(right.title));
console.table(results);
console.log(JSON.stringify({ products: results.length, publicationJobsRead: jobs.length }, null, 2));
