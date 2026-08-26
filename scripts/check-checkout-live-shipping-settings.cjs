#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');

const route = fs.readFileSync('src/app/api/bundle/checkout/route.ts', 'utf8');
assert.match(route, /import \{ readShippingSettings \} from "@\/lib\/shippingSettings\.server"/,
  'checkout must load the same persisted shipping settings used by the admin and frontend');
assert.match(route, /courierLines\.push\(\{[\s\S]*?bundleProductId: product\.id/,
  'checkout must retain Bundle product identity for explicit shipping mappings');
assert.match(route, /calculateCourierCharge\(courierLines, shippingState, await readShippingSettings\(\)\)/,
  'server-side checkout must calculate against live shipping settings');
console.log('checkout live shipping settings check passed');
