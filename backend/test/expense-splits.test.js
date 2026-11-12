const test = require('node:test');
const assert = require('node:assert/strict');
const { amountToCents, allocateExpenseSplits, tryAmountToCents } = require('../src/expense-splits');

test('equal allocation keeps the existing cent distribution', () => {
  assert.deepEqual(allocateExpenseSplits(1000, [2, 3, 4]), [
    { personId: 2, cents: 334 },
    { personId: 3, cents: 333 },
    { personId: 4, cents: 333 },
  ]);
});

test('equal rupee splits conserve ₹100 and ₹999.99 across three, six, and seven people', () => {
  for (const [totalCents, people, expected] of [
    [10000, 3, [3334, 3333, 3333]],
    [10000, 6, [1667, 1667, 1667, 1667, 1666, 1666]],
    [99999, 7, [14286, 14286, 14286, 14286, 14285, 14285, 14285]],
  ]) {
    const allocations = allocateExpenseSplits(totalCents, Array.from({ length: people }, (_, index) => index + 1));
    assert.deepEqual(allocations.map(row => row.cents), expected);
    assert.equal(allocations.reduce((sum, row) => sum + row.cents, 0), totalCents);
  }
});

test('only selected participants receive allocations; excluded group members are omitted', () => {
  assert.deepEqual(allocateExpenseSplits(10000, [4, 9]), [
    { personId: 4, cents: 5000 },
    { personId: 9, cents: 5000 },
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

test('money input rejects negative values and precision finer than one paise', () => {
  for (const amount of [-1, '-0.01', 1.001, 1.0001, '10.999', '1.0001', '1e2', 'not-a-number', '', NaN, Infinity, -Infinity]) {
    assert.throws(() => amountToCents(amount));
    assert.equal(tryAmountToCents(amount), null);
  }
  for (const [amount, cents] of [[0.01, 1], [1, 100], [1.10, 110], ['1.10', 110], [999.99, 99999]]) {
    assert.equal(amountToCents(amount), cents);
    assert.equal(tryAmountToCents(amount), cents);
  }
});

test('percentage allocation accepts decimal percentages totaling exactly 100%', () => {
  assert.deepEqual(allocateExpenseSplits(10000, [
    { personId: 2, percentage: '33.34' },
    { personId: 3, percentage: '33.33' },
    { personId: 4, percentage: '33.33' },
  ], 'percentage'), [
    { personId: 2, cents: 3334 },
    { personId: 3, cents: 3333 },
    { personId: 4, cents: 3333 },
  ]);
});

test('percentage allocation rejects totals below and above 100%', () => {
  assert.throws(() => allocateExpenseSplits(10000, [
    { personId: 2, percentage: '49.99' },
    { personId: 3, percentage: '50' },
  ], 'percentage'), /exactly 100%/);
  assert.throws(() => allocateExpenseSplits(10000, [
    { personId: 2, percentage: '50.01' },
    { personId: 3, percentage: '50' },
  ], 'percentage'), /exactly 100%/);
});

test('percentage allocation allows zero percentages and preserves every cent', () => {
  assert.deepEqual(allocateExpenseSplits(100, [
    { personId: 2, percentage: '100' },
    { personId: 3, percentage: '0' },
  ], 'percentage'), [
    { personId: 2, cents: 100 },
    { personId: 3, cents: 0 },
  ]);
  assert.equal(allocateExpenseSplits(100, [
    { personId: 2, percentage: '33.34' },
    { personId: 3, percentage: '33.33' },
    { personId: 4, percentage: '33.33' },
  ], 'percentage').reduce((sum, share) => sum + share.cents, 0), 100);
});

test('percentage rounding is deterministic for 100 and 1 split among three participants', () => {
  const participants = [
    { personId: 2, percentage: '33.34' },
    { personId: 3, percentage: '33.33' },
    { personId: 4, percentage: '33.33' },
  ];
  assert.deepEqual(allocateExpenseSplits(10000, participants, 'percentage').map(share => share.cents), [3334, 3333, 3333]);
  assert.deepEqual(allocateExpenseSplits(100, participants, 'percentage').map(share => share.cents), [34, 33, 33]);
  assert.deepEqual(allocateExpenseSplits(1, [
    { personId: 2, percentage: '50' },
    { personId: 3, percentage: '50' },
  ], 'percentage').map(share => share.cents), [1, 0]);
});

test('percentage allocation rejects negative values, excessive precision, and duplicate participants', () => {
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, percentage: '-1' },
    { personId: 3, percentage: '101' },
  ], 'percentage'), /nonnegative/);
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, percentage: '50.001' },
    { personId: 3, percentage: '49.999' },
  ], 'percentage'), /two decimals/);
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, percentage: '50' },
    { personId: 2, percentage: '50' },
  ], 'percentage'), /unique/);
});

test('shares allocation distributes 2:1:1 proportionally', () => {
  assert.deepEqual(allocateExpenseSplits(1200, [
    { personId: 2, shares: 2 },
    { personId: 3, shares: 1 },
    { personId: 4, shares: 1 },
  ], 'shares'), [
    { personId: 2, cents: 600 },
    { personId: 3, cents: 300 },
    { personId: 4, cents: 300 },
  ]);
});

test('shares allocation splits 100 equally across 1:1:1 with deterministic cents', () => {
  assert.deepEqual(allocateExpenseSplits(10000, [
    { personId: 2, shares: 1 },
    { personId: 3, shares: 1 },
    { personId: 4, shares: 1 },
  ], 'shares'), [
    { personId: 2, cents: 3334 },
    { personId: 3, cents: 3333 },
    { personId: 4, cents: 3333 },
  ]);
});

test('shares allocation distributes 3:2:1 and conserves the expense total', () => {
  const allocations = allocateExpenseSplits(10000, [
    { personId: 2, shares: 3 },
    { personId: 3, shares: 2 },
    { personId: 4, shares: 1 },
  ], 'shares');
  assert.deepEqual(allocations.map(share => share.cents), [5000, 3333, 1667]);
  assert.equal(allocations.reduce((sum, share) => sum + share.cents, 0), 10000);
});

test('shares allocation deterministically gives a leftover cent to the earliest tied participant', () => {
  assert.deepEqual(allocateExpenseSplits(1, [
    { personId: 2, shares: 1 },
    { personId: 3, shares: 1 },
    { personId: 4, shares: 1 },
  ], 'shares').map(share => share.cents), [1, 0, 0]);
});

test('shares allocation rejects zero, negative, fractional, unsafe, and duplicate shares', () => {
  for (const invalidShares of [0, -1, 1.5, '1.5', '0', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => allocateExpenseSplits(100, [
      { personId: 2, shares: invalidShares },
    ], 'shares'), /share count/);
  }
  assert.throws(() => allocateExpenseSplits(100, [
    { personId: 2, shares: 1 },
    { personId: 2, shares: 1 },
  ], 'shares'), /unique/);
});
