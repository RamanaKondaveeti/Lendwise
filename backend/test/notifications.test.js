const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotifications, reminderPeriodKey } = require('../src/notifications');

const eventTypes = [
  ['expense_created', 'expense'],
  ['expense_updated', 'expense'],
  ['settlement_recorded', 'settlement'],
  ['settlement_reminder', 'group'],
  ['group_invitation', 'invitation'],
  ['member_joined', 'workspace'],
  ['recurring_generated', 'recurring'],
  ['recurring_confirmation', 'recurring'],
];

test('creates all supported notification event types with their navigation targets', async () => {
  for (const [type, targetType] of eventTypes) {
    const inserts = [];
    const executor = {
      async execute(query, parameters) {
        if (query.startsWith('SELECT a.id AS account_id')) {
          return [[{ account_id: 17, enabled: 1 }], []];
        }
        inserts.push(parameters);
        return [{ insertId: inserts.length, affectedRows: 1 }, []];
      },
    };

    const count = await createNotifications(executor, {
      workspaceId: 3,
      accountIds: [17],
      type,
      title: 'GroupBuk update',
      message: 'A related group item changed.',
      targetType,
      targetId: 24,
      dedupeKey: `${type}:24`,
    });

    assert.equal(count, 1, type);
    assert.deepEqual(inserts[0].slice(0, 3), [17, 3, type]);
    assert.equal(inserts[0][5], targetType);
  }
});

test('honors disabled preferences, excludes the acting account, and deduplicates unique events', async () => {
  const inserted = [];
  const executor = {
    async execute(query, parameters) {
      if (query.startsWith('SELECT a.id AS account_id')) {
        return [[
          { account_id: 1, enabled: 1 },
          { account_id: 2, enabled: 0 },
          { account_id: 3, enabled: 1 },
        ].filter(account => parameters.includes(account.account_id)), []];
      }
      if (inserted.some(row => row[0] === parameters[0] && row[8] === parameters[8])) {
        const error = new Error('Duplicate notification.');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      inserted.push(parameters);
      return [{ affectedRows: 1 }, []];
    },
  };
  const notification = {
    workspaceId: 7,
    accountIds: [1, 2, 3, 3],
    excludeAccountId: 1,
    type: 'expense_created',
    title: 'New expense',
    message: 'An expense was recorded.',
    targetType: 'expense',
    targetId: 8,
    dedupeKey: 'expense-created:8',
  };

  assert.equal(await createNotifications(executor, notification), 1);
  assert.deepEqual(inserted.map(row => row[0]), [3]);
  assert.equal(await createNotifications(executor, { ...notification, excludeAccountId: null }), 1);
  assert.equal(inserted.length, 2);
});

test('uses stable daily and Monday-based weekly reminder periods', () => {
  assert.equal(reminderPeriodKey('daily', '2026-11-10'), '2026-11-10');
  assert.equal(reminderPeriodKey('weekly', '2026-11-10'), '2026-11-09');
  assert.equal(reminderPeriodKey('weekly', '2026-11-15'), '2026-11-09');
  assert.throws(() => reminderPeriodKey('off', '2026-11-10'), /frequency/);
});

test('rejects invalid notification event and target data', async () => {
  await assert.rejects(createNotifications({ execute: async () => [[], []] }, {
    workspaceId: 1,
    accountIds: [1],
    type: 'unknown',
    title: 'Invalid',
    message: 'Invalid',
    targetType: 'expense',
    dedupeKey: 'invalid',
  }), /valid notification payload/);
});
