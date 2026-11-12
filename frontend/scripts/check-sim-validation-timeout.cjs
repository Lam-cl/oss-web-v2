const assert = require('node:assert/strict');
const { callable, compile } = require('./test-source-helpers.cjs');

// Run the real UI handler and HTTP client with a virtual upstream clock.
// A 50-SIM response at 38 seconds must succeed, but 121 seconds must time out.
async function runValidation(elapsed, quantity = 50) {
  const patches = [];
  const errors = [];
  const messages = [];
  const requests = [];
  const { adminFetch } = compile('src/lib/admin/client.ts');
  const validate = callable('src/components/admin/SimRangeAssignment.tsx', 'validateLine', {
    adminFetch,
    orderId: 61,
    rangesFor: () => [{ id: 'range-1', prefixId: 20, startSerial: '82600421029', endSerial: String(8260042102 + quantity - 1) + '8' }],
    serialQuantity: callable('src/components/admin/SimRangeAssignment.tsx', 'serialQuantity', {}),
    data: { prefixOptions: [{ id: 20, prefix: '896016260' }] },
    setBusyItem: () => {},
    patchRange: (_item, _range, patch) => patches.push(patch),
    onError: message => errors.push(message),
    onSaved: message => messages.push(message),
  });
  global.fetch = async (url, init) => {
    assert.equal(url, '/admin-api/orders/61/sim-range-validation');
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).orderItemId, 111);
    const body = JSON.parse(init.body);
    requests.push(body);
    const delay = Array.isArray(elapsed) ? elapsed[requests.length - 1] : elapsed;
    if (delay >= init.signal.deadline) throw new DOMException('Timeout', 'TimeoutError');
    return Response.json({ quantity: Number(body.endSerial.slice(0, 10)) - Number(body.startSerial.slice(0, 10)) + 1, assignmentToken: `test-token-${requests.length}` });
  };
  await validate(111, 'TWE', quantity);
  return { patches, errors, messages, requests };
}

async function main() {
  const originalFetch = global.fetch;
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = milliseconds => ({ deadline: milliseconds });
  try {
    for (const elapsed of [38_000, 119_999]) {
      const result = await runValidation(elapsed);
      assert.deepEqual(result.errors, [], `Validation must survive a ${elapsed}ms upstream response`);
      assert.equal(result.patches.at(-1).status, 'valid');
      assert.deepEqual(result.patches.at(-1).tokens, ['test-token-1']);
      assert.equal(result.messages.length, 1);
    }
    const expired = await runValidation(120_001);
    assert.equal(expired.patches.at(-1).status, 'error');
    assert.match(expired.errors[0], /timed out/);
    const partial = await runValidation([38_000, 120_001], 201);
    assert.equal(partial.requests.length, 2, 'Stop after a failed batch; do not validate later batches');
    assert.equal(partial.patches.at(-1).status, 'error');
    assert.equal(partial.patches.some(patch => patch.status === 'valid'), false);
    assert.equal(partial.messages.length, 0);

    for (const [quantity, sizes] of [[100, [100]], [101, [100, 1]], [200, [100, 100]], [201, [100, 100, 1]]]) {
      const result = await runValidation(119_999, quantity);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.requests.map(body => Number(body.endSerial.slice(0, 10)) - Number(body.startSerial.slice(0, 10)) + 1), sizes);
      assert.equal(result.requests[0].startSerial, '82600421029');
      assert.equal(result.requests.at(-1).endSerial, String(8260042102 + quantity - 1) + '8');
      for (let index = 1; index < result.requests.length; index++) {
        assert.equal(Number(result.requests[index].startSerial.slice(0, 10)), Number(result.requests[index - 1].endSerial.slice(0, 10)) + 1);
      }
      const tokens = result.patches.at(-1).tokens;
      assert.equal(tokens.length, sizes.length);
      const saveRequests = [];
      const save = callable('src/components/admin/SimRangeAssignment.tsx', 'saveLine', {
        rangesFor: () => [{ status: 'valid', tokens }],
        adminFetch: async (url, init) => saveRequests.push({ url, body: JSON.parse(init.body) }),
        orderId: 61, setBusyItem: () => {}, setRangesByItem: () => {},
        onSaved: () => {}, onReload: async () => {}, onError: message => assert.fail(message),
      });
      await save(111);
      assert.deepEqual(saveRequests, [{ url: 'orders/61/sim-range-assignments', body: { tokens } }]);
    }

    const { adminFetch } = compile('src/lib/admin/client.ts');
    global.fetch = async (_url, init) => {
      if (20_001 >= init.signal.deadline) throw new DOMException('Timeout', 'TimeoutError');
      return Response.json({});
    };
    await assert.rejects(adminFetch('orders'), /timed out/);
    console.log('PASS: Each 100-SIM batch allows 120 seconds; all tokens reach Save SIM; other admin requests retain 20 seconds.');
  } finally {
    global.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
