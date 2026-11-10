const test = require('node:test');
const assert = require('node:assert/strict');
const { amountToCents, allocateExpenseSplits } = require('../src/expense-splits');

test('equal allocation keeps the existing cent distribution', () => {
  assert.deepEqual(allocateExpenseSplits(1000, [2, 3, 4]), [
    { personId: 2, cents: 334 },
    { personId: 3, cents: 333 },
    { personId: 4, cents: 333 },
  ]);
});

test('exact allocation persists each requested share in cents', () => {
  assert.deepEqual(allocateExpenseSplits(1001, [
    { personId: 2, amount: '5.01' },
    { personId: 3, amount: '5' },
  ], 'exact'), [
    { personId: 2, cents: 501 },
    { personId: 3, cents: 500 },
  ]);
});

test('exact allocation accepts zero shares and decimal precision to cents', () => {
  assert.equal(amountToCents('0'), 0);
  assert.equal(amountToCents('12.3'), 1230);
  assert.equal(amountToCents('0.01'), 1);
  assert.deepEqual(allocateExpenseSplits(100, [
    { personId: 2, amount: '1.00' },
    { personId: 3, amount: '0.00' },
  ], 'exact'), [
    { personId: 2, cents: 100 },
    { personId: 3, cents: 0 },
  ]);
});

test('exact allocation rejects under and over allocation', () => {
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, amount: '0.99' },
  ], 'exact'), /must equal/);
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, amount: '1.01' },
  ], 'exact'), /must equal/);
});

test('exact allocation rejects negative, excessive precision, and duplicate participants', () => {
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, amount: '-1.00' },
  ], 'exact'), /nonnegative/);
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, amount: '1.001' },
  ], 'exact'), /two decimals/);
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, amount: '0.50' },
    { personId: 2, amount: '0.50' },
  ], 'exact'), /unique/);
});
