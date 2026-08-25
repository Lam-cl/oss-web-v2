const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    module.exports,
    require,
    module,
    file,
    path.dirname(file),
  );
  return module.exports;
}

const store = load('src/lib/admin/productControl.server.ts');
const pendingStepKinds = [
  'upload-images',
  'create-option',
  'add-option-values',
  'create-variants',
  'update-variants',
  'remove-images',
  'order-images',
  'update-control',
  'update-product',
];
const pendingOperation = (overrides = {}) => ({
  operationId: 'b'.repeat(64),
  startedAt: '2026-08-23T01:02:04.000Z',
  phase: 'applying',
  completedSteps: [{ index: 0, kind: 'upload-images', itemKey: 'upload-main' }],
  resultFingerprint: null,
  resolved: {
    optionIds: { 'choice-colour': 10 },
    valueIds: { 'value-red': 101 },
    imageIds: { 'upload-main': 701 },
    variantIds: { 'variant-red-small': 501 },
  },
  ...overrides,
});
const record = (productId = 7) => ({
  version: 1,
  productId,
  updatedAt: '2026-08-23T01:02:03.000Z',
  upstreamFingerprint: 'a'.repeat(64),
  category: null,
  optionOrder: [10, 20],
  valueOrder: { 10: [101, 102], 20: [201] },
  hiddenValueIds: [102],
  imageAssignments: [{ imageId: 701, valueId: 101 }],
  variantBindings: [{ valueIds: [101, 201], variantId: 501 }],
  pendingOperation: null,
  lastCompletedOperation: null,
});

