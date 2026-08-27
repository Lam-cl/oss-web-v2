#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'https://bundleapi.tonewow.com/api/products?type=MERCHANDISE&limit=100';
const EVIDENCE = ['verified-native', 'verified-recorded', 'candidate-order-pattern', 'candidate-unique-sku', 'ambiguous'];
const clean = (value) => String(value ?? '').trim();
const normalise = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const byOrderId = (left, right) => number(left.order) - number(right.order) || number(left.id) - number(right.id);

function orderedOptions(options = []) {
  return [...options].sort(byOrderId).map((option) => ({
    id: number(option.id),
    name: clean(option.name),
    values: [...(option.values || [])].sort(byOrderId).map((value) => ({
      id: number(value.id), value: clean(value.value), imageUrl: value.imageUrl || null,
    })),
  })).filter((option) => option.name && option.values.length);
}

export function cartesian(rawOptions = []) {
  const options = orderedOptions(rawOptions);
  if (!options.length) return [];
  return options.reduce((rows, option) => rows.flatMap((row) => option.values.map((value) => ({
    selections: [...row.selections, { optionId: option.id, optionName: option.name, valueId: value.id, value: value.value }],
    values: [...row.values, value.value],
  }))), [{ selections: [], values: [] }]).map((row) => ({
    ...row,
    key: row.selections.map((item) => `${item.optionName}=${item.value}`).join(' | '),
  }));
}

function selectedMap(variant) {
  const selected = new Map();
  for (const raw of variant.selectedOptions || []) {
    const nested = raw?.productOptionValue || {};
    const name = raw?.optionName || nested?.productOption?.name;
    const value = raw?.optionValue || raw?.value || nested?.value;
    if (name && value) selected.set(normalise(name), normalise(value));
  }
  return selected;
}

function skuContains(sku, value) {
  const skuTokens = normalise(sku).split('-').filter(Boolean);
  const valueTokens = normalise(value).split('-').filter(Boolean);
  return valueTokens.length > 0 && valueTokens.length <= skuTokens.length && skuTokens.some((_, index) =>
    valueTokens.every((token, offset) => skuTokens[index + offset] === token));
}

function variantRecord(variant) {
  return {
    id: number(variant.id),
    sku: clean(variant.sku),
    price: number(variant.price),
    inventory: number(variant.inventory),
    selectedOptions: variant.selectedOptions || [],
  };
}

