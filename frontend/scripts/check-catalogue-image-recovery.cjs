const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const ts = require('typescript');

const file = path.join(process.cwd(), 'src/lib/admin/catalogueBundleAdapter.server.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const moduleFixture = { exports: {} };
new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
  moduleFixture.exports, require, moduleFixture, file, path.dirname(file),
);
const { createCatalogueBundleAdapter } = moduleFixture.exports;

const S3 = 'oss-bucket.s3.us-east-2.amazonaws.com';
const operationId = 'afd350cf4a74724fc7ed9e33684e8df0ac18b8845bff094c314d0b133ac9ae5c';
const catalogueId = 'cf764a8a-0688-4423-a549-ea2a64b057e5';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

// Real, independently generated 1 x 1 RGBA PNGs: proper CRCs and compressed IDAT.
// Different bytes make recovery depend on image content, not names or array order.
function png(r, g, b) {
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(name, body) {
    const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(body.length); crc.writeUInt32BE(crc32(Buffer.concat([type, body])));
    return Buffer.concat([length, type, body, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const bodies = [png(0, 0, 0), png(255, 255, 255), png(69, 128, 200)];
const mediaIds = [
  'efa16b82-5469-412e-a243-c410923fb10b',
  '8c11c2c7-934a-4ed2-8f90-2917571436c6',
  '68fc82df-6551-476c-802e-d50b0adb889f',
];
const names = ['front.png', 'back.png', 'lifestyle.png'];

function fixture(initial = [576, 577, 578]) {
  const f = {
    calls: [],
    media: mediaIds.map((mediaId, order) => ({
      mediaId, originalName: names[order], contentType: 'image/png', order, sha256: digest(bodies[order]),
    })),
    job: {
      operationId, catalogueId, draftBundleProductId: 208, phase: 'building', revision: 6,
      resolved: { images: {}, options: {}, values: {}, variants: {} }, bindings: [],
    },
    product: {
      id: 208, title: 'Pre-Order ACTION Shirt BLK (RM69) ONLY RM59! [TW-afd350cf-a2]',
      description: `Pre-order description\n[[TW-CATALOGUE-DRAFT:${operationId}]]`,
      type: 'MERCHANDISE', price: 59, shippingCost: 0, weight: 0, isPreOrder: true,
      categories: [], tags: [], deletedAt: null, options: [], productVariants: [], images: [],
    },
    imageBodies: new Map(), responseOverrides: new Map(), nextId: 582,
    losePutResponse: false, failReadAfterPut: false, pendingReadFailure: false,
    loseOrderResponse: false, rejectOrder: false,
  };
  f.addImage = (id, bodyIndex, order = bodyIndex, url = `https://${S3}/${id}.png`) => {
    f.product.images.push({ id, productId: 208, url, order });
    f.imageBodies.set(url, bodies[bodyIndex]);
  };
  initial.forEach((id, index) => f.addImage(id, index % 3, index));
  f.request = (index = 0) => ({
    key: f.media[index].mediaId, name: f.media[index].originalName,
    contentType: f.media[index].contentType, order: f.media[index].order,
    sha256: f.media[index].sha256, body: bodies[index], operationId,
  });
  const local = {
    readPublication: async id => id === operationId ? structuredClone(f.job) : null,
    readProductPublication: async () => structuredClone(f.job),
    readMedia: async () => structuredClone(f.media),
    hideOptionValues: async () => { throw Error('Image recovery must not create or hide variants'); },
    activateVersion: async () => { throw Error('Image recovery must not activate a product'); },
    readActivation: async () => null, readActiveVersions: async () => [],
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    f.calls.push({ method, url: String(url), headers: new Headers(init.headers), redirect: init.redirect });
    if (url.hostname !== 'bundle.test') {
      assert.equal(method, 'GET', 'Image reads must not send mutations to storage');
      assert.equal(new Headers(init.headers).has('authorization'), false, 'Admin token must never reach storage');
      assert.equal(new Headers(init.headers).has('cookie'), false, 'Admin cookies must never reach storage');
      assert.equal(init.redirect, 'error', 'Remote image redirects must not be followed');
      const override = f.responseOverrides.get(String(url));
      if (override) return override();
      const bytes = f.imageBodies.get(String(url));
      if (!bytes) return new Response('Not found', { status: 404 });
      return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
    }
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-admin-token');
    if (url.pathname === '/api/products/208' && method === 'GET') {
      if (f.pendingReadFailure) { f.pendingReadFailure = false; throw Error('Read response was lost'); }
      return json(structuredClone(f.product));
    }
    if (url.pathname === '/api/products/208' && method === 'PUT') {
      assert(init.body instanceof FormData);
      const image = init.body.get('images');
      assert(image instanceof Blob, 'Recovery should only issue a PUT for an actually missing image');
      const id = f.nextId++, imageUrl = `https://${S3}/${id}.png`;
      const bytes = Buffer.from(await image.arrayBuffer());
      f.product.images.push({ id, productId: 208, url: imageUrl, order: f.product.images.length });
      f.imageBodies.set(imageUrl, bytes);
      if (f.losePutResponse) {
        f.losePutResponse = false;
        if (f.failReadAfterPut) f.pendingReadFailure = true;
        throw Error('PUT committed but response was lost');
      }
      return json(structuredClone(f.product));
    }
    if (url.pathname === '/api/products/208/images/order' && method === 'PATCH') {
      const payload = JSON.parse(init.body), images = Array.isArray(payload) ? payload : payload.images;
      assert.equal(images.length, f.product.images.length);
      assert.equal(new Set(images.map(image => image.id)).size, images.length);
      assert.deepEqual(images.map(image => image.order).sort((a, b) => a - b), images.map((_, index) => index));
      if (f.rejectOrder) throw Error('Order request rejected before committing');
      for (const image of images) {
        const raw = f.product.images.find(row => row.id === image.id);
        assert(raw, 'Every reordered image must belong to this product'); raw.order = image.order;
      }
      if (f.loseOrderResponse) { f.loseOrderResponse = false; throw Error('Order committed but response was lost'); }
      return json({ success: true });
    }
    throw Error(`Unexpected request ${method} ${url}`);
  };
  f.make = () => createCatalogueBundleAdapter({ baseUrl: 'https://bundle.test/api', token: 'fixture-admin-token', local, fetcher });
  f.puts = () => f.calls.filter(call => call.method === 'PUT');
  f.writes = () => f.calls.filter(call => call.method !== 'GET');
  f.storageReads = () => f.calls.filter(call => new URL(call.url).hostname !== 'bundle.test');
  return f;
}

async function noUpload(f, request = f.request(), pattern = /ambiguous|identity|digest|image|read|unavailable|limit|large|HTTPS|storage|publication/i) {
  await assert.rejects(() => f.make().uploadImage(208, request), pattern);
  assert.equal(f.puts().length, 0, 'Uncertain recovery must not append another image');
}

(async () => {
  // Exact production first-attempt shape: all three bytes committed; no image
  // checkpoint survived. Restart between every image; recover IDs, never append.
  {
    const f = fixture(), original = structuredClone(f.product);
    for (let index = 0; index < 3; index++) {
      const result = await f.make().uploadImage(208, f.request(index));
      assert.deepEqual(result, { imageId: 576 + index, sha256: f.media[index].sha256 });
    }
    assert.equal(f.puts().length, 0);
    assert.equal(f.product.images.length, 3);
    assert.deepEqual(f.product, original, 'Recovery must preserve product metadata and existing image identities');
    assert(f.storageReads().length >= 3, 'Content identity must be independently read from storage');
  }
  // Ordinary uploads retain durable identity across a process-style restart.
  {
    const f = fixture([]);
    for (let index = 0; index < 3; index++) {
      const result = await f.make().uploadImage(208, f.request(index));
      f.job.resolved.images[f.media[index].mediaId] = result.imageId;
    }
    assert.equal(f.puts().length, 3);
    for (let index = 0; index < 3; index++) {
      const result = await f.make().uploadImage(208, f.request(index));
      assert.equal(result.imageId, f.job.resolved.images[f.media[index].mediaId]);
    }
    assert.equal(f.puts().length, 3, 'A checkpointed image must not be uploaded again');
  }
  // Provider commit followed by a lost PUT response is reconciled immediately.
  {
    const f = fixture([]); f.losePutResponse = true;
    const result = await f.make().uploadImage(208, f.request());
    assert.equal(result.imageId, 582);
    assert.equal(f.puts().length, 1);
    assert.equal((await f.make().uploadImage(208, f.request())).imageId, 582);
    assert.equal(f.puts().length, 1, 'A later retry must reuse the committed image');
  }
  // If even the positive readback is unavailable, fail closed; the next fresh
  // attempt still recovers the committed image instead of sending a second PUT.
  {
    const f = fixture([]); f.losePutResponse = true; f.failReadAfterPut = true;
    await assert.rejects(() => f.make().uploadImage(208, f.request()), /image|read|Bundle|reconcil/i);
    assert.equal(f.puts().length, 1);
    const result = await f.make().uploadImage(208, f.request());
    assert.equal(result.imageId, 582); assert.equal(f.puts().length, 1);
  }
  // Current corrupted208 shape: two full sets with identical bytes. Never
  // guess which IDs are canonical, or append a third set while quarantined.
  {
    const f = fixture([576, 577, 578, 579, 580, 581]);
    await noUpload(f);
    assert.equal(f.product.images.length, 6);
  }
  // Order commit is a separate ambiguous-response boundary: a lost response
  // is harmless only if the subsequent real provider order proves the commit.
  for (const committed of [true, false]) {
    const f = fixture();
    for (let index = 0; index < 3; index++) {
      f.job.resolved.images[f.media[index].mediaId] = 576 + index;
      f.product.images[index].order = 2 - index;
    }
    if (committed) {
      f.loseOrderResponse = true;
      assert.equal((await f.make().uploadImage(208, f.request())).imageId, 576);
      assert.deepEqual(f.product.images.map(image => image.order), [0, 1, 2]);
    } else {
      f.rejectOrder = true;
      await assert.rejects(() => f.make().uploadImage(208, f.request()), /order|readback|verification/i);
      assert.deepEqual(f.product.images.map(image => image.order), [2, 1, 0]);
    }
    assert.equal(f.puts().length, 0);
  }
  // A durable mapping cannot legitimize extra copies of the same image bytes.
  {
    const f = fixture([576, 577, 578, 579, 580, 581]);
    for (let index = 0; index < 3; index++) f.job.resolved.images[f.media[index].mediaId] = 579 + index;
    await noUpload(f);
  }
  // Two desired files with the same digest have no safe identity without a
  // checkpoint. Names and array order are not provider identity evidence.
  {
    const f = fixture(); f.media[1].sha256 = f.media[0].sha256;
    f.imageBodies.set(f.product.images[1].url, bodies[0]);
    await noUpload(f);
  }
  // The expected provider ID must still contain the intended bytes.
  {
    const f = fixture(); f.job.resolved.images[f.media[0].mediaId] = 577;
    await noUpload(f);
  }
  {
    const f = fixture(); f.job.resolved.images[f.media[0].mediaId] = 999;
    await noUpload(f);
  }
  // An image already claimed by a different key is not a reusable identity.
  {
    const f = fixture(); f.job.resolved.images[f.media[1].mediaId] = 576;
    await noUpload(f);
  }
  // Unreadable unbound images prevent both a confident match and a confident
  // absence decision, even if another readable image appears to match.
  {
    const f = fixture(); f.imageBodies.delete(f.product.images[1].url);
    await noUpload(f);
  }
  // Readable but foreign bytes are not proof that the requested image is
  // safely absent. Do not append into a draft whose contents contradict its
  // source manifest, whether or not another image already matches the request.
  for (const hasRequestedImage of [false, true]) {
    const f = fixture([]);
    if (hasRequestedImage) f.addImage(576, 0, 0);
    f.addImage(999, 1, f.product.images.length);
    f.imageBodies.set(f.product.images.at(-1).url, png(255, 0, 128));
    await noUpload(f);
  }
  for (const url of [
    'http://oss-bucket.s3.us-east-2.amazonaws.com/front.png',
    'https://attacker.example/front.png',
    'https://oss-bucket.s3.us-east-2.amazonaws.com.attacker.example/front.png',
    'https://fixture:secret@oss-bucket.s3.us-east-2.amazonaws.com/front.png',
    'https://oss-bucket.s3.us-east-2.amazonaws.com:444/front.png',
    'https://oss-bucket.s3.us-east-2.amazonaws.com/front.png#not-an-image-identity',
  ]) {
    const f = fixture(); f.product.images[0].url = url;
    await noUpload(f);
    assert.equal(f.storageReads().some(call => call.url === url), false, 'Unsafe URLs must be rejected before fetching');
  }
  {
    const f = fixture(), url = f.product.images[0].url;
    f.responseOverrides.set(url, () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/file' } }));
    await noUpload(f);
  }
  {
    const f = fixture(), url = f.product.images[0].url;
    f.responseOverrides.set(url, () => new Response(new Uint8Array()));
    await noUpload(f);
  }
  // Enforce both declared and actual body limits; a missing content-length
  // cannot turn provider image inspection into an unbounded download.
  {
    const f = fixture(), url = f.product.images[0].url;
    f.responseOverrides.set(url, () => new Response(bodies[0], { headers: { 'content-length': String(10 * 1024 * 1024 + 1) } }));
    await noUpload(f);
  }
  {
    const f = fixture(), url = f.product.images[0].url;
    f.responseOverrides.set(url, () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(6 * 1024 * 1024));
      controller.enqueue(new Uint8Array(5 * 1024 * 1024)); controller.close();
    } })));
    await noUpload(f);
  }
  // Wrong or missing durable draft ownership must not trigger a provider write.
  {
    const f = fixture(); f.job.draftBundleProductId = 999;
    await noUpload(f); assert.equal(f.writes().length, 0);
  }
  {
    const f = fixture(); f.job = null;
    await noUpload(f); assert.equal(f.writes().length, 0);
  }
  {
    const f = fixture(); f.job.phase = 'complete';
    await noUpload(f); assert.equal(f.writes().length, 0);
  }
  {
    const f = fixture(); f.product.images[1].id = 576;
    await noUpload(f); assert.equal(f.writes().length, 0);
  }
  console.log('Catalogue image recovery regressions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
