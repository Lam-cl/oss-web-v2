import assert from 'node:assert/strict';
import test from 'node:test';
import { mapInOrder } from './cataloguePublicProjectionCore.ts';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('mapInOrder keeps input order when later items resolve first', async () => {
  const finished = [];
  const result = await mapInOrder([1, 2, 3, 4, 5], async (value) => {
    await delay((6 - value) * 5);
    finished.push(value);
    return `p${value}`;
  });
  assert.deepEqual(result, ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.deepEqual(finished, [5, 4, 3, 2, 1]);
});

test('mapInOrder drops null/undefined results like the skipped products of the old loop', async () => {
  const result = await mapInOrder(['a', 'skip', 'b', 'none', 'c'], async (value) => {
    if (value === 'skip') return null;
    if (value === 'none') return undefined;
    return value.toUpperCase();
  });
  assert.deepEqual(result, ['A', 'B', 'C']);
});

test('mapInOrder runs reads concurrently up to the limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const started = Date.now();
  await mapInOrder(Array.from({ length: 12 }, (_, index) => index), async () => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await delay(20);
    inFlight -= 1;
    return 1;
  }, 4);
  assert.equal(peak, 4);
  // 12 reads of 20 ms with 4 in flight: ~60 ms, far below the 240 ms sequential time.
  assert.ok(Date.now() - started < 200);
});

test('mapInOrder rejects with the read error and stops scheduling new reads', async () => {
  const started = [];
  await assert.rejects(
    mapInOrder([0, 1, 2, 3, 4, 5], async (value) => {
      started.push(value);
      await delay(5);
      if (value === 1) throw new Error('adoption read failed');
      return value;
    }, 2),
    /adoption read failed/,
  );
  assert.ok(!started.includes(5), `scheduled after failure: ${started}`);
});

test('mapInOrder handles an empty list', async () => {
  assert.deepEqual(await mapInOrder([], async () => 1), []);
});
