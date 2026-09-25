const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { compile } = require('./test-source-helpers.cjs');

async function main() {
  const backup = process.argv[2];
  if (!backup || !path.isAbsolute(backup)) throw new Error('Provide the absolute catalogue backup directory.');
  const { compressCatalogueImage, catalogueR2AssetKey } = compile('src/lib/catalogueR2Assets.server.ts');
  const sources = JSON.parse(await fs.readFile(path.join(backup, 'media-manifest.json'), 'utf8'));
  const prepared = path.join(backup, 'prepared-webp');
  await fs.mkdir(prepared, { recursive: true, mode: 0o700 });
  const result = [];
  for (const source of sources) {
    const original = await fs.readFile(path.join(backup, 'originals', `${source.mediaId}.bin`));
    assert.equal(createHash('sha256').update(original).digest('hex'), source.sha256);
    for (const variant of ['card', 'gallery']) {
      const body = await compressCatalogueImage(original, variant);
      assert(body.length < 1_000_000, 'R2 image must be under 1,000,000 bytes');
      assert.equal(body.toString('ascii', 0, 4), 'RIFF');
      assert.equal(body.toString('ascii', 8, 12), 'WEBP');
      const file = `${source.mediaId}-${variant}.webp`;
      await fs.writeFile(path.join(prepared, file), body, { flag: 'wx', mode: 0o600 });
      result.push({ catalogueId: source.catalogueId, mediaId: source.mediaId, sourceSha256: source.sha256,
        variant, key: catalogueR2AssetKey(source.catalogueId, source.sha256, variant), file,
        sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length });
    }
  }
  await fs.writeFile(path.join(prepared, 'manifest.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ images: result.length, bytes: result.reduce((sum, item) => sum + item.bytes, 0),
    maxBytes: Math.max(...result.map(item => item.bytes)), cardsOver100KB: result.filter(item => item.variant === 'card' && item.bytes >= 100_000).length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