(async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tw-product-control-'));
  await fsp.chmod(directory, 0o755);

  assert.equal(
    store.PRODUCT_CONTROL_DIRECTORY,
    path.join(process.cwd(), '.data', 'product-control'),
  );
  assert.equal(await store.readProductControl(7, directory), null);
  assert.equal(
    (await fsp.stat(directory)).mode & 0o777,
    0o700,
    'missing-product reads must tighten a pre-existing directory',
  );

  const first = await store.writeProductControl(record(), directory);
  assert.deepEqual(first, record());
  assert.deepEqual(await store.readProductControl(7, directory), record());
  assert.equal(
    (await fsp.stat(directory)).mode & 0o777,
    0o700,
    'pre-existing directory must be tightened',
  );
  assert.equal((await fsp.stat(path.join(directory, '7.json'))).mode & 0o777, 0o600);

  const checkpoint = {
    ...record(),
    category: 'Wearables',
    pendingOperation: pendingOperation({
      phase: 'bundle-complete',
      completedSteps: pendingStepKinds.map((kind, index) => ({ index, kind })),
      resultFingerprint: 'c'.repeat(64),
    }),
  };
  assert.deepEqual(await store.writeProductControl(checkpoint, directory), checkpoint);
  assert.deepEqual(await store.readProductControl(7, directory), checkpoint);

  const completed = {
    ...record(),
    lastCompletedOperation: {
      operationId: 'b'.repeat(64),
      resultFingerprint: 'c'.repeat(64),
      completedAt: '2026-08-23T01:02:05.000Z',
    },
  };
  assert.deepEqual(await store.writeProductControl(completed, directory), completed);
  assert.deepEqual(await store.readProductControl(7, directory), completed);

  const syncCalls = [];
  const instrumentedOpen = async (...args) => {
    const handle = await fsp.open(...args);
    return {
      writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
      sync: async () => { syncCalls.push(String(args[0]) === directory ? 'directory' : 'file'); await handle.sync(); },
      close: () => handle.close(),
    };
  };
  await store.writeProductControl(record(13), directory, instrumentedOpen);
  assert.deepEqual(syncCalls, ['file', 'directory'], 'atomic writes must fsync the file before the containing directory');

  const unlockedResult = await Promise.race([
    store.withProductLock(11, () => store.writeProductControlUnlocked(record(11), directory), directory),
    new Promise((_, reject) => setTimeout(() => reject(new Error('unlocked writer deadlocked')), 250)),
  ]);
  assert.deepEqual(unlockedResult, record(11));
  assert.equal((await fsp.stat(path.join(directory, '11.json'))).mode & 0o777, 0o600);
  await assert.rejects(
    () => store.writeProductControlUnlocked({ ...record(11), category: 123 }, directory),
    /valid/i,
    'the unlocked writer must still validate records',
  );

  let releaseStandalone;
  const standaloneGate = new Promise((resolve) => { releaseStandalone = resolve; });
  const held = store.withProductLock(12, async () => {
    await standaloneGate;
  }, directory);
  let standaloneSettled = false;
  const standalone = store.writeProductControl(record(12), directory).then((value) => {
    standaloneSettled = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(standaloneSettled, false, 'standalone writes must wait for the product lock');
  releaseStandalone();
  await held;
  assert.deepEqual(await standalone, record(12));
  await store.writeProductControl(record(), directory);

  await fsp.chmod(directory, 0o755);
  await fsp.chmod(path.join(directory, '7.json'), 0o644);
  assert.deepEqual(await store.readProductControl(7, directory), record());
  assert.equal(
    (await fsp.stat(directory)).mode & 0o777,
    0o700,
    'reads must tighten a pre-existing directory',
  );
  assert.equal(
    (await fsp.stat(path.join(directory, '7.json'))).mode & 0o777,
    0o600,
    'reads must tighten a pre-existing file',
  );

  let active = 0;
  let max = 0;
  await Promise.all([
    store.withProductLock(7, async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
    }, directory),
    store.withProductLock(7, async () => {
      active++;
      max = Math.max(max, active);
      active--;
    }, directory),
  ]);
  assert.equal(max, 1);

  active = 0;
  max = 0;
  await Promise.all([8, 9].map((productId) => store.withProductLock(productId, async () => {
    active++;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
  }, directory)));
  assert.equal(max, 2);

  await fsp.writeFile(path.join(directory, '7.json'), '{broken', 'utf8');
  await assert.rejects(
    () => store.readProductControl(7, directory),
    /corrupt/i,
    'malformed JSON must never become empty state',
  );

  const badCases = [
    ['wrong version', { ...record(), version: 2 }],
    ['mismatched product', { ...record(), productId: 8 }],
    ['unsafe product', { ...record(), productId: Number.MAX_SAFE_INTEGER + 1 }],
    ['timestamp', { ...record(), updatedAt: 'yesterday' }],
    ['duplicate option', { ...record(), optionOrder: [10, 10] }],
    ['duplicate value', { ...record(), valueOrder: { 10: [101, 101], 20: [201] } }],
    ['duplicate hidden', { ...record(), hiddenValueIds: [102, 102] }],
    ['duplicate image', {
      ...record(),
      imageAssignments: [{ imageId: 701, valueId: 101 }, { imageId: 701, valueId: 102 }],
    }],
    ['duplicate binding', {
      ...record(),
      variantBindings: [
        { valueIds: [101, 201], variantId: 501 },
        { valueIds: [201, 101], variantId: 502 },
      ],
    }],
    ['two values from one option', {
      ...record(),
      variantBindings: [{ valueIds: [101, 102], variantId: 501 }],
    }],
    ['missing option value', {
      ...record(),
      variantBindings: [{ valueIds: [101], variantId: 501 }],
    }],
    ['pending shape', {
      ...record(),
      pendingOperation: { operationId: '', startedAt: 'bad' },
    }],
    ['category type', { ...record(), category: 123 }],
    ['operation id length', { ...record(), pendingOperation: pendingOperation({ operationId: 'a'.repeat(63) }) }],
    ['operation id hex', { ...record(), pendingOperation: pendingOperation({ operationId: 'g'.repeat(64) }) }],
    ['pending timestamp', { ...record(), pendingOperation: pendingOperation({ startedAt: 'bad' }) }],
    ['pending phase', { ...record(), pendingOperation: pendingOperation({ phase: 'done' }) }],
    ['legacy string completed step', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: ['upload-images:0'] }),
    }],
    ['duplicate completed step tuple', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [
        { index: 0, kind: 'upload-images', itemKey: 'upload-main' },
        { index: 0, kind: 'upload-images', itemKey: 'upload-main' },
      ] }),
    }],
    ['unknown completed step kind', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [{ index: 0, kind: 'delete-product' }] }),
    }],
    ['negative completed step index', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [{ index: -1, kind: 'upload-images' }] }),
    }],
    ['unsafe completed step index', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [{ index: Number.MAX_SAFE_INTEGER + 1, kind: 'upload-images' }] }),
    }],
    ['fractional completed step index', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [{ index: 0.5, kind: 'upload-images' }] }),
    }],
    ['unknown completed step field', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [{ index: 0, kind: 'upload-images', extra: true }] }),
    }],
    ['missing completed step field', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [{ kind: 'upload-images' }] }),
    }],
    ['unstable completed step item key', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [{ index: 0, kind: 'upload-images', itemKey: ' space padded ' }] }),
    }],
    ['oversized completed step item key', {
      ...record(), pendingOperation: pendingOperation({ completedSteps: [{ index: 0, kind: 'upload-images', itemKey: 'x'.repeat(129) }] }),
    }],
    ['applying operation with result fingerprint', {
      ...record(), pendingOperation: pendingOperation({ resultFingerprint: 'c'.repeat(64) }),
    }],
    ['bundle-complete operation without result fingerprint', {
      ...record(), pendingOperation: pendingOperation({ phase: 'bundle-complete', resultFingerprint: null }),
    }],
    ['bundle-complete operation with invalid result fingerprint', {
      ...record(), pendingOperation: pendingOperation({ phase: 'bundle-complete', resultFingerprint: 'g'.repeat(64) }),
    }],
    ['missing resolved map', {
      ...record(), pendingOperation: pendingOperation({ resolved: { optionIds: {}, valueIds: {}, imageIds: {} } }),
    }],
    ['unknown resolved map', {
      ...record(), pendingOperation: pendingOperation({
        resolved: { optionIds: {}, valueIds: {}, imageIds: {}, variantIds: {}, otherIds: {} },
      }),
    }],
    ['unstable resolved key', {
      ...record(), pendingOperation: pendingOperation({
        resolved: { optionIds: { 'bad key': 10 }, valueIds: {}, imageIds: {}, variantIds: {} },
      }),
    }],
    ['oversized resolved key', {
      ...record(), pendingOperation: pendingOperation({
        resolved: { optionIds: { ['x'.repeat(129)]: 10 }, valueIds: {}, imageIds: {}, variantIds: {} },
      }),
    }],
    ['non-positive resolved id', {
      ...record(), pendingOperation: pendingOperation({
        resolved: { optionIds: { choice: 0 }, valueIds: {}, imageIds: {}, variantIds: {} },
      }),
    }],
    ['unsafe resolved id', {
      ...record(), pendingOperation: pendingOperation({
        resolved: { optionIds: {}, valueIds: {}, imageIds: {}, variantIds: { variant: Number.MAX_SAFE_INTEGER + 1 } },
      }),
    }],
    ['unknown pending field', { ...record(), pendingOperation: { ...pendingOperation(), extra: true } }],
    ['completed tombstone operation id', { ...record(), lastCompletedOperation: {
      operationId: 'g'.repeat(64), resultFingerprint: 'c'.repeat(64), completedAt: '2026-08-23T01:02:05.000Z',
    } }],
    ['completed tombstone result fingerprint', { ...record(), lastCompletedOperation: {
      operationId: 'b'.repeat(64), resultFingerprint: 'short', completedAt: '2026-08-23T01:02:05.000Z',
    } }],
    ['completed tombstone timestamp', { ...record(), lastCompletedOperation: {
      operationId: 'b'.repeat(64), resultFingerprint: 'c'.repeat(64), completedAt: 'bad',
    } }],
    ['completed tombstone missing field', { ...record(), lastCompletedOperation: {
      operationId: 'b'.repeat(64), resultFingerprint: 'c'.repeat(64),
    } }],
    ['completed tombstone unknown field', { ...record(), lastCompletedOperation: {
      operationId: 'b'.repeat(64), resultFingerprint: 'c'.repeat(64), completedAt: '2026-08-23T01:02:05.000Z', extra: true,
    } }],
    ['unknown field', { ...record(), state: {} }],
  ];
  for (const [name, bad] of badCases) {
    await fsp.writeFile(path.join(directory, '7.json'), JSON.stringify(bad));
    await assert.rejects(() => store.readProductControl(7, directory), /corrupt/i, name);
  }

  await assert.rejects(
    () => store.writeProductControl({
      ...record(),
      pendingOperation: pendingOperation({ operationId: 'op-1', startedAt: 'bad' }),
    }, directory),
    /valid/i,
  );
  await assert.rejects(() => store.readProductControl(0, directory), /valid product ID/);
  await assert.rejects(() => store.readProductControl('7', directory), /valid product ID/);

  const blockedTarget = path.join(directory, '42.json');
  await fsp.mkdir(blockedTarget);
  await assert.rejects(
    () => store.writeProductControl(record(42), directory),
    'rename failure must reject the write',
  );
  assert.deepEqual(
    (await fsp.readdir(directory)).filter((name) => name.startsWith('42.json.') && name.endsWith('.tmp')),
    [],
    'failed atomic writes must remove their temp file',
  );

  const blockedUnlockedTarget = path.join(directory, '43.json');
  await fsp.mkdir(blockedUnlockedTarget);
  await assert.rejects(
    () => store.withProductLock(
      43,
      () => store.writeProductControlUnlocked(record(43), directory),
      directory,
    ),
    'unlocked rename failure must reject the write',
  );
  assert.deepEqual(
    (await fsp.readdir(directory)).filter((name) => name.startsWith('43.json.') && name.endsWith('.tmp')),
    [],
    'failed unlocked atomic writes must remove their temp file',
  );

  assert.match(
    fs.readFileSync('src/lib/admin/productControl.server.ts', 'utf8'),
    /single PM2 worker[\s\S]*replaced before clustering/i,
    'required Ponytail lock limitation comment missing',
  );
  assert.deepEqual(
    (await fsp.readdir(directory)).filter((name) => name.includes('.tmp')),
    [],
  );

  await fsp.rm(directory, { recursive: true, force: true });
  console.log('Product control store check passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
