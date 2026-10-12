const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const catalogueId = '00000000-0000-4000-8000-000000000001';
const mediaId = '00000000-0000-4000-8000-000000000002';
let locked = false, busy = false, denyAssignment = false, denyAuth = false;
let events = [];
const response = (value, status = 200) => Response.json(value, { status });

const policy = {
  catalogueMediaAuthError: async () => {
    events.push('auth');
    return denyAuth ? response({}, 401) : null;
  },
  isValidCatalogueMediaId: () => true,
  readCatalogueMediaProduct: async () => {
    assert.equal(locked, true, 'product must be read inside the mutation lock');
    events.push('product');
    return { product: { latestChoices: true }, error: null };
  },
  activeSimMediaMutationError: async product => {
    assert.equal(locked, true, 'SIM policy must run inside the mutation lock');
    assert.equal(product.latestChoices, true);
    events.push('policy');
    return null;
  },
  isActiveCatalogueMediaAssignment: product => {
    assert.equal(locked, true, 'assignment validation must run inside the mutation lock');
    assert.equal(product.latestChoices, true);
    events.push('assignment');
    return !denyAssignment;
  },
  catalogueMediaBadRequest: () => response({}, 400),
  catalogueMediaRequestError: reason => response({}, reason.message === 'busy' ? 409 : 500),
  publicCatalogueMedia: media => media,
  readBoundedCatalogueMediaForm: async () => {
    const file = new Blob(['image'], { type: 'image/png' });
    file.name = 'image.png';
    return new Map([['file', file], ['order', '0'], ['assignment', 'red']]);
  },
};

const mediaStore = {};
for (const name of [
  'addCatalogueMedia', 'updateCatalogueMedia', 'removeCatalogueMedia',
  'getCatalogueMediaRemoval', 'finalizeCatalogueMediaRemoval',
]) {
  mediaStore[name] = async () => {
    assert.equal(locked, true, `${name} must run inside the mutation lock`);
    events.push(`write:${name}`);
    return { mediaId, operationId: mediaId, status: 'committed' };
  };
}
mediaStore.listCatalogueMedia = async () => [];
mediaStore.readVerifiedCatalogueMedia = async () => ({});

const mutationLock = {
  withCatalogueMutationLock: async (id, action) => {
    assert.equal(id, catalogueId);
    events.push('acquire');
    if (busy) throw new Error('busy');
    assert.equal(locked, false, 'mutation lock must not be nested');
    locked = true;
    try { return await action(); }
    finally { events.push('release'); locked = false; }
  },
};
const adminRoute = {
  readBoundedCatalogueJson: async () => ({ mediaIds: [mediaId] }),
  catalogueAdminError: () => response({}, 500),
};

function loadRoute(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('exports', 'require', 'module', output)(loaded.exports, name => {
    if (name === 'next/server') return { NextResponse: { json: (value, init) => Response.json(value, init) } };
    if (name === '@/lib/admin/catalogueMedia.server') return mediaStore;
    if (name === '@/lib/admin/catalogueMediaRoute.server') return policy;
    if (name === '@/lib/admin/catalogueMutationLock.server') return mutationLock;
    if (name === '@/lib/admin/catalogueAdminRoute.server') return adminRoute;
    throw new Error(`Unexpected route dependency: ${name}`);
  }, loaded);
  return loaded.exports;
}

(async () => {
  const upload = loadRoute('src/app/api/admin/catalogue-products/[id]/media/route.ts');
  const item = loadRoute('src/app/api/admin/catalogue-products/[id]/media/[mediaId]/route.ts');
  const removal = loadRoute('src/app/api/admin/catalogue-products/[id]/media-removals/[operationId]/route.ts');
  const context = { params: { id: catalogueId, mediaId, operationId: mediaId } };
  const request = { json: async () => ({ assignment: 'red' }) };
  const cases = [
    ['upload', upload.POST, 'addCatalogueMedia', 201, true],
    ['update', item.PATCH, 'updateCatalogueMedia', 200, true],
    ['delete', item.DELETE, 'removeCatalogueMedia', 200, true],
    ['reconcile', removal.GET, 'getCatalogueMediaRemoval', 200, false],
    ['finalize', removal.POST, 'finalizeCatalogueMediaRemoval', 200, true],
  ];
  for (const [name, handler, operation, status, checksPolicy] of cases) {
    events = [];
    assert.equal((await handler(request, context)).status, status, name);
    const expected = ['auth', 'acquire', 'product'];
    if (checksPolicy) expected.push('policy');
    if (name === 'upload' || name === 'update') expected.push('assignment');
    expected.push(`write:${operation}`, 'release');
    assert.deepEqual(events, expected, `${name}: validation and mutation ordering`);

    busy = true;
    events = [];
    assert.equal((await handler(request, context)).status, 409, `${name}: busy response`);
    assert.deepEqual(events, ['auth', 'acquire'], `${name}: busy request must not read or mutate`);
    busy = false;

    denyAuth = true;
    events = [];
    assert.equal((await handler(request, context)).status, 401, `${name}: authentication`);
    assert.deepEqual(events, ['auth'], `${name}: unauthenticated request must not acquire lock`);
    denyAuth = false;
  }
  denyAssignment = true;
  for (const [name, handler] of [['upload', upload.POST], ['update', item.PATCH]]) {
    events = [];
    assert.equal((await handler(request, context)).status, 400, `${name}: latest invalid assignment`);
    assert.deepEqual(events, ['auth', 'acquire', 'product', 'policy', 'assignment', 'release']);
    assert.equal(locked, false, `${name}: validation rejection releases lock`);
  }
  console.log('Catalogue media mutation callback ordering, authentication, busy protection and latest assignment validation: PASS');
})().catch(reason => { console.error(reason); process.exitCode = 1; });
