const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const originalLoad = Module._load;
Module._load = function(request, parent, main) {
  if (request === '@/lib/dataApiClient.server') return { remoteDocument: async () => ({ value: {
    rows: [
      { productCode: 'TWE', requestId: 1, requestDate: '30/09/2026 12:00', purchaserName: 'Ali', referralCode: 'TWE-12', simSerial: '12345678901', simPrefixId: '10' },
      { productCode: 'TWP', requestId: 2, requestDate: '01/10/2026 12:00', purchaserName: 'Lee', referralCode: 'TWP-33', simSerial: '98765432101', simPrefixId: '11' },
    ], refreshedAt: '2026-09-30T00:00:00Z', checks: { 'TWE:1': { status: 'confirmed', simSerial: 'other-serial', simPrefixId: '10', memberId: 'TWE-SECRET' } },
  } }) };
  return originalLoad.call(this, request, parent, main);
};
const { inspectOssRow, planLabel, listOssRequests } = require('../src/lib/admin/ossJourney.server.ts');
Module._load = originalLoad;
const row = { productCode: 'TWE', requestId: 1, simPrefixId: '10', simSerial: '12345678901', planName: 'SuperLITE' };
const prefixes = new Map([['893777701', '10']]);
const originalFetch = global.fetch;
async function run(status, member, expected) {
  global.fetch = async url => Response.json(String(url).includes('checksimtype') ? status : member);
  const result = await inspectOssRow(row, prefixes);
  assert.equal(result.status, expected);
  return result;
}
(async () => {
  const filtered = await listOssRequests({ productCode: 'TWP', search: 'Lee', page: 1, limit: 25 });
  assert.equal(filtered.meta.total, 1);
  assert.equal(filtered.data[0].requestId, 2);
  assert.equal((await listOssRequests({})).data[0].requestId, 2, 'DD/MM/YYYY dates sort chronologically');
  assert.equal((await listOssRequests({ productCode: 'TWE' })).data[0].check, null, 'changed serial hides old identity');
  assert.equal(planLabel({ ...row, planName: 'Lindung Biz' }), 'Preload BIZ');
  assert.equal(planLabel({ ...row, planName: 'Lindung Pro' }), 'Preload PRO');
  assert.equal(planLabel({ ...row, planName: 'SuperLITE with FU 35' }), 'Preload FU35');
  assert.equal((await run({ simStatus: '', msisdn: '' }, null, 'unknown')).memberId, undefined);
  assert.equal((await run({ simStatus: 'PENDING' }, null, 'processing')).msisdn, undefined);
  const member = { accountInfo: { memberID: 'TWE-123', simprefix: '10', simserial: row.simSerial }, mainPlanName: 'FU35' };
  const confirmed = await run({ simStatus: 'COMPLETED', msisdn: '60123456789', lastTransaction: '2026-09-30 12:34:56.0' }, member, 'confirmed');
  assert.equal(confirmed.memberId, 'TWE-123');
  assert.equal(confirmed.msisdn, '0123456789');
  assert.equal(confirmed.hqLastTransactionAt, '2026-09-30T04:34:56.000Z');
  assert.equal(planLabel(row, confirmed), 'Pelan aktif: FU35');
  const mismatch = await run({ simStatus: 'COMPLETED', msisdn: '60123456789' },
    { accountInfo: { ...member.accountInfo, simserial: '99999999999' } }, 'unknown');
  assert.equal(mismatch.memberId, undefined);
  console.log('OSS journey checks passed');
})().finally(() => { global.fetch = originalFetch; });
