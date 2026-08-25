'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const { migrateSimToneVariants } = require('../src/lib/admin/simVariantMigration.server.ts');
const { createSimVariantMigrationStore, simDataRoot } = require('../src/lib/admin/simVariantMigrationStore.server.ts');
const { synchronizeSimVariantProjection, verifySimVariantProjection } = require('../src/lib/admin/catalogueAdoption.server.ts');

function args(argv) {
  const result = { apply: false, dataDir: simDataRoot(), base: 'https://bundleapi.tonewow.com/api' };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--apply') result.apply = true;
    else if (value === '--product') result.productId = Number(argv[++index]);
    else if (value === '--expected-fingerprint') result.expectedFingerprint = argv[++index];
    else if (value === '--data-dir') result.dataDir = simDataRoot(argv[++index]);
    else if (value === '--bundle-base-url') result.base = argv[++index].replace(/\/$/, '');
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (![39, 40].includes(result.productId) || !/^[a-f0-9]{64}$/.test(result.expectedFingerprint || '')) throw new Error('Usage: node scripts/migrate-sim-tone-variants.cjs --product 39|40 --expected-fingerprint <64 hex> [--apply] [--data-dir PATH]');
  if (result.apply && !process.env.BUNDLE_ADMIN_TOKEN) throw new Error('BUNDLE_ADMIN_TOKEN is required only with --apply.');
  return result;
}

function adapter(config) {
  const auth = () => process.env.BUNDLE_ADMIN_TOKEN ? { authorization: `Bearer ${process.env.BUNDLE_ADMIN_TOKEN}` } : {};
  async function call(endpoint, init = {}) {
    const response = await fetch(`${config.base}/${endpoint}`, { ...init, headers: { accept: 'application/json', ...auth(), ...(init.headers || {}) }, cache: 'no-store' });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`Bundle returned invalid JSON (${response.status}).`); }
    if (!response.ok) throw new Error(`Bundle rejected ${endpoint} (${response.status}).`);
    return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  }
  async function readProduct(productId) {
    const product = await call(`products/${productId}`), images = [];
    for (const image of product.images || []) {
      const response = await fetch(image.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Unable to snapshot SIM image ${image.id}.`);
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length || body.length > 10 * 1024 * 1024) throw new Error(`SIM image ${image.id} is invalid or too large.`);
      images.push({ ...image, sha256: require('node:crypto').createHash('sha256').update(body).digest('hex') });
    }
    return { ...product, images };
  }
  const json = (body) => ({ 'content-type': 'application/json', body: JSON.stringify(body) });
  return {
    checkpoints: createSimVariantMigrationStore(config.dataDir),
    readProduct,
    async updateOptionValues(productId, optionId, change) {
      await call(`products/${productId}/options/${optionId}`, { method: 'PUT', ...json(change) });
    },
    async createVariant(productId, optionName, label) {
      await call(`products/${productId}/variants`, { method: 'POST', ...json({ optionName, values: [{ value: label }], autoGenerateSku: true, defaultInventory: 0 }) });
    },
    async updateOption(productId, optionId, change) {
      const current = await readProduct(productId);
      const existing = current.options.find((option) => option.id === optionId);
      if (!existing) throw new Error(`Bundle option ${optionId} is unavailable.`);
      await call(`products/${productId}/options/${optionId}`, { method: 'PUT', ...json({ name: change.name, values: existing.values.map((value) => ({ value: value.value })) }) });
    },
    async updateVariants(productId, variants) {
      await call(`products/${productId}/batch-update`, { method: 'POST', ...json({ variants }) });
    },
    async synchronizeProjection(change) {
      if (change.mode !== 'activate') {
        await synchronizeSimVariantProjection(change, { dataDirectory: config.dataDir });
        return;
      }
      const adoptionPath = path.join(config.dataDir, 'catalogue-imports', 'by-bundle', `${change.productId}.json`);
      const adoption = JSON.parse(fs.readFileSync(adoptionPath, 'utf8'));
      if (!/^[a-f0-9]{64}$/.test(String(adoption.sourceFingerprint || ''))) throw new Error('Active SIM adoption source fingerprint is unavailable.');
      await synchronizeSimVariantProjection({ ...change, expectedSourceFingerprint: adoption.sourceFingerprint }, { dataDirectory: config.dataDir });
    },
    verifyProjection: (change) => verifySimVariantProjection(change, { dataDirectory: config.dataDir }).then(() => undefined),
  };
}

(async () => {
  const config = args(process.argv.slice(2));
  process.env.TONEWOW_DATA_DIR = config.dataDir;
  const result = await migrateSimToneVariants({ productId: config.productId, expectedFingerprint: config.expectedFingerprint, apply: config.apply }, adapter(config));
  process.stdout.write(`${JSON.stringify({ mode: config.apply ? 'apply' : 'dry-run', ...result }, null, 2)}\n`);
})().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
