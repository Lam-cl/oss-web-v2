#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');

const products = fs.readFileSync('src/app/admin/products/page.tsx', 'utf8');
const evidence = fs.readFileSync('src/lib/admin/cataloguePublicationChangeState.server.ts', 'utf8');
const fulfilment = fs.readFileSync('src/lib/admin/simAssignments.ts', 'utf8');

assert.match(products, /saveMode="product"/, 'every catalogue item uses the ordinary product save mode');
assert.doesNotMatch(products, /publishSimProduct|Save SIM changes|Dedicated SIM saving/, 'products page must not route SIM through a dedicated save workflow');
assert.doesNotMatch(products, /managementDomain\?:|capabilities\?:|lockedFields\?:/, 'catalogue UI contract must not expose SIM-only editor locks');
assert.doesNotMatch(evidence, /simManaged|currentBundleProductId === 39|currentBundleProductId === 40/, 'publication evidence must be identical for SIM and merchandise');
assert.match(evidence, /currentProjection\(product\)[\s\S]*?return \{ publicationChangeState: 'dirty' \}[\s\S]*?providerProduct/, 'a valid draft change must be dirty before provider drift is evaluated');
assert.match(fulfilment, /category === "sim card" \|\| category === "sim cards"/, 'SIM Card category activates serial-number fulfilment');
assert.match(fulfilment, /\[39, 40\]\.includes\(productId\)/, 'legacy SIM orders retain an explicit compatibility fallback');
assert.doesNotMatch(fulfilment, /return \/\\bsim\\b\/i\.test\(name\)/, 'ordinary product names must not accidentally activate SIM fulfilment');
console.log('ordinary SIM catalogue and category fulfilment check passed');
