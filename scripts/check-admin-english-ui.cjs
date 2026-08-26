#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const roots = ['src/app/admin', 'src/app/api/admin', 'src/components/admin', 'src/lib/admin'];
const files = [];
for (const root of roots) {
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(target);
    }
  };
  visit(root);
}

const forbidden = /\b(?:Tetapan|penghantaran|perubahan|kategori|kadar|pesanan|berjaya|disimpan|Pilih|Tiada|Percuma|Tambah|Padam|Batal|Menyimpan|Semak|Keutamaan|Semenanjung|Terdapat|Tinggalkan|Betulkan|Amaran|Permintaan|Maklumat|Akaun|Rekod)\b|Muat semula|cuba lagi|Sesi anda|Produk katalog|Media katalog|Tidak perlu/iu;
const violations = files.flatMap((file) => {
  const match = fs.readFileSync(file, 'utf8').match(forbidden);
  return match ? [`${file}: ${match[0]}`] : [];
});
assert.deepEqual(violations, [], `Malay admin UI copy remains:\n${violations.join('\n')}`);
console.log('admin English-only UI check passed');
