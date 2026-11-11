const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeActivityQuery, activityTypeClause } = require('../src/group-activity');

test('activity query validates filters and pagination defaults', () => {
  assert.deepEqual(normalizeActivityQuery({}), { type: 'all', startDate: null, endDate: null, limit: 25, offset: 0 });
  assert.deepEqual(normalizeActivityQuery({ type: 'edit', startDate: '2026-02-01', endDate: '2026-02-28', limit: '10', offset: '20' }), { type: 'edit', startDate: '2026-02-01', endDate: '2026-02-28', limit: 10, offset: 20 });
  assert.throws(() => normalizeActivityQuery({ type: 'invalid' }), /activity type/);
  assert.throws(() => normalizeActivityQuery({ startDate: '2026-02-30' }), /YYYY-MM-DD/);
  assert.throws(() => normalizeActivityQuery({ startDate: '2026-03-02', endDate: '2026-03-01' }), /on or before/);
  assert.throws(() => normalizeActivityQuery({ limit: 101 }), /between 1 and 100/);
  assert.throws(() => normalizeActivityQuery({ offset: -1 }), /non-negative/);
});

test('activity type filters map to the intended event families', () => {
  assert.match(activityTypeClause('expense')[0], /expense_created.*expense_edited.*expense_deleted/);
  assert.match(activityTypeClause('settlement')[0], /settlement_recorded/);
  assert.match(activityTypeClause('trip')[0], /trip_created.*trip_updated.*trip_cancelled/);
  assert.match(activityTypeClause('edit')[0], /expense_edited.*trip_updated/);
  assert.match(activityTypeClause('delete')[0], /expense_deleted/);
  assert.equal(activityTypeClause('all'), null);
});
