const test = require('node:test');
const assert = require('node:assert/strict');
const { validTripInput } = require('../src/trips');

test('accepts valid trips and all supported statuses', () => {
  for (const status of ['planned', 'active', 'completed', 'cancelled']) {
    assert.equal(validTripInput({ name: 'Coorg', startDate: '2025-01-01', endDate: '2025-01-03', budgetAmount: 0, status }), true);
  }
});

test('rejects missing names, invalid dates, reversed ranges, invalid budgets, and status', () => {
  assert.equal(validTripInput({ startDate: '2025-01-01', endDate: '2025-01-02' }), false);
  assert.equal(validTripInput({ name: 'Trip' }), false);
  assert.equal(validTripInput({ name: 'Trip', startDate: '2025-02-30', endDate: '2025-03-01' }), false);
  assert.equal(validTripInput({ name: 'Trip', startDate: '2025-02-02', endDate: '2025-02-01' }), false);
  assert.equal(validTripInput({ name: 'Trip', budgetAmount: -1 }), false);
  assert.equal(validTripInput({ name: 'Trip', status: 'unknown' }), false);
});

test('allows partial edits while retaining create validation', () => {
  assert.equal(validTripInput({ status: 'cancelled' }, true), true);
  assert.equal(validTripInput({ status: 'cancelled' }), false);
});
