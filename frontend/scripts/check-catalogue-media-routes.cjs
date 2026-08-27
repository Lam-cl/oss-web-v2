const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');

const root=process.cwd();
const collectionFile = path.join(root, 'src/app/api/admin/catalogue-products/[id]/media/route.ts');
const itemFile = path.join(root, 'src/app/api/admin/catalogue-products/[id]/media/[mediaId]/route.ts');
const helperFile = path.join(root, 'src/lib/admin/catalogueMediaRoute.server.ts');
const collectionAlias = '@/app/api/admin/catalogue-products/[id]/media/route';
const itemAlias = '@/app/api/admin/catalogue-products/[id]/media/[mediaId]/route';

function compile(file, injected = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request in injected) return injected[request];
    if (request.startsWith('.')) return require(path.resolve(path.dirname(file), request));
    return require(request);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}

const response = (body, status = 200) => Response.json(body, { status });
const server = {
  getAdminSession: async (request) => request.auth ? { user: { role: 'ADMIN' } } : null,
  requestIsSameOrigin: (request) => request.sameOrigin,
  safeError: (status, payload) => response({ message: payload?.message || `safe-${status}` }, status),
};
const next = { NextResponse: { json: (body, init = {}) => response(body, init.status || 200) } };
const mark = (request, { auth = true, sameOrigin = true } = {}) => {
  request.auth = auth;
  request.sameOrigin = sameOrigin;
  return request;
};
const request = ({ auth = true, sameOrigin = true, json, method = 'GET', headers } = {}) => mark(new Request('https://admin.test/media', {
  method,
  headers: { ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  ...(json === undefined ? {} : { body: JSON.stringify(json) }),
}), { auth, sameOrigin });
const parse = (result) => result.json();
const jpeg = () => new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1])], { type: 'image/jpeg' });
const upload = ({ assignment = 'all', duplicateFile = false, extra, auth = true, sameOrigin = true } = {}) => {
  const form = new FormData();
  form.append('file', jpeg(), 'hero.jpg');
  if (duplicateFile) form.append('file', jpeg(), 'second.jpg');
  form.append('order', '0');
  form.append('assignment', assignment);
  if (extra) form.append(extra[0], extra[1]);
  return mark(new Request('https://admin.test/media', { method: 'POST', body: form }), { auth, sameOrigin });
};
const declaredLength = (value) => mark(new Request('https://admin.test/media', {
  method: 'POST',
  headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': value },
  body: '--x--\r\n',
}), {});
const oversizedStream = () => {
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= 12) return controller.close();
      controller.enqueue(new Uint8Array(1024 * 1024));
      sent += 1;
    },
  });
  return mark(new Request('https://admin.test/media', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=x' },
    body: stream,
    duplex: 'half',
  }), {});
};

