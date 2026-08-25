const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ts = require('typescript');

let failRenameSuffix = null;
let failTrashUnlink = false;
let failPostManifestSync = false;
let manifestJustRenamed = false;
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = (request) => {
    if (request === 'fs/promises') return {
      ...fsp,
      open: async (...args) => {
        const handle = await fsp.open(...args);
        return new Proxy(handle, { get(target, property) {
          if (property === 'sync') return async () => {
            if (failPostManifestSync && manifestJustRenamed) { failPostManifestSync = false; manifestJustRenamed = false; throw new Error('injected post-commit sync failure'); }
            const result = await target.sync();
            if (manifestJustRenamed) manifestJustRenamed = false;
            return result;
          };
          const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
        } });
      },
      rename: async (from, to) => {
        if (failRenameSuffix && String(to).endsWith(failRenameSuffix)) throw new Error('injected rename failure');
        const result = await fsp.rename(from, to);
        if (String(to).endsWith('manifest.json')) manifestJustRenamed = true;
        return result;
      },
      unlink: async (target) => {
        if (failTrashUnlink && String(target).endsWith('.trash')) throw new Error('injected trash unlink failure');
        return fsp.unlink(target);
      },
    };
    return require(request);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}

const moduleFile = path.resolve('src/lib/admin/catalogueMedia.server.ts');
const exported = load(moduleFile);
const id = () => randomUUID();
const jpeg = (suffix = '') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(suffix)]);
const png = (suffix = '') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(suffix)]);
const webp = (suffix = '') => {
  const tail = Buffer.from(suffix);
  const body = Buffer.alloc(12 + tail.length);
  body.write('RIFF', 0, 'ascii'); body.writeUInt32LE(4 + tail.length, 4); body.write('WEBP', 8, 'ascii'); tail.copy(body, 12);
  return body;
};
const addInput = (body = jpeg('x'), order = 0) => ({ name: 'hero.jpg', type: 'image/jpeg', body, order, assignment: 'all' });
const removalPaths = (directory, catalogueId, operationId, mediaId) => ({
  catalogue: path.join(directory, catalogueId),
  manifest: path.join(directory, catalogueId, 'manifest.json'),
  transaction: path.join(directory, catalogueId, 'transactions', operationId),
  record: path.join(directory, catalogueId, 'transactions', operationId, 'record.json'),
  original: path.join(directory, catalogueId, `${mediaId}.bin`),
  tombstone: path.join(directory, catalogueId, 'transactions', operationId, `${mediaId}.bin`),
});
async function prepareRemovalCrash(directory, catalogueId, item, operationId, afterManifestCommit = false) {
  const targets = removalPaths(directory, catalogueId, operationId, item.mediaId);
  await fsp.mkdir(targets.transaction, { recursive: true, mode: 0o700 });
  const original = await fsp.readFile(targets.original);
  await fsp.writeFile(targets.tombstone, original, { mode: 0o600 });
  const now = new Date().toISOString();
  await fsp.writeFile(targets.record, `${JSON.stringify({
    operationId, catalogueId, status: 'prepared', removed: [item], createdAt: now, updatedAt: now,
  }, null, 2)}\n`, { mode: 0o600 });
  if (afterManifestCommit) await fsp.writeFile(targets.manifest, `${JSON.stringify({ media: [] }, null, 2)}\n`, { mode: 0o600 });
  return { ...targets, originalBody: original };
}


