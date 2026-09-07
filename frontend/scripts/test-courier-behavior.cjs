const assert = require('node:assert/strict');
const { callable } = require('./test-source-helpers.cjs');
module.exports = async function checkCourier() {
  const file = 'src/components/admin/OrderDrawer.tsx';
  const run = async (overrides = {}) => {
    const calls = [], errors = [], success = [], busy = [];
    const save = callable(file, 'saveCourier', {
      order: { id: 197, status: 'PAID' }, id: 197, courierId: '7', trackingNo: '  TW123  ',
      expectedDeliveryDate: '2026-09-10', metadata: null, couriers: [{ id: 7, name: 'Fixture Courier' }],
      detailState: { couriers: {status:'ready'}, metadata: {status:'ready'} },
      onError: value => errors.push(value), onSaved: value => success.push(value),
      setCourierBusy: value => busy.push(value), load: async () => {},
      adminFetch: async (url, init) => { calls.push({ url, method: init.method, body: JSON.parse(init.body) }); },
      ...overrides,
    });
    await save(); return { calls, errors, success, busy };
  };
  const saved = await run();
  assert.deepEqual(saved.calls, [
    { url: 'orders/197/status', method: 'PUT', body: { status: 'PAID', trackingCode: 'TW123', courierId: 7 } },
    { url: 'orders/197/fulfilment-metadata', method: 'PUT', body: { service: 'Fixture Courier', trackingNo: 'TW123', expectedDeliveryDate: '2026-09-10' } },
  ]);
  assert.deepEqual(saved.busy, [true, false]); assert.equal(saved.success.length, 1);
  for (const invalid of [{order:null}, {courierId:''}, {trackingNo:'  '}, {detailState:{couriers:{status:'loading'},metadata:{status:'ready'}}}, {detailState:{couriers:{status:'ready'},metadata:{status:'error'}}}]) {
    const result = await run(invalid); assert.equal(result.calls.length, 0); assert.equal(result.errors.length, 1);
  }
  assert.equal((await run({metadata:{courier:{expectedDeliveryDate:'2026-09-09'}}})).calls.length, 1, 'Existing courier metadata is not overwritten');
  assert.equal((await run({expectedDeliveryDate:''})).calls.length, 1);
  const failed = await run({adminFetch:async()=>{throw new Error('Provider unavailable');}});
  assert.equal(failed.success.length, 0); assert.equal(failed.errors.length, 1); assert.deepEqual(failed.busy,[true,false]);
};