(async () => {
  assert.equal(fs.existsSync(collectionFile), true, 'collection route missing');
  assert.equal(fs.existsSync(itemFile), true, 'item route missing');
  assert.equal(fs.existsSync(helperFile), true, 'shared route helper missing');

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tw-catalogue-routes-'));
  const productId = randomUUID();
  const missingProductId = randomUUID();
  const mediaModule = compile(path.join(root, 'src/lib/admin/catalogueMedia.server.ts'), {
    '@/lib/dataApiClient.server': { dataApiEnabled: () => false },
  });
  const realStore = mediaModule.createCatalogueMediaStore(directory);
  let productReads = 0;
  let simActive = false;
  const activeProduct = {
    catalogueId: productId,
    currentBundleProductId: null,
    model: {
      choices: [{ key: 'colour', values: [
        { key: 'red', retired: false },
        { key: 'blue', retired: true },
      ] }],
    },
  };
  const product = { readCatalogueProduct: async (id) => {
    productReads += 1;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('A valid catalogue ID is required.');
    return id === productId ? activeProduct : null;
  } };
  const writes = { add: 0, update: 0, remove: 0 };
  const store = {
    ...realStore,
    addCatalogueMedia: async (...args) => { writes.add += 1; return realStore.addCatalogueMedia(...args); },
    updateCatalogueMedia: async (...args) => { writes.update += 1; return realStore.updateCatalogueMedia(...args); },
    removeCatalogueMedia: async (...args) => { writes.remove += 1; return realStore.removeCatalogueMedia(...args); },
  };
  const adoption = { readCatalogueAdoptionByBundle: async (bundleProductId) => simActive ? {
    status: 'active', bundleProductId, catalogueId: productId, managementProfile: { domain: 'SIM' },
  } : null };
  const baseInjected = {
    'next/server': next,
    '@/lib/admin/server': server,
    '@/lib/admin/catalogueProduct.server': product,
    '@/lib/admin/catalogueMedia.server': store,
    '@/lib/admin/catalogueAdoption.server': adoption,
  };
  const helper = compile(helperFile, baseInjected);
  const injected = { ...baseInjected, '@/lib/admin/catalogueMediaRoute.server': helper };
  const collection = compile(collectionFile, injected);
  const item = compile(itemFile, injected);

  try {
    // Every mutation is authenticated and same-origin protected before store writes.
    assert.equal((await collection.POST(upload({ auth: false }), { params: { id: productId } })).status, 401);
    assert.equal((await collection.POST(upload({ sameOrigin: false }), { params: { id: productId } })).status, 403);
    assert.equal((await item.PATCH(request({ auth: false, json: { order: 1 }, method: 'PATCH' }), { params: { id: productId, mediaId: randomUUID() } })).status, 401);
    assert.equal((await item.PATCH(request({ sameOrigin: false, json: { order: 1 }, method: 'PATCH' }), { params: { id: productId, mediaId: randomUUID() } })).status, 403);
    assert.equal((await item.DELETE(request({ auth: false, method: 'DELETE' }), { params: { id: productId, mediaId: randomUUID() } })).status, 401);
    assert.equal((await item.DELETE(request({ sameOrigin: false, method: 'DELETE' }), { params: { id: productId, mediaId: randomUUID() } })).status, 403);
    assert.deepEqual(writes, { add: 0, update: 0, remove: 0 });

    assert.equal((await collection.GET(request({ auth: false }), { params: { id: productId } })).status, 401);
    assert.equal((await collection.GET(request(), { params: { id: missingProductId } })).status, 404);
    assert.equal((await item.DELETE(request({ method: 'DELETE' }), { params: { id: missingProductId, mediaId: randomUUID() } })).status, 404);
    assert.equal((await collection.GET(request(), { params: { id: 'bad' } })).status, 400);

    // Content-Length is rejected before reading/parsing; chunked streams are capped while reading.
    const beforeOversize = writes.add;
    assert.equal((await collection.POST(declaredLength(String(11 * 1024 * 1024 + 1)), { params: { id: productId } })).status, 413);
    assert.equal((await collection.POST(declaredLength('12x'), { params: { id: productId } })).status, 400);
    assert.equal((await collection.POST(oversizedStream(), { params: { id: productId } })).status, 413);
    assert.equal(writes.add, beforeOversize, 'oversized or malformed multipart requests must not reach the store');

    assert.equal((await collection.POST(upload({ extra: ['surprise', 'x'] }), { params: { id: productId } })).status, 400);
    assert.equal((await collection.POST(upload({ duplicateFile: true }), { params: { id: productId } })).status, 400);

    // Assignment must be all or an active key from the already-read product model.
    assert.equal((await collection.POST(upload({ assignment: 'green' }), { params: { id: productId } })).status, 400);
    assert.equal((await collection.POST(upload({ assignment: 'blue' }), { params: { id: productId } })).status, 400);
    const createdResponse = await collection.POST(upload({ assignment: 'red' }), { params: { id: productId } });
    assert.equal(createdResponse.status, 201);
    const created = (await parse(createdResponse)).media;
    assert.match(created.mediaId, /^[0-9a-f-]{36}$/);
    assert.equal(created.assignment, 'red');
    assert.equal('body' in created, false);
    assert.equal('sha256' in created, false);

    const listed = await parse(await collection.GET(request(), { params: { id: productId } }));
    assert.equal(listed.media.length, 1);
    assert.equal('body' in listed.media[0], false);
    assert.equal('sha256' in listed.media[0], false);
    assert.equal(listed.media[0].url, `/admin-api/catalogue-products/${productId}/media/${created.mediaId}`);

    // Raw draft media is available only through the authenticated admin endpoint.
    const mediaContext = { params: { id: productId, mediaId: created.mediaId } };
    assert.equal((await item.GET(request({ auth: false }), mediaContext)).status, 401);
    assert.equal((await item.GET(request(), { params: { id: productId, mediaId: 'bad' } })).status, 400);
    assert.equal((await item.GET(request(), { params: { id: missingProductId, mediaId: created.mediaId } })).status, 404);
    const mediaResponse = await item.GET(request(), mediaContext);
    assert.equal(mediaResponse.status, 200);
    assert.equal(mediaResponse.headers.get('content-type'), 'image/jpeg');
    assert.equal(mediaResponse.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]));

    // Active SIM media is provider-owned and cannot drift through generic media routes.
    simActive = true;
    activeProduct.currentBundleProductId = 39;
    const writesBeforeSim = { ...writes };
    assert.equal((await collection.POST(upload(), { params: { id: productId } })).status, 409);
    assert.equal((await item.PATCH(request({ json: { order: 1 }, method: 'PATCH' }), { params: { id: productId, mediaId: created.mediaId } })).status, 409);
    assert.equal((await item.DELETE(request({ method: 'DELETE' }), { params: { id: productId, mediaId: created.mediaId } })).status, 409);
    assert.deepEqual(writes, writesBeforeSim, 'active SIM media denial must happen before store writes');
    simActive = false;
    activeProduct.currentBundleProductId = null;

    // Malformed media IDs fail before product/model lookup or body parsing.
    const readsBeforeBadMedia = productReads;
    assert.equal((await item.PATCH(request({ json: { order: 1 }, method: 'PATCH' }), { params: { id: productId, mediaId: 'bad' } })).status, 400);
    assert.equal((await item.DELETE(request({ method: 'DELETE' }), { params: { id: productId, mediaId: 'bad' } })).status, 400);
    assert.equal(productReads, readsBeforeBadMedia);

    const context = { params: { id: productId, mediaId: created.mediaId } };
    assert.equal((await item.PATCH(request({ json: {}, method: 'PATCH' }), context)).status, 400);
    assert.equal((await item.PATCH(request({ json: { order: 1, surprise: true }, method: 'PATCH' }), context)).status, 400);
    assert.equal((await item.PATCH(request({ json: { assignment: 'green' }, method: 'PATCH' }), context)).status, 400);
    assert.equal((await item.PATCH(request({ json: { assignment: 'blue' }, method: 'PATCH' }), context)).status, 400);
    const patched = (await parse(await item.PATCH(request({ json: { order: 1, assignment: 'all' }, method: 'PATCH' }), context))).media;
    assert.equal(patched.order, 1);
    assert.equal(patched.assignment, 'all');
    assert.equal('body' in patched, false);
    assert.equal('sha256' in patched, false);

    assert.equal((await item.DELETE(request({ method: 'DELETE' }), { params: { id: productId, mediaId: randomUUID() } })).status, 404);
    const removedResponse = await item.DELETE(request({ method: 'DELETE' }), context);
    assert.equal(removedResponse.status, 200);
    const removed = (await parse(removedResponse)).media;
    assert.equal(removed.mediaId, created.mediaId);
    assert.equal('body' in removed, false);
    assert.equal('sha256' in removed, false);
    assert.deepEqual(await realStore.listCatalogueMedia(productId), []);

    for (const file of [collectionFile, itemFile]) {
      const source = fs.readFileSync(file, 'utf8');
      assert.match(source, /catalogueMediaRoute\.server/);
      assert.doesNotMatch(source, /function (?:publicMedia|mediaError|productError)/);
    }
    const collectionReexport = fs.readFileSync(path.join(root, 'src/app/admin-api/catalogue-products/[id]/media/route.ts'), 'utf8');
    const itemReexport = fs.readFileSync(path.join(root, 'src/app/admin-api/catalogue-products/[id]/media/[mediaId]/route.ts'), 'utf8');
    assert.match(collectionReexport, new RegExp(`export \\{[^}]*GET[^}]*POST[^}]*\\} from '${collectionAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    assert.match(itemReexport, new RegExp(`export \\{[^}]*GET[^}]*PATCH[^}]*DELETE[^}]*\\} from '${itemAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    console.log('Catalogue media route check passed');
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
