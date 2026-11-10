const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAccessibleBudgetQuery,
  buildBudgetSpendQuery,
  budgetAlertDedupeKey,
  budgetAlertThresholdsCrossed,
  convertBudgetAmountToBase,
  currentPeriod,
  getBudgetSpend,
  periodRanges,
  validateBudgetInput,
} = require('../src/budgets');
const { createNotifications } = require('../src/notifications');

const range = { startDate: '2026-11-01', endDate: '2026-12-01' };
const personalBudget = {
  id: 1, workspace_id: 4, budget_type: 'personal', person_id: 7,
  group_id: null, category: null,
};
const groupBudget = {
  id: 2, workspace_id: 4, budget_type: 'group', person_id: null,
  group_id: 9, category: null,
};

test('personal budgets calculate only the member share from splits', async () => {
  let query;
  const spent = await getBudgetSpend({
    async execute(sql, parameters) {
      query = { sql, parameters };
      return [[{ spent: '37.45' }], []];
    },
  }, personalBudget, range);

  assert.equal(spent, 37.45);
  assert.match(query.sql, /SUM\(s\.amount\)/);
  assert.match(query.sql, /s\.person_id = \?/);
  assert.doesNotMatch(query.sql, /settlements/);
  assert.deepEqual(query.parameters, [4, 7, '2026-11-01 00:00:00', '2026-12-01 00:00:00']);
});

test('group budgets calculate full expense amounts and category budgets filter those expenses', async () => {
  const noCategory = buildBudgetSpendQuery(groupBudget, range);
  assert.match(noCategory.sql, /SUM\(e\.amount\)/);
  assert.match(noCategory.sql, /e\.group_id = \?/);
  assert.doesNotMatch(noCategory.sql, /splits/);

  const personalCategory = buildBudgetSpendQuery({ ...personalBudget, category: 'Food & Dining' }, range);
  assert.match(personalCategory.sql, /SUM\(s\.amount\)/);
  assert.match(personalCategory.sql, /e\.category = \?/);
  assert.equal(personalCategory.parameters.at(-1), 'Food & Dining');
  const groupCategory = buildBudgetSpendQuery({ ...groupBudget, category: 'Travel' }, range);
  assert.match(groupCategory.sql, /SUM\(e\.amount\)/);
  assert.match(groupCategory.sql, /e\.category = \?/);
  assert.equal(groupCategory.parameters.at(-1), 'Travel');
});

test('weekly, monthly, and yearly periods use UTC calendar boundaries', () => {
  assert.deepEqual(currentPeriod('2026-11-10', 'weekly'), {
    startDate: '2026-11-09', endDate: '2026-11-16',
  });
  assert.deepEqual(currentPeriod('2024-02-29', 'monthly'), {
    startDate: '2024-02-01', endDate: '2024-03-01',
  });
  assert.deepEqual(currentPeriod('2026-07-19', 'yearly'), {
    startDate: '2026-01-01', endDate: '2027-01-01',
  });
  const budget = { start_date: '2026-11-10', end_date: '2026-11-30', period: 'monthly' };
  assert.deepEqual(periodRanges(budget, '2026-11-18').current, {
    startDate: '2026-11-10', endDate: '2026-12-01',
  });
});

test('INR and USD budget values normalize to the stored INR base amount', () => {
  assert.deepEqual(convertBudgetAmountToBase(1234.56, 'INR', 1), {
    amount: 1234.56, exchangeRateToInr: 1,
  });
  assert.deepEqual(convertBudgetAmountToBase(10, 'USD', 83.125), {
    amount: 831.25, exchangeRateToInr: 83.125,
  });
  assert.equal(validateBudgetInput({
    name: 'USD budget', budgetType: 'personal', amount: 10, currency: 'USD',
    exchangeRateToInr: 83.125, period: 'monthly', startDate: '2026-11-01',
  }).amount, 831.25);
  assert.throws(() => convertBudgetAmountToBase(10, 'INR', 83), /exchange rate/);
  assert.throws(() => convertBudgetAmountToBase(10, 'USD', 0), /exchange rate/);
});

