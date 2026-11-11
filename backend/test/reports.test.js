const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildExpenseReportFilter,
  buildSettlementReportFilter,
  isValidReportDate,
} = require('../src/reports');

test('validates calendar dates, including leap days', () => {
  assert.equal(isValidReportDate(null), true);
  assert.equal(isValidReportDate('2024-02-29'), true);
  assert.equal(isValidReportDate('2025-02-29'), false);
  assert.equal(isValidReportDate('2025-2-01'), false);
});

test('expense report filters are workspace-scoped and include selected date, group, member, and category', () => {
  const filter = buildExpenseReportFilter({
    workspaceId: 4,
    groupId: 11,
    memberId: 8,
    category: 'Food & Dining',
    startDate: '2025-01-01',
    endDate: '2025-01-31',
  });
  assert.match(filter.where, /g\.workspace_id = \?/);
  assert.match(filter.where, /e\.voided_at IS NULL/);
  assert.match(filter.where, /e\.group_id = \?/);
  assert.match(filter.where, /e\.category = \?/);
  assert.match(filter.where, /e\.created_at >= \?/);
  assert.match(filter.where, /e\.created_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.match(filter.where, /member_split/);
  assert.deepEqual(filter.parameters, [
    4, 11, 'Food & Dining', '2025-01-01 00:00:00', '2025-01-31', 8, 8,
  ]);
});

test('expense reports exclude voided expenses while audit retrieval remains opt-in on the expenses API', () => {
  const filter = buildExpenseReportFilter({
    workspaceId: 4, groupId: null, memberId: null, category: null, startDate: null, endDate: null,
  });
  assert.match(filter.where, /e\.voided_at IS NULL/);
});

test('settlement filters include workspace-only settlements and use inclusive end dates', () => {
  const filter = buildSettlementReportFilter({
    workspaceId: 5,
    groupId: null,
    memberId: 2,
    startDate: null,
    endDate: '2025-06-30',
  });
  assert.match(filter.where, /payer\.workspace_id = \? AND payee\.workspace_id = \?/);
  assert.match(filter.where, /st\.payer_id = \? OR st\.payee_id = \?/);
  assert.match(filter.where, /DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.deepEqual(filter.parameters, [5, 5, 2, 2, '2025-06-30']);
});

test('rejects reversed date ranges and invalid filter IDs', () => {
  assert.throws(() => buildExpenseReportFilter({
    workspaceId: 1,
    groupId: null,
    memberId: null,
    category: null,
    startDate: '2025-03-01',
    endDate: '2025-02-28',
  }), /Invalid report filters/);
  assert.throws(() => buildSettlementReportFilter({
    workspaceId: 0,
    groupId: 1,
    memberId: null,
    startDate: null,
    endDate: null,
  }), /Invalid report filters/);
});
