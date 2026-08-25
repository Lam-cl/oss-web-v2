import assert from 'node:assert/strict';
import { calculateCourierCharge } from '../src/lib/shipping';

const tShirtPlusTumbler = calculateCourierCharge([
  { name: 'Tone Wow T-shirt', quantity: 1 },
  { name: 'Tumbler 1180ml', quantity: 21 },
], 'Johor');

assert.equal(
  tShirtPlusTumbler.amount,
  20,
  'mixed cart must use the heaviest product category, not the largest category charge',
);
console.log('shipping hierarchy check passed');