function auditProduct(product, recorded = {}) {
  const options = orderedOptions(product.options);
  const combinations = cartesian(options).map((combination) => ({ ...combination, evidence: 'ambiguous', variant: null, reason: 'No one-to-one evidence.' }));
  const variants = [...(product.productVariants || [])].sort((a, b) => number(a.id) - number(b.id));
  const byId = new Map(variants.map((variant) => [number(variant.id), variant]));
  const used = new Set();
  const conflicts = new Set();
  const assign = (index, variant, evidence, reason) => {
    if (!variant || used.has(number(variant.id)) || combinations[index].variant) {
      conflicts.add(index);
      return false;
    }
    combinations[index] = { ...combinations[index], evidence, variant: variantRecord(variant), reason };
    used.add(number(variant.id));
    return true;
  };

  for (const variant of variants) {
    const selected = selectedMap(variant);
    if (!selected.size) continue;
    const matches = combinations.flatMap((combination, index) => combination.selections.every((item) =>
      selected.get(normalise(item.optionName)) === normalise(item.value)) ? [index] : []);
    if (matches.length === 1) assign(matches[0], variant, 'verified-native', 'Bundle selectedOptions exactly matches this combination.');
  }

  for (const [key, variantId] of Object.entries(recorded || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const index = combinations.findIndex((combination) => combination.key === key);
    if (index >= 0 && !combinations[index].variant) assign(index, byId.get(number(variantId)), 'verified-recorded', 'Explicit recorded mapping identifies this variant.');
  }

  const nativeMissing = variants.every((variant) => !(variant.selectedOptions || []).length);
  if (nativeMissing && !used.size && combinations.length) {
    const primaryCount = options[0]?.values.length || 0;
    const candidates = variants.length === combinations.length
      ? variants
      : options.length === 2 && variants.length === primaryCount + combinations.length ? variants.slice(primaryCount) : null;
    if (candidates) combinations.forEach((_, index) => assign(index, candidates[index], 'candidate-order-pattern',
      variants.length === combinations.length
        ? 'Variant ID order has the same cardinality as the Cartesian combinations.'
        : `Variant ID order contains ${primaryCount} leading orphan variants followed by the Cartesian combinations.`));
  }

  const skuClaims = new Map();
  for (const variant of variants.filter((item) => !used.has(number(item.id)))) {
    const matches = combinations.flatMap((combination, index) => !combination.variant && combination.values.every((value) => skuContains(variant.sku, value)) ? [index] : []);
    if (matches.length === 1) skuClaims.set(matches[0], [...(skuClaims.get(matches[0]) || []), variant]);
  }
  for (const [index, claims] of skuClaims) {
    if (claims.length === 1) assign(index, claims[0], 'candidate-unique-sku', 'Exactly one unused SKU contains every option value token.');
    else conflicts.add(index);
  }

  for (const index of conflicts) {
    const current = combinations[index];
    if (current.variant) used.delete(current.variant.id);
    combinations[index] = { ...current, evidence: 'ambiguous', variant: null, reason: 'Multiple variants claim this combination.' };
  }

  const orphanVariants = variants.filter((variant) => !used.has(number(variant.id))).map(variantRecord);
  const missingCombinations = combinations.filter((combination) => !combination.variant).map(({ key, values, selections, evidence, reason }) => ({ key, values, selections, evidence, reason }));
  const skuGroups = new Map();
  for (const variant of variants) {
    const key = clean(variant.sku).toUpperCase();
    if (key) skuGroups.set(key, [...(skuGroups.get(key) || []), number(variant.id)]);
  }
  const duplicateSkus = [...skuGroups].filter(([, ids]) => ids.length > 1).map(([sku, variantIds]) => ({ sku, variantIds }));
  const images = [...(product.images || [])].sort(byOrderId).map((image) => ({ id: number(image.id), order: number(image.order), url: image.url || image.imageUrl || null }));
  const variantRows = variants.map(variantRecord);

  return {
    id: number(product.id),
    title: clean(product.title || product.name || `Product ${product.id}`),
    options,
    combinations,
    missingCombinations,
    orphanVariants,
    duplicateSkus,
    images,
    prices: { product: number(product.price), variants: variantRows.map(({ id, price }) => ({ id, price })) },
    inventory: {
      total: variantRows.reduce((total, variant) => total + (variant.inventory ?? 0), 0),
      variants: variantRows.map(({ id, inventory }) => ({ id, inventory })),
    },
    ambiguous: combinations.some((combination) => combination.evidence === 'ambiguous'),
  };
}

export function auditCatalogue(rawProducts, recordedMappings = {}) {
  const products = [...(rawProducts || [])].sort((a, b) => number(a.id) - number(b.id)).map((product) =>
    auditProduct(product, recordedMappings[number(product.id)] || recordedMappings[String(product.id)]));
  const globalSkus = new Map();
  for (const product of products) for (const combination of product.combinations) {
    if (!combination.variant?.sku) continue;
    const sku = combination.variant.sku.toUpperCase();
    globalSkus.set(sku, [...(globalSkus.get(sku) || []), { productId: product.id, variantId: combination.variant.id }]);
  }
  for (const product of products) for (const orphan of product.orphanVariants) {
    if (!orphan.sku) continue;
    const sku = orphan.sku.toUpperCase();
    globalSkus.set(sku, [...(globalSkus.get(sku) || []), { productId: product.id, variantId: orphan.id }]);
  }
  const duplicateSkus = [...globalSkus].filter(([, variants]) => variants.length > 1)
    .sort(([left], [right]) => left.localeCompare(right)).map(([sku, variants]) => ({ sku, variants }));
  const evidence = Object.fromEntries(EVIDENCE.map((name) => [name, products.reduce((count, product) =>
    count + product.combinations.filter((combination) => combination.evidence === name).length, 0)]));
  return {
    schemaVersion: 1,
    source: SOURCE,
    summary: {
      products: products.length,
      combinations: products.reduce((count, product) => count + product.combinations.length, 0),
      variants: products.reduce((count, product) => count + product.inventory.variants.length, 0),
      missingCombinations: products.reduce((count, product) => count + product.missingCombinations.length, 0),
      orphanVariants: products.reduce((count, product) => count + product.orphanVariants.length, 0),
      duplicateSkus: duplicateSkus.length,
      ambiguousProducts: products.filter((product) => product.ambiguous).length,
      evidence,
    },
    duplicateSkus,
    products,
  };
}

const cell = (value) => clean(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function renderMarkdown(report) {
  const s = report.summary;
  const lines = [
    '# Product Control Audit', '',
    `Source: ${report.source}`, '',
    '## Summary', '',
    '| Products | Combinations | Variants | Missing | Orphans | Duplicate SKUs | Ambiguous products |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${s.products} | ${s.combinations} | ${s.variants} | ${s.missingCombinations} | ${s.orphanVariants} | ${s.duplicateSkus} | ${s.ambiguousProducts} |`, '',
    '### Evidence counts', '',
    ...EVIDENCE.map((name) => `- ${name}: ${s.evidence[name]}`), '',
    '## Duplicate SKUs', '',
    ...(report.duplicateSkus.length ? report.duplicateSkus.map((item) => `- ${cell(item.sku)}: ${item.variants.map((v) => `product ${v.productId} / variant ${v.variantId}`).join(', ')}`) : ['None.']), '',
  ];
  for (const product of report.products) {
    lines.push(`## ${product.id}: ${cell(product.title)}`, '', `Status: ${product.ambiguous ? 'AMBIGUOUS' : 'resolved/candidate evidence only'}`, '',
      '| Combination | Evidence | Variant | SKU | Price | Inventory |', '| --- | --- | ---: | --- | ---: | ---: |');
    for (const combination of product.combinations) lines.push(`| ${cell(combination.key)} | ${combination.evidence} | ${combination.variant?.id ?? '—'} | ${cell(combination.variant?.sku || '—')} | ${combination.variant?.price ?? '—'} | ${combination.variant?.inventory ?? '—'} |`);
    lines.push('', `Missing combinations: ${product.missingCombinations.length ? product.missingCombinations.map((item) => cell(item.key)).join('; ') : 'None.'}`,
      `Orphan variants: ${product.orphanVariants.length ? product.orphanVariants.map((item) => `${item.id} (${cell(item.sku || 'no SKU')}, price ${item.price ?? 'null'}, inventory ${item.inventory ?? 'null'})`).join('; ') : 'None.'}`,
      `Duplicate SKUs in product: ${product.duplicateSkus.length ? product.duplicateSkus.map((item) => `${cell(item.sku)} [${item.variantIds.join(', ')}]`).join('; ') : 'None.'}`,
      `Images (${product.images.length}): ${product.images.length ? product.images.map((image) => `${image.id}:${cell(image.url || 'null')}`).join('; ') : 'None.'}`,
      `Product price: ${product.prices.product ?? 'null'}`,
      `Inventory total: ${product.inventory.total}`, '');
  }
  return `${lines.join('\n').trim()}\n`;
}

export const exitCode = (report) => report.summary.ambiguousProducts > 0 ? 1 : 0;

async function main() {
  const response = await fetch(SOURCE, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Catalogue GET failed: ${response.status}`);
  const payload = await response.json();
  const products = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const report = auditCatalogue(products);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const reportDir = path.join(root, 'test-reports');
  await mkdir(reportDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(reportDir, 'product-control-audit-2026-08-23.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(reportDir, 'product-control-audit-2026-08-23.md'), renderMarkdown(report)),
  ]);
  console.log(JSON.stringify({ summary: report.summary, ambiguousProducts: report.products.filter((product) => product.ambiguous).map(({ id, title, missingCombinations, orphanVariants }) => ({ id, title, missingCombinations, orphanVariants })) }, null, 2));
  process.exitCode = exitCode(report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 2; });
}

