const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const digest = (body) => crypto.createHash('sha256').update(body).digest('hex');
function png(red, green, blue) {
  const crc32 = (body) => {
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, body) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(body.length); crc.writeUInt32BE(crc32(Buffer.concat([type, body])));
    return Buffer.concat([length, type, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, red, green, blue, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

function fixture({ checkpointed, rejectOrder = false, loseOrderResponse = false }) {
  let job;
  const calls = [], checkpointSteps = [];
  const persistence = {
    readPublicationJob: async (operation) => job?.operationId === operation ? structuredClone(job) : null,
    createPublicationJob: async () => { throw Error('The existing durable draft must be resumed, not recreated'); },
    updatePublicationJob: async (operation, revision, update) => {
      assert.equal(operation, job.operationId); assert.equal(revision, job.revision);
      job = await update(structuredClone(job)); job.revision++;
      checkpointSteps.push(job.completedSteps.map((step) => step.name));
      return structuredClone(job);
    },
  };
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    if (modules.has(file)) return modules.get(file);
    const mod = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const localRequire = (name) => name === './cataloguePublication.server' ? persistence
      : name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name);
    new Function('exports', 'require', 'module', output)(mod.exports, localRequire, mod);
    modules.set(file, mod.exports);
    return mod.exports;
  }
  const publisher = load('src/lib/admin/cataloguePublish.server.ts');
  const { createCatalogueBundleAdapter } = load('src/lib/admin/catalogueBundleAdapter.server.ts');
  const bodies = [png(0, 0, 0), png(255, 255, 255), png(69, 128, 200)];
  const mediaIds = ['efa16b82-5469-412e-a243-c410923fb10b', '8c11c2c7-934a-4ed2-8f90-2917571436c6', '68fc82df-6551-476c-802e-d50b0adb889f'];
  const request = {
    catalogueId: 'cf764a8a-0688-4423-a549-ea2a64b057e5', versionOrdinal: 2, previousBundleProductId: 207,
    spec: { details: { title: 'Shirt', description: 'Pre-order description', price: 59, category: 'Apparel', isPreOrder: true },
      choices: [], combinations: [{ valueKeys: [], price: 59, inventory: 9999999 }], existingImages: [] },
    uploads: bodies.map((body, order) => ({ key: mediaIds[order], name: `${order}.png`, contentType: 'image/png', order, body, sha256: digest(body) })),
  };
  const operation = publisher.cataloguePublicationOperationId(request);
  job = { version: 1, operationId: operation, catalogueId: request.catalogueId, revision: 6, phase: 'building',
    modelFingerprint64: operation, previousBundleProductId: 207, draftBundleProductId: 208,
    completedSteps: [{ name: 'draft-created', completedAt: '2026-10-29T00:00:00.000Z' }],
    resolved: { images: checkpointed ? Object.fromEntries(mediaIds.map((id, index) => [id, 576 + index])) : {},
      options: {}, values: {}, variants: {} }, bindings: [], resultFingerprint64: null,
    createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z' };
  const media = request.uploads.map((upload) => ({ mediaId: upload.key, originalName: upload.name,
    contentType: upload.contentType, order: upload.order, sha256: upload.sha256 }));
  const product = { id: 208, title: `Shirt [TW-${operation.slice(0, 8)}-a2]`,
    description: `Pre-order description\n[[TW-CATALOGUE-DRAFT:${operation}]]`, type: 'MERCHANDISE', price: 59,
    shippingCost: 0, weight: 0, isPreOrder: true, categories: ['Apparel'], tags: [], deletedAt: null,
    options: [], productVariants: [], images: bodies.map((body, index) => ({ id: 576 + index, productId: 208,
      url: `https://oss-bucket.s3.us-east-2.amazonaws.com/${576 + index}.png`, order: 2 - index })) };
  const json = (value) => Response.json(structuredClone(value));
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method || 'GET';
    calls.push({ path: url.pathname, method });
    if (url.hostname === 'oss-bucket.s3.us-east-2.amazonaws.com') {
      assert.equal(method, 'GET'); assert.equal(new Headers(init.headers).has('authorization'), false);
      const index = Number(url.pathname.slice(1).replace('.png', '')) - 576;
      assert(index >= 0 && index < bodies.length);
      return new Response(bodies[index], { headers: { 'content-type': 'image/png' } });
    }
    assert.equal(url.origin, 'https://bundle.test', 'No real network or unrelated host is allowed');
    if (url.pathname === '/api/products' && method === 'GET') return json({ data: [product] });
    if (url.pathname === '/api/products/208' && method === 'GET') return json(product);
    if (url.pathname === '/api/products/208/images/order' && method === 'PATCH') {
      const ordering = JSON.parse(init.body).images;
      if (rejectOrder) throw Error('Order rejected before commit');
      for (const image of ordering) product.images.find((row) => row.id === image.id).order = image.order;
      if (loseOrderResponse) { loseOrderResponse = false; throw Error('Order committed but response was lost'); }
      return json({ success: true });
    }
    if (url.pathname === '/api/products/208' && method === 'PUT') {
      assert(init.body instanceof FormData);
      assert.equal(init.body.has('images'), false, 'Existing images must never be uploaded again');
      const description = init.body.get('description');
      assert(description.includes('TW-CATALOGUE-DRAFT'), 'These tests must never publish a provider product');
      product.description = description; // Only the safe draft-restoration path may reach this PUT.
      return json(product);
    }
    if (url.pathname === '/api/products/208/variants' && method === 'POST') {
      // Tripwire deliberately ends the positive case after the real publisher
      // attests images. The negative case must never reach variant creation.
      throw Error('End fixture after independently verified image phase');
    }
    throw Error(`Unexpected request: ${method} ${url.pathname}`);
  };
  const local = {
    readPublication: async (id) => id === operation ? structuredClone(job) : null,
    readProductPublication: async () => structuredClone(job), readMedia: async () => structuredClone(media),
    hideOptionValues: async () => {},
    activateVersion: async () => { assert.fail('Image-only attestation must never reach activation'); },
    readActivation: async () => ({ active: false, operationId: operation, productId: 208 }),
    readActiveVersions: async () => [],
  };
  const adapter = createCatalogueBundleAdapter({ baseUrl: 'https://bundle.test/api', token: 'fixture-token', local, fetcher });
  return { calls, product, checkpointSteps, readJob: () => job, adapter,
    run: () => publisher.publishCatalogueProductVersion(request, adapter) };
}

(async () => {
  for (const checkpointed of [false, true]) {
    const f = fixture({ checkpointed, rejectOrder: true });
    await assert.rejects(f.run, /image|order|readback|storage|digest/i);
    assert.deepEqual(f.product.images.map((image) => image.order), [2, 1, 0]);
    assert.equal(f.calls.some((call) => call.path.endsWith('/variants')), false,
      'The real publisher must not continue to variants after the real adapter rejects raw image-order readback');
    assert.equal(f.readJob().completedSteps.some((step) => step.name === 'images-resolved'), false,
      'Failed image ordering must never be checkpointed as independently resolved');
    assert.equal(f.checkpointSteps.some((steps) => steps.includes('images-resolved')), false);
    const readback = (await f.adapter.readProduct(208)).data;
    assert.deepEqual(readback.images.map((image) => image.order), [2, 1, 0],
      'Composed metadata must preserve actual provider order after an adapter failure');
  }
  // A lost PATCH response is recoverable only if raw provider order really
  // changed. Durable mappings alone must never manufacture that evidence.
  for (const loseOrderResponse of [false, true]) {
    const f = fixture({ checkpointed: true, loseOrderResponse });
    await assert.rejects(f.run, /option|compiled|variant/i);
    assert.deepEqual(f.product.images.map((image) => image.order), [0, 1, 2]);
    assert.equal(f.readJob().completedSteps.some((step) => step.name === 'images-resolved'), true);
    assert.equal(f.calls.some((call) => call.path.endsWith('/variants')), true,
      'Positive raw order attestation permits the real publisher to reach the variant boundary');
    assert.equal(f.product.images.length, 3, 'Image recovery never appends duplicate images');
  }
  console.log('Integrated catalogue image-order attestation check passed (real publisher + real adapter, 4 boundary cases)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
