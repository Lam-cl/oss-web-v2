'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = process.cwd();
function compile(rel, injected = {}) {
  const file = path.join(root, rel);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    module.exports,
    (id) => id in injected ? injected[id] : require(id),
    module,
    file,
    path.dirname(file),
  );
  return module.exports;
}

function product(id = 39) {
  const superlite = id === 39;
  return {
    id,
    name: superlite ? 'SUPERLITE SIM' : 'BIZ SIM',
    title: superlite ? 'SUPERLITE SIM' : 'BIZ SIM',
    slug: superlite ? 'superlite-sim' : 'biz-sim',
    type: 'MERCHANDISE', requiresSimAssignment: true, tracksInventory: true, deletedAt: null,
    price: superlite ? 10 : 128,
    images: [{ id: superlite ? 192 : 193, url: `https://media.test/${id}.png`, order: 0, sha256: 'a'.repeat(64) }],
    options: [{ id: superlite ? 36 : 37, name: 'Pack', values: [{ id: superlite ? 71 : 72, value: 'Standard', order: 0 }] }],
    productVariants: [{ id: superlite ? 106 : 107, productId: id, sku: superlite ? 'SIM-SUPERLITE' : 'SIM-BIZ', price: superlite ? 10 : 128, inventory: superlite ? 87 : 90 }],
  };
}

function memoryStore() {
  const jobs = new Map();
  const tails = new Map();
  return {
    async withProductLock(id, run) {
      const prior = tails.get(id) || Promise.resolve();
      const result = prior.then(run, run);
      tails.set(id, result.then(() => undefined, () => undefined));
      return result;
    },
    async read(id) { return jobs.has(id) ? structuredClone(jobs.get(id)) : null; },
    async create(job) { assert(!jobs.has(job.operationId)); jobs.set(job.operationId, { ...structuredClone(job), version: 1, revision: 1, phase: 'prepared', before: null, bindings: [], completedSteps: [], reconciledTimeouts: [], providerFingerprint: null, projectionActivated: false }); return structuredClone(jobs.get(job.operationId)); },
    async update(id, revision, mutate) { const current = jobs.get(id); assert.equal(current.revision, revision); const next = mutate(structuredClone(current)); next.revision++; jobs.set(id, next); return structuredClone(next); },
    seed(job) { jobs.set(job.operationId, structuredClone(job)); },
  };
}

function migrationHarness(migration,id,{failCreate=false,extraOnCreate=false,projectionTimeout=false,checkpointAfterProjection=false,variantErrors=[]}={}){
  const state=product(id),events=[];let nextValue=id===39?80:90,nextVariant=id===39?120:130,projectionMode='restore',timedOut=false;
  const baseStore=memoryStore();
  const store=checkpointAfterProjection?{...baseStore,async update(operationId,revision,mutate){const current=await baseStore.read(operationId),candidate=await mutate(structuredClone(current));if(candidate.projectionActivated&&!timedOut){timedOut=true;throw new Error('checkpoint after projection failed')}return baseStore.update(operationId,revision,()=>candidate)}}:baseStore;
  const deps={checkpoints:store,readProduct:async()=>structuredClone(state),
    updateOptionValues:async(_id,_optionId,change)=>{events.push('values');const known=new Set(state.options[0].values.map(value=>value.value));for(const value of change.values)if(!known.has(value.value))state.options[0].values.push({id:nextValue++,value:value.value,order:state.options[0].values.length})},
    createVariant:async(_id,_name,label)=>{events.push(`create:${label}`);if(failCreate)throw new Error('pre-activation create failure');const count=extraOnCreate?2:1;for(let index=0;index<count;index++){const variantId=nextVariant++;state.productVariants.push({id:variantId,productId:id,sku:`SIM-${id}-${label.replace(' ','-')}-${variantId}`,price:null,inventory:0})}},
    updateOption:async(_id,_optionId,change)=>{events.push(`option:${change.name}`);state.options[0].name=change.name},
    updateVariants:async(_id,rows)=>{events.push('stock');const error=variantErrors.shift();if(error)throw new Error(error);for(const change of rows){const found=state.productVariants.find(item=>item.id===change.id);if(found)Object.assign(found,change)}},
    synchronizeProjection:async change=>{events.push(`projection:${change.mode}`);projectionMode=change.mode;if(projectionTimeout&&change.mode==='activate'&&!timedOut){timedOut=true;throw new Error('commit then timeout')}},
    verifyProjection:async change=>{events.push(`verify:${change.mode}`);assert.equal(projectionMode,change.mode)},
  };
  return {state,events,deps,store,expectedFingerprint:migration.fingerprintSimToneVariantProduct(state)};
}

