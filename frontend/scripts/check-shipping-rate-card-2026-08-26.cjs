#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('src/lib/shipping.ts', 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'require', 'module', output)(mod.exports, require, mod);

assert.deepEqual(mod.exports.DEFAULT_SHIPPING_SETTINGS.groups, {
  shirt: { label: 'T-shirt', tiers: [
    { minimum: 1, peninsular: 20, eastMalaysia: 30 },
    { minimum: 21, peninsular: 30, eastMalaysia: 40 },
  ] },
  bulky: { label: 'Water bottle, tumbler & bunting', tiers: [
    { minimum: 1, peninsular: 10, eastMalaysia: 20 },
    { minimum: 6, peninsular: 20, eastMalaysia: 30 },
    { minimum: 11, peninsular: 30, eastMalaysia: 40 },
    { minimum: 21, peninsular: 40, eastMalaysia: 50 },
  ] },
  small: { label: 'Badge, lanyard, pen, cap & non woven bag', tiers: [
    { minimum: 1, peninsular: 10, eastMalaysia: 20 },
    { minimum: 30, peninsular: 20, eastMalaysia: 30 },
  ] },
  flyers: { label: 'Flyers', tiers: [
    { minimum: 1, peninsular: 10, eastMalaysia: 20 },
    { minimum: 2, peninsular: 20, eastMalaysia: 30 },
    { minimum: 3, peninsular: 30, eastMalaysia: 40 },
  ] },
  sim: { label: 'SIM card', tiers: [
    { minimum: 1, peninsular: 10, eastMalaysia: 20 },
    { minimum: 30, peninsular: 0, eastMalaysia: 0 },
  ] },
});
console.log('shipping rate-card check passed (source SHA-256 38c85fa13484d3bb5ffbe926587d953514a3bc9af9d7a9574a7cf90d3130424f)');
