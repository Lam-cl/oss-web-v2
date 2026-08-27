const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = ['src/app/globals.css', 'src/app/merchandise-parity.css']
  .map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const sheet = css.match(/\.merch-cart-summary-sheet\s*\{([^}]*)\}/)?.[1] || '';
const header = css.match(/\.merch-cart-sheet-header\s*\{([^}]*)\}/)?.[1] || '';

assert.match(sheet, /max-height:\s*calc\(100dvh\s*-\s*\d+px\)/, 'mobile summary must fit inside the visible viewport');
assert.match(sheet, /overflow-y:\s*auto/, 'long order summaries must scroll inside the sheet');
assert.match(sheet, /overscroll-behavior:\s*contain/, 'sheet scrolling must not leak to the checkout page');
assert.match(header, /position:\s*sticky/, 'close control must remain reachable while the summary scrolls');
assert.match(header, /top:\s*0/, 'sticky summary header must stay at the top');

console.log('checkout mobile summary scrolling check passed');
