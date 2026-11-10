const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createExpenseAndSplits,
  nextOccurrenceDate,
  reserveOccurrence,
  splitExpenseAmount,
} = require('../src/recurring');

test('advances weekly, monthly, quarterly, and yearly schedules from the original anchor', () => {
  assert.equal(nextOccurrenceDate('2024-01-31', 'weekly'), '2024-02-07');
  assert.equal(nextOccurrenceDate('2024-02-29', 'monthly', 1, 31), '2024-03-31');
  assert.equal(nextOccurrenceDate('2024-01-31', 'monthly', 1, 31), '2024-02-29');
  assert.equal(nextOccurrenceDate('2024-02-29', 'yearly', 2, 29), '2025-02-28');
  assert.equal(nextOccurrenceDate('2024-01-31', 'quarterly', 1, 31), '2024-04-30');
});

test('equal and custom allocations conserve every cent', () => {
  assert.deepEqual(splitExpenseAmount(10, [2, 3, 4]), [
    { personId: 2, amount: 3.34 },
    { personId: 3, amount: 3.33 },
    { personId: 4, amount: 3.33 },
  ]);
  const custom = splitExpenseAmount(10, [2, 3], 'custom', [70, 30]);
  assert.deepEqual(custom, [
    { personId: 2, amount: 7 },
    { personId: 3, amount: 3 },
  ]);
  assert.equal(custom.reduce((sum, share) => sum + share.amount, 0), 10);
  assert.throws(() => splitExpenseAmount(10, [2, 3], 'custom', [60, 30]), /100%/);
});

test('generated expenses and all participant splits are inserted with a traceable occurrence link', async () => {
  const statements = [];
  const executor = {
    async execute(query, parameters) {
      statements.push({ query, parameters });
      return [{ insertId: 44, affectedRows: 1 }];
    },
  };
  const template = {
    id: 8,
    group_id: 3,
    title: 'Monthly utilities',
    paid_by: 2,
    category: 'Utilities & Bills',
    split_method: 'equal',
  };
  const expenseId = await createExpenseAndSplits(
    executor,
    template,
    '2025-03-01',
    12.5,
    1500,
    [{ person_id: 2 }, { person_id: 3 }, { person_id: 4 }]
  );

  const splitRows = statements.filter(statement => statement.query.startsWith('INSERT INTO splits'));
  assert.equal(expenseId, 44);
  assert.deepEqual(statements[0].parameters, [3, 'Monthly utilities', 1500, 2, 'Utilities & Bills', 'equal', '2025-03-01 12:00:00']);
  assert.deepEqual(splitRows.map(statement => statement.parameters), [
    [44, 2, 500],
    [44, 3, 500],
    [44, 4, 500],
  ]);
  assert.deepEqual(statements.at(-1).parameters, [44, 12.5, 1500, 8, '2025-03-01']);
});

test('unique occurrence reservation prevents a second generation for the same template date', async () => {
  const reserved = new Set();
  const executor = {
    async execute(_query, [templateId, occurrenceDate]) {
      const key = `${templateId}:${occurrenceDate}`;
      if (reserved.has(key)) {
        const error = new Error('Duplicate occurrence.');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      reserved.add(key);
      return [{ affectedRows: 1 }];
    },
  };

  assert.equal(await reserveOccurrence(executor, 15, '2025-01-01'), true);
  assert.equal(await reserveOccurrence(executor, 15, '2025-01-01'), false);
  assert.equal(await reserveOccurrence(executor, 15, '2025-02-01'), true);
  assert.equal(await reserveOccurrence(executor, 16, '2025-01-01'), true);
});

test('occurrence reservation only treats duplicate-key errors as an existing occurrence', async () => {
  const executor = {
    async execute() {
      const error = new Error('Database unavailable.');
      error.code = 'ECONNREFUSED';
      throw error;
    },
  };
  await assert.rejects(reserveOccurrence(executor, 15, '2025-01-01'), { code: 'ECONNREFUSED' });
});
