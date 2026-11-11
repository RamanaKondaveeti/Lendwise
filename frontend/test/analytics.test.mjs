import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateMonthlyAnalytics } from '../src/analytics.mjs'

const expense = (id, createdAt, amount, groupId, category, shares = []) => ({
  id,
  created_at: createdAt,
  amount,
  group_id: groupId,
  category,
  shares,
})

test('uses recorded split amounts for the user share and applies group/category filters', () => {
  const records = [
    expense(1, '2025-02-10T12:00:00Z', 30, 7, 'Groceries', [
      { person_id: 3, amount: 17.5 },
      { person_id: 4, amount: 12.5 },
    ]),
    expense(2, '2025-02-11T12:00:00Z', 80, 7, 'Travel', [
      { person_id: 3, amount: 20 },
    ]),
    expense(3, '2025-02-12T12:00:00Z', 50, 8, 'Groceries', [
      { person_id: 3, amount: 15 },
    ]),
  ]

  const result = calculateMonthlyAnalytics(records, 3, '2025-02', 7, 'Groceries')

  assert.equal(result.total, 30)
  assert.equal(result.personalShare, 17.5)
  assert.deepEqual(result.categoryTotals, [{ name: 'Groceries', amount: 30 }])
})

test('compares with the previous month and builds actual monthly totals for the selected year', () => {
  const records = [
    expense(1, '2024-12-20T12:00:00Z', 10, 7, 'Food & Dining'),
    expense(2, '2025-01-20T12:00:00Z', 20, 7, 'Food & Dining'),
    expense(3, '2025-02-20T12:00:00Z', 30, 7, 'Food & Dining'),
    expense(4, '2025-02-21T12:00:00Z', 100, 8, 'Food & Dining'),
  ]

  const result = calculateMonthlyAnalytics(records, 3, '2025-02', 7)

  assert.equal(result.total, 30)
  assert.equal(result.previousTotal, 20)
  assert.equal(result.changePercent, 50)
  assert.equal(result.monthlySeries.length, 12)
  assert.equal(result.monthlySeries[0].total, 20)
  assert.equal(result.monthlySeries[1].total, 30)
  assert.equal(result.monthlySeries[11].total, 0)
})

test('keeps expense amounts in their stored base units and counts only actual shares', () => {
  const records = [
    expense(1, '2025-03-05T12:00:00Z', 1250, 7, 'Other', [
      { person_id: 3, amount: 0 },
    ]),
  ]
  const result = calculateMonthlyAnalytics(records, 3, '2025-03')

  assert.equal(result.total, 1250)
  assert.equal(result.personalShare, 0)
  assert.equal(result.changePercent, null)
  assert.equal(result.monthlySeries[2].total, 1250)
  assert.equal(result.monthlySeries[1].total, 0)
})

test('voided expenses are excluded from totals, personal shares, and monthly analytics', () => {
  const records = [
    expense(1, '2025-03-05T12:00:00Z', 125, 7, 'Other', [{ person_id: 3, amount: 25 }]),
    { ...expense(2, '2025-03-06T12:00:00Z', 500, 7, 'Other', [{ person_id: 3, amount: 100 }]), voided_at: '2025-03-07T00:00:00Z' },
  ]
  const result = calculateMonthlyAnalytics(records, 3, '2025-03')
  assert.equal(result.total, 125)
  assert.equal(result.personalShare, 25)
  assert.equal(result.monthlySeries[2].total, 125)
})
