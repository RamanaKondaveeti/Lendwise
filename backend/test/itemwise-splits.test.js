const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateItemWiseSplits } = require('../src/expense-splits');

test('one item assigned to one participant is fully allocated to that participant', () => {
  const result = allocateItemWiseSplits(1250, [{
    itemName: 'Lunch', quantity: 1, unitPrice: '12.50', allocationMethod: 'equal', participants: [4],
  }]);
  assert.deepEqual(result.allocations, [{ personId: 4, cents: 1250 }]);
  assert.equal(result.items[0].totalCents, 1250);
});

test('a shared item uses deterministic equal allocation', () => {
  const result = allocateItemWiseSplits(100, [{
    itemName: 'Snack', quantity: 1, unitPrice: '1.00', allocationMethod: 'equal', participants: [4, 5, 6],
  }]);
  assert.deepEqual(result.items[0].allocations, [
    { personId: 4, cents: 34 }, { personId: 5, cents: 33 }, { personId: 6, cents: 33 },
  ]);
});

test('multiple items can go to different participants with mixed allocation methods', () => {
  const result = allocateItemWiseSplits(1800, [
    { itemName: 'Meal', quantity: 1, unitPrice: '12.00', allocationMethod: 'exact', participants: [
      { personId: 4, amount: '8.00' }, { personId: 5, amount: '4.00' },
    ] },
    { itemName: 'Drinks', quantity: 2, unitPrice: '3.00', allocationMethod: 'shares', participants: [
      { personId: 5, shares: 1 }, { personId: 6, shares: 1 },
    ] },
  ]);
  assert.deepEqual(result.allocations, [
    { personId: 4, cents: 800 }, { personId: 5, cents: 700 }, { personId: 6, cents: 300 },
  ]);
});

test('quantity greater than one multiplies the unit price in cents', () => {
  const result = allocateItemWiseSplits(375, [{
    itemName: 'Coffee', quantity: 3, unitPrice: '1.25', allocationMethod: 'equal', participants: [4],
  }]);
  assert.equal(result.items[0].totalCents, 375);
});

test('percentage allocations must total 100 percent for each item', () => {
  const input = [{ itemName: 'Meal', quantity: 1, unitPrice: '10.00', allocationMethod: 'percentage', participants: [
    { personId: 4, percentage: '50' }, { personId: 5, percentage: '50' },
  ] }];
  assert.deepEqual(allocateItemWiseSplits(1000, input).items[0].allocations.map(row => row.cents), [500, 500]);
  input[0].participants[1].percentage = '49';
  assert.throws(() => allocateItemWiseSplits(1000, input), /exactly 100%/);
});

test('exact allocations must equal the item total', () => {
  const input = [{ itemName: 'Meal', quantity: 1, unitPrice: '10.00', allocationMethod: 'exact', participants: [
    { personId: 4, amount: '5.00' }, { personId: 5, amount: '5.00' },
  ] }];
  assert.equal(allocateItemWiseSplits(1000, input).allocations.reduce((sum, row) => sum + row.cents, 0), 1000);
  input[0].participants[1].amount = '4.99';
  assert.throws(() => allocateItemWiseSplits(1000, input), /must equal/);
});

test('share counts must be positive and distribute rounding deterministically', () => {
  const input = [{ itemName: 'Candy', quantity: 1, unitPrice: '0.01', allocationMethod: 'shares', participants: [
    { personId: 4, shares: 1 }, { personId: 5, shares: 1 }, { personId: 6, shares: 1 },
  ] }];
  assert.deepEqual(allocateItemWiseSplits(1, input).items[0].allocations.map(row => row.cents), [1, 0, 0]);
  input[0].participants[1].shares = 0;
  assert.throws(() => allocateItemWiseSplits(1, input), /greater than zero/);
});

test('invalid participants and item totals are rejected', () => {
  const item = { itemName: 'Meal', quantity: 1, unitPrice: '10.00', allocationMethod: 'equal', participants: [4] };
  assert.throws(() => allocateItemWiseSplits(999, [item]), /Item totals must equal/);
  assert.throws(() => allocateItemWiseSplits(1000, [{ ...item, itemName: ' ' }]), /needs a name/);
  assert.throws(() => allocateItemWiseSplits(1000, [{ ...item, quantity: 0 }]), /quantity must be greater than zero/);
  assert.throws(() => allocateItemWiseSplits(1000, [{ ...item, unitPrice: '-1' }]), /nonnegative/);
  assert.throws(() => allocateItemWiseSplits(1000, [{ ...item, participants: [4, 4] }]), /unique/);
});
