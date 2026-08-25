const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

function load(rel, injected = {}) {
  const file = path.join(process.cwd(), rel);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (name) => name in injected ? injected[name] : require(name);
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, localRequire, mod, file, path.dirname(file));
  return mod.exports;
}

const response = (body, status = 200) => Response.json(body, { status });
const pickup = (status = 'PAID') => ({ id: 42, status, deliveryOption: 'PICKUP' });

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-'));
  try {
    const server = load('src/lib/admin/readyCollectionEmail.server.ts', {
      '@/lib/admin/types': load('src/lib/admin/types.ts', { '../pickup': load('src/lib/pickup.ts') }),
      '@/lib/admin/simVariantMigrationStore.server': { simDataRoot: (value) => {
        const candidate = value || root;
        if (!path.isAbsolute(candidate) || path.normalize(candidate) !== candidate) throw new Error('absolute normalized');
        return candidate;
      } },
      '@/lib/dataApiClient.server': { dataApiEnabled: () => false },
    });
    const storeA = server.createReadyCollectionEmailStore(root);
    const storeB = server.createReadyCollectionEmailStore(root);
    const calls = [];
    let order = pickup();
    const adapter = (store, send = async () => response({ sent: true })) => ({
      store,
      readOrder: async () => structuredClone(order),
      updateStatus: async (id) => {
        assert.equal((await store.read(id)).phase, 'status-updating', 'durable intent must precede status mutation');
        calls.push(['status', id]);
        order.status = 'PROCESSING';
      },
      sendEmail: async (id) => {
        assert.equal((await store.read(id)).phase, 'attempting', 'durable email intent must precede provider call');
        calls.push(['email', id]);
        return send(id);
      },
    });

    const [first, second] = await Promise.all([
      server.orchestrateReadyCollectionEmail(42, 'READY_FOR_COLLECTION', adapter(storeA)),
      server.orchestrateReadyCollectionEmail(42, 'PROCESSING', adapter(storeB)),
    ]);
    assert.equal(first.outcome, 'sent');
    assert.equal(second.outcome, 'sent');
    assert.equal(calls.filter(([type]) => type === 'email').length, 1, 'two instances must send once');
    assert.equal(calls.filter(([type]) => type === 'status').length, 1, 'two instances must update once');
    assert.equal((await server.orchestrateReadyCollectionEmail(42, 'READY_FOR_COLLECTION', adapter(storeB))).outcome, 'sent');
    assert.equal(calls.filter(([type]) => type === 'email').length, 1, 'repeated/stale ready must replay marker');

    for (const status of ['SHIPPED', 'PROCESSING', 'DELIVERED', 'CANCELLED', 'REFUNDED']) {
      const isolated = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-ineligible-'));
      order = pickup(status);
      await assert.rejects(
        () => server.orchestrateReadyCollectionEmail(43, 'READY_FOR_COLLECTION', adapter(server.createReadyCollectionEmailStore(isolated))),
        /paid.*pickup/i,
      );
      await fsp.rm(isolated, { recursive: true, force: true });
    }
    order = { ...pickup(), deliveryOption: 'DELIVER' };
    const deliverRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-deliver-'));
    await assert.rejects(
      () => server.orchestrateReadyCollectionEmail(44, 'READY_FOR_COLLECTION', adapter(server.createReadyCollectionEmailStore(deliverRoot))),
      /paid.*pickup/i,
    );

    const timeoutRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-timeout-'));
    order = pickup(); calls.length = 0;
    const timeoutStore = server.createReadyCollectionEmailStore(timeoutRoot);
    const unknown = await server.orchestrateReadyCollectionEmail(45, 'READY_FOR_COLLECTION', adapter(timeoutStore, async () => { throw new Error('timeout after accept'); }));
    assert.equal(unknown.outcome, 'unknown');
    assert.equal(order.status, 'PROCESSING', 'email uncertainty must preserve updated status');
    const replay = await server.orchestrateReadyCollectionEmail(45, 'READY_FOR_COLLECTION', adapter(server.createReadyCollectionEmailStore(timeoutRoot)));
    assert.equal(replay.outcome, 'unknown');
    assert.equal(calls.filter(([type]) => type === 'email').length, 1, 'unknown must never auto-retry');

    for (const [id, status, expected] of [[48, 503, 'unknown'], [49, 400, 'failed']]) {
      const failureRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-provider-'));
      order = pickup(); calls.length = 0;
      const failureStore = server.createReadyCollectionEmailStore(failureRoot);
      const failed = await server.orchestrateReadyCollectionEmail(id, 'READY_FOR_COLLECTION', adapter(failureStore, async () => response({}, status)));
      assert.equal(failed.outcome, expected);
      order.status = 'PROCESSING';
      assert.equal((await server.orchestrateReadyCollectionEmail(id, 'READY_FOR_COLLECTION', adapter(server.createReadyCollectionEmailStore(failureRoot)))).outcome, expected);
      assert.equal(calls.filter(([type]) => type === 'email').length, 1, `${status} must never auto-retry`);
    }

    const crashRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-crash-'));
    const crashStore = server.createReadyCollectionEmailStore(crashRoot);
    await crashStore.write(46, { version: 2, orderId: 46, phase: 'attempting', updatedAt: new Date().toISOString() });
    order = pickup('PROCESSING'); calls.length = 0;
    const crashed = await server.orchestrateReadyCollectionEmail(46, 'READY_FOR_COLLECTION', adapter(server.createReadyCollectionEmailStore(crashRoot)));
    assert.equal(crashed.outcome, 'unknown');
    assert.equal(calls.length, 0, 'restart after attempted send must not call provider');
    assert.equal((await crashStore.read(46)).phase, 'unknown');

    // A crash after the Bundle commit but before the next marker write must be recoverable.
    const commitCrashRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-status-commit-crash-'));
    const commitCrashStore = server.createReadyCollectionEmailStore(commitCrashRoot);
    order = pickup(); calls.length = 0;
    let failStatusUpdatedWrite = true;
    const crashingStore = {
      ...commitCrashStore,
      async write(id, value) {
        if (value.phase === 'status-updated' && failStatusUpdatedWrite) {
          failStatusUpdatedWrite = false;
          throw new Error('simulated crash after status commit');
        }
        return commitCrashStore.write(id, value);
      },
    };
    await assert.rejects(
      () => server.orchestrateReadyCollectionEmail(50, 'READY_FOR_COLLECTION', adapter(crashingStore)),
      /simulated crash/,
    );
    assert.equal(order.status, 'PROCESSING');
    assert.equal((await commitCrashStore.read(50)).phase, 'status-updating');
    const recoveredCommit = await server.orchestrateReadyCollectionEmail(50, 'READY_FOR_COLLECTION', adapter(commitCrashStore));
    assert.equal(recoveredCommit.outcome, 'sent');
    assert.equal(calls.filter(([type]) => type === 'status').length, 1);
    assert.equal(calls.filter(([type]) => type === 'email').length, 1);

    // Lost update response: authoritative PROCESSING proves the commit and permits email.
    const responseLossRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-status-response-loss-'));
    order = pickup(); calls.length = 0;
    const responseLossStore = server.createReadyCollectionEmailStore(responseLossRoot);
    const responseLossAdapter = adapter(responseLossStore);
    responseLossAdapter.updateStatus = async (id) => {
      calls.push(['status', id]);
      order.status = 'PROCESSING';
      const error = new Error('network timeout after commit');
      error.status = 504;
      throw error;
    };
    assert.equal((await server.orchestrateReadyCollectionEmail(51, 'READY_FOR_COLLECTION', responseLossAdapter)).outcome, 'sent');
    assert.equal(calls.filter(([type]) => type === 'email').length, 1);

    // Crash before status call: durable intent + PAID is safe to retry once.
    const beforeStatusRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-before-status-'));
    const beforeStatusStore = server.createReadyCollectionEmailStore(beforeStatusRoot);
    await beforeStatusStore.write(52, { version: 2, orderId: 52, phase: 'status-updating', updatedAt: new Date().toISOString() });
    order = pickup(); calls.length = 0;
    assert.equal((await server.orchestrateReadyCollectionEmail(52, 'READY_FOR_COLLECTION', adapter(beforeStatusStore))).outcome, 'sent');
    assert.equal(calls.filter(([type]) => type === 'status').length, 1);
    assert.equal(calls.filter(([type]) => type === 'email').length, 1);

    // PROCESSING is eligible only when durable intent proves this operation initiated it.
    const processingRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-processing-marker-'));
    const processingStore = server.createReadyCollectionEmailStore(processingRoot);
    await processingStore.write(53, { version: 2, orderId: 53, phase: 'status-updating', updatedAt: new Date().toISOString() });
    order = pickup('PROCESSING'); calls.length = 0;
    assert.equal((await server.orchestrateReadyCollectionEmail(53, 'READY_FOR_COLLECTION', adapter(processingStore))).outcome, 'sent');
    assert.equal(calls.filter(([type]) => type === 'status').length, 0);
    assert.equal(calls.filter(([type]) => type === 'email').length, 1);

    const noMarkerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-processing-no-marker-'));
    order = pickup('PROCESSING'); calls.length = 0;
    await assert.rejects(
      () => server.orchestrateReadyCollectionEmail(54, 'READY_FOR_COLLECTION', adapter(server.createReadyCollectionEmailStore(noMarkerRoot))),
      /paid.*pickup/i,
    );
    assert.equal(calls.filter(([type]) => type === 'email').length, 0);

    // If the first transient failure definitely left PAID, retry status at most once.
    const paidRetryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-paid-retry-'));
    order = pickup(); calls.length = 0;
    let statusAttempts = 0;
    const paidRetryAdapter = adapter(server.createReadyCollectionEmailStore(paidRetryRoot));
    paidRetryAdapter.updateStatus = async (id) => {
      calls.push(['status', id]);
      statusAttempts += 1;
      if (statusAttempts === 1) {
        const error = new Error('temporary upstream failure');
        error.status = 503;
        throw error;
      }
      order.status = 'PROCESSING';
    };
    assert.equal((await server.orchestrateReadyCollectionEmail(55, 'READY_FOR_COLLECTION', paidRetryAdapter)).outcome, 'sent');
    assert.equal(statusAttempts, 2);
    assert.equal(calls.filter(([type]) => type === 'email').length, 1);

    // If reconciliation cannot read authoritative state, remain durably unknown and do not email.
    const unreadableRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ready-email-status-unreadable-'));
    order = pickup(); calls.length = 0;
    let reads = 0;
    const unreadableStore = server.createReadyCollectionEmailStore(unreadableRoot);
    const unreadableAdapter = adapter(unreadableStore);
    unreadableAdapter.readOrder = async () => {
      reads += 1;
      if (reads === 1) return structuredClone(order);
      throw new Error('read unavailable');
    };
    unreadableAdapter.updateStatus = async (id) => {
      calls.push(['status', id]);
      const error = new Error('status timeout');
      error.status = 504;
      throw error;
    };
    const statusUnknown = await server.orchestrateReadyCollectionEmail(56, 'READY_FOR_COLLECTION', unreadableAdapter);
    assert.equal(statusUnknown.outcome, 'status-unknown');
    assert.equal(statusUnknown.statusUpdated, false);
    assert.equal((await unreadableStore.read(56)).phase, 'status-unknown');
    assert.equal(calls.filter(([type]) => type === 'email').length, 0);
    order = pickup('PROCESSING');
    const reconciledUnknown = await server.orchestrateReadyCollectionEmail(56, 'READY_FOR_COLLECTION', adapter(unreadableStore));
    assert.equal(reconciledUnknown.outcome, 'sent');
    assert.equal(calls.filter(([type]) => type === 'status').length, 1, 'PROCESSING reconciliation must not mutate status again');
    assert.equal(calls.filter(([type]) => type === 'email').length, 1, 'status-unknown restart must send exactly once after committed status is proven');

    for (const invalid of [0, -1, 1.2, NaN]) await assert.rejects(
      () => server.orchestrateReadyCollectionEmail(invalid, 'READY_FOR_COLLECTION', adapter(storeA)),
      /positive.*id/i,
    );
    await assert.rejects(() => server.orchestrateReadyCollectionEmail(47, 'COMPLETED', adapter(storeA)), /requested status/i);

    let auth = true, sameOrigin = true, handled = 0;
    const route = load('src/app/api/admin/[...path]/route.ts', {
      'next/server': { NextResponse: { json: (body, init = {}) => response(body, init.status || 200) } },
      '@/lib/admin/server': {
        BUNDLE_API: 'https://bundle.test/api', getAdminSession: async () => auth ? ({ token: 'secret' }) : null,
        readUpstream: async (upstream) => upstream.json(), requestIsSameOrigin: () => sameOrigin,
        safeError: (status, body = {}) => response(body, status), sanitizePayload: (body) => body,
      },
      '@/lib/admin/readyCollectionEmail.server': { orchestrateReadyCollectionEmail: async () => { handled++; return { outcome: 'sent', statusUpdated: true }; } },
      '@/lib/shippingSettings.server': {},
      '@/lib/admin/productSetup.server': { ProductSetupError: class extends Error {} },
      '@/lib/admin/simPrefixes.server': { SimPrefixError: class extends Error {} },
      '@/lib/admin/simRange.server': { SimRangeError: class extends Error {} },
      '@/lib/admin/orderMetadata.server': { OrderMetadataError: class extends Error {} },
      '@/lib/productImageColors.server': {},
    });
    const request = () => { const value = new Request('https://admin.test/admin-api/orders/42/ready-for-collection-email', { method: 'POST', headers: { origin: 'https://admin.test', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'READY_FOR_COLLECTION' }) }); Object.defineProperty(value, 'nextUrl', { value: new URL(value.url) }); return value; };
    const context = { params: { path: ['orders', '42', 'ready-for-collection-email'] } };
    auth = false; assert.equal((await route.POST(request(), context)).status, 401);
    auth = true; sameOrigin = false; assert.equal((await route.POST(request(), context)).status, 403);
    sameOrigin = true; assert.equal((await route.POST(request(), context)).status, 200);
    assert.equal(handled, 1, 'only authenticated same-origin request reaches orchestrator');
    for (const parts of [['orders', '0', 'ready-for-collection-email'], ['orders', '-1', 'ready-for-collection-email'], ['orders', '42x', 'ready-for-collection-email']]) {
      assert.equal((await route.POST(request(), { params: { path: parts } })).status, 404);
    }

    const drawer = fs.readFileSync('src/components/admin/OrderDrawer.tsx', 'utf8');
    const client = fs.readFileSync('src/lib/admin/readyCollectionEmail.ts', 'utf8');
    assert.match(drawer + client, /ready-for-collection-email/);
    assert.doesNotMatch(drawer, /resend-ready-email|Retry Email|sendReadyCollectionEmail/);
    assert.match(drawer, /email outcome (?:is )?uncertain/i);
    console.log('ready collection server orchestration checks passed');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
