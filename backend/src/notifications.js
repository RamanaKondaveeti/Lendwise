const notificationPreferences = {
  expense_created: 'expense_created',
  expense_updated: 'expense_updated',
  settlement_recorded: 'settlement_recorded',
  settlement_reminder: 'settlement_reminder',
  group_invitation: 'group_invitation',
  member_joined: 'member_joined',
  recurring_generated: 'recurring_generated',
  recurring_confirmation: 'recurring_confirmation',
  budget_alert: 'budget_alert',
};

const targetTypes = new Set(['expense', 'group', 'settlement', 'recurring', 'invitation', 'workspace', 'budget']);

async function createNotifications(executor, {
  workspaceId,
  accountIds,
  excludeAccountId = null,
  type,
  title,
  message,
  targetType,
  targetId = null,
  targetDate = null,
  dedupeKey,
}) {
  const preferenceColumn = notificationPreferences[type];
  if (!preferenceColumn || !targetTypes.has(targetType) ||
      !Number.isInteger(Number(workspaceId)) || Number(workspaceId) <= 0 ||
      typeof title !== 'string' || !title.trim() || title.length > 160 ||
      typeof message !== 'string' || !message.trim() || message.length > 500 ||
      typeof dedupeKey !== 'string' || !dedupeKey || dedupeKey.length > 190 ||
      (targetId !== null && (!Number.isInteger(Number(targetId)) || Number(targetId) <= 0))) {
    throw new TypeError('A valid notification payload is required.');
  }
  const recipients = [...new Set(accountIds.map(Number))]
    .filter(accountId => Number.isInteger(accountId) && accountId > 0 && accountId !== Number(excludeAccountId));
  if (!recipients.length) return 0;

  const [accounts] = await executor.execute(
    `SELECT a.id AS account_id, COALESCE(p.${preferenceColumn}, 1) AS enabled
     FROM accounts a
     LEFT JOIN notification_preferences p ON p.account_id = a.id
     WHERE a.id IN (${recipients.map(() => '?').join(',')})`,
    recipients
  );
  let inserted = 0;
  for (const account of accounts) {
    if (!Number(account.enabled)) continue;
    try {
      await executor.execute(
        `INSERT INTO notifications
         (account_id, workspace_id, notification_type, title, message,
          target_type, target_id, target_date, dedupe_key)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          account.account_id,
          Number(workspaceId),
          type,
          title.trim(),
          message.trim(),
          targetType,
          targetId,
          targetDate,
          dedupeKey,
        ]
      );
      inserted += 1;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
    }
  }
  return inserted;
}

function reminderPeriodKey(frequency, value = new Date()) {
  if (!['daily', 'weekly'].includes(frequency)) {
    throw new TypeError('Reminder frequency must be daily or weekly.');
  }
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid reminder date is required.');
  date.setUTCHours(0, 0, 0, 0);
  if (frequency === 'weekly') {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  }
  return date.toISOString().slice(0, 10);
}

module.exports = {
  createNotifications,
  notificationPreferences,
  reminderPeriodKey,
};
