const assert = require('node:assert/strict');
const { compile } = require('./test-source-helpers.cjs');
const snapshot = compile('src/lib/cataloguePublishedSnapshot.server.ts', {
  '@/lib/dataApiClient.server': { dataApiEnabled: () => false },
});
const manifest = {
  operationId: 'a'.repeat(64),
  media: [
    { mediaId: '11111111-1111-4111-8111-111111111111', bytes: 4, sha256: 'b'.repeat(64) },
    { mediaId: '22222222-2222-4222-8222-222222222222', bytes: 3, sha256: 'c'.repeat(64) },
  ],
};

(async () => {
  const calls = [];
  await snapshot.assertPublishedSnapshotMediaReadable(manifest, async (operationId, mediaId) => {
    calls.push([operationId, mediaId]);
    const expected = manifest.media.find(item => item.mediaId === mediaId);
    return { body: Buffer.alloc(expected.bytes), sha256: expected.sha256 };
  });
  assert.equal(calls.length, 2, 'every published image is read back');
  await assert.rejects(() => snapshot.assertPublishedSnapshotMediaReadable(manifest, async () => null), /could not be read back/);
  await assert.rejects(() => snapshot.assertPublishedSnapshotMediaReadable(manifest, async () => { throw new Error('published bucket unavailable'); }), /published bucket unavailable/);
  console.log('Published media readback: all images checked and missing/unreadable images reject activation');
})().catch(error => { console.error(error); process.exitCode = 1; });
