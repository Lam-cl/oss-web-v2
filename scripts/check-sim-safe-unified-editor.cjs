const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'src/components/admin/UnifiedProductEditor.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/admin/UnifiedProductEditor.module.css'), 'utf8');
const products = fs.readFileSync(path.join(root, 'src/app/admin/products/page.tsx'), 'utf8');
const publishRoute = fs.readFileSync(path.join(root, 'src/app/api/admin/sim-products/[productId]/publish/route.ts'), 'utf8');
const publishAlias = fs.readFileSync(path.join(root, 'src/app/admin-api/sim-products/[productId]/publish/route.ts'), 'utf8');
const adoption = fs.readFileSync(path.join(root, 'src/lib/admin/catalogueAdoption.server.ts'), 'utf8');
const presentationSource = fs.readFileSync(path.join(root, 'src/app/admin/products/productPresentation.ts'), 'utf8');
const presentationOutput = ts.transpileModule(presentationSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const presentation = { exports: {} };
new Function('exports', 'require', 'module', presentationOutput)(presentation.exports, require, presentation);

function loadUnifiedProductEditor() {
  const file = path.join(root, 'src/components/admin/UnifiedProductEditor.tsx');
  const output = ts.transpileModule(editor, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const inert = new Proxy(() => null, { get: () => inert });
  const mocks = {
    react: inert,
    'react/jsx-runtime': { jsx: inert, jsxs: inert, Fragment: Symbol('Fragment') },
    '@/lib/admin/productEditor': { normalizeProductEditorSpec: inert },
    './UnifiedProductEditor.module.css': {},
  };
  mocks['@/lib/productDescription'] = (() => {
    const source = fs.readFileSync(path.join(root, 'src/lib/productDescription.ts'), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const child = { exports: {} };
    new Function('exports', 'require', 'module', js)(child.exports, require, child);
    return child.exports;
  })();
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, (id) => id in mocks ? mocks[id] : require(id), mod, file, path.dirname(file));
  return mod.exports;
}

function loadPublishRoute(form, counts) {
  const file = path.join(root, 'src/app/api/admin/sim-products/[productId]/publish/route.ts');
  const output = ts.transpileModule(publishRoute, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  class SimError extends Error { constructor(message, status = 422) { super(message); this.status = status; } }
  const mocks = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/admin/server': { getAdminSession: async () => ({ token: 'token' }), requestIsSameOrigin: () => true, safeError: (status, value = {}) => Response.json(value, { status }) },
    '@/lib/admin/simProductBundleAdapter.server': { SimProductBundleAdapterError: SimError, createSimProductBundleAdapter: () => { counts.adapters += 1; return {}; } },
    '@/lib/admin/simProductUpdate.server': { SimProductUpdateError: SimError, updateSimProductInPlace: async request => { counts.updates += 1; return { phase: 'complete', request }; } },
    '@/lib/admin/catalogueMediaRoute.server': { readBoundedCatalogueMediaForm: async () => form, catalogueMediaRequestError: () => Response.json({}, { status: 400 }) },
    '@/lib/admin/simPublicationEvidence.server': { recordSimPublicationEvidence: async () => ({}) },
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, id => id in mocks ? mocks[id] : require(id), mod, file, path.dirname(file));
  return mod.exports;
}

assert.match(editor, /managementDomain\?:\s*'SIM'\s*\|\s*string/, 'editor accepts a management domain');
assert.match(editor, /minimumOrderQuantity\?:\s*number/, 'editor accepts the authoritative MOQ');
assert.match(editor, /lockedFields\?:\s*string\[\]/, 'editor accepts backend locked fields');
assert.match(editor, /saveMode\?:\s*'product'\s*\|\s*'sim'\s*\|\s*'local-draft'/, 'editor has explicit save policy modes');
assert.match(editor, /managementDomain\s*===\s*'SIM'/, 'SIM behavior depends on explicit domain metadata');
assert.match(editor, /Managed by SIM workflow/, 'SIM editor clearly identifies its owner');
assert.match(editor, /Save SIM changes/, 'capable SIM records have a dedicated save label');
assert.match(editor, /Save local draft/, 'incapable SIM records save only a local draft');
assert.match(editor, /saved to this catalogue draft only/i, 'local draft state is explained plainly');
assert.match(editor, /Product name[\s\S]*?lockedValue/, 'SIM product name is rendered as locked text');
assert.match(editor, /Category[\s\S]*?lockedValue/, 'SIM category is rendered as locked text');
assert.match(editor, /simManaged[\s\S]*?lockedChoices/, 'SIM choices use a non-editable summary');
assert.match(editor, /simManaged\s*\?\s*<label>Variant Price \(RM\)[\s\S]*?:\s*<details className=\{styles\.cellAdvanced\}/, 'SIM matrix exposes price without Product Code controls');
assert.match(editor, /combination\.valueKeys\.length === 0[\s\S]*?\? simManaged \? null : <label className=\{styles\.standardSku\}/, 'SIM standard products never expose Product Code controls');
assert.match(editor, /assignment:\s*'all'\s+as const/, 'new photos remain General by construction');
assert.match(editor, /Current General image[\s\S]*?locked/i, 'SIM image is presented as current and locked');
assert.doesNotMatch(editor, /simManaged \? 'Add General photo'/, 'SIM editor does not offer image upload');
assert.match(editor, /simManaged \? null : <label className=\{styles\.photoUpload\}/, 'SIM editor hides generic photo upload controls');
assert.match(editor, /<NumericInput[\s\S]*?updateBasePrice/, 'SIM-safe editor retains real numeric price interaction');
assert.match(editor, /<NumericInput[\s\S]*?inventory/, 'SIM-safe editor retains real numeric inventory interaction');

assert.match(products, /managementDomain\?:\s*'SIM'\s*\|\s*string/, 'catalogue record accepts SIM management metadata');
assert.match(products, /minimumOrderQuantity\?:\s*number/, 'catalogue record accepts MOQ metadata');
assert.match(products, /lockedFields\?:\s*string\[\]/, 'catalogue record accepts locked fields metadata');
assert.match(products, /capabilities\?:\s*\{\s*saveSimChanges\?:\s*boolean\s*\}/, 'catalogue record accepts explicit SIM-save capability');
assert.match(products, /saveMode=\{catalogueProduct\.managementDomain === 'SIM'[\s\S]*?saveSimChanges/, 'legacy dedicated capability remains backward-compatible');
assert.deepEqual(presentation.exports.publicationActionPresentation({ state: 'dirty', localDraft: false, simManaged: true }), { visible: true, label: 'Publish changes', disabledReason: null }, 'SIM Card rows expose the ordinary publish action');
assert.equal(presentation.exports.genericCatalogueLifecycleAllowed(true), true, 'SIM Card rows expose ordinary Unpublish and Archive actions');
assert.equal(presentation.exports.genericCatalogueLifecycleAllowed(false), true, 'merchandise rows retain generic lifecycle actions');
assert.doesNotMatch(products, /<small>Managed by SIM workflow<\/small>/, 'SIM Card rows are presented as ordinary catalogue products');
assert.match(publishRoute, /keys\.includes\('image'\)[\s\S]*?locked read-only[\s\S]*?uploads are not allowed/i, 'dedicated route rejects image fields clearly');
assert.match(publishRoute, /const allowed=new Set\(\['expectedFingerprint','description','productDetails','price','variants'\]\)/, 'dedicated route accepts metadata plus the exact variant matrix only');
assert.doesNotMatch(publishRoute, /form\.get\('image'\)|file\.arrayBuffer|image:\s*\{/, 'dedicated route never reads or forwards an image');

for (const className of ['simBanner', 'lockedValue', 'lockedChoices', 'simManagedPhoto']) {
  assert.match(css, new RegExp(`\\.${className}\\b`), `${className} has responsive editor styling`);
}
assert.match(css, /@media \(max-width: 640px\)[\s\S]*?simBanner/, 'SIM state remains legible on mobile');

(async () => {
  const { publishSimProduct } = loadUnifiedProductEditor();
  assert.equal(typeof publishSimProduct, 'function', 'SIM publishing is exposed as executable request behavior');
  const intent = {
    spec: {
      details: { title: 'SUPERLITE SIM', category: 'SIM Card', description: 'Useful SIM\n\nProduct details:\n- Ready to use', price: 12.5 },
      choices: [{ key: 'variant', name: 'Variant', optionId: 36, values: [
        { key: 'tone-excel', label: 'Tone Excel', valueId: 80, retired: false },
        { key: 'tone-plus', label: 'Tone Plus', valueId: 81, retired: false },
      ] }],
      combinations: [
        { valueKeys: ['tone-excel'], variantId: 120, sku: 'SIM-SUPERLITE-EXCEL-120', price: 12.5, inventory: 44 },
        { valueKeys: ['tone-plus'], variantId: 121, sku: 'SIM-SUPERLITE-PLUS-121', price: 12.5, inventory: 43 },
      ],
      existingImages: [],
    },
    existingMedia: [{ mediaId: 'current', url: 'https://media.test/current.png', order: 0, assignment: 'all', remove: false }],
    pendingPhotos: [],
  };
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ fingerprint: 'b'.repeat(64) }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const result = await publishSimProduct({ currentBundleProductId: 39, providerFingerprint: 'a'.repeat(64) }, intent, fetcher);
  assert.equal(result.fingerprint, 'b'.repeat(64));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/admin-api/sim-products/39/publish');
  assert.match(publishAlias, /@\/app\/api\/admin\/sim-products\/\[productId\]\/publish\/route/, 'same-origin admin alias must re-export the local SIM publish route');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert(calls[0].init.body instanceof FormData);
  const form = calls[0].init.body;
  assert.deepEqual(Array.from(form.keys()).sort(), ['description','expectedFingerprint','price','productDetails','variants'].sort());
  assert.equal(form.get('expectedFingerprint'), 'a'.repeat(64));
  assert.equal(form.get('description'), 'Useful SIM');
  assert.equal(form.get('productDetails'), 'Ready to use');
  assert.equal(form.get('price'), '12.5');
  assert.deepEqual(JSON.parse(form.get('variants')), [
    { label: 'Tone Excel', valueId: 80, variantId: 120, sku: 'SIM-SUPERLITE-EXCEL-120', price: 12.5, inventory: 44 },
    { label: 'Tone Plus', valueId: 81, variantId: 121, sku: 'SIM-SUPERLITE-PLUS-121', price: 12.5, inventory: 43 },
  ]);
  assert.equal(form.has('image'), false, 'SIM save never submits an image');

  let genericCalls = 0;
  await assert.rejects(() => publishSimProduct({ currentBundleProductId: 40, providerFingerprint: 'a'.repeat(64) }, intent, async () => { genericCalls += 1; return new Response(); }), /identity|variant|same-ID/i);
  const image = new File([Uint8Array.from([137,80,78,71,13,10,26,10])], 'general.png', { type: 'image/png' });
  const callsBeforeUpload = calls.length;
  await assert.rejects(() => publishSimProduct({ currentBundleProductId: 39, providerFingerprint: 'a'.repeat(64) }, { ...intent, pendingPhotos: [{ key: 'new', file: image, order: 0, assignment: 'all' }] }, fetcher), /image.*locked|cannot.*image|read-only/i);
  assert.equal(calls.length, callsBeforeUpload, 'image upload is rejected before any request');
  assert.equal(genericCalls, 0, 'invalid identity never falls through to any request');
  assert.equal(calls.some(({ url }) => /catalogue-products|\/media/.test(url)), false, 'SIM save never calls generic Catalogue/media endpoints');

  const uploadForm = new FormData(); uploadForm.set('image', image);
  const rejectedCounts = { adapters: 0, updates: 0 }, rejectedRoute = loadPublishRoute(uploadForm, rejectedCounts);
  const rejectedResponse = await rejectedRoute.POST(new Request('https://admin.test/api', { method: 'POST' }), { params: { productId: '39' } });
  assert.equal(rejectedResponse.status, 400); assert.match((await rejectedResponse.json()).message, /locked read-only.*not allowed/i);
  assert.deepEqual(rejectedCounts, { adapters: 0, updates: 0 }, 'route rejects upload before adapter/provider mutation');

  const metadataForm = new FormData();
  for (const [key, value] of Object.entries({ expectedFingerprint:'a'.repeat(64), description:'After', productDetails:'Detail', price:'12.5', variants:JSON.stringify([
    { label:'Tone Excel', valueId:80, variantId:120, sku:'SIM-SUPERLITE-EXCEL-120', price:12.5, inventory:44 },
    { label:'Tone Plus', valueId:81, variantId:121, sku:'SIM-SUPERLITE-PLUS-121', price:12.5, inventory:43 },
  ]) })) metadataForm.set(key, value);
  const acceptedCounts = { adapters: 0, updates: 0 }, acceptedRoute = loadPublishRoute(metadataForm, acceptedCounts);
  const acceptedResponse = await acceptedRoute.POST(new Request('https://admin.test/api', { method: 'POST' }), { params: { productId: '39' } });
  assert.equal(acceptedResponse.status, 200); assert.deepEqual(acceptedCounts, { adapters: 1, updates: 1 }, 'route accepts metadata plus exact two-row SIM variant save');
  console.log('SIM-safe Unified Product Editor behavioral check passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
