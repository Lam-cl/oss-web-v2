const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/app/api/bundle/checkout/route.ts', 'utf8');
assert.match(source, /["']Content-Type["']\s*:\s*["']application\/json["']/, 'checkout must use the proven JSON contract');
assert.match(source, /body\s*:\s*JSON\.stringify\(productCheckout\)/, 'checkout must send the exact JSON object');
assert.doesNotMatch(source, /body\s*:\s*form\b/, 'obsolete multipart transport must remain removed');
assert.match(source, /idNumber\s*:\s*String\(address\.idNumber/, 'billing NRIC/passport must remain in the JSON address');
console.log('Bundle checkout transport contract check passed');
