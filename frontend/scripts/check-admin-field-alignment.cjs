const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync('src/app/admin/admin.css', 'utf8');
assert.match(css, /\.adm-field\s*\{[^}]*align-content:start;/, 'fulfilment fields must align internal content at the top');
assert.equal(css.includes('.adm-field input,.adm-field select { height:39px; box-sizing:border-box; }'), true, 'fulfilment inputs and selects must share one exact size');
console.log('admin field alignment regression check passed');
