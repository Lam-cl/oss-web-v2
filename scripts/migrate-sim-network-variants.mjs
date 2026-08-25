#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = (process.env.BUNDLE_API_URL || 'https://bundleapi.tonewow.com/api').replace(/\/$/, '');
const token = process.env.BUNDLE_ADMIN_TOKEN || '';
const apply = process.argv.includes('--apply');
const productIds = process.argv.filter((value) => /^\d+$/.test(value)).map(Number);
const targets = productIds.length ? productIds : [39, 40];

async function request(apiPath, init = {}) {
  const response = await fetch(`${API}/${apiPath}`, {
    ...init,
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${apiPath}: ${payload.message || response.status}`);
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function variantNetwork(variant) {
  const source = JSON.stringify({ sku: variant.sku, selectedOptions: variant.selectedOptions });
  if (/tone.plus|\bTWP\b/i.test(source)) return 'TWP';
  if (/tone.excel|\bTWE\b/i.test(source)) return 'TWE';
  return '';
}

const products = [];
for (const id of targets) products.push(await request(`products/${id}`));
const migrationPlan = products.map((product) => {
  const inventory = (product.productVariants || []).reduce((total, variant) => total + Math.max(0, Number(variant.inventory) || 0), 0);
  return { id: product.id, title: product.title || product.name, inventory, twe: Math.ceil(inventory / 2), twp: Math.floor(inventory / 2), alreadyConfigured: product.options?.some((option) => /^network$/i.test(option.name)) };
});
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', products: migrationPlan }, null, 2));

if (!apply) process.exit(0);
if (!token) throw new Error('BUNDLE_ADMIN_TOKEN is required with --apply.');
const backupDirectory = `/root/.codex/backups/tonewow-bundle-products/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(backupDirectory, { recursive: true });
await writeFile(path.join(backupDirectory, 'sim-products-before.json'), JSON.stringify(products, null, 2), { mode: 0o600 });

for (const plan of migrationPlan) {
  if (plan.alreadyConfigured) continue;
  const before = products.find((product) => Number(product.id) === Number(plan.id));
  await request(`products/${plan.id}/batch-update`, { method: 'POST', body: JSON.stringify({ variants: (before.productVariants || []).map((variant) => ({ id: variant.id, sku: variant.sku, price: Number(variant.price), inventory: 0 })) }) });
  for (const option of before.options || []) {
    for (const value of option.values || []) await request(`products/${plan.id}/options/${option.id}/values/${value.id}`, { method: 'DELETE' });
    try { await request(`products/${plan.id}/options/${option.id}`, { method: 'DELETE' }); } catch { /* final value may remove the option */ }
  }
  await request(`products/${plan.id}/variants`, { method: 'POST', body: JSON.stringify({ optionName: 'Network', values: [{ value: 'Tone Excel (TWE)' }, { value: 'Tone Plus (TWP)' }], autoGenerateSku: true, defaultInventory: 0 }) });
  const generated = await request(`products/${plan.id}`);
  const variants = (generated.productVariants || []).map((variant) => {
    const network = variantNetwork(variant);
    return { id: variant.id, sku: variant.sku, price: Number(variant.price ?? before.price), inventory: network === 'TWE' ? plan.twe : network === 'TWP' ? plan.twp : 0 };
  });
  if (!variants.some((variant) => /TWE/i.test(variant.sku || '')) || !variants.some((variant) => /TWP/i.test(variant.sku || ''))) throw new Error(`Product ${plan.id}: generated TWE/TWP variants could not be identified. Restore from ${backupDirectory}.`);
  await request(`products/${plan.id}/batch-update`, { method: 'POST', body: JSON.stringify({ variants }) });
}

console.log(`Migration complete. Rollback snapshot: ${backupDirectory}`);
