const assert = require('node:assert');
const fs = require('node:fs');

const sourcePath = process.env.THANK_YOU_SOURCE || 'src/app/thank-you/page.tsx';
const source = fs.readFileSync(sourcePath, 'utf8');

assert(source.includes("const isMerdekaPromo = /^16twmp/i.test(refNo);"), 'Merdeka references must be identified by their exact prefix.');
assert(
  /onClick=\{\(\) => \{\s*if \(isMerdekaPromo\) \{\s*window\.location\.assign\('https:\/\/www\.tonewow\.com\/malaysia-promo'\);\s*return;\s*\}\s*router\.push\('\/'\);\s*\}\}/.test(source),
  'Back to Home must route only Merdeka references externally and preserve the shop fallback for every other category.',
);

console.log('Merdeka thank-you return checks passed.');
