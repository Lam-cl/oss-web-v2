import assert from 'node:assert/strict';
import test from 'node:test';

// Each test imports a fresh module instance (query string busts the ESM cache)
// so the in-memory queue starts empty.
let instance = 0;
async function freshSmartech() {
  instance += 1;
  return import(`./smartech.ts?instance=${instance}`);
}

function recorder() {
  const calls = [];
  const fn = (...args) => { calls.push(args); };
  return { calls, fn };
}

test.afterEach(() => {
  delete globalThis.window;
});

test('does nothing on the server (no window)', async () => {
  const lib = await freshSmartech();
  assert.doesNotThrow(() => lib.smartechDispatch('product View', { prid: 1 }));
  assert.doesNotThrow(() => lib.flushSmartechQueue());
  const { calls, fn } = recorder();
  globalThis.window = { smartech: fn };
  lib.flushSmartechQueue();
  assert.deepEqual(calls, []);
});

test('queues calls while window.smartech is absent and flushes them in order', async () => {
  const lib = await freshSmartech();
  globalThis.window = {};
  lib.smartechContact('23', { email: 'a@example.com' });
  lib.smartechIdentify('900101015555');
  lib.smartechDispatch('add to cart', { prid: 7 });

  const { calls, fn } = recorder();
  globalThis.window.smartech = fn;
  assert.deepEqual(calls, [], 'nothing sent before flush');

  lib.flushSmartechQueue();
  assert.deepEqual(calls, [
    ['contact', '23', { email: 'a@example.com' }],
    ['identify', '900101015555'],
    ['dispatch', 'add to cart', { prid: 7 }],
  ]);

  lib.flushSmartechQueue();
  assert.equal(calls.length, 3, 'queue is emptied after flush');
});

test('a track call after load flushes the backlog before sending itself', async () => {
  const lib = await freshSmartech();
  globalThis.window = {};
  lib.smartechDispatch('product View', { prid: 1 });

  const { calls, fn } = recorder();
  globalThis.window.smartech = fn;
  lib.smartechDispatch('checkout', { amount: 10 });
  assert.deepEqual(calls, [
    ['dispatch', 'product View', { prid: 1 }],
    ['dispatch', 'checkout', { amount: 10 }],
  ]);
});

test('caps the queue, keeping the earliest calls', async () => {
  const lib = await freshSmartech();
  globalThis.window = {};
  for (let i = 0; i < lib.SMARTECH_QUEUE_LIMIT + 25; i += 1) {
    lib.smartechDispatch('event', { i });
  }

  const { calls, fn } = recorder();
  globalThis.window.smartech = fn;
  lib.flushSmartechQueue();
  assert.equal(calls.length, lib.SMARTECH_QUEUE_LIMIT);
  assert.deepEqual(calls[0], ['dispatch', 'event', { i: 0 }]);
  assert.deepEqual(calls.at(-1), ['dispatch', 'event', { i: lib.SMARTECH_QUEUE_LIMIT - 1 }]);
});