(async () => {
  assert.deepEqual(Object.keys(exported).sort(), ['addCatalogueMedia', 'createCatalogueMediaStore', 'finalizeCatalogueMediaRemoval', 'getCatalogueMediaRemoval', 'listCatalogueMedia', 'readVerifiedCatalogueMedia', 'removeCatalogueMedia', 'updateCatalogueMedia']);
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tw-catalogue-media-'));
  const store = exported.createCatalogueMediaStore(directory);
  try {
    assert.deepEqual(Object.keys(store).sort(), ['addCatalogueMedia', 'finalizeCatalogueMediaRemoval', 'getCatalogueMediaRemoval', 'listCatalogueMedia', 'readVerifiedCatalogueMedia', 'removeCatalogueMedia', 'updateCatalogueMedia']);

    // Exact contracts and real format signatures.
    for (const extra of [{ extra: true }, { directory: '/tmp' }]) {
      await assert.rejects(() => store.addCatalogueMedia(id(), { ...addInput(), ...extra }), /unknown|exact|keys/i);
    }
    const contractId = id();
    const item = await store.addCatalogueMedia(contractId, addInput(jpeg('valid')));
    assert.equal('body' in item, false, 'add must return metadata only');
    assert.equal('body' in (await store.listCatalogueMedia(contractId))[0], false, 'list must return metadata only');
    await assert.rejects(() => store.updateCatalogueMedia(contractId, item.mediaId, {}), /empty|at least one/i);
    await assert.rejects(() => store.updateCatalogueMedia(contractId, item.mediaId, { order: 1, surprise: true }), /unknown|keys/i);
    const symbolInput = addInput(); symbolInput[Symbol('unknown')] = true;
    await assert.rejects(() => store.addCatalogueMedia(id(), symbolInput), /unknown|exact|keys/i);
    for (const [type, body] of [['image/jpeg', png()], ['image/png', jpeg()], ['image/webp', png()], ['image/jpeg', Buffer.from('not an image')]]) {
      await assert.rejects(() => store.addCatalogueMedia(id(), { ...addInput(body), type }), /signature|content/i);
    }
    await store.addCatalogueMedia(id(), { ...addInput(png()), name: 'x.png', type: 'image/png' });
    await store.addCatalogueMedia(id(), { ...addInput(webp()), name: 'x.webp', type: 'image/webp' });
    await assert.rejects(() => store.addCatalogueMedia(id(), addInput(Buffer.alloc(10 * 1024 * 1024 + 1))), /10 MB/i);

    // Metadata operations stat referenced files but never read/hash their bodies.
    const leanId = id();
    const leanItem = await store.addCatalogueMedia(leanId, addInput(jpeg('lean')));
    const leanBinary = path.join(directory, leanId, `${leanItem.mediaId}.bin`);
    const sameSizeCorruption = Buffer.alloc(leanItem.bytes, 0x41);
    await fsp.writeFile(leanBinary, sameSizeCorruption);
    assert.equal((await store.listCatalogueMedia(leanId))[0].mediaId, leanItem.mediaId, 'metadata list must not hash binary bodies');
    const leanUpdated = await store.updateCatalogueMedia(leanId, leanItem.mediaId, { order: 1 });
    assert.equal('body' in leanUpdated, false, 'update must return metadata only');
    await assert.rejects(() => store.readVerifiedCatalogueMedia(leanId, leanItem.mediaId), /corrupt/i, 'explicit publisher read must verify digest/signature');
    await assert.rejects(() => store.readVerifiedCatalogueMedia(leanId, 'bad'), /valid media ID/i);
    const leanRemoved = await store.removeCatalogueMedia(leanId, leanItem.mediaId);
    assert.equal('body' in leanRemoved, false, 'remove must return metadata only');

    const verifiedId = id();
    const verifiedItem = await store.addCatalogueMedia(verifiedId, addInput(jpeg('verified')));
    const verified = await store.readVerifiedCatalogueMedia(verifiedId, verifiedItem.mediaId);
    assert.equal(verified.mediaId, verifiedItem.mediaId);
    assert.deepEqual(verified.body, jpeg('verified'));

    // The deployment invariant is one PM2 fork worker; serialize within that process.
    const raceId = id();
    const raced = await Promise.allSettled([
      store.addCatalogueMedia(raceId, { ...addInput(), name: 'a.jpg' }),
      store.addCatalogueMedia(raceId, { ...addInput(), name: 'b.jpg' }),
    ]);
    assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(raced.filter((result) => result.status === 'rejected' && /duplicate.*order/i.test(String(result.reason))).length, 1);
    assert.equal((await store.listCatalogueMedia(raceId)).length, 1);

    // Item count quota (small bodies) and total quota (manifest-advertised boundary).
    const countId = id();
    for (let order = 0; order < 100; order += 1) await store.addCatalogueMedia(countId, addInput(jpeg(String(order)), order));
    await assert.rejects(() => store.addCatalogueMedia(countId, addInput(jpeg('overflow'), 100)), /100 media items/i);
    const totalId = id();
    const totalDir = path.join(directory, totalId); await fsp.mkdir(totalDir, { mode: 0o700 });
    const totalMedia = [];
    for (let n = 0; n < 10; n += 1) {
      const mediaId = id(); const body = Buffer.alloc(10 * 1024 * 1024); body[0] = 0xff; body[1] = 0xd8; body[2] = 0xff;
      await fsp.writeFile(path.join(totalDir, `${mediaId}.bin`), body, { mode: 0o600 });
      totalMedia.push({ mediaId, catalogueId: totalId, originalName: `${n}.jpg`, contentType: 'image/jpeg', bytes: body.length, sha256: require('node:crypto').createHash('sha256').update(body).digest('hex'), order: n, assignment: 'all', createdAt: new Date().toISOString() });
    }
    await fsp.writeFile(path.join(totalDir, 'manifest.json'), JSON.stringify({ media: totalMedia }), { mode: 0o600 });
    await assert.rejects(() => store.addCatalogueMedia(totalId, addInput(jpeg('one'), 10)), /100 MiB total/i);
    const oversizedId = id(); const oversized = await store.addCatalogueMedia(oversizedId, addInput());
    await fsp.writeFile(path.join(directory, oversizedId, `${oversized.mediaId}.bin`), Buffer.alloc(10 * 1024 * 1024 + 1));
    await assert.rejects(() => store.listCatalogueMedia(oversizedId), /corrupt/i);

    // Symlinks at every trust boundary are rejected, never followed/chmodded.
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'tw-media-outside-'));
    const rootLink = `${directory}-link`; await fsp.symlink(directory, rootLink);
    await assert.rejects(() => exported.createCatalogueMediaStore(rootLink).listCatalogueMedia(id()), /symlink|safe/i);
    const catLinkId = id(); await fsp.symlink(outside, path.join(directory, catLinkId));
    await assert.rejects(() => store.listCatalogueMedia(catLinkId), /symlink|safe|corrupt/i);

    const manifestId = id(); await fsp.mkdir(path.join(directory, manifestId)); await fsp.symlink(path.join(outside, 'manifest.json'), path.join(directory, manifestId, 'manifest.json'));
    await assert.rejects(() => store.listCatalogueMedia(manifestId), /symlink|corrupt|safe/i);
    const binaryId = id(); const binaryItem = await store.addCatalogueMedia(binaryId, addInput()); const binaryPath = path.join(directory, binaryId, `${binaryItem.mediaId}.bin`);
    await fsp.unlink(binaryPath); await fsp.symlink(path.join(outside, 'binary'), binaryPath);
    await assert.rejects(() => store.listCatalogueMedia(binaryId), /symlink|corrupt|safe/i);
    const trashId = id(); await store.addCatalogueMedia(trashId, addInput()); await fsp.symlink(path.join(outside, 'trash'), path.join(directory, trashId, `${id()}.${id()}.trash`));
    await assert.rejects(() => store.listCatalogueMedia(trashId), /symlink|corrupt|safe/i);
    const tempId = id(); await store.addCatalogueMedia(tempId, addInput()); await fsp.symlink(path.join(outside, 'temp'), path.join(directory, tempId, `manifest.json.${process.pid}.${id()}.tmp`));
    await assert.rejects(() => store.listCatalogueMedia(tempId), /symlink|corrupt|safe/i);
    await fsp.rm(outside, { recursive: true, force: true }); await fsp.unlink(rootLink);

    // A removal set commits through one durable manifest replacement and is idempotent after restart.
    const transactionId = id();
    const txItems = [
      await store.addCatalogueMedia(transactionId, { ...addInput(jpeg('tx-a'), 0), name: 'a.jpg' }),
      await store.addCatalogueMedia(transactionId, { ...addInput(jpeg('tx-b'), 1), name: 'b.jpg' }),
      await store.addCatalogueMedia(transactionId, { ...addInput(jpeg('tx-c'), 2), name: 'c.jpg' }),
    ];
    const operationId = id();
    const committed = await store.finalizeCatalogueMediaRemoval(transactionId, operationId, [txItems[0].mediaId, txItems[2].mediaId]);
    assert.equal(committed.status, 'committed');
    assert.deepEqual((await store.listCatalogueMedia(transactionId)).map(item => item.mediaId), [txItems[1].mediaId]);
    const restarted = exported.createCatalogueMediaStore(directory);
    assert.equal((await restarted.getCatalogueMediaRemoval(transactionId, operationId)).status, 'committed');
    assert.equal((await restarted.finalizeCatalogueMediaRemoval(transactionId, operationId, [txItems[0].mediaId, txItems[2].mediaId])).status, 'committed');
    for (const item of [txItems[0], txItems[2]]) {
      const tombstone = path.join(directory, transactionId, 'transactions', operationId, `${item.mediaId}.bin`);
      assert.deepEqual(await fsp.readFile(tombstone), jpeg(item === txItems[0] ? 'tx-a' : 'tx-c'), 'committed binary preimage is retained');
    }

    // Recovery attests the complete durable preimage before metadata listing can clean anything.
    // Cover both crash boundaries (prepared before effect, and manifest effect before commit record)
    // with both missing and same-size corrupt tombstones under orphan-cleanup pressure.
    for (const recoveryMethod of ['get', 'finalize']) {
      for (const afterManifestCommit of [false, true]) for (const tombstoneFailure of ['missing', 'corrupt']) {
        const recoveryId = id();
        const recoveryBody = jpeg(`recovery-${recoveryMethod}-${afterManifestCommit}-${tombstoneFailure}`);
        const recoveryItem = await store.addCatalogueMedia(recoveryId, addInput(recoveryBody));
        const recoveryOperation = id();
        const crash = await prepareRemovalCrash(directory, recoveryId, recoveryItem, recoveryOperation, afterManifestCommit);
        const orphan = path.join(crash.catalogue, `${id()}.bin`);
        const orphanBody = jpeg('orphan-cleanup-pressure');
        await fsp.writeFile(orphan, orphanBody, { mode: 0o600 });
        if (tombstoneFailure === 'missing') await fsp.unlink(crash.tombstone);
        else await fsp.writeFile(crash.tombstone, Buffer.alloc(recoveryBody.length, 0x41));
        const manifestBefore = await fsp.readFile(crash.manifest);

        const recoveryStore = exported.createCatalogueMediaStore(directory);
        await assert.rejects(
          () => recoveryMethod === 'get'
            ? recoveryStore.getCatalogueMediaRemoval(recoveryId, recoveryOperation)
            : recoveryStore.finalizeCatalogueMediaRemoval(recoveryId, recoveryOperation, [recoveryItem.mediaId]),
          /corrupt|unsafe/i,
          `${recoveryMethod} with ${tombstoneFailure} preimage must fail closed at the ${afterManifestCommit ? 'post-effect' : 'pre-effect'} boundary`,
        );
        assert.deepEqual(await fsp.readFile(crash.manifest), manifestBefore, 'failed reconciliation must preserve visible metadata byte-for-byte');
        assert.deepEqual(await fsp.readFile(crash.original), recoveryBody, 'failed reconciliation must preserve the original binary byte-for-byte');
        assert.deepEqual(await fsp.readFile(orphan), orphanBody, 'preimage failure must happen before orphan cleanup');
      }
    }

    // Valid prepared transactions reconcile after restart at both crash boundaries.
    for (const afterManifestCommit of [false, true]) {
      const recoveryId = id();
      const recoveryBody = jpeg(`valid-recovery-${afterManifestCommit}`);
      const recoveryItem = await store.addCatalogueMedia(recoveryId, addInput(recoveryBody));
      const recoveryOperation = id();
      await prepareRemovalCrash(directory, recoveryId, recoveryItem, recoveryOperation, afterManifestCommit);
      const operation = await exported.createCatalogueMediaStore(directory).getCatalogueMediaRemoval(recoveryId, recoveryOperation);
      assert.equal(operation.status, afterManifestCommit ? 'committed' : 'prepared');
      assert.deepEqual(await fsp.readFile(path.join(directory, recoveryId, 'transactions', recoveryOperation, `${recoveryItem.mediaId}.bin`)), recoveryBody);
    }

    // A failed atomic manifest replacement rolls back every member; no partial disappearance.
    const rollbackSetId = id();
    const rollbackSet = [
      await store.addCatalogueMedia(rollbackSetId, { ...addInput(jpeg('rb-a'), 0), name: 'a.jpg' }),
      await store.addCatalogueMedia(rollbackSetId, { ...addInput(jpeg('rb-b'), 1), name: 'b.jpg' }),
    ];
    const rollbackOperation = id();
    failRenameSuffix = 'manifest.json';
    await assert.rejects(() => store.finalizeCatalogueMediaRemoval(rollbackSetId, rollbackOperation, rollbackSet.map(item => item.mediaId)), /rename failure/);
    failRenameSuffix = null;
    assert.deepEqual((await store.listCatalogueMedia(rollbackSetId)).map(item => item.mediaId), rollbackSet.map(item => item.mediaId));
    assert.equal((await store.getCatalogueMediaRemoval(rollbackSetId, rollbackOperation)).status, 'rolled_back');

    // Remove is a recoverable rename -> manifest commit -> best-effort trash cleanup.
    const rollbackId = id(); const rollbackItem = await store.addCatalogueMedia(rollbackId, addInput());
    failRenameSuffix = 'manifest.json';
    await assert.rejects(() => store.removeCatalogueMedia(rollbackId, rollbackItem.mediaId), /rename failure/);
    failRenameSuffix = null;
    assert.equal((await store.listCatalogueMedia(rollbackId)).length, 1, 'failed manifest commit must roll binary back');
    const crashId = id(); const crashItem = await store.addCatalogueMedia(crashId, addInput());
    const crashDir = path.join(directory, crashId); await fsp.rename(path.join(crashDir, `${crashItem.mediaId}.bin`), path.join(crashDir, `${crashItem.mediaId}.${id()}.trash`));
    assert.equal((await store.listCatalogueMedia(crashId)).length, 1, 'list must recover a pre-manifest remove crash from trash');
    const syncFailureId = id(); failPostManifestSync = true;
    await assert.rejects(() => store.addCatalogueMedia(syncFailureId, addInput()), /post-commit sync failure/);
    assert.equal((await store.listCatalogueMedia(syncFailureId)).length, 1, 'post-rename sync failure must not delete a manifest-referenced binary');
    const cleanupId = id(); const cleanupItem = await store.addCatalogueMedia(cleanupId, addInput());
    failTrashUnlink = true;
    const removed = await store.removeCatalogueMedia(cleanupId, cleanupItem.mediaId);
    assert.equal(removed.mediaId, cleanupItem.mediaId, 'cleanup failure after commit must still succeed');
    failTrashUnlink = false;
    assert.deepEqual(await store.listCatalogueMedia(cleanupId), []);
    assert.equal((await fsp.readdir(path.join(directory, cleanupId))).some((name) => name.endsWith('.trash')), false, 'later list cleans trash');

    assert.equal((await fsp.stat(directory)).mode & 0o777, 0o700);
    assert.match(fs.readFileSync(moduleFile, 'utf8'), /PM2 fork mode with one worker/);
    console.log('Catalogue media store check passed');
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