test('budget utilization queries sum live expense rows so edits and deletions recalculate', async () => {
  let fixtureSpend = 75;
  let queryCount = 0;
  const executor = {
    async execute(sql) {
      queryCount += 1;
      assert.match(sql, /SUM\(s\.amount\)/);
      return [[{ spent: fixtureSpend }], []];
    },
  };
  assert.equal(await getBudgetSpend(executor, personalBudget, range), 75);
  fixtureSpend = 42; // Existing expense amount or split was edited.
  assert.equal(await getBudgetSpend(executor, personalBudget, range), 42);
  fixtureSpend = 0; // The expense was deleted.
  assert.equal(await getBudgetSpend(executor, personalBudget, range), 0);
  assert.equal(queryCount, 3);
});

test('recurring generated expenses count through the expenses table once', () => {
  const query = buildBudgetSpendQuery(groupBudget, range);
  assert.match(query.sql, /FROM expenses e/);
  assert.doesNotMatch(query.sql, /recurring_expenses|recurring_expense_occurrences/);
});

test('budget access query scopes personal owners and group memberships to the workspace', () => {
  const query = buildAccessibleBudgetQuery(12, { workspace_id: 4, person_id: 7 });
  assert.match(query.sql, /b\.workspace_id = \?/);
  assert.match(query.sql, /b\.person_id = \?/);
  assert.match(query.sql, /EXISTS \(\s*SELECT 1 FROM group_members/);
  assert.deepEqual(query.parameters, [12, 4, 7, 7]);
});

test('crosses 80, 90, 100 and exceeded thresholds exactly once per period key', () => {
  assert.deepEqual(budgetAlertThresholdsCrossed([80, 90, 100], 79.99), []);
  assert.deepEqual(budgetAlertThresholdsCrossed([80, 90, 100], 89), [80]);
  assert.deepEqual(budgetAlertThresholdsCrossed([80, 90, 100], 95), [80, 90]);
  assert.deepEqual(budgetAlertThresholdsCrossed([80, 90, 100], 100), [80, 90, 100]);
  assert.deepEqual(budgetAlertThresholdsCrossed([80, 90, 100], 101), [80, 90, 100, 'exceeded']);
  assert.equal(budgetAlertDedupeKey(5, '2026-11-01', 90), 'budget:5:2026-11-01:90');
  assert.notEqual(budgetAlertDedupeKey(5, '2026-11-01', 90), budgetAlertDedupeKey(5, '2026-12-01', 90));
});

test('budget notifications honor preferences and deduplicate by budget and period', async () => {
  const inserted = new Set();
  let enabled = 1;
  const executor = {
    async execute(sql, parameters) {
      if (sql.startsWith('SELECT a.id AS account_id')) {
        return [[{ account_id: 7, enabled }], []];
      }
      const key = `${parameters[0]}:${parameters[8]}`;
      if (inserted.has(key)) {
        const error = new Error('Duplicate notification.');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      inserted.add(key);
      return [{ affectedRows: 1 }, []];
    },
  };
  const alert = periodStart => ({
    workspaceId: 4, accountIds: [7], type: 'budget_alert', title: 'Budget warning',
    message: 'Budget threshold crossed.', targetType: 'budget', targetId: 5,
    targetDate: periodStart, dedupeKey: budgetAlertDedupeKey(5, periodStart, 80),
  });
  assert.equal(await createNotifications(executor, alert('2026-11-01')), 1);
  assert.equal(await createNotifications(executor, alert('2026-11-01')), 0);
  assert.equal(await createNotifications(executor, alert('2026-12-01')), 1);
  enabled = 0;
  assert.equal(await createNotifications(executor, {
    ...alert('2027-01-01'), dedupeKey: budgetAlertDedupeKey(5, '2027-01-01', 80),
  }), 0);
  assert.equal(inserted.size, 2);
});
