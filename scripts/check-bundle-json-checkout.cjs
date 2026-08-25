const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/app/api/bundle/checkout/route.ts','utf8');
assert.match(source,/["']Content-Type["']:\s*["']application\/json["']/,'Bundle checkout must use the proven working JSON transport');
assert.match(source,/body:\s*JSON\.stringify\(productCheckout\)/,'Bundle checkout must send the proven productCheckout JSON body');
assert.doesNotMatch(source,/body:\s*form\b/,'Broken multipart transport must not return');
console.log('Bundle checkout JSON transport regression check passed');
