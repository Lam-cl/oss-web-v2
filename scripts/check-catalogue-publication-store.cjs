const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');

const moduleFile = path.resolve('src/lib/admin/cataloguePublication.server.ts');
let durabilityLog = null;
function load() {
  const output = ts.transpileModule(fs.readFileSync(moduleFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const localRequire = request => request === 'node:fs/promises' ? {
    ...fsp,
    mkdir: async (...args) => { const result = await fsp.mkdir(...args); durabilityLog?.push(`mkdir:${args[0]}`); return result; },
    open: async (...args) => {
      const handle = await fsp.open(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === 'sync') return async () => { durabilityLog?.push(`sync:${args[0]}`); return target.sync(); };
        const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
      } });
    },
  } : require(request);
  const m = { exports: {} }; new Function('exports', 'require', 'module', '__filename', '__dirname', output)(m.exports, localRequire, m, moduleFile, path.dirname(moduleFile)); return m.exports;
}
const operationId = () => require('node:crypto').randomBytes(32).toString('hex');
const fingerprint = (char = 'a') => char.repeat(64);
const input = (overrides = {}) => ({ operationId: operationId(), catalogueId: randomUUID(), modelFingerprint64: fingerprint(), previousBundleProductId: null, ...overrides });
const step = (name, at) => ({ name, completedAt: at });
(async () => {
  const store = load();
  assert.deepEqual(Object.keys(store).sort(), ['createPublicationJob','readPublicationJob','updatePublicationJob']);
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tw-pub-store-'));
  try {
    const firstUseRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'tw-pub-first-use-'));
    const firstUseDirectory = path.join(firstUseRoot, 'root', 'catalogue-publications');
    durabilityLog = [];
    await store.createPublicationJob(input(), firstUseDirectory);
    assert.deepEqual(durabilityLog.slice(0, 4), [
      `mkdir:${path.join(firstUseRoot, 'root')}`,
      `sync:${firstUseRoot}`,
      `mkdir:${firstUseDirectory}`,
      `sync:${path.join(firstUseRoot, 'root')}`,
    ], 'each first-use directory entry must be fsynced in its parent immediately after mkdir');
    durabilityLog = null;
    await fsp.rm(firstUseRoot, { recursive: true, force: true });

    const created = await store.createPublicationJob(input(), directory);
    assert.equal(created.version, 1); assert.equal(created.revision, 1); assert.equal(created.phase, 'building');
    assert.deepEqual(created.completedSteps, []); assert.deepEqual(created.resolved, { options:{}, values:{}, images:{}, variants:{} }); assert.deepEqual(created.bindings, []);
    assert.equal(created.draftBundleProductId, null); assert.equal(created.resultFingerprint64, null);
    const file = path.join(directory, `${created.operationId}.json`);
    assert.equal((await fsp.stat(directory)).mode & 0o777, 0o700); assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);

    // Detached reads and updater inputs/results cannot mutate retained state.
    created.phase = 'complete';
    assert.equal((await store.readPublicationJob(created.operationId, directory)).phase, 'building');
    let retained;
    const updated = await store.updatePublicationJob(created.operationId, 1, j => { retained=j; j.draftBundleProductId=40; j.completedSteps=[step('draft-created',j.updatedAt)]; return j; }, directory);
    retained.phase='complete'; updated.phase='complete';
    assert.equal((await store.readPublicationJob(created.operationId, directory)).phase, 'building');
    assert.equal((await store.readPublicationJob(created.operationId, directory)).revision, 2);
    await assert.rejects(()=>store.updatePublicationJob(created.operationId,1,j=>j,directory),/revision.*conflict/i);

    // Monotonic phases, exact typed ordered steps, and impossible active/complete states.
    const now = new Date().toISOString(); const current = await store.readPublicationJob(created.operationId,directory);
    await assert.rejects(()=>store.updatePublicationJob(created.operationId,current.revision,j=>({...j,phase:'activated'}),directory),/phase|invariant|activated/i);
    await assert.rejects(()=>store.updatePublicationJob(created.operationId,current.revision,j=>({...j,completedSteps:[step('activated',now)]}),directory),/order|step|invariant/i);
    await assert.rejects(()=>store.updatePublicationJob(created.operationId,current.revision,j=>({...j,phase:'complete',resultFingerprint64:fingerprint('b')}),directory),/complete|phase|invariant/i);
    await assert.rejects(()=>store.updatePublicationJob(created.operationId,current.revision,j=>({...j,phase:'building',resolved:{...j.resolved,options:{'../x':3}}}),directory),/key|resolved|valid/i);
    const premature=['draft-created','images-resolved','options-resolved','variants-resolved','variants-normalized','bundle-published'].map(name=>step(name,current.updatedAt));
    await assert.rejects(()=>store.updatePublicationJob(created.operationId,current.revision,j=>({...j,completedSteps:premature}),directory),/phase|invariant/i);

    // Bindings are total over resolved variants and only reference resolved values.
    const bindingBase=j=>({...j,resolved:{options:{},values:{red:12},images:{},variants:{one:14}},bindings:[{valueKeys:['red'],variantId:14}]});
    await assert.rejects(()=>store.updatePublicationJob(current.operationId,current.revision,j=>({...bindingBase(j),bindings:[]}),directory),/every resolved variant|binding/i);
    await assert.rejects(()=>store.updatePublicationJob(current.operationId,current.revision,j=>({...bindingBase(j),bindings:[{valueKeys:['missing'],variantId:14}]}),directory),/binding/i);
    await assert.rejects(()=>store.updatePublicationJob(current.operationId,current.revision,j=>({...bindingBase(j),bindings:[{valueKeys:['toString'],variantId:14}]}),directory),/binding/i);
    await assert.rejects(()=>store.updatePublicationJob(current.operationId,current.revision,j=>({...bindingBase(j),resolved:{...bindingBase(j).resolved,variants:{one:14,two:15}}}),directory),/every resolved variant|binding/i);

    // A valid job can advance through uncertain reconciliation phases to complete, never backwards.
    let life = await store.createPublicationJob(input({ previousBundleProductId: 7 }), directory);
    life = await store.updatePublicationJob(life.operationId,life.revision,j=>({...j,draftBundleProductId:51,
      completedSteps:['draft-created','images-resolved','options-resolved','variants-resolved','variants-normalized'].map(name=>step(name,j.updatedAt)),
      resolved:{options:{colour:11},values:{red:12},images:{hero:13},variants:{'red-variant':14}},bindings:[{valueKeys:['red'],variantId:14}]}),directory);
    life = await store.updatePublicationJob(life.operationId,life.revision,j=>({...j,phase:'bundle-published',completedSteps:[...j.completedSteps,step('bundle-published',j.updatedAt)]}),directory);
    life = await store.updatePublicationJob(life.operationId,life.revision,j=>({...j,phase:'activation-uncertain'}),directory);
    life = await store.updatePublicationJob(life.operationId,life.revision,j=>({...j,phase:'activated',completedSteps:[...j.completedSteps,step('activated',j.updatedAt)]}),directory);
    life = await store.updatePublicationJob(life.operationId,life.revision,j=>({...j,phase:'retirement-uncertain'}),directory);
    life = await store.updatePublicationJob(life.operationId,life.revision,j=>({...j,phase:'previous-retired',completedSteps:[...j.completedSteps,step('previous-retired',j.updatedAt)]}),directory);
    life = await store.updatePublicationJob(life.operationId,life.revision,j=>({...j,phase:'complete',resultFingerprint64:fingerprint('c'),completedSteps:[...j.completedSteps,step('complete',j.updatedAt)]}),directory);
    assert.equal(life.phase,'complete'); assert.equal(life.revision,8);
    const replay = await store.updatePublicationJob(life.operationId,life.revision,j=>j,directory);
    assert.deepEqual(replay,life); assert.equal((await store.readPublicationJob(life.operationId,directory)).revision,8);
    await assert.rejects(()=>store.updatePublicationJob(life.operationId,life.revision,j=>({...j,resultFingerprint64:fingerprint('d')}),directory),/immutable/i);

    // Single-worker queue serializes operations; expectedRevision remains the CAS boundary.
    const race = await store.createPublicationJob(input(), directory);
    const changes = await Promise.allSettled([
      store.updatePublicationJob(race.operationId,1,async j=>{await new Promise(r=>setTimeout(r,30)); return {...j,draftBundleProductId:41,completedSteps:[step('draft-created',j.updatedAt)]}},directory),
      store.updatePublicationJob(race.operationId,1,j=>({...j,draftBundleProductId:42,completedSteps:[step('draft-created',j.updatedAt)]}),directory),
    ]);
    assert.deepEqual(changes.map(x=>x.status).sort(),['fulfilled','rejected']);
    assert.match(changes.find(x=>x.status==='rejected').reason.message,/revision.*conflict/i);
    assert.equal((await store.readPublicationJob(race.operationId,directory)).revision,2);

    // Traversal and all relevant symlink boundaries are rejected without following.
    await assert.rejects(()=>store.readPublicationJob('../etc/passwd',directory),/operation ID/i);
    const rootLink=`${directory}-link`; await fsp.symlink(directory,rootLink); await assert.rejects(()=>store.readPublicationJob(operationId(),rootLink),/symlink|safe/i); await fsp.unlink(rootLink);
    const outside=path.join(os.tmpdir(),`outside-${operationId()}`); await fsp.writeFile(outside,'untouched');
    const linkId=operationId(); await fsp.symlink(outside,path.join(directory,`${linkId}.json`)); await assert.rejects(()=>store.readPublicationJob(linkId,directory),/corrupt|symlink|safe/i); assert.equal(await fsp.readFile(outside,'utf8'),'untouched');
    const ancestor=path.join(os.tmpdir(),`ancestor-${operationId()}`); const real=path.join(os.tmpdir(),`real-${operationId()}`); await fsp.mkdir(real); await fsp.symlink(real,ancestor);
    await assert.rejects(()=>store.createPublicationJob(input(),path.join(ancestor,'catalogue-publications')),/ancestor|symlink|safe/i); await fsp.rm(ancestor); await fsp.rm(real,{recursive:true});

    // Collections and serialized records are bounded; malformed checkpoints are corruption errors.
    const hugeValues=Object.fromEntries(Array.from({length:10001},(_,i)=>[`v${i}`,i+1]));
    await assert.rejects(()=>store.updatePublicationJob(current.operationId,current.revision,j=>({...j,resolved:{...j.resolved,values:hugeValues}}),directory),/resolved|limit|invalid/i);
    const oversized=operationId(); await fsp.writeFile(path.join(directory,`${oversized}.json`),' '.repeat(1048577),{mode:0o600});
    await assert.rejects(()=>store.readPublicationJob(oversized,directory),/corrupt/i);

    // Temporary artifacts are cleaned after successful writes.
    const bad=operationId(); await fsp.writeFile(path.join(directory,`${bad}.json`),'{broken',{mode:0o600}); await assert.rejects(()=>store.readPublicationJob(bad,directory),/corrupt/i);
    assert.deepEqual((await fsp.readdir(directory)).filter(n=>n.endsWith('.tmp')),[]);
    let calls=0; const oldFetch=global.fetch; global.fetch=async()=>{calls++;}; await store.readPublicationJob(created.operationId,directory); global.fetch=oldFetch; assert.equal(calls,0);
    assert.doesNotMatch(fs.readFileSync(moduleFile,'utf8'),/\b(?:fetch|axios)\b/);
    console.log('Catalogue publication store check passed');
  } finally { await fsp.rm(directory,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exit(1)});