function seedPartial(migration,h,phase='provider-mutating',extra=false){
  const before=structuredClone(h.state),expectedFingerprint=migration.fingerprintSimToneVariantProduct(before),operationId=require('node:crypto').createHash('sha256').update(`{"expectedFingerprint":"${expectedFingerprint}","productId":39}`).digest('hex');
  h.state.options[0].values.push({id:156,value:'Tone Excel',order:1});
  h.state.productVariants[0].inventory=43;
  h.state.productVariants.push({id:209,productId:39,sku:'SUPER-TONE EXCEL',price:10,inventory:44});
  if(extra)h.state.productVariants.push({id:210,productId:39,sku:'AMBIGUOUS',price:10,inventory:0});
  h.store.seed({version:1,operationId,requestFingerprint:operationId,productId:39,revision:3,phase,before,bindings:[],completedSteps:['value:Tone Excel'],reconciledTimeouts:[],providerFingerprint:null,projectionActivated:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  return expectedFingerprint;
}

(async () => {
  const migration = compile('src/lib/admin/simVariantMigration.server.ts', {
    './simVariantMigrationStore.server': { defaultSimVariantMigrationStore: null },
    './productBundleState': { fingerprintBundleProduct: (value) => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex') },
  });
  assert.deepEqual(migration.SIM_TONE_VARIANT_PLAN[39].variants.map((row) => [row.label, row.inventory]), [['Tone Excel', 44], ['Tone Plus', 43]]);
  assert.deepEqual(migration.SIM_TONE_VARIANT_PLAN[40].variants.map((row) => [row.label, row.inventory]), [['Tone Excel', 45], ['Tone Plus', 45]]);

  const state = product(39), beforeImages = structuredClone(state.images), events = [];
  let nextValue = 80, nextVariant = 120;
  const deps = {
    checkpoints: memoryStore(),
    readProduct: async () => structuredClone(state),
    updateOptionValues: async (_id, optionId, change) => {
      events.push(['values', optionId, structuredClone(change)]);
      const existing = new Set(state.options[0].values.map((value) => value.value));
      for (const value of change.values) if (!existing.has(value.value)) state.options[0].values.push({ id: nextValue++, value: value.value, order: state.options[0].values.length });
    },
    updateOption: async (_id, optionId, change) => {
      events.push(['option', optionId, structuredClone(change)]);
      state.options[0].name = change.name;
    },
    createVariant: async (_id, optionName, label) => {
      events.push(['create', optionName, label]);
      state.productVariants.push({ id: nextVariant, productId: 39, sku: `SIM-SUPERLITE-${label === 'Tone Excel' ? 'EXCEL' : 'PLUS'}-${nextVariant}`, price: null, inventory: 0 });
      nextVariant++;
    },
    updateVariants: async (_id, rows) => {
      events.push(['variants', structuredClone(rows)]);
      for (const row of rows) Object.assign(state.productVariants.find((variant) => variant.id === row.id), row);
    },
    synchronizeProjection: async (change) => { events.push(['projection', structuredClone(change)]); },
    verifyProjection: async () => {},
  };
  const expectedFingerprint = migration.fingerprintSimToneVariantProduct(state);
  const dry = await migration.migrateSimToneVariants({ productId: 39, expectedFingerprint }, deps);
  assert.equal(dry.phase, 'dry-run');
  assert.deepEqual(events, []);

  const applied = await migration.migrateSimToneVariants({ productId: 39, expectedFingerprint, apply: true }, deps);
  assert.equal(applied.phase, 'complete');
  assert.deepEqual(applied.bindings.map((row) => [row.label, row.valueId, row.variantId]), [['Tone Excel', 80, 120], ['Tone Plus', 81, 121]]);
  assert.deepEqual(state.images, beforeImages, 'provider image IDs/URLs/digests/order must not change');
  assert.equal(state.productVariants.find((row) => row.id === 106).inventory, 0, 'legacy variant is preserved but unavailable');
  assert.deepEqual(state.productVariants.filter((row) => row.id !== 106).map((row) => [row.price, row.inventory]), [[10, 44], [10, 43]]);
  assert.equal(events.filter((event) => event[0] === 'projection').length, 1);
  const projection = events.find((event) => event[0] === 'projection')[1];
  assert.equal(projection.optionName, 'Variant');
  assert.deepEqual(projection.variants.map((row) => row.label), ['Tone Excel', 'Tone Plus']);
  assert.equal(projection.legacyVariantId, 106);

  const replayEvents = events.length;
  const replay = await migration.migrateSimToneVariants({ productId: 39, expectedFingerprint, apply: true }, deps);
  assert.equal(replay.phase, 'complete');
  assert.equal(events.length, replayEvents, 'terminal replay must be side-effect free');

  {const h=migrationHarness(migration,40);const result=await migration.migrateSimToneVariants({productId:40,expectedFingerprint:h.expectedFingerprint,apply:true},h.deps);assert.equal(result.phase,'complete');assert.deepEqual(h.state.productVariants.filter(item=>item.id!==107).map(item=>item.inventory),[45,45]);}
  {const h=migrationHarness(migration,39);h.state.productVariants[0].inventory=86;const fingerprint=migration.fingerprintSimToneVariantProduct(h.state);await assert.rejects(()=>migration.migrateSimToneVariants({productId:39,expectedFingerprint:fingerprint,apply:true},h.deps),/inventory 87/i);assert.deepEqual(h.events,[],'stock drift must fail before provider mutation');}
  {const h=migrationHarness(migration,39,{failCreate:true});await assert.rejects(()=>migration.migrateSimToneVariants({productId:39,expectedFingerprint:h.expectedFingerprint,apply:true},h.deps),/preserved and hidden|zeroed/i);assert.equal(h.events.includes('stock'),false,'compensation must not write variants when no generated variant exists and legacy is exact');assert.equal(h.events.some(event=>event==='projection:restore'),false,'pre-activation compensation must not call restore');const replayResult=await migration.migrateSimToneVariants({productId:39,expectedFingerprint:h.expectedFingerprint,apply:true},h.deps);assert.equal(replayResult.phase,'compensated');assert(h.events.includes('verify:restore'),'compensated replay verifies baseline projection');}
  {const h=migrationHarness(migration,39,{projectionTimeout:true});const result=await migration.migrateSimToneVariants({productId:39,expectedFingerprint:h.expectedFingerprint,apply:true},h.deps);assert(result.reconciledTimeouts.includes('projection-synced'));assert.equal(h.events.filter(event=>event==='projection:activate').length,2);}
  {const h=migrationHarness(migration,39,{extraOnCreate:true});await assert.rejects(()=>migration.migrateSimToneVariants({productId:39,expectedFingerprint:h.expectedFingerprint,apply:true},h.deps),/preserved and hidden|zeroed/i);assert(h.state.productVariants.filter(item=>item.id!==106).every(item=>item.inventory===0),'all ambiguous generated IDs are zeroed');assert.equal(h.state.options[0].name,'Pack');}
  {const h=migrationHarness(migration,39,{checkpointAfterProjection:true});await assert.rejects(()=>migration.migrateSimToneVariants({productId:39,expectedFingerprint:h.expectedFingerprint,apply:true},h.deps),/preserved and hidden|zeroed/i);assert(h.events.includes('projection:restore'),'checkpoint failure after activation compensates projection');assert.equal(h.state.productVariants.find(item=>item.id===106).inventory,87);}
  {const h=migrationHarness(migration,39),fingerprint=seedPartial(migration,h);const result=await migration.migrateSimToneVariants({productId:39,expectedFingerprint:fingerprint,apply:true},h.deps);assert.equal(result.phase,'complete');assert.deepEqual(result.bindings.map(x=>[x.label,x.variantId]),[['Tone Excel',209],['Tone Plus',120]]);assert.equal(h.events.includes('create:Tone Excel'),false,'retry must bind the committed provider identity instead of duplicating Tone Excel');assert.equal(h.events.filter(x=>x==='create:Tone Plus').length,1);}
  {const h=migrationHarness(migration,39),fingerprint=seedPartial(migration,h,'compensating');const result=await migration.migrateSimToneVariants({productId:39,expectedFingerprint:fingerprint,apply:true},h.deps);assert.equal(result.phase,'complete');assert.deepEqual(result.bindings.map(x=>x.variantId),[209,120]);assert.equal(h.events.includes('create:Tone Excel'),false,'compensating recovery must resume the unique additive state');}
  {const h=migrationHarness(migration,39),fingerprint=seedPartial(migration,h,'compensating',true);await assert.rejects(()=>migration.migrateSimToneVariants({productId:39,expectedFingerprint:fingerprint,apply:true},h.deps),/ambiguous|fail closed|recovery/i);assert.deepEqual(h.events,[],'ambiguous compensating recovery must not mutate provider state');}
  {const h=migrationHarness(migration,39),fingerprint=seedPartial(migration,h,'provider-mutating',true);await assert.rejects(()=>migration.migrateSimToneVariants({productId:39,expectedFingerprint:fingerprint,apply:true},h.deps),/ambiguous|fail closed|recovery/i);assert.deepEqual(h.events,[],'ambiguous ordinary retry must not enter compensation or mutate provider state');}
  {const h=migrationHarness(migration,39,{variantErrors:['original provider failure','compensation provider failure']});await assert.rejects(()=>migration.migrateSimToneVariants({productId:39,expectedFingerprint:h.expectedFingerprint,apply:true},h.deps),error=>/migration failed \(Final SIM variant structure.*\).*compensation failed \(compensation provider failure\)/i.test(error.message),'diagnostic must retain distinct original verification and compensation failures');}

  const cart = compile('src/store/cartStore.ts', {
    zustand: { create: () => () => ({}) },
    'zustand/middleware': { persist: (value) => value },
    '@/data/merchandise': {
      getMerchandiseVariantId: (candidate, option) => candidate.variantIds[option],
      getMerchandiseVariantInventory: (candidate, id) => candidate.variantInventoryById[id] || 0,
    },
  });
  const stale = [{ id: 'old', type: 'merchandise', productId: '39', bundleProductId: 39, bundleVariantId: 106, variant: 'Standard', name: 'SUPERLITE SIM', price: 10, quantity: 2, addedAt: '' }];
  const catalogue = [{ id: '39', apiProductId: 39, slug: 'superlite-sim', name: 'SUPERLITE SIM', description: '', price: 10, optionLabel: 'Variant', options: [{ name: 'Tone Excel', image: '/same.png' }, { name: 'Tone Plus', image: '/same.png' }], variantIds: { 'Tone Excel': 120, 'Tone Plus': 121 }, variantInventoryById: { 120: 44, 121: 43 }, minimumOrderQuantity: 2 }];
  const reconciled = cart.reconcileMerchandiseCartItems(stale, catalogue);
  assert.equal(reconciled[0].bundleVariantId, undefined);
  assert.equal(reconciled[0].variant, undefined);
  assert.equal(reconciled[0].selectionRequired, 'Variant selection required');
  const staleMerchandise = [{ id: 'badge', type: 'merchandise', productId: '79', bundleProductId: 79, bundleVariantId: 201, variant: 'Green', name: 'Button Badge', price: 5, quantity: 1, addedAt: '' }];
  const currentMerchandise = [{ id: '79', apiProductId: 79, slug: 'button-badge', name: 'Button Badge', description: '', price: 5, options: [{ name: 'Blue', image: '/blue.png' }, { name: 'Red', image: '/red.png' }], variantIds: { Blue: 202, Red: 203 }, variantInventoryById: { 202: 7, 203: 3 }, minimumOrderQuantity: 1 }];
  const staleMerchandiseResult = cart.reconcileMerchandiseCartItems(staleMerchandise, currentMerchandise)[0];
  assert.equal(staleMerchandiseResult.bundleVariantId, undefined, 'disappeared merchandise option must not silently substitute the first option');
  assert.equal(staleMerchandiseResult.variant, undefined);
  assert.equal(staleMerchandiseResult.selectionRequired, 'Variant selection required');
  const replacedProductCart = [{ id: 'versioned', type: 'merchandise', productId: 'catalogue-lanyard', bundleProductId: 23, bundleVariantId: 39, variant: 'Standard', name: 'Lanyard', price: 3, quantity: 1, addedAt: '' }];
  const replacementProduct = [{ id: 'catalogue-lanyard', apiProductId: 83, slug: 'lanyard', name: 'Lanyard', description: '', price: 3, options: [{ name: 'Standard', image: '/lanyard.png' }], variantIds: { Standard: 213 }, variantInventoryById: { 213: 7 }, minimumOrderQuantity: 1 }];
  const replacedProductResult = cart.reconcileMerchandiseCartItems(replacedProductCart, replacementProduct)[0];
  assert.equal(replacedProductResult.bundleVariantId, undefined, 'a same-label option on a replacement product version must not remap the stale variant');
  assert.equal(replacedProductResult.selectionRequired, 'Variant selection required');
  const currentProductResult = cart.reconcileMerchandiseCartItems([{ ...replacedProductCart[0], bundleProductId: 83, bundleVariantId: 213, selectionRequired: 'Variant selection required' }], replacementProduct)[0];
  assert.equal(currentProductResult.bundleVariantId, 213, 'an exact current product and variant binding remains selected');
  assert.equal(currentProductResult.selectionRequired, undefined);

  const editor = fs.readFileSync(path.join(root, 'src/components/merchandise/CartMerchandiseEditor.tsx'), 'utf8');
  assert.doesNotMatch(editor, /Math\.max\(\s*0,\s*(?:next\.options|product\.options)\.findIndex/s, 'missing selection must never become option index 0');
  assert.match(editor, /disabled=\{[^}]*optionIndex\s*<\s*0/s, 'Confirm must be disabled until a variant is explicitly selected');
  const cartPage = fs.readFileSync(path.join(root, 'src/app/cart/page.tsx'), 'utf8');
  assert.doesNotMatch(cartPage, /item\.variant\s*\|\|\s*['"]Standard['"]/, 'missing variant must not display as Standard');

  const fulfilment = compile('src/lib/admin/simAssignments.ts');
  const units = fulfilment.deriveSimUnits({ items: [{ id: 9, productId: 39, variantId:120, productName: 'SUPERLITE SIM', variantLabel: 'misleading Tone Plus text', quantity: 1 }] },{120:{label:'Tone Excel',productCode:'TWE'}});
  assert.match(units[0].label, /Tone Excel/);
  assert.doesNotMatch(units[0].label, /misleading|Tone Plus/);
  assert.doesNotMatch(units[0].label, /network/i);

  const assignmentUi=fs.readFileSync(path.join(root,'src/components/admin/SimRangeAssignment.tsx'),'utf8');
  assert.doesNotMatch(assignmentUi,/Network|explicitProductCode/i,'fulfilment must bind ordinary Variant by ID, not interpret text');
  const cli=fs.readFileSync(path.join(root,'scripts/migrate-sim-tone-variants.cjs'),'utf8');
  assert(cli.indexOf('updateOptionValues')<cli.indexOf('createVariant'),'adapter must expose confirmed value append before variant creation');
  assert.match(cli,/options\/\$\{optionId\}.*method: 'PUT'/s);
  assert.match(cli,/products\/\$\{productId\}\/variants.*method: 'POST'/s);

  for (const file of ['src/app/merchandise/[slug]/page.tsx', 'src/components/home/MerchandiseSection.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!/networkChoiceRequired|\^network\$/i.test(source), `${file} must not model Tone labels as networks`);
    assert(source.includes("optionLabel === 'Variant'"), `${file} must require explicit ordinary Variant selection`);
  }
  const checkout = fs.readFileSync(path.join(root, 'src/app/checkout/page.tsx'), 'utf8');
  assert(checkout.includes('selectionRequired'), 'checkout must block stale Standard carts');
  const route = fs.readFileSync(path.join(root, 'src/app/api/bundle/checkout/route.ts'), 'utf8');
  assert(route.includes('projectedVariants') && route.includes('legacyVariants'), 'checkout server must reject stale/wrong product+variant pairs across Catalogue and legacy merchandise');

  console.log('SIM Tone Excel/Tone Plus structural migration and application check passed');
})().catch((error) => { console.error(error); process.exit(1); });
