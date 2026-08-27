#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://bundleapi.tonewow.com/api/products';
const EXPORT = path.join(ROOT, 'test-reports/staging-catalogue-export-2026-08-23.json');
const MANIFEST = path.join(ROOT, 'test-reports/staging-catalogue-migration-2026-08-23.md');
const LEGACY = path.join(ROOT, '.data/product-image-colors.json');
const EXCLUDED_PROBE_IDS = new Set([56, 57]);
const clean = (value) => value == null ? null : String(value);
const number = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const order = (a, b) => (number(a.order) ?? 0) - (number(b.order) ?? 0) || (number(a.id) ?? 0) - (number(b.id) ?? 0);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const key = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

async function getJson(url) {
  const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function legacySettings() {
  try {
    const raw = JSON.parse(await readFile(LEGACY, 'utf8'));
    const products = {};
    for (const [productId, assignments] of Object.entries(raw.products || {}).sort(([a], [b]) => Number(a) - Number(b))) {
      products[productId] = Object.fromEntries(Object.entries(assignments || {}).sort(([a], [b]) => Number(a) - Number(b)));
    }
    const hiddenOptionValues = {};
    for (const [productId, ids] of Object.entries(raw.hiddenOptionValues || {}).sort(([a], [b]) => Number(a) - Number(b))) {
      hiddenOptionValues[productId] = [...new Set((ids || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
    }
    return { source: '.data/product-image-colors.json', products, hiddenOptionValues };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EACCES') return { source: null, products: {}, hiddenOptionValues: {} };
    throw new Error(`Legacy image settings are not valid JSON: ${error.message}`);
  }
}

function taxonomy(values) {
  return [...(values || [])].map((value) => typeof value === 'string' ? value : {
    id: number(value.id), name: clean(value.name), slug: clean(value.slug),
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function selectedOptions(values) {
  return [...(values || [])].map((value) => ({
    optionId: number(value.optionId ?? value.productOptionValue?.productOption?.id),
    optionName: clean(value.optionName ?? value.productOptionValue?.productOption?.name),
    valueId: number(value.valueId ?? value.productOptionValue?.id),
    label: clean(value.optionValue ?? value.value ?? value.productOptionValue?.value),
  })).sort((a, b) => (a.optionId ?? 0) - (b.optionId ?? 0) || String(a.optionName).localeCompare(String(b.optionName)));
}

function productRecord(raw) {
  const record = {
    id: number(raw.id),
    name: clean(raw.name),
    title: clean(raw.title),
    slug: clean(raw.slug),
    description: clean(raw.description),
    price: number(raw.price),
    categories: taxonomy(raw.categories),
    tags: taxonomy(raw.tags),
    images: [...(raw.images || [])].sort(order).map((image) => ({
      id: number(image.id), order: number(image.order), url: clean(image.url ?? image.imageUrl),
    })),
    options: [...(raw.options || [])].sort(order).map((option) => ({
      id: number(option.id), name: clean(option.name), order: number(option.order), required: Boolean(option.required), type: clean(option.type),
      values: [...(option.values || [])].sort(order).map((value) => ({
        id: number(value.id), label: clean(value.value), order: number(value.order), imageUrl: clean(value.imageUrl),
      })),
    })),
    variants: [...(raw.productVariants || raw.variants || [])].sort(order).map((variant) => ({
      id: number(variant.id), sku: clean(variant.sku), price: number(variant.price), inventory: number(variant.inventory),
      selectedOptions: selectedOptions(variant.selectedOptions),
    })),
    deletedAt: clean(raw.deletedAt),
  };
  return { ...record, fingerprint: `sha256:${digest(record)}` };
}

function combinations(options) {
  if (!options.length) return [{ key: '(default)', selections: [] }];
  return options.reduce((rows, option) => rows.flatMap((row) => option.values.map((value) => ({
    selections: [...row.selections, { optionId: option.id, optionName: option.name, valueId: value.id, label: value.label }],
  }))), [{ selections: [] }]).map((row) => ({
    ...row, key: row.selections.map((item) => `${item.optionName}=${item.label}`).join(' | '),
  }));
}

function migrationProduct(product, legacy) {
  const hiddenValueIds = legacy.hiddenOptionValues[String(product.id)] || [];
  const hidden = new Set(hiddenValueIds);
  const effectiveOptions = product.options.map((option) => ({ ...option, values: option.values.filter((value) => !hidden.has(value.id)) }));
  const choices = effectiveOptions.filter((option) => option.values.length > 1);
  const classification = choices.length === 0 ? 'no-choice' : choices.length === 1 ? 'one-choice' : 'two-choice';
  const expected = combinations(choices.slice(0, 2));
  const variants = product.variants;
  const claimed = new Set();
  const mapped = new Map();

  for (const variant of variants) {
    if (!variant.selectedOptions.length) continue;
    const matches = expected.filter((combo) => combo.selections.every((selection) => variant.selectedOptions.some((selected) =>
      (selected.optionId === selection.optionId || key(selected.optionName) === key(selection.optionName))
      && (selected.valueId === selection.valueId || key(selected.label) === key(selection.label)))));
    if (matches.length === 1 && !mapped.has(matches[0].key)) {
      mapped.set(matches[0].key, variant.id);
      claimed.add(variant.id);
    }
  }

  const missing = expected.filter((combo) => !mapped.has(combo.key));
  const unused = variants.filter((variant) => !claimed.has(variant.id));
  let candidates = [];
  if (unused.length === missing.length) candidates = unused;
  else if (choices.length === 2 && unused.length === missing.length + choices[0].values.length) candidates = unused.slice(choices[0].values.length);
  for (let i = 0; i < Math.min(missing.length, candidates.length); i++) {
    mapped.set(missing[i].key, candidates[i].id);
    claimed.add(candidates[i].id);
  }

  const assignments = legacy.products[String(product.id)] || {};
  const imageIds = new Set(product.images.map((image) => String(image.id)));
  const valueIds = new Set(product.options.flatMap((option) => option.values.map((value) => value.id)));
  const orphanAssignments = Object.entries(assignments).filter(([imageId, valueId]) =>
    !imageIds.has(imageId) || valueId !== 'all' && !valueIds.has(Number(valueId))).map(([imageId, valueId]) => ({ imageId: Number(imageId), valueId }));
  return {
    id: product.id,
    title: product.title || product.name,
    classification,
    choiceOptionIds: choices.map((option) => option.id),
    expectedCombinations: expected.map((combo) => ({ ...combo, variantId: mapped.get(combo.key) ?? null })),
    missingCombinations: expected.filter((combo) => !mapped.has(combo.key)).map((combo) => combo.key),
    orphanVariantIds: variants.filter((variant) => !claimed.has(variant.id)).map((variant) => variant.id),
    nullPrices: { product: product.price === null, variantIds: variants.filter((variant) => variant.price === null).map((variant) => variant.id) },
    legacyImageAssignments: Object.entries(assignments).map(([imageId, valueId]) => ({ imageId: Number(imageId), valueId })),
    hiddenOptionValueIds: hiddenValueIds,
    orphanLegacyAssignments: orphanAssignments,
  };
}

function renderMarkdown(exportData, migration) {
  const groups = Object.fromEntries(['no-choice', 'one-choice', 'two-choice'].map((shape) => [shape, migration.filter((product) => product.classification === shape)]));
  const lines = [
    '# Staging Catalogue Migration Manifest — 2026-08-23', '',
    `Export fingerprint: \`${exportData.fingerprints.catalogue}\``,
    `Source: ${exportData.source.list}`, '',
    '## Scope', '',
    `- Active merchandise details exported: **${exportData.summary.activeProducts}**`,
    `- Product IDs: ${exportData.summary.productIds.join(', ')}`,
    '- Deleted probe IDs 56 and 57 are explicitly excluded and absent.',
    `- Legacy image settings: ${exportData.legacySettings.source || 'not readable; no assignments exported'}.`, '',
    '## Classification', '',
    '| Product | Shape | Expected combinations | Variants | Missing | Orphans | Null prices | Local image assignments | Hidden values |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |',
  ];
  for (const item of migration) {
    const product = exportData.products.find((value) => value.id === item.id);
    const nulls = [item.nullPrices.product ? 'product' : '', ...item.nullPrices.variantIds.map((id) => `variant ${id}`)].filter(Boolean).join(', ') || 'none';
    lines.push(`| ${item.id}: ${cell(item.title)} | ${item.classification} | ${item.expectedCombinations.length} | ${product.variants.length} | ${item.missingCombinations.length} | ${item.orphanVariantIds.length} | ${nulls} | ${item.legacyImageAssignments.length} | ${item.hiddenOptionValueIds.join(', ') || 'none'} |`);
  }
  lines.push('', '## Conditions', '');
  for (const item of migration) {
    lines.push(`### ${item.id}: ${cell(item.title)}`, '',
      `- Expected combinations: ${item.expectedCombinations.map((combo) => `${cell(combo.key)} → ${combo.variantId ?? 'missing'}`).join('; ') || 'none'}.`,
      `- Missing combinations: ${item.missingCombinations.join('; ') || 'none'}.`,
      `- Orphan variants: ${item.orphanVariantIds.join(', ') || 'none'}.`,
      `- Null prices: ${item.nullPrices.product || item.nullPrices.variantIds.length ? `product=${item.nullPrices.product}; variants=${item.nullPrices.variantIds.join(', ') || 'none'}` : 'none'}.`,
      `- Legacy image assignments: ${item.legacyImageAssignments.map((entry) => `${entry.imageId}→${entry.valueId}`).join(', ') || 'none'}.`,
      `- Orphan legacy assignments: ${item.orphanLegacyAssignments.map((entry) => `${entry.imageId}→${entry.valueId}`).join(', ') || 'none'}.`, '');
  }
  lines.push('## Recommended clean rebuild order', '',
    `1. Import no-choice products first: ${(groups['no-choice'] || []).map((item) => item.id).join(', ')}. Treat their single “Standard” Bundle option as a legacy implementation detail.`,
    `2. Import one-choice products: ${(groups['one-choice'] || []).map((item) => item.id).join(', ')}. Create option values before variants, then restore image/value links.`,
    `3. Import two-choice products: ${(groups['two-choice'] || []).map((item) => item.id).join(', ')}. Generate the full Cartesian matrix; do not carry leading orphan variants into Catalogue.`,
    '4. Restore SKUs, prices and inventory only after every new Catalogue combination has an explicit ID mapping; preserve old IDs solely as migration references.',
    '5. Restore legacy image assignments by image/value identity after media upload, omit hidden value 99, and verify every assignment against the new IDs.',
    '6. Reconnect special checkout dependencies last (SIM products 39/40 and delivery-fee product 41), then validate Catalogue reads before any staging cleanup.', '',
    'No implementation, cleanup, mutation, or migration was performed.', '');
  return lines.join('\n');
}

export async function buildExport() {
  const listPayload = await getJson(`${API}?type=MERCHANDISE&limit=100`);
  const listed = Array.isArray(listPayload) ? listPayload : listPayload.data || [];
  const active = listed.filter((product) => product.type === 'MERCHANDISE' && product.deletedAt == null && !EXCLUDED_PROBE_IDS.has(Number(product.id))).sort((a, b) => Number(a.id) - Number(b.id));
  const details = await Promise.all(active.map((product) => getJson(`${API}/${Number(product.id)}`)));
  const products = details.map((payload) => payload?.data && !Array.isArray(payload.data) ? payload.data : payload)
    .map(productRecord).sort((a, b) => a.id - b.id);
  if (products.some((product) => product.deletedAt !== null || EXCLUDED_PROBE_IDS.has(product.id))) throw new Error('Inactive or excluded product reached the export');
  const legacy = await legacySettings();
  const base = {
    schemaVersion: 1,
    snapshotDate: '2026-08-23',
    source: { list: `${API}?type=MERCHANDISE&limit=100`, detail: `${API}/{productId}`, methods: ['GET'] },
    filters: { type: 'MERCHANDISE', deletedAt: null, excludedProbeIds: [...EXCLUDED_PROBE_IDS] },
    summary: { activeProducts: products.length, productIds: products.map((product) => product.id) },
    legacySettings: legacy,
    products,
  };
  return { ...base, fingerprints: { algorithm: 'sha256', catalogue: `sha256:${digest(base)}`, products: Object.fromEntries(products.map((product) => [product.id, product.fingerprint])) } };
}

async function main() {
  const exportData = await buildExport();
  const migration = exportData.products.map((product) => migrationProduct(product, exportData.legacySettings));
  await Promise.all([
    writeFile(EXPORT, `${JSON.stringify(exportData, null, 2)}\n`, 'utf8'),
    writeFile(MANIFEST, `${renderMarkdown(exportData, migration)}\n`, 'utf8'),
  ]);
  console.log(JSON.stringify({ products: exportData.summary.activeProducts, ids: exportData.summary.productIds, catalogueFingerprint: exportData.fingerprints.catalogue }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
