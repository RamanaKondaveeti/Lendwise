const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { calculateMinimalSettlements, validateGroupSettlement } = require('./settlements');
const { createNotifications, reminderPeriodKey } = require('./notifications');
const {
  buildExpenseReportFilter,
  buildSettlementReportFilter,
  isValidReportDate,
} = require('./reports');
const {
  createExpenseAndSplits,
  dateOnly,
  nextOccurrenceDate,
  reserveOccurrence,
} = require('./recurring');
const {
  buildAccessibleBudgetQuery,
  budgetAlertDedupeKey,
  budgetAlertThresholdsCrossed,
  getBudgetSpend,
  periodRanges,
  validateBudgetInput,
} = require('./budgets');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.DB_PASSWORD) {
  throw new Error('Production requires DB_PASSWORD.');
}

const scrypt = promisify(crypto.scrypt);
const passwordHashOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const app = express();
app.set('trust proxy', 1);
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'lendwise',
  user: process.env.DB_USER || 'lendwiseuser',
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '16kb' }));

const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const emailTransport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined
  })
  : null;

const q = async (text, params = []) => {
  const [result] = await pool.execute(text, params);
  return result;
};

async function notifyPeople(executor, workspaceId, personIds, notification, excludeAccountId = null) {
  const people = [...new Set(personIds.map(Number))]
    .filter(personId => Number.isInteger(personId) && personId > 0);
  if (!people.length) return 0;
  const [accounts] = await executor.execute(
    `SELECT account_id FROM workspace_members
     WHERE workspace_id = ? AND person_id IN (${people.map(() => '?').join(',')})`,
    [workspaceId, ...people]
  );
  return createNotifications(executor, {
    workspaceId,
    accountIds: accounts.map(account => account.account_id),
    excludeAccountId,
    ...notification,
  });
}

async function notifyWorkspaceMembers(executor, workspaceId, notification, excludeAccountId = null) {
  const [accounts] = await executor.execute(
    'SELECT account_id FROM workspace_members WHERE workspace_id = ?',
    [workspaceId]
  );
  return createNotifications(executor, {
    workspaceId,
    accountIds: accounts.map(account => account.account_id),
    excludeAccountId,
    ...notification,
  });
}

async function notifyGroupMembers(executor, workspaceId, groupId, notification, excludeAccountId = null) {
  const [members] = await executor.execute(
    `SELECT gm.person_id FROM group_members gm
     JOIN \`groups\` g ON g.id = gm.group_id AND g.workspace_id = ?
     WHERE gm.group_id = ?`,
    [workspaceId, groupId]
  );
  return notifyPeople(
    executor,
    workspaceId,
    members.map(member => member.person_id),
    notification,
    excludeAccountId
  );
}

async function getWorkspaceBalances(workspaceId, executor = pool) {
  const [balances] = await executor.execute(
    `SELECT p.id, p.name, p.initials, p.color,
            COALESCE((SELECT SUM(s.amount) FROM splits s
                      JOIN expenses e ON e.id = s.expense_id
                      JOIN \`groups\` g ON g.id = e.group_id AND g.workspace_id = p.workspace_id
                      WHERE s.person_id = p.id), 0)
            - COALESCE((SELECT SUM(e.amount) FROM expenses e
                        JOIN \`groups\` g ON g.id = e.group_id AND g.workspace_id = p.workspace_id
                        WHERE e.paid_by = p.id), 0)
            + COALESCE((SELECT SUM(s.amount) FROM settlements s
                        JOIN people payer ON payer.id = s.payer_id AND payer.workspace_id = p.workspace_id
                        JOIN people payee ON payee.id = s.payee_id AND payee.workspace_id = p.workspace_id
                        WHERE s.payee_id = p.id), 0)
            - COALESCE((SELECT SUM(s.amount) FROM settlements s
                        JOIN people payer ON payer.id = s.payer_id AND payer.workspace_id = p.workspace_id
                        JOIN people payee ON payee.id = s.payee_id AND payee.workspace_id = p.workspace_id
                        WHERE s.payer_id = p.id), 0) AS balance
     FROM people p WHERE p.workspace_id = ? ORDER BY p.id`,
    [workspaceId]
  );
  return balances;
}

async function getWorkspaceGroupBalances(workspaceId, executor = pool) {
  const [balances] = await executor.execute(
    `SELECT g.id AS group_id, g.name AS group_name, p.id, p.name, p.initials, p.color,
            COALESCE(split_totals.amount, 0) - COALESCE(paid_totals.amount, 0)
              + COALESCE(settlement_received.amount, 0) - COALESCE(settlement_paid.amount, 0) AS balance
     FROM \`groups\` g
     JOIN people p ON p.workspace_id = g.workspace_id
     LEFT JOIN (
       SELECT e.group_id, s.person_id, SUM(s.amount) AS amount
       FROM splits s JOIN expenses e ON e.id = s.expense_id
       GROUP BY e.group_id, s.person_id
     ) split_totals ON split_totals.group_id = g.id AND split_totals.person_id = p.id
     LEFT JOIN (
       SELECT group_id, paid_by AS person_id, SUM(amount) AS amount
       FROM expenses GROUP BY group_id, paid_by
     ) paid_totals ON paid_totals.group_id = g.id AND paid_totals.person_id = p.id
     LEFT JOIN (
       SELECT COALESCE(st.group_id, e.group_id) AS group_id, st.payee_id AS person_id, SUM(st.amount) AS amount
       FROM settlements st LEFT JOIN expenses e ON e.id = st.expense_id
       WHERE st.group_id IS NOT NULL OR st.expense_id IS NOT NULL
       GROUP BY COALESCE(st.group_id, e.group_id), st.payee_id
     ) settlement_received ON settlement_received.group_id = g.id AND settlement_received.person_id = p.id
     LEFT JOIN (
       SELECT COALESCE(st.group_id, e.group_id) AS group_id, st.payer_id AS person_id, SUM(st.amount) AS amount
       FROM settlements st LEFT JOIN expenses e ON e.id = st.expense_id
       WHERE st.group_id IS NOT NULL OR st.expense_id IS NOT NULL
       GROUP BY COALESCE(st.group_id, e.group_id), st.payer_id
     ) settlement_paid ON settlement_paid.group_id = g.id AND settlement_paid.person_id = p.id
     WHERE g.workspace_id = ? AND (
       EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.person_id = p.id)
       OR EXISTS (
         SELECT 1 FROM expenses e JOIN splits s ON s.expense_id = e.id
         WHERE e.group_id = g.id AND s.person_id = p.id
       )
       OR EXISTS (SELECT 1 FROM expenses e WHERE e.group_id = g.id AND e.paid_by = p.id)
       OR EXISTS (
         SELECT 1 FROM settlements st LEFT JOIN expenses linked ON linked.id = st.expense_id
         WHERE COALESCE(st.group_id, linked.group_id) = g.id
           AND (st.payer_id = p.id OR st.payee_id = p.id)
       )
     )
     ORDER BY g.id, p.id`,
    [workspaceId]
  );
  return balances;
}

function derivePasswordHash(password, salt) {
  return scrypt(password, salt, 64, passwordHashOptions);
}

const sessionCookieName = 'lendwise_session';
const sessionDurationSeconds = Number(process.env.SESSION_DURATION_SECONDS || 8 * 60 * 60);
const emailTokenDurationSeconds = 60 * 60;
if (!Number.isInteger(sessionDurationSeconds) || sessionDurationSeconds < 300 || sessionDurationSeconds > 30 * 24 * 60 * 60) {
  throw new Error('SESSION_DURATION_SECONDS must be between 300 seconds and 30 days.');
}

function getSessionToken(req) {
  const cookies = req.headers.cookie || '';
  const cookie = cookies.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${sessionCookieName}=`));
  return cookie?.slice(sessionCookieName.length + 1) || '';
}

function setSessionCookie(res, token) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationSeconds}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
  );
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession(accountId, workspaceId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(
    `INSERT INTO auth_sessions(token_hash, account_id, workspace_id, expires_at)
     VALUES(?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
    [hashSessionToken(token), accountId, workspaceId, sessionDurationSeconds]
  );
  setSessionCookie(res, token);
}

function emailIsConfigured() {
  return Boolean(emailTransport && process.env.MAIL_FROM && process.env.APP_URL);
}

async function sendEmail({ to, subject, text }) {
  if (!emailIsConfigured()) throw new Error('Email delivery is not configured.');
  await emailTransport.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    text
  });
}

async function createEmailToken(accountId, type, seconds = emailTokenDurationSeconds) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q('DELETE FROM email_tokens WHERE account_id = ? AND token_type = ?', [accountId, type]);
  await q(
    `INSERT INTO email_tokens(token_hash, account_id, token_type, expires_at)
     VALUES(?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
    [hashSessionToken(token), accountId, type, seconds]
  );
  return token;
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' }
});
const publicApiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});

async function ensureColumn(table, column, definition) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (!columns.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

function dateOnOrAfter(startDate, frequency, anchorMonth, anchorDay, minimumDate) {
  let date = dateOnly(startDate);
  const minimum = dateOnly(minimumDate);
  for (let count = 0; date < minimum && count < 10000; count += 1) {
    date = nextOccurrenceDate(date, frequency, anchorMonth, anchorDay);
  }
  if (date < minimum) throw new RangeError('The recurring schedule is too far in the past.');
  return date;
}

async function processDueRecurringTemplate(templateId) {
  const connection = await pool.getConnection();
  let inTransaction = false;
  try {
    await connection.beginTransaction();
    inTransaction = true;
    const [templates] = await connection.execute(
      `SELECT * FROM recurring_expenses
       WHERE id = ? AND status = 'active' AND next_occurrence_date <= UTC_DATE()
       FOR UPDATE`,
      [templateId]
    );
    if (!templates.length) {
      await connection.commit();
      inTransaction = false;
      return false;
    }

    const template = templates[0];
    const occurrenceDate = dateOnly(template.next_occurrence_date);
    const [participants] = await connection.execute(
      `SELECT person_id, share_percent FROM recurring_expense_participants
       WHERE template_id = ? ORDER BY person_id`,
      [template.id]
    );
    if (!participants.length) throw new Error(`Recurring expense ${template.id} has no participants.`);

    const reserved = await reserveOccurrence(connection, template.id, occurrenceDate);
    if (reserved && template.variable_amount) {
      await connection.execute(
        `UPDATE recurring_expense_occurrences SET status = 'needs_confirmation'
         WHERE template_id = ? AND occurrence_date = ?`,
        [template.id, occurrenceDate]
      );
      await notifyGroupMembers(connection, template.workspace_id, template.group_id, {
        type: 'recurring_confirmation',
        title: 'Recurring expense needs confirmation',
        message: `Enter the actual amount for ${template.title}.`,
        targetType: 'recurring',
        targetId: template.id,
        targetDate: occurrenceDate,
        dedupeKey: `recurring-confirmation:${template.id}:${occurrenceDate}`,
      });
    } else if (reserved) {
      await createExpenseAndSplits(
        connection,
        template,
        occurrenceDate,
        template.amount,
        template.base_amount,
        participants
      );
      await notifyGroupMembers(connection, template.workspace_id, template.group_id, {
        type: 'recurring_generated',
        title: 'Recurring expense recorded',
        message: `${template.title} was added to ${template.currency} group expenses.`,
        targetType: 'recurring',
        targetId: template.id,
        targetDate: occurrenceDate,
        dedupeKey: `recurring-generated:${template.id}:${occurrenceDate}`,
      });
    }

    const nextDate = nextOccurrenceDate(
      occurrenceDate,
      template.frequency,
      template.anchor_month,
      template.anchor_day
    );
    const completed = template.end_date && nextDate > dateOnly(template.end_date);
    await connection.execute(
      'UPDATE recurring_expenses SET next_occurrence_date = ?, status = ? WHERE id = ?',
      [completed ? null : nextDate, completed ? 'completed' : 'active', template.id]
    );
    await connection.commit();
    inTransaction = false;
    return true;
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Recurring expense rollback failed', rollbackError);
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

let recurringSchedulerRunning = false;
async function runDueRecurringExpenses() {
  if (recurringSchedulerRunning) return;
  recurringSchedulerRunning = true;
  try {
    const [dueTemplates] = await pool.execute(
      `SELECT id FROM recurring_expenses
       WHERE status = 'active' AND next_occurrence_date <= UTC_DATE()
       ORDER BY next_occurrence_date, id LIMIT 100`
    );
    for (const { id } of dueTemplates) {
      for (let occurrence = 0; occurrence < 500; occurrence += 1) {
        try {
          if (!await processDueRecurringTemplate(id)) break;
        } catch (error) {
          console.error(`Recurring expense ${id} could not be generated.`, error);
          break;
        }
      }
    }
  } catch (error) {
    console.error('Recurring expense scheduler failed.', error);
  } finally {
    recurringSchedulerRunning = false;
  }
}

let settlementReminderSchedulerRunning = false;
async function runSettlementReminders(now = new Date()) {
  if (settlementReminderSchedulerRunning) return;
  settlementReminderSchedulerRunning = true;
  try {
    const [workspaces] = await pool.execute('SELECT id FROM workspaces ORDER BY id');
    for (const workspace of workspaces) {
      try {
        const [members, balances] = await Promise.all([
          pool.execute(
            `SELECT wm.account_id, wm.person_id,
                    COALESCE(p.settlement_reminder_frequency, 'weekly') AS frequency
             FROM workspace_members wm
             LEFT JOIN notification_preferences p ON p.account_id = wm.account_id
             WHERE wm.workspace_id = ?`,
            [workspace.id]
          ),
          getWorkspaceGroupBalances(workspace.id),
        ]);
        const accountsByPerson = new Map(members[0].map(member => [member.person_id, member]));
        for (const balance of balances) {
          if (Number(balance.balance) <= 0) continue;
          const member = accountsByPerson.get(balance.id);
          if (!member || member.frequency === 'off') continue;
          const period = reminderPeriodKey(member.frequency, now);
          await createNotifications(pool, {
            workspaceId: workspace.id,
            accountIds: [member.account_id],
            type: 'settlement_reminder',
            title: 'Settlement reminder',
            message: `You have an outstanding balance in ${balance.group_name}.`,
            targetType: 'group',
            targetId: balance.group_id,
            dedupeKey: `settlement-reminder:${balance.group_id}:${balance.id}:${period}`,
          });
        }
      } catch (error) {
        console.error(`Settlement reminders failed for workspace ${workspace.id}.`, error);
      }
    }
  } catch (error) {
    console.error('Settlement reminder scheduler failed.', error);
  } finally {
    settlementReminderSchedulerRunning = false;
  }
}

async function ensureWorkspaceForeignKey(table, name) {
  const [constraints] = await pool.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name]
  );
  if (!constraints.length) {
    await pool.query(
      `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\`
       FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE`
    );
  }
}

async function migrateWorkspaceOwnership() {
  await ensureColumn('settlements', 'expense_id', 'INT NULL');
  await ensureColumn('settlements', 'group_id', 'INT NULL');
  const [expenseSettlementConstraint] = await pool.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settlements'
       AND CONSTRAINT_NAME = 'fk_settlements_expense'`
  );
  if (!expenseSettlementConstraint.length) {
    await pool.query(
      `ALTER TABLE settlements ADD CONSTRAINT fk_settlements_expense
       FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE`
    );
  }
  const [expenseSettlementIndex] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settlements'
       AND INDEX_NAME = 'idx_settlements_expense'`
  );
  if (!expenseSettlementIndex.length) {
    await pool.query('ALTER TABLE settlements ADD INDEX idx_settlements_expense (expense_id)');
  }
  const [groupSettlementConstraint] = await pool.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settlements'
       AND CONSTRAINT_NAME = 'fk_settlements_group'`
  );
  if (!groupSettlementConstraint.length) {
    await pool.query(
      'ALTER TABLE settlements ADD CONSTRAINT fk_settlements_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE'
    );
  }
  const [groupSettlementIndex] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settlements'
       AND INDEX_NAME = 'idx_settlements_group'`
  );
  if (!groupSettlementIndex.length) {
    await pool.query('ALTER TABLE settlements ADD INDEX idx_settlements_group (group_id)');
  }
  await ensureColumn('people', 'workspace_id', 'INT NULL');
  await ensureColumn('groups', 'workspace_id', 'INT NULL');
  await ensureColumn('accounts', 'workspace_id', 'INT NULL');
  await ensureColumn('auth_sessions', 'workspace_id', 'INT NULL');
  await ensureColumn('workspace_invitations', 'invitee_account_id', 'INT NULL');

  const legacyAccounts = await q(
    `SELECT a.id, a.person_id, p.name, p.initials, p.color
     FROM accounts a JOIN people p ON p.id = a.person_id
     WHERE a.workspace_id IS NULL ORDER BY a.id`
  );
  for (const account of legacyAccounts) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [workspace] = await connection.execute(
        'INSERT INTO workspaces(name) VALUES(?)',
        [`${account.name}'s workspace`]
      );
      const [person] = await connection.execute(
        'INSERT INTO people(workspace_id, name, initials, color) VALUES(?, ?, ?, ?)',
        [workspace.insertId, account.name, account.initials, account.color]
      );
      await connection.execute(
        'UPDATE accounts SET workspace_id = ?, person_id = ? WHERE id = ?',
        [workspace.insertId, person.insertId, account.id]
      );
      await connection.execute(
        'UPDATE auth_sessions SET workspace_id = ? WHERE account_id = ?',
        [workspace.insertId, account.id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  const [unownedRecords] = await q(
    `SELECT
       (SELECT COUNT(*) FROM people WHERE workspace_id IS NULL) +
       (SELECT COUNT(*) FROM \`groups\` WHERE workspace_id IS NULL) AS total`
  );
  if (Number(unownedRecords.total)) {
    const workspace = await q("INSERT INTO workspaces(name) VALUES('Legacy workspace')");
    await q('UPDATE people SET workspace_id = ? WHERE workspace_id IS NULL', [workspace.insertId]);
    await q('UPDATE `groups` SET workspace_id = ? WHERE workspace_id IS NULL', [workspace.insertId]);
  }
  await q(
    `UPDATE auth_sessions s JOIN accounts a ON a.id = s.account_id
     SET s.workspace_id = a.workspace_id WHERE s.workspace_id IS NULL`
  );
  await q(
    `INSERT IGNORE INTO workspace_members(account_id, workspace_id, person_id)
     SELECT id, workspace_id, person_id FROM accounts
     WHERE workspace_id IS NOT NULL AND person_id IS NOT NULL`
  );
  const [inviteeConstraints] = await pool.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_invitations'
       AND CONSTRAINT_NAME = 'fk_workspace_invitations_invitee'`
  );
  if (!inviteeConstraints.length) {
    await pool.query(
      `ALTER TABLE workspace_invitations ADD CONSTRAINT fk_workspace_invitations_invitee
       FOREIGN KEY (invitee_account_id) REFERENCES accounts(id) ON DELETE CASCADE`
    );
  }

  const [unmigrated] = await q(
    `SELECT
       (SELECT COUNT(*) FROM people WHERE workspace_id IS NULL) +
       (SELECT COUNT(*) FROM \`groups\` WHERE workspace_id IS NULL) +
       (SELECT COUNT(*) FROM accounts WHERE workspace_id IS NULL) +
       (SELECT COUNT(*) FROM auth_sessions WHERE workspace_id IS NULL) AS total`
  );
  if (Number(unmigrated.total)) throw new Error('Workspace migration left records without workspace ownership.');

  const indexes = [
    ['people', 'idx_people_workspace'],
    ['groups', 'idx_groups_workspace'],
    ['accounts', 'idx_accounts_workspace'],
    ['auth_sessions', 'idx_auth_sessions_workspace']
  ];
  for (const [table, index] of indexes) {
    const [rows] = await pool.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, index]
    );
    if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (workspace_id)`);
  }
  await ensureWorkspaceForeignKey('people', 'fk_people_workspace');
  await ensureWorkspaceForeignKey('groups', 'fk_groups_workspace');
  await ensureWorkspaceForeignKey('accounts', 'fk_accounts_workspace');
  await ensureWorkspaceForeignKey('auth_sessions', 'fk_auth_sessions_workspace');
  await pool.query('ALTER TABLE people MODIFY workspace_id INT NOT NULL');
  await pool.query('ALTER TABLE `groups` MODIFY workspace_id INT NOT NULL');
  await pool.query('ALTER TABLE accounts MODIFY workspace_id INT NOT NULL');
  await pool.query('ALTER TABLE auth_sessions MODIFY workspace_id INT NOT NULL');
}

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  for (const statement of schema.split(';').map(part => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  await ensureColumn('expenses', 'category', "VARCHAR(100) NOT NULL DEFAULT 'Other'");
  await ensureColumn('notification_preferences', 'budget_alert', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn('budgets', 'exchange_rate_to_inr', 'DECIMAL(15, 8) NOT NULL DEFAULT 1');
  const [notificationTypeColumn] = await pool.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'notification_type'`
  );
  if (notificationTypeColumn[0] && !notificationTypeColumn[0].COLUMN_TYPE.includes('budget_alert')) {
    await pool.query(`ALTER TABLE notifications MODIFY notification_type ENUM(
      'expense_created', 'expense_updated', 'settlement_recorded', 'settlement_reminder',
      'group_invitation', 'member_joined', 'recurring_generated', 'recurring_confirmation', 'budget_alert'
    ) NOT NULL`);
  }
  const [notificationTargetColumn] = await pool.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'target_type'`
  );
  if (notificationTargetColumn[0] && !notificationTargetColumn[0].COLUMN_TYPE.includes('budget')) {
    await pool.query(`ALTER TABLE notifications MODIFY target_type ENUM(
      'expense', 'group', 'settlement', 'recurring', 'invitation', 'workspace', 'budget'
    ) NOT NULL`);
  }
  await q("UPDATE expenses SET category = 'Other' WHERE category IS NULL OR TRIM(category) = ''");
  await migrateWorkspaceOwnership();
  await q('DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP()');
  await q('DELETE FROM email_tokens WHERE expires_at <= UTC_TIMESTAMP()');
  await q('DELETE FROM workspace_invitations WHERE expires_at <= UTC_TIMESTAMP() AND accepted_at IS NULL');
}

app.use('/api', publicApiRateLimit);

app.post('/api/auth/signup', authRateLimit, async (req, res) => {
  const { name, email, password, invitationToken } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedName || normalizedName.length > 255 ||
      normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Enter a name, valid email, and password between 8 and 128 characters.' });
  }
  if (invitationToken !== undefined && invitationToken !== null &&
      invitationToken !== '' && (typeof invitationToken !== 'string' || invitationToken.length > 128)) {
    return res.status(400).json({ error: 'This invitation is invalid or expired.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  let passwordHash;
  try {
    passwordHash = await derivePasswordHash(password, salt);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not create your account.' });
  }
  const initials = normalizedName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  let connection;
  let inTransaction = false;
  try {
    let invitedWorkspaceId = null;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    if (typeof invitationToken === 'string' && invitationToken) {
      const [invitations] = await connection.execute(
        `SELECT id, workspace_id, email, invitee_account_id FROM workspace_invitations
         WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
        [hashSessionToken(invitationToken)]
      );
      const invitation = invitations[0];
      if (!invitation || invitation.invitee_account_id || invitation.email !== normalizedEmail) {
        await connection.rollback();
        inTransaction = false;
        return res.status(400).json({ error: 'This invitation is invalid, expired, or for a different email.' });
      }
      invitedWorkspaceId = invitation.workspace_id;
    }

    let workspaceId = invitedWorkspaceId;
    if (workspaceId === null) {
      const [workspace] = await connection.execute(
        'INSERT INTO workspaces(name) VALUES(?)',
        [`${normalizedName}'s workspace`]
      );
      workspaceId = workspace.insertId;
    }
    let personId;
    if (invitationToken) {
      const [existingPeople] = await connection.execute(
        `SELECT p.id
         FROM people p
         LEFT JOIN accounts a ON a.person_id = p.id
         WHERE p.workspace_id = ? AND LOWER(TRIM(p.name)) = LOWER(?)
           AND a.id IS NULL
         ORDER BY p.id
         LIMIT 1 FOR UPDATE`,
        [workspaceId, normalizedName]
      );
      personId = existingPeople[0]?.id;
    }
    if (!personId) {
      const [person] = await connection.execute(
        'INSERT INTO people(workspace_id, name, initials) VALUES(?, ?, ?)',
        [workspaceId, normalizedName, initials]
      );
      personId = person.insertId;
    }
    const [account] = await connection.execute(
      'INSERT INTO accounts(workspace_id, email, password_salt, password_hash, person_id) VALUES(?, ?, ?, ?, ?)',
      [workspaceId, normalizedEmail, salt, passwordHash.toString('hex'), personId]
    );
    await connection.execute(
      'INSERT INTO workspace_members(account_id, workspace_id, person_id) VALUES(?, ?, ?)',
      [account.insertId, workspaceId, personId]
    );
    if (invitationToken) {
      const [accepted] = await connection.execute(
        `UPDATE workspace_invitations SET accepted_at = UTC_TIMESTAMP()
         WHERE token_hash = ? AND accepted_at IS NULL`,
        [hashSessionToken(invitationToken)]
      );
      if (accepted.affectedRows !== 1) throw new Error('Invitation was already accepted.');
    }
    await connection.commit();
    inTransaction = false;
    await createSession(account.insertId, workspaceId, res);
    res.status(201).json({
      id: account.insertId,
      email: normalizedEmail,
      name: normalizedName,
      personId,
      workspaceId
    });
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Signup rollback failed', rollbackError);
      }
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Could not create your account.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/auth/forgot-password', authRateLimit, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  try {
    const [account] = await q('SELECT id, email FROM accounts WHERE email = ?', [email]);
    if (account) {
      const token = await createEmailToken(account.id, 'password_reset');
      try {
        await sendEmail({
          to: account.email,
          subject: 'Reset your GroupBuk password',
          text: `Reset your password: ${appUrl}/?reset=${encodeURIComponent(token)}`
        });
      } catch (emailError) {
        console.error('Password reset email delivery failed', emailError);
        return res.json({ message: 'If an account exists for that email, a reset link will be sent.' });
      }
    }
    res.json({ message: 'If an account exists for that email, a reset link will be sent.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not process the password reset request.' });
  }
});

app.post('/api/auth/reset-password', authRateLimit, async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || token.length < 20 || token.length > 128 ||
      typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'Use a valid reset link and a password of at least 12 characters.' });
  }
  try {
    const [tokenRow] = await q(
      `SELECT account_id FROM email_tokens
       WHERE token_hash = ? AND token_type = 'password_reset'
         AND expires_at > UTC_TIMESTAMP()`,
      [hashSessionToken(token)]
    );
    if (!tokenRow) return res.status(400).json({ error: 'Password reset link is invalid or expired.' });

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await derivePasswordHash(password, salt);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT account_id FROM email_tokens
         WHERE token_hash = ? AND token_type = 'password_reset'
           AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
        [hashSessionToken(token)]
      );
      if (!rows.length) {
        await connection.rollback();
        return res.status(400).json({ error: 'Password reset link is invalid or expired.' });
      }
      await connection.execute(
        'UPDATE accounts SET password_salt = ?, password_hash = ? WHERE id = ?',
        [salt, passwordHash.toString('hex'), tokenRow.account_id]
      );
      await connection.execute('DELETE FROM auth_sessions WHERE account_id = ?', [tokenRow.account_id]);
      await connection.execute('DELETE FROM email_tokens WHERE account_id = ?', [tokenRow.account_id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ message: 'Password reset. You can now sign in with your new password.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not reset your password.' });
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      typeof password !== 'string' || !password.length || password.length > 128) {
    return res.status(400).json({ error: 'Enter a valid email and password.' });
  }

  try {
    const [account] = await q(
      `SELECT a.id, a.email, a.password_salt, a.password_hash, a.person_id,
              a.workspace_id, p.name
       FROM accounts a JOIN people p ON p.id = a.person_id AND p.workspace_id = a.workspace_id
       WHERE a.email = ?`,
      [normalizedEmail]
    );
    if (!account) {
      await derivePasswordHash(password, 'lendwise-invalid-account');
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const passwordHash = await derivePasswordHash(password, account.password_salt);
    const storedHash = Buffer.from(account.password_hash, 'hex');
    if (storedHash.length !== passwordHash.length ||
        !crypto.timingSafeEqual(storedHash, passwordHash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    await createSession(account.id, account.workspace_id, res);
    res.json({
      id: account.id,
      email: account.email,
      name: account.name,
      personId: account.person_id,
      workspaceId: account.workspace_id
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = getSessionToken(req);
    if (token) {
      await q('DELETE FROM auth_sessions WHERE token_hash = ?', [hashSessionToken(token)]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not sign out.' });
  }
});

async function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

  try {
    const [account] = await q(
        `SELECT a.id, a.email, wm.person_id, s.workspace_id, p.name, w.name AS workspace_name
       FROM auth_sessions s
       JOIN accounts a ON a.id = s.account_id
       JOIN workspace_members wm ON wm.account_id = a.id AND wm.workspace_id = s.workspace_id
       JOIN people p ON p.id = wm.person_id AND p.workspace_id = wm.workspace_id
       JOIN workspaces w ON w.id = s.workspace_id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
           AND a.workspace_id IS NOT NULL`,
        [hashSessionToken(token)]
    );
    if (!account) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
    }
    req.account = account;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not verify your session.' });
  }
}

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/') ||
      (req.method === 'GET' && /^\/invitations\/[^/]+$/.test(req.path))) return next();
  return requireAuth(req, res, next);
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    id: req.account.id,
    email: req.account.email,
    name: req.account.name,
    personId: req.account.person_id,
    workspaceId: req.account.workspace_id,
    workspaceName: req.account.workspace_name
  });
});

async function findAccessibleBudget(budgetId, account, executor = pool) {
  const query = buildAccessibleBudgetQuery(budgetId, account);
  const [rows] = await executor.execute(query.sql, query.parameters);
  return rows[0] || null;
}

async function budgetSpend(budget, range, executor = pool) {
  return getBudgetSpend(executor, budget, range);
}

async function getBudgetUtilization(budget, executor = pool) {
  const ranges = periodRanges(budget);
  const [spent, previousSpent] = await Promise.all([
    budgetSpend(budget, ranges.current, executor),
    budgetSpend(budget, ranges.previous, executor),
  ]);
  const amount = Number(budget.amount);
  return {
    budgetId: budget.id,
    period: budget.period,
    currentPeriod: { ...ranges.current, spent, budgetAmount: amount, remaining: amount - spent, percentUsed: amount ? spent / amount * 100 : 0 },
    previousPeriod: { ...ranges.previous, spent: previousSpent, budgetAmount: amount, remaining: amount - previousSpent, percentUsed: amount ? previousSpent / amount * 100 : 0 },
    paused: Boolean(budget.is_paused),
    alerts: budget.is_paused ? [] : (Array.isArray(budget.alert_thresholds) ? budget.alert_thresholds : JSON.parse(budget.alert_thresholds)).filter(threshold => spent / amount * 100 >= threshold),
  };
}

async function runBudgetAlerts() {
  try {
    const [budgets] = await pool.execute(
      `SELECT b.*, DATE_FORMAT(b.start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(b.end_date, '%Y-%m-%d') AS end_date
       FROM budgets b WHERE b.is_active = TRUE AND b.is_paused = FALSE`
    );
    const today = new Date().toISOString().slice(0, 10);
    for (const budget of budgets) {
      const ranges = periodRanges(budget);
      if (ranges.current.startDate > today || ranges.current.endDate <= ranges.current.startDate ||
          (budget.end_date && String(budget.end_date) < today)) continue;
      const utilization = await getBudgetUtilization(budget);
      const percentUsed = utilization.currentPeriod.percentUsed;
      const configured = Array.isArray(budget.alert_thresholds)
        ? budget.alert_thresholds : JSON.parse(budget.alert_thresholds);
      const crossed = budgetAlertThresholdsCrossed(configured, percentUsed);
      if (!crossed.length) continue;
      let accountIds;
      if (budget.budget_type === 'personal') {
        const [accounts] = await pool.execute(
          'SELECT account_id FROM workspace_members WHERE workspace_id = ? AND person_id = ?',
          [budget.workspace_id, budget.person_id]
        );
        accountIds = accounts.map(row => row.account_id);
      } else {
        const [accounts] = await pool.execute(
          `SELECT DISTINCT wm.account_id FROM group_members gm
           JOIN people p ON p.id = gm.person_id AND p.workspace_id = ?
           JOIN workspace_members wm ON wm.person_id = p.id AND wm.workspace_id = p.workspace_id
           WHERE gm.group_id = ?`,
          [budget.workspace_id, budget.group_id]
        );
        accountIds = accounts.map(row => row.account_id);
      }
      for (const threshold of crossed) {
        const exceeded = threshold === 'exceeded';
        const label = exceeded ? 'Budget exceeded' : `${threshold}% of budget used`;
        await createNotifications(pool, {
          workspaceId: budget.workspace_id,
          accountIds,
          type: 'budget_alert',
          title: `${budget.name}: ${label}`,
          message: exceeded
            ? `${budget.name} is over its ${budget.period} limit (${percentUsed.toFixed(0)}% used).`
            : `${budget.name} has reached ${threshold}% of its ${budget.period} limit (${percentUsed.toFixed(0)}% used).`,
          targetType: 'budget',
          targetId: budget.id,
          targetDate: ranges.current.startDate,
          dedupeKey: budgetAlertDedupeKey(budget.id, ranges.current.startDate, threshold),
        });
      }
    }
  } catch (error) {
    console.error('Budget alert processing failed', error);
  }
}

app.post('/api/budgets', async (req, res) => {
  try {
    const data = validateBudgetInput(req.body);
    let groupId = null;
    let personId = req.account.person_id;
    if (data.budgetType === 'group') {
      const [groups] = await q(
        `SELECT g.id FROM \`groups\` g JOIN group_members gm ON gm.group_id = g.id
         WHERE g.id = ? AND g.workspace_id = ? AND gm.person_id = ?`,
        [data.groupId, req.account.workspace_id, req.account.person_id]
      );
      if (!groups.length) return res.status(403).json({ error: 'You must belong to this group to create its budget.' });
      groupId = data.groupId; personId = null;
    }
    const [result] = await pool.execute(
      `INSERT INTO budgets(workspace_id, created_by, name, budget_type, person_id, group_id, category,
        amount, currency, exchange_rate_to_inr, period, start_date, end_date, alert_thresholds)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.account.workspace_id, req.account.person_id, data.name, data.budgetType, personId, groupId,
        data.category, data.amount, data.currency, data.exchangeRateToInr, data.period, data.startDate, data.endDate, JSON.stringify(data.alertThresholds)]
    );
    res.status(201).json({ id: result.insertId, message: 'Budget created.' });
  } catch (error) {
    if (error instanceof TypeError) return res.status(400).json({ error: error.message });
    console.error(error); res.status(500).json({ error: 'Could not create this budget.' });
  }
});

app.get('/api/budgets', async (req, res) => {
  try {
    const budgets = await q(
      `SELECT b.*, DATE_FORMAT(b.start_date, '%Y-%m-%d') AS start_date,
       DATE_FORMAT(b.end_date, '%Y-%m-%d') AS end_date, g.name AS group_name
       FROM budgets b LEFT JOIN \`groups\` g ON g.id = b.group_id
       WHERE b.workspace_id = ? AND b.is_active = TRUE AND
       ((b.budget_type = 'personal' AND b.person_id = ?) OR (b.budget_type = 'group' AND EXISTS
         (SELECT 1 FROM group_members gm WHERE gm.group_id = b.group_id AND gm.person_id = ?)))
       ORDER BY b.created_at DESC`,
      [req.account.workspace_id, req.account.person_id, req.account.person_id]
    );
    const result = await Promise.all(budgets.map(async budget => ({ ...budget, utilization: await getBudgetUtilization(budget) })));
    res.json(result);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not load budgets.' }); }
});

app.get('/api/budgets/:budgetId', async (req, res) => {
  const id = Number(req.params.budgetId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid budget.' });
  try {
    const budget = await findAccessibleBudget(id, req.account);
    if (!budget) return res.status(404).json({ error: 'Budget not found.' });
    res.json({ ...budget, utilization: await getBudgetUtilization(budget) });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not load this budget.' }); }
});

app.put('/api/budgets/:budgetId', async (req, res) => {
  const id = Number(req.params.budgetId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid budget.' });
  try {
    const old = await findAccessibleBudget(id, req.account);
    if (!old) return res.status(404).json({ error: 'Budget not found.' });
    const data = validateBudgetInput(req.body);
    let groupId = null; let personId = req.account.person_id;
    if (data.budgetType === 'group') {
      const [groups] = await q(`SELECT g.id FROM \`groups\` g JOIN group_members gm ON gm.group_id = g.id WHERE g.id = ? AND g.workspace_id = ? AND gm.person_id = ?`, [data.groupId, req.account.workspace_id, req.account.person_id]);
      if (!groups.length) return res.status(403).json({ error: 'You must belong to this group to manage its budget.' });
      groupId = data.groupId; personId = null;
    }
    await q(`UPDATE budgets SET name=?, budget_type=?, person_id=?, group_id=?, category=?, amount=?, currency=?, exchange_rate_to_inr=?, period=?, start_date=?, end_date=?, alert_thresholds=? WHERE id=? AND workspace_id=?`,
      [data.name, data.budgetType, personId, groupId, data.category, data.amount, data.currency, data.exchangeRateToInr, data.period, data.startDate, data.endDate, JSON.stringify(data.alertThresholds), id, req.account.workspace_id]);
    res.json({ ok: true, message: 'Budget updated.' });
  } catch (error) { if (error instanceof TypeError) return res.status(400).json({ error: error.message }); console.error(error); res.status(500).json({ error: 'Could not update this budget.' }); }
});

app.delete('/api/budgets/:budgetId', async (req, res) => {
  const id = Number(req.params.budgetId);
  try {
    const budget = await findAccessibleBudget(id, req.account);
    if (!budget) return res.status(404).json({ error: 'Budget not found.' });
    await q('UPDATE budgets SET is_active = FALSE WHERE id = ? AND workspace_id = ?', [id, req.account.workspace_id]);
    res.json({ ok: true, message: 'Budget deactivated.' });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not deactivate this budget.' }); }
});

app.patch('/api/budgets/:budgetId/pause', async (req, res) => {
  const id = Number(req.params.budgetId);
  try {
    const budget = await findAccessibleBudget(id, req.account);
    if (!budget) return res.status(404).json({ error: 'Budget not found.' });
    if (typeof req.body?.paused !== 'boolean') return res.status(400).json({ error: 'Set paused to true or false.' });
    await q('UPDATE budgets SET is_paused = ? WHERE id = ? AND workspace_id = ?', [req.body.paused, id, req.account.workspace_id]);
    res.json({ ok: true, paused: req.body.paused });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not change the budget state.' }); }
});

app.get('/api/budgets/:budgetId/utilization', async (req, res) => {
  const id = Number(req.params.budgetId);
  try { const budget = await findAccessibleBudget(id, req.account); if (!budget) return res.status(404).json({ error: 'Budget not found.' }); res.json(await getBudgetUtilization(budget)); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Could not calculate budget utilization.' }); }
});

app.get('/api/budgets/:budgetId/history', async (req, res) => {
  const id = Number(req.params.budgetId);
  const limit = Number(req.query.limit || 12);
  if (!Number.isInteger(limit) || limit < 1 || limit > 60) return res.status(400).json({ error: 'History limit must be from 1 to 60.' });
  try {
    const budget = await findAccessibleBudget(id, req.account);
    if (!budget) return res.status(404).json({ error: 'Budget not found.' });
    const current = periodRanges(budget).current;
    const end = new Date(`${current.startDate}T00:00:00.000Z`);
    const history = [];
    for (let i = 0; i < limit; i++) {
      const previousEnd = end.toISOString().slice(0, 10);
      const start = new Date(end);
      if (budget.period === 'weekly') start.setUTCDate(start.getUTCDate() - 7);
      else if (budget.period === 'monthly') start.setUTCMonth(start.getUTCMonth() - 1);
      else start.setUTCFullYear(start.getUTCFullYear() - 1);
      const range = { startDate: start.toISOString().slice(0, 10), endDate: previousEnd };
      if (budget.end_date && range.startDate >= String(budget.end_date).slice(0, 10)) continue;
      const spent = await budgetSpend(budget, range);
      history.unshift({ ...range, spent, budgetAmount: Number(budget.amount), percentUsed: spent / Number(budget.amount) * 100 });
      end.setTime(start.getTime());
    }
    res.json(history);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not load budget history.' }); }
});

app.get('/api/budgets/:budgetId/alerts', async (req, res) => {
  const id = Number(req.params.budgetId);
  try { const budget = await findAccessibleBudget(id, req.account); if (!budget) return res.status(404).json({ error: 'Budget not found.' }); const utilization = await getBudgetUtilization(budget); res.json(utilization.alerts.map(threshold => ({ threshold, percentUsed: utilization.currentPeriod.percentUsed, spent: utilization.currentPeriod.spent, budgetAmount: utilization.currentPeriod.budgetAmount }))); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Could not load budget alerts.' }); }
});

app.get('/api/notifications', async (req, res) => {
  const requestedLimit = Number(req.query.limit || 25);
  const requestedOffset = Number(req.query.offset || 0);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100 ||
      !Number.isSafeInteger(requestedOffset) || requestedOffset < 0 || requestedOffset > 1000000) {
    return res.status(400).json({ error: 'Notification pages must use a limit from 1 to 100 and a non-negative offset.' });
  }
  try {
    const [page, counts] = await Promise.all([
      q(
        `SELECT n.id, n.workspace_id, w.name AS workspace_name, n.notification_type,
                n.title, n.message, n.target_type, n.target_id, n.target_date,
                n.created_at, n.read_at
         FROM notifications n
         JOIN workspaces w ON w.id = n.workspace_id
         WHERE n.account_id = ?
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT ? OFFSET ?`,
        [req.account.id, requestedLimit + 1, requestedOffset]
      ),
      q(
        `SELECT COUNT(*) AS unread_count FROM notifications
         WHERE account_id = ? AND read_at IS NULL`,
        [req.account.id]
      ),
    ]);
    const hasMore = page.length > requestedLimit;
    res.json({
      notifications: page.slice(0, requestedLimit),
      unreadCount: Number(counts[0]?.unread_count || 0),
      hasMore,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load your notifications.' });
  }
});

app.get('/api/notification-preferences', async (req, res) => {
  try {
    const [preferences] = await q(
      'SELECT * FROM notification_preferences WHERE account_id = ?',
      [req.account.id]
    );
    const saved = preferences || {};
    res.json({
      expense_created: Number(saved.expense_created ?? 1) !== 0,
      expense_updated: Number(saved.expense_updated ?? 1) !== 0,
      settlement_recorded: Number(saved.settlement_recorded ?? 1) !== 0,
      settlement_reminder: Number(saved.settlement_reminder ?? 1) !== 0,
      group_invitation: Number(saved.group_invitation ?? 1) !== 0,
      member_joined: Number(saved.member_joined ?? 1) !== 0,
      recurring_generated: Number(saved.recurring_generated ?? 1) !== 0,
      recurring_confirmation: Number(saved.recurring_confirmation ?? 1) !== 0,
      budget_alert: Number(saved.budget_alert ?? 1) !== 0,
      settlement_reminder_frequency: saved.settlement_reminder_frequency || 'weekly',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load notification preferences.' });
  }
});

app.put('/api/notification-preferences', async (req, res) => {
  const body = req.body || {};
  const booleanPreferences = [
    'expense_created', 'expense_updated', 'settlement_recorded',
    'settlement_reminder', 'group_invitation', 'member_joined',
    'recurring_generated', 'recurring_confirmation', 'budget_alert',
  ];
  const allowedFields = new Set([...booleanPreferences, 'settlement_reminder_frequency']);
  const suppliedFields = Object.keys(body);
  if (!suppliedFields.length || suppliedFields.some(key => !allowedFields.has(key)) ||
      booleanPreferences.some(key => Object.prototype.hasOwnProperty.call(body, key) && typeof body[key] !== 'boolean') ||
      (Object.prototype.hasOwnProperty.call(body, 'settlement_reminder_frequency') &&
        !['off', 'daily', 'weekly'].includes(body.settlement_reminder_frequency))) {
    return res.status(400).json({ error: 'Choose valid notification preferences and a daily, weekly, or off reminder frequency.' });
  }
  try {
    const [existing] = await q(
      'SELECT * FROM notification_preferences WHERE account_id = ?',
      [req.account.id]
    );
    const defaults = Object.fromEntries(booleanPreferences.map(key => [key, true]));
    const values = {
      ...defaults,
      ...existing,
      ...body,
      settlement_reminder_frequency: body.settlement_reminder_frequency ||
        existing?.settlement_reminder_frequency || 'weekly',
    };
    await q(
      `INSERT INTO notification_preferences
       (account_id, expense_created, expense_updated, settlement_recorded,
        settlement_reminder, group_invitation, member_joined, recurring_generated,
        recurring_confirmation, budget_alert, settlement_reminder_frequency)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        expense_created = VALUES(expense_created),
        expense_updated = VALUES(expense_updated),
        settlement_recorded = VALUES(settlement_recorded),
        settlement_reminder = VALUES(settlement_reminder),
        group_invitation = VALUES(group_invitation),
        member_joined = VALUES(member_joined),
        recurring_generated = VALUES(recurring_generated),
        recurring_confirmation = VALUES(recurring_confirmation),
        budget_alert = VALUES(budget_alert),
        settlement_reminder_frequency = VALUES(settlement_reminder_frequency)`,
      [
        req.account.id,
        ...booleanPreferences.map(key => Number(values[key]) !== 0 ? 1 : 0),
        values.settlement_reminder_frequency,
      ]
    );
    res.json({
      ...Object.fromEntries(booleanPreferences.map(key => [key, Number(values[key]) !== 0])),
      settlement_reminder_frequency: values.settlement_reminder_frequency,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not save notification preferences.' });
  }
});

app.patch('/api/notifications/:notificationId/read', async (req, res) => {
  const notificationId = Number(req.params.notificationId);
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
    return res.status(400).json({ error: 'Notification ID must be a positive integer.' });
  }
  try {
    const result = await q(
      'UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE id = ? AND account_id = ?',
      [notificationId, req.account.id]
    );
    if (!result.affectedRows) {
      const [existing] = await q(
        'SELECT id FROM notifications WHERE id = ? AND account_id = ?',
        [notificationId, req.account.id]
      );
      if (!existing) return res.status(404).json({ error: 'Notification not found.' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not mark this notification as read.' });
  }
});

app.post('/api/notifications/read-all', async (req, res) => {
  try {
    const result = await q(
      'UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE account_id = ? AND read_at IS NULL',
      [req.account.id]
    );
    res.json({ ok: true, count: result.affectedRows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not mark your notifications as read.' });
  }
});

app.delete('/api/notifications/:notificationId', async (req, res) => {
  const notificationId = Number(req.params.notificationId);
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
    return res.status(400).json({ error: 'Notification ID must be a positive integer.' });
  }
  try {
    const result = await q(
      'DELETE FROM notifications WHERE id = ? AND account_id = ?',
      [notificationId, req.account.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not dismiss this notification.' });
  }
});

app.get('/api/workspaces', async (req, res) => {
  try {
    const workspaces = await q(
      `SELECT w.id, w.name, wm.person_id, (w.id = ?) AS active
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.account_id = ?
       ORDER BY active DESC, w.name, w.id`,
      [req.account.workspace_id, req.account.id]
    );
    res.json(workspaces);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load your workspaces.' });
  }
});

app.post('/api/workspaces/active', async (req, res) => {
  const workspaceId = Number(req.body?.workspaceId);
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Choose a valid workspace.' });
  }
  try {
    const token = getSessionToken(req);
    const [membership] = await q(
      'SELECT workspace_id FROM workspace_members WHERE account_id = ? AND workspace_id = ?',
      [req.account.id, workspaceId]
    );
    if (!membership) return res.status(404).json({ error: 'Workspace not found.' });
    await q(
      'UPDATE auth_sessions SET workspace_id = ? WHERE token_hash = ? AND account_id = ?',
      [workspaceId, hashSessionToken(token), req.account.id]
    );
    res.json({ ok: true, workspaceId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not switch workspaces.' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get('/api/invitations/:token', async (req, res) => {
  const token = req.params.token;
  if (!token || token.length > 128) {
    return res.status(400).json({ error: 'Invitation link is invalid or expired.' });
  }
  try {
    const [invitation] = await q(
      `SELECT i.email, i.invitee_account_id IS NOT NULL AS existing_account,
              w.name AS workspace_name
       FROM workspace_invitations i
       JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.token_hash = ? AND i.accepted_at IS NULL
         AND i.expires_at > UTC_TIMESTAMP()`,
      [hashSessionToken(token)]
    );
    if (!invitation) return res.status(400).json({ error: 'Invitation link is invalid or expired.' });
    res.json(invitation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load this invitation.' });
  }
});

app.get('/api/users/search', async (req, res) => {
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (search.length < 2 || search.length > 80) {
    return res.status(400).json({ error: 'Enter at least 2 and no more than 80 characters.' });
  }
  try {
    const matches = await q(
      `SELECT a.id AS account_id, p.name
       FROM accounts a
       JOIN people p ON p.id = a.person_id
       LEFT JOIN workspace_members wm
         ON wm.account_id = a.id AND wm.workspace_id = ?
       LEFT JOIN workspace_invitations wi
         ON wi.invitee_account_id = a.id AND wi.workspace_id = ?
         AND wi.accepted_at IS NULL AND wi.expires_at > UTC_TIMESTAMP()
       WHERE a.id <> ? AND wm.account_id IS NULL AND wi.id IS NULL
         AND LOCATE(LOWER(?), LOWER(p.name)) > 0
       ORDER BY p.name, a.id
       LIMIT 10`,
      [req.account.workspace_id, req.account.workspace_id, req.account.id, search]
    );
    res.json(matches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not search users.' });
  }
});

app.post('/api/invitations', async (req, res) => {
  const inviteeAccountId = Number(req.body?.accountId);
  const hasAccountId = Number.isInteger(inviteeAccountId) && inviteeAccountId > 0;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!hasAccountId && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  try {
    let targetEmail = email;
    if (hasAccountId) {
      const [targetAccount] = await q(
        'SELECT id, email FROM accounts WHERE id = ?',
        [inviteeAccountId]
      );
      if (!targetAccount || targetAccount.id === req.account.id) {
        return res.status(404).json({ error: 'User not found.' });
      }
      const [membership] = await q(
        'SELECT account_id FROM workspace_members WHERE account_id = ? AND workspace_id = ?',
        [inviteeAccountId, req.account.workspace_id]
      );
      if (membership) return res.status(409).json({ error: 'This user is already in your workspace.' });
      targetEmail = targetAccount.email;
    } else {
      const [existingAccount] = await q('SELECT id FROM accounts WHERE email = ?', [email]);
      if (existingAccount) {
        return res.status(400).json({ error: 'This email belongs to an existing account. Search for their name instead.' });
      }
    }

    const [pending] = await q(
      `SELECT id FROM workspace_invitations
       WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP()
         AND ((? IS NOT NULL AND invitee_account_id = ?) OR email = ?)`,
      [req.account.workspace_id, hasAccountId ? inviteeAccountId : null, hasAccountId ? inviteeAccountId : 0, targetEmail]
    );
    if (pending) {
      return res.status(202).json({ message: 'If the address can be invited, an invitation email will arrive shortly.' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const connection = await pool.getConnection();
    let invitationId;
    try {
      await connection.beginTransaction();
      const [invitation] = await connection.execute(
        `INSERT INTO workspace_invitations(workspace_id, invitee_account_id, email, token_hash, invited_by, expires_at)
         VALUES(?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))`,
        [req.account.workspace_id, hasAccountId ? inviteeAccountId : null, targetEmail, hashSessionToken(token), req.account.id]
      );
      invitationId = invitation.insertId;
      if (hasAccountId) {
        await createNotifications(connection, {
          workspaceId: req.account.workspace_id,
          accountIds: [inviteeAccountId],
          type: 'group_invitation',
          title: 'Group invitation',
          message: `${req.account.name} invited you to ${req.account.workspace_name}.`,
          targetType: 'invitation',
          targetId: invitationId,
          dedupeKey: `group-invitation:${invitationId}`,
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const inviteUrl = `${appUrl}/?invite=${encodeURIComponent(token)}`;
    try {
      await sendEmail({
        to: targetEmail,
        subject: 'You are invited to GroupBuk',
        text: `${req.account.name} invited you to join the ${req.account.workspace_name} GroupBuk workspace. Accept the invitation: ${inviteUrl}`
      });
    } catch (emailError) {
      console.error('Workspace invitation email delivery failed', emailError);
      return res.status(201).json({
        message: 'Email could not be sent. Share the invitation link manually.',
        emailSent: false,
        invitationUrl: inviteUrl
      });
    }
    res.status(201).json({
      message: 'Invitation email sent. You can also share the invitation link.',
      emailSent: true,
      invitationUrl: inviteUrl
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create this invitation.' });
  }
});

app.post('/api/invitations/accept', requireAuth, async (req, res) => {
  const token = req.body?.token;
  const invitationId = Number(req.body?.invitationId);
  const hasToken = typeof token === 'string' && token.length >= 20 && token.length <= 128;
  const hasInvitationId = Number.isSafeInteger(invitationId) && invitationId > 0;
  if (!hasToken && !hasInvitationId) {
    return res.status(400).json({ error: 'Invitation link is invalid or expired.' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [invitations] = await connection.execute(
      `SELECT i.id, i.workspace_id, w.name AS workspace_name FROM workspace_invitations i
       JOIN workspaces w ON w.id = i.workspace_id
       WHERE ((? IS NOT NULL AND token_hash = ?) OR (? IS NOT NULL AND id = ?))
         AND i.invitee_account_id = ? AND i.accepted_at IS NULL
         AND i.expires_at > UTC_TIMESTAMP() FOR UPDATE`,
      [
        hasToken ? hashSessionToken(token) : null,
        hasToken ? hashSessionToken(token) : '',
        hasInvitationId ? invitationId : null,
        hasInvitationId ? invitationId : 0,
        req.account.id,
      ]
    );
    const invitation = invitations[0];
    if (!invitation) {
      await connection.rollback();
      return res.status(400).json({ error: 'This invitation is invalid, expired, or for another account.' });
    }

    const [existingMembership] = await connection.execute(
      'SELECT person_id FROM workspace_members WHERE account_id = ? AND workspace_id = ?',
      [req.account.id, invitation.workspace_id]
    );
    let personId = existingMembership[0]?.person_id;
    const joined = !personId;
    if (!personId) {
      const [availablePeople] = await connection.execute(
        `SELECT p.id FROM people p
         LEFT JOIN accounts a ON a.person_id = p.id
         LEFT JOIN workspace_members wm ON wm.person_id = p.id
         WHERE p.workspace_id = ? AND LOWER(TRIM(p.name)) = LOWER(?)
           AND a.id IS NULL AND wm.account_id IS NULL
         ORDER BY p.id LIMIT 1 FOR UPDATE`,
        [invitation.workspace_id, req.account.name]
      );
      if (availablePeople[0]) {
        personId = availablePeople[0].id;
      } else {
        const initials = req.account.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
        const [person] = await connection.execute(
          'INSERT INTO people(workspace_id, name, initials) VALUES(?, ?, ?)',
          [invitation.workspace_id, req.account.name, initials]
        );
        personId = person.insertId;
      }
      await connection.execute(
        'INSERT INTO workspace_members(account_id, workspace_id, person_id) VALUES(?, ?, ?)',
        [req.account.id, invitation.workspace_id, personId]
      );
    }
    await connection.execute(
      'UPDATE workspace_invitations SET accepted_at = UTC_TIMESTAMP() WHERE id = ?',
      [invitation.id]
    );
    await connection.execute(
      'UPDATE auth_sessions SET workspace_id = ? WHERE token_hash = ? AND account_id = ?',
      [invitation.workspace_id, hashSessionToken(getSessionToken(req)), req.account.id]
    );
    await connection.execute(
      `UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP())
       WHERE account_id = ? AND target_type = 'invitation' AND target_id = ?`,
      [req.account.id, invitation.id]
    );
    if (joined) {
      await notifyWorkspaceMembers(connection, invitation.workspace_id, {
        type: 'member_joined',
        title: 'A member joined',
        message: `${req.account.name} joined ${invitation.workspace_name}.`.slice(0, 500),
        targetType: 'workspace',
        targetId: invitation.workspace_id,
        dedupeKey: `member-joined:${invitation.id}`,
      }, req.account.id);
    }
    await connection.commit();
    res.json({ ok: true, workspaceId: invitation.workspace_id });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    res.status(500).json({ error: 'Could not accept this invitation.' });
  } finally {
    connection?.release();
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const workspaceId = req.account.workspace_id;
    const people = await q(
      'SELECT id, name, initials, color FROM people WHERE workspace_id = ? ORDER BY id',
      [workspaceId]
    );
    const groups = await q(
      `SELECT g.id, g.name, g.icon, g.color, COUNT(DISTINCT e.id) AS expenses,
              COALESCE(SUM(e.amount), 0) AS total
       FROM \`groups\` g
       LEFT JOIN expenses e ON e.group_id = g.id
       WHERE g.workspace_id = ?
       GROUP BY g.id
       ORDER BY g.id`,
      [workspaceId]
    );
    const members = await q(
      `SELECT gm.group_id, p.id, p.name, p.initials, p.color
       FROM group_members gm
       JOIN people p ON p.id = gm.person_id AND p.workspace_id = ?
       JOIN \`groups\` g ON g.id = gm.group_id AND g.workspace_id = ?
       ORDER BY p.name, p.id`,
      [workspaceId, workspaceId]
    );
    const membersByGroup = new Map();
    for (const person of members) {
      const groupMembers = membersByGroup.get(person.group_id) || [];
      groupMembers.push({
        id: person.id,
        name: person.name,
        initials: person.initials,
        color: person.color
      });
      membersByGroup.set(person.group_id, groupMembers);
    }
    for (const group of groups) {
      group.members = membersByGroup.get(group.id) || [];
    }
    const groupBalances = await getWorkspaceGroupBalances(workspaceId);
    const groupBalancesById = new Map();
    for (const person of groupBalances) {
      const balances = groupBalancesById.get(person.group_id) || [];
      balances.push(person);
      groupBalancesById.set(person.group_id, balances);
    }
    for (const group of groups) {
      const balances = groupBalancesById.get(group.id) || [];
      group.balance_people = balances;
      const userBalance = balances.find(person => person.id === req.account.person_id);
      group.user_balance = Number(userBalance?.balance || 0);
      group.settlement_suggestions = calculateMinimalSettlements(balances)
        .map(payment => ({
          ...payment,
          groupId: group.id,
          groupName: group.name
        }));
      group.settlement_suggestion = group.settlement_suggestions.find(payment =>
        payment.payerId === req.account.person_id || payment.payeeId === req.account.person_id
      ) || null;
    }
    const activity = await q(
      `SELECT e.id, e.title, e.amount, e.category, e.created_at, p.name AS payer,
              p.initials, p.color, g.name AS group_name
       FROM expenses e
       JOIN people p ON p.id = e.paid_by AND p.workspace_id = ?
       JOIN \`groups\` g ON g.id = e.group_id
       WHERE g.workspace_id = ?
       ORDER BY e.created_at DESC
       LIMIT 12`,
      [workspaceId, workspaceId]
    );
    const [activityCount] = await q(
      'SELECT COUNT(*) AS count FROM expenses e JOIN `groups` g ON g.id = e.group_id WHERE g.workspace_id = ?',
      [workspaceId]
    );
    const net = await getWorkspaceBalances(workspaceId);
    res.json({
      people,
      groups,
      activity,
      activityCount: Number(activityCount.count),
      balances: net,
      currentUserId: req.account.person_id
    });
  } catch (error) {
    console.error(error);
    const schemaErrors = ['ER_NO_SUCH_TABLE', 'ER_VIEW_INVALID'];
    const connectionErrors = [
      'ECONNREFUSED',
      'ER_ACCESS_DENIED_ERROR',
      'ER_BAD_DB_ERROR',
      'PROTOCOL_CONNECTION_LOST',
      'ETIMEDOUT'
    ];
    let message = 'Could not load your expense data. Check the backend logs for the database error.';
    if (schemaErrors.includes(error.code)) {
      message = 'The expense database schema is missing or out of date. Restart the backend to run its startup migrations, then retry.';
    } else if (error.code === 'ER_BAD_FIELD_ERROR') {
      message = 'The backend query references a database column that is unavailable. Check the backend logs and confirm the running backend and database schema are compatible.';
    } else if (connectionErrors.includes(error.code)) {
      message = 'The backend could not connect to its configured database. Check the database settings and availability.';
    }
    res.status(500).json({ error: message });
  }
});

app.get('/api/recurring-expenses', async (req, res) => {
  try {
    const workspaceId = req.account.workspace_id;
    const templates = await q(
      `SELECT r.*, g.name AS group_name, p.name AS payer_name
       FROM recurring_expenses r
       JOIN \`groups\` g ON g.id = r.group_id AND g.workspace_id = ?
       JOIN people p ON p.id = r.paid_by AND p.workspace_id = ?
       WHERE r.workspace_id = ?
       ORDER BY r.status = 'active' DESC, r.next_occurrence_date, r.id`,
      [workspaceId, workspaceId, workspaceId]
    );
    if (!templates.length) return res.json({ templates: [], occurrences: [] });
    const ids = templates.map(template => template.id);
    const placeholders = ids.map(() => '?').join(',');
    const [participants, occurrences] = await Promise.all([
      q(
        `SELECT rp.template_id, rp.person_id, rp.share_percent, p.name
         FROM recurring_expense_participants rp
         JOIN people p ON p.id = rp.person_id AND p.workspace_id = ?
         WHERE rp.template_id IN (${placeholders})
         ORDER BY rp.template_id, p.name, p.id`,
        [workspaceId, ...ids]
      ),
      q(
        `SELECT o.id, o.template_id, o.occurrence_date, o.status, o.expense_id,
                o.entered_amount, o.base_amount, o.generated_at,
                r.title, r.currency, r.amount AS expected_amount, r.variable_amount,
                g.name AS group_name, e.title AS expense_title, e.amount AS expense_base_amount
         FROM recurring_expense_occurrences o
         JOIN recurring_expenses r ON r.id = o.template_id
         JOIN \`groups\` g ON g.id = r.group_id AND g.workspace_id = ?
         LEFT JOIN expenses e ON e.id = o.expense_id
         WHERE o.template_id IN (${placeholders})
         ORDER BY o.occurrence_date DESC, o.id DESC
         LIMIT 200`,
        [workspaceId, ...ids]
      ),
    ]);
    const participantsByTemplate = new Map();
    for (const participant of participants) {
      const current = participantsByTemplate.get(participant.template_id) || [];
      current.push(participant);
      participantsByTemplate.set(participant.template_id, current);
    }
    for (const template of templates) {
      template.participants = participantsByTemplate.get(template.id) || [];
    }
    res.json({ templates, occurrences });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load recurring expenses.' });
  }
});

app.post('/api/recurring-expenses', async (req, res) => {
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const groupId = Number(body.groupId);
  const paidBy = Number(body.paidBy);
  const amount = Number(body.amount);
  const exchangeRateToInr = Number(body.exchangeRateToInr);
  const baseAmount = Math.round(amount * exchangeRateToInr * 100) / 100;
  const participantInput = Array.isArray(body.participants) ? body.participants : [];
  const participants = participantInput.map(participant => ({
    personId: Number(participant?.personId),
    sharePercent: participant?.sharePercent === null || participant?.sharePercent === undefined
      ? null
      : Number(participant.sharePercent),
  }));
  const participantIds = participants.map(participant => participant.personId);
  const frequency = body.frequency;
  const splitMethod = body.splitMethod;
  const currency = body.currency;
  let startDate;
  let endDate;
  try {
    startDate = dateOnly(body.startDate);
    endDate = body.endDate ? dateOnly(body.endDate) : null;
  } catch {
    return res.status(400).json({ error: 'Enter valid recurring expense start and end dates.' });
  }
  const today = new Date().toISOString().slice(0, 10);
  const customTotal = participants.reduce((sum, participant) => sum + Number(participant.sharePercent || 0), 0);
  if (!title || title.length > 255 || description.length > 2000 ||
      !category || category.length > 100 ||
      !Number.isInteger(groupId) || groupId <= 0 ||
      !Number.isInteger(paidBy) || paidBy <= 0 ||
      !Number.isFinite(amount) || amount <= 0 || amount > 9999999999 ||
      !Number.isFinite(exchangeRateToInr) || exchangeRateToInr <= 0 ||
      exchangeRateToInr >= 10000000 || baseAmount > 9999999999.99 ||
      !Number.isSafeInteger(Math.round(amount * 100)) ||
      !Number.isSafeInteger(Math.round(baseAmount * 100)) || baseAmount <= 0 ||
      !['INR', 'USD'].includes(currency) ||
      (currency === 'INR' && Math.abs(exchangeRateToInr - 1) > 0.000001) ||
      !['weekly', 'monthly', 'quarterly', 'yearly'].includes(frequency) ||
      !['equal', 'custom'].includes(splitMethod) ||
      typeof body.variableAmount !== 'boolean' ||
      !participantIds.length || participantIds.some(id => !Number.isInteger(id) || id <= 0) ||
      new Set(participantIds).size !== participantIds.length ||
      (endDate && endDate < startDate) || startDate < today ||
      (splitMethod === 'custom' && (
        participants.some(participant => !Number.isFinite(participant.sharePercent) || participant.sharePercent <= 0) ||
        Math.abs(customTotal - 100) > 0.01
      ))) {
    return res.status(400).json({ error: 'Check the title, group, amount, dates, split, currency, and participants.' });
  }

  let connection;
  let inTransaction = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const [groups] = await connection.execute(
      'SELECT id FROM `groups` WHERE id = ? AND workspace_id = ? FOR UPDATE',
      [groupId, req.account.workspace_id]
    );
    if (!groups.length) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({ error: 'Group not found.' });
    }
    const idsToCheck = [...new Set([paidBy, ...participantIds])];
    const [members] = await connection.execute(
      `SELECT gm.person_id AS id FROM group_members gm
       JOIN people p ON p.id = gm.person_id AND p.workspace_id = ?
       WHERE gm.group_id = ? AND gm.person_id IN (${idsToCheck.map(() => '?').join(',')})`,
      [req.account.workspace_id, groupId, ...idsToCheck]
    );
    if (members.length !== idsToCheck.length) {
      await connection.rollback();
      inTransaction = false;
      return res.status(400).json({ error: 'Choose a group member as payer and participants.' });
    }

    const anchorMonth = Number(startDate.slice(5, 7));
    const anchorDay = Number(startDate.slice(8, 10));
    const [template] = await connection.execute(
      `INSERT INTO recurring_expenses
       (workspace_id, group_id, created_by, paid_by, title, description, amount, base_amount,
        currency, exchange_rate_to_inr, category, split_method, variable_amount, frequency,
        start_date, end_date, anchor_month, anchor_day, next_occurrence_date, status)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        req.account.workspace_id, groupId, req.account.person_id, paidBy, title, description || null,
        amount, baseAmount, currency, exchangeRateToInr, category, splitMethod,
        body.variableAmount, frequency, startDate, endDate, anchorMonth, anchorDay, startDate,
      ]
    );
    for (const participant of participants) {
      await connection.execute(
        `INSERT INTO recurring_expense_participants(template_id, person_id, share_percent)
         VALUES(?, ?, ?)`,
        [template.insertId, participant.personId, splitMethod === 'custom' ? participant.sharePercent : null]
      );
    }
    await connection.commit();
    inTransaction = false;
    res.status(201).json({ ok: true, id: template.insertId, message: 'Recurring expense created.' });
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Recurring expense rollback failed', rollbackError);
      }
    }
    console.error(error);
    res.status(500).json({ error: 'Could not save this recurring expense.' });
  } finally {
    connection?.release();
  }
});

app.put('/api/recurring-expenses/:templateId', async (req, res) => {
  const templateId = Number(req.params.templateId);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return res.status(400).json({ error: 'Recurring expense ID must be a positive integer.' });
  }
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const groupId = Number(body.groupId);
  const paidBy = Number(body.paidBy);
  const amount = Number(body.amount);
  const exchangeRateToInr = Number(body.exchangeRateToInr);
  const baseAmount = Math.round(amount * exchangeRateToInr * 100) / 100;
  const participantInput = Array.isArray(body.participants) ? body.participants : [];
  const participants = participantInput.map(participant => ({
    personId: Number(participant?.personId),
    sharePercent: participant?.sharePercent === null || participant?.sharePercent === undefined
      ? null
      : Number(participant.sharePercent),
  }));
  const participantIds = participants.map(participant => participant.personId);
  const frequency = body.frequency;
  const splitMethod = body.splitMethod;
  const currency = body.currency;
  let startDate;
  let endDate;
  try {
    startDate = dateOnly(body.startDate);
    endDate = body.endDate ? dateOnly(body.endDate) : null;
  } catch {
    return res.status(400).json({ error: 'Enter valid recurring expense start and end dates.' });
  }
  const customTotal = participants.reduce((sum, participant) => sum + Number(participant.sharePercent || 0), 0);
  if (!title || title.length > 255 || description.length > 2000 ||
      !category || category.length > 100 ||
      !Number.isInteger(groupId) || groupId <= 0 ||
      !Number.isInteger(paidBy) || paidBy <= 0 ||
      !Number.isFinite(amount) || amount <= 0 || amount > 9999999999 ||
      !Number.isFinite(exchangeRateToInr) || exchangeRateToInr <= 0 ||
      exchangeRateToInr >= 10000000 || baseAmount > 9999999999.99 ||
      !Number.isSafeInteger(Math.round(amount * 100)) ||
      !Number.isSafeInteger(Math.round(baseAmount * 100)) || baseAmount <= 0 ||
      !['INR', 'USD'].includes(currency) ||
      (currency === 'INR' && Math.abs(exchangeRateToInr - 1) > 0.000001) ||
      !['weekly', 'monthly', 'quarterly', 'yearly'].includes(frequency) ||
      !['equal', 'custom'].includes(splitMethod) ||
      typeof body.variableAmount !== 'boolean' ||
      !participantIds.length || participantIds.some(id => !Number.isInteger(id) || id <= 0) ||
      new Set(participantIds).size !== participantIds.length ||
      (endDate && endDate < startDate) ||
      (splitMethod === 'custom' && (
        participants.some(participant => !Number.isFinite(participant.sharePercent) || participant.sharePercent <= 0) ||
        Math.abs(customTotal - 100) > 0.01
      ))) {
    return res.status(400).json({ error: 'Check the title, group, amount, dates, split, currency, and participants.' });
  }

  let connection;
  let inTransaction = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const [existing] = await connection.execute(
      `SELECT * FROM recurring_expenses
       WHERE id = ? AND workspace_id = ? FOR UPDATE`,
      [templateId, req.account.workspace_id]
    );
    if (!existing.length) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({ error: 'Recurring expense not found.' });
    }
    const old = existing[0];
    if (old.status === 'cancelled') {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({ error: 'Cancelled recurring expenses cannot be edited.' });
    }
    const [groups] = await connection.execute(
      'SELECT id FROM `groups` WHERE id = ? AND workspace_id = ? FOR UPDATE',
      [groupId, req.account.workspace_id]
    );
    if (!groups.length) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({ error: 'Group not found.' });
    }
    const idsToCheck = [...new Set([paidBy, ...participantIds])];
    const [members] = await connection.execute(
      `SELECT gm.person_id AS id FROM group_members gm
       JOIN people p ON p.id = gm.person_id AND p.workspace_id = ?
       WHERE gm.group_id = ? AND gm.person_id IN (${idsToCheck.map(() => '?').join(',')})`,
      [req.account.workspace_id, groupId, ...idsToCheck]
    );
    if (members.length !== idsToCheck.length) {
      await connection.rollback();
      inTransaction = false;
      return res.status(400).json({ error: 'Choose a group member as payer and participants.' });
    }

    const anchorMonth = Number(startDate.slice(5, 7));
    const anchorDay = Number(startDate.slice(8, 10));
    const today = new Date().toISOString().slice(0, 10);
    let nextDate = old.start_date === startDate && old.frequency === frequency && old.next_occurrence_date
      ? dateOnOrAfter(old.next_occurrence_date, frequency, anchorMonth, anchorDay, today)
      : dateOnOrAfter(startDate, frequency, anchorMonth, anchorDay, today);
    const completed = endDate && nextDate > endDate;
    nextDate = completed ? null : nextDate;
    const status = old.status === 'paused' ? 'paused' : completed ? 'completed' : 'active';
    await connection.execute(
      `UPDATE recurring_expenses SET group_id = ?, paid_by = ?, title = ?, description = ?,
       amount = ?, base_amount = ?, currency = ?, exchange_rate_to_inr = ?, category = ?,
       split_method = ?, variable_amount = ?, frequency = ?, start_date = ?, end_date = ?,
       anchor_month = ?, anchor_day = ?, next_occurrence_date = ?, status = ?
       WHERE id = ?`,
      [
        groupId, paidBy, title, description || null, amount, baseAmount, currency,
        exchangeRateToInr, category, splitMethod, body.variableAmount, frequency, startDate,
        endDate, anchorMonth, anchorDay, nextDate, status, templateId,
      ]
    );
    await connection.execute('DELETE FROM recurring_expense_participants WHERE template_id = ?', [templateId]);
    for (const participant of participants) {
      await connection.execute(
        `INSERT INTO recurring_expense_participants(template_id, person_id, share_percent)
         VALUES(?, ?, ?)`,
        [templateId, participant.personId, splitMethod === 'custom' ? participant.sharePercent : null]
      );
    }
    await connection.commit();
    inTransaction = false;
    res.json({ ok: true, message: 'Recurring expense updated.' });
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Recurring expense rollback failed', rollbackError);
      }
    }
    console.error(error);
    res.status(500).json({ error: 'Could not update this recurring expense.' });
  } finally {
    connection?.release();
  }
});

app.patch('/api/recurring-expenses/:templateId/status', async (req, res) => {
  const templateId = Number(req.params.templateId);
  const status = req.body?.status;
  if (!Number.isInteger(templateId) || templateId <= 0 || !['active', 'paused'].includes(status)) {
    return res.status(400).json({ error: 'Choose active or paused for a valid recurring expense.' });
  }
  try {
    const result = await q(
      `UPDATE recurring_expenses SET status = ?
       WHERE id = ? AND workspace_id = ? AND status IN ('active', 'paused')`,
      [status, templateId, req.account.workspace_id]
    );
    if (!result.affectedRows) {
      const [templates] = await q(
        'SELECT id FROM recurring_expenses WHERE id = ? AND workspace_id = ?',
        [templateId, req.account.workspace_id]
      );
      return res.status(templates.length ? 409 : 404).json({
        error: templates.length ? 'Completed or cancelled recurring expenses cannot be resumed.' : 'Recurring expense not found.',
      });
    }
    res.json({ ok: true, message: status === 'paused' ? 'Recurring expense paused.' : 'Recurring expense resumed.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not update recurring expense status.' });
  }
});

app.delete('/api/recurring-expenses/:templateId', async (req, res) => {
  const templateId = Number(req.params.templateId);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return res.status(400).json({ error: 'Recurring expense ID must be a positive integer.' });
  }
  try {
    const result = await q(
      `UPDATE recurring_expenses SET status = 'cancelled', next_occurrence_date = NULL
       WHERE id = ? AND workspace_id = ? AND status != 'cancelled'`,
      [templateId, req.account.workspace_id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Recurring expense not found.' });
    res.json({ ok: true, message: 'Recurring expense deactivated.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not deactivate this recurring expense.' });
  }
});

app.post('/api/recurring-expenses/:templateId/occurrences/:occurrenceDate/confirm', async (req, res) => {
  const templateId = Number(req.params.templateId);
  const amount = Number(req.body?.amount);
  let occurrenceDate;
  try {
    occurrenceDate = dateOnly(req.params.occurrenceDate);
  } catch {
    return res.status(400).json({ error: 'Enter a valid occurrence date.' });
  }
  if (!Number.isInteger(templateId) || templateId <= 0 ||
      !Number.isFinite(amount) || amount <= 0 || amount > 9999999999 ||
      !Number.isSafeInteger(Math.round(amount * 100))) {
    return res.status(400).json({ error: 'Enter a positive actual amount.' });
  }

  let connection;
  let inTransaction = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const [templates] = await connection.execute(
      `SELECT * FROM recurring_expenses
       WHERE id = ? AND workspace_id = ? AND variable_amount = TRUE FOR UPDATE`,
      [templateId, req.account.workspace_id]
    );
    if (!templates.length) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({ error: 'Variable recurring expense not found.' });
    }
    const template = templates[0];
    const [occurrences] = await connection.execute(
      `SELECT id, status FROM recurring_expense_occurrences
       WHERE template_id = ? AND occurrence_date = ? FOR UPDATE`,
      [templateId, occurrenceDate]
    );
    if (!occurrences.length || occurrences[0].status !== 'needs_confirmation') {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({ error: 'This occurrence is already handled or does not need confirmation.' });
    }
    const [participants] = await connection.execute(
      `SELECT person_id, share_percent FROM recurring_expense_participants
       WHERE template_id = ? ORDER BY person_id`,
      [templateId]
    );
    const baseAmount = Math.round(amount * Number(template.exchange_rate_to_inr) * 100) / 100;
    if (!Number.isSafeInteger(Math.round(baseAmount * 100)) || baseAmount <= 0 || baseAmount > 9999999999.99) {
      throw new Error('The confirmed amount could not be converted to the stored base currency.');
    }
    const expenseId = await createExpenseAndSplits(
      connection,
      template,
      occurrenceDate,
      amount,
      baseAmount,
      participants
    );
    await notifyGroupMembers(connection, template.workspace_id, template.group_id, {
      type: 'recurring_generated',
      title: 'Recurring expense recorded',
      message: `${template.title} was added to ${template.currency} group expenses.`,
      targetType: 'expense',
      targetId: expenseId,
      targetDate: occurrenceDate,
      dedupeKey: `recurring-generated:${template.id}:${occurrenceDate}`,
    }, req.account.id);
    await connection.commit();
    inTransaction = false;
    res.status(201).json({ ok: true, expenseId, message: 'Recurring expense recorded.' });
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Recurring occurrence confirmation rollback failed', rollbackError);
      }
    }
    console.error(error);
    res.status(500).json({ error: 'Could not record this recurring expense.' });
  } finally {
    connection?.release();
  }
});

app.get('/api/expenses', async (req, res) => {
  const groupId = req.query.groupId === undefined ? null : Number(req.query.groupId);
  if (groupId !== null && (!Number.isInteger(groupId) || groupId <= 0)) {
    return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  }

  try {
    const expenses = await q(
      `SELECT e.id, e.group_id, e.title, e.amount, e.category, e.created_at,
              p.id AS payer_id, p.name AS payer, p.initials, p.color,
              g.name AS group_name
       FROM expenses e
       JOIN people p ON p.id = e.paid_by AND p.workspace_id = ?
       JOIN \`groups\` g ON g.id = e.group_id
       WHERE g.workspace_id = ? ${groupId === null ? '' : 'AND e.group_id = ?'}
       ORDER BY e.created_at DESC, e.id DESC`,
      groupId === null
        ? [req.account.workspace_id, req.account.workspace_id]
        : [req.account.workspace_id, req.account.workspace_id, groupId]
    );
    if (!expenses.length) return res.json([]);
    const shares = await q(
      `SELECT s.expense_id, s.person_id, p.name,
              s.amount, COALESCE(SUM(st.amount), 0) AS settled_amount
       FROM splits s
       JOIN expenses e ON e.id = s.expense_id
       JOIN \`groups\` g ON g.id = e.group_id AND g.workspace_id = ?
       JOIN people p ON p.id = s.person_id AND p.workspace_id = ?
       LEFT JOIN settlements st
         ON st.expense_id = s.expense_id AND st.payer_id = s.person_id AND st.payee_id = e.paid_by
       WHERE g.workspace_id = ? ${groupId === null ? '' : 'AND e.group_id = ?'}
       GROUP BY s.expense_id, s.person_id, p.name, s.amount
       ORDER BY p.name, p.id`,
      groupId === null
        ? [req.account.workspace_id, req.account.workspace_id, req.account.workspace_id]
        : [req.account.workspace_id, req.account.workspace_id, req.account.workspace_id, groupId]
    );
    const sharesByExpense = new Map();
    for (const share of shares) {
      const expenseShares = sharesByExpense.get(share.expense_id) || [];
      const amount = Number(share.amount);
      const settledAmount = Number(share.settled_amount);
      expenseShares.push({
        person_id: share.person_id,
        name: share.name,
        amount,
        settled_amount: settledAmount,
        outstanding_amount: Math.max(0, Math.round((amount - settledAmount) * 100) / 100)
      });
      sharesByExpense.set(share.expense_id, expenseShares);
    }
    for (const expense of expenses) {
      expense.shares = sharesByExpense.get(expense.id) || [];
      expense.outstanding_amount = expense.shares
        .filter(share => share.person_id !== expense.payer_id)
        .reduce((total, share) => total + share.outstanding_amount, 0);
    }
    res.json(expenses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load expenses.' });
  }
});

app.get('/api/reports', async (req, res) => {
  const reportType = req.query.type;
  const groupId = req.query.groupId && req.query.groupId !== 'all' ? Number(req.query.groupId) : null;
  const memberId = req.query.memberId && req.query.memberId !== 'all' ? Number(req.query.memberId) : null;
  const category = typeof req.query.category === 'string' && req.query.category !== 'all'
    ? req.query.category.trim()
    : null;
  const startDate = typeof req.query.startDate === 'string' && req.query.startDate ? req.query.startDate : null;
  const endDate = typeof req.query.endDate === 'string' && req.query.endDate ? req.query.endDate : null;
  const limit = Number(req.query.limit || 5000);
  const offset = Number(req.query.offset || 0);
  const allowedTypes = new Set(['expense', 'monthly', 'group', 'member', 'settlement', 'outstanding']);
  if (!allowedTypes.has(reportType) ||
      (groupId !== null && (!Number.isInteger(groupId) || groupId <= 0)) ||
      (memberId !== null && (!Number.isInteger(memberId) || memberId <= 0)) ||
      (category && category.length > 100) ||
      !isValidReportDate(startDate) || !isValidReportDate(endDate) ||
      (startDate && endDate && startDate > endDate) ||
      !Number.isInteger(limit) || limit < 1 || limit > 5000 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    return res.status(400).json({ error: 'Choose a valid report, date range, group, member, category, limit, and offset.' });
  }

  try {
    const workspaceId = req.account.workspace_id;
    if (groupId !== null) {
      const groups = await q('SELECT id FROM `groups` WHERE id = ? AND workspace_id = ?', [groupId, workspaceId]);
      if (!groups.length) return res.status(404).json({ error: 'Group not found in this workspace.' });
    }
    if (memberId !== null) {
      const people = await q('SELECT id FROM people WHERE id = ? AND workspace_id = ?', [memberId, workspaceId]);
      if (!people.length) return res.status(404).json({ error: 'Member not found in this workspace.' });
    }

    if (reportType === 'outstanding') {
      let balances = await getWorkspaceGroupBalances(workspaceId);
      if (groupId !== null) balances = balances.filter(row => Number(row.group_id) === groupId);
      if (memberId !== null) balances = balances.filter(row => Number(row.id) === memberId);
      const records = balances.map(row => ({
        date: new Date().toISOString().slice(0, 10),
        group: row.group_name,
        description: `${row.name} balance`,
        category: '',
        paid_by: '',
        participants: row.name,
        total_amount: 0,
        personal_share: 0,
        balance: Number(row.balance),
        currency: 'INR',
        settlement_status: Number(row.balance) > 0 ? 'Owes' : Number(row.balance) < 0 ? 'Owed' : 'Settled',
      }));
      return res.json({
        reportType,
        records,
        totalRecords: records.length,
        hasMore: false,
        totals: {
          total_amount: 0,
          personal_share: 0,
          balance: records.reduce((sum, row) => sum + row.balance, 0),
        },
      });
    }

    if (reportType === 'settlement') {
      const { where, parameters } = buildSettlementReportFilter({
        workspaceId, groupId, memberId, startDate, endDate,
      });
      const [count] = await q(
        `SELECT COUNT(*) AS total_records, COALESCE(SUM(st.amount), 0) AS total_amount
         FROM settlements st
         JOIN people payer ON payer.id = st.payer_id AND payer.workspace_id = ?
         JOIN people payee ON payee.id = st.payee_id AND payee.workspace_id = ?
         LEFT JOIN \`groups\` g ON g.id = st.group_id
         LEFT JOIN expenses linked_expense ON linked_expense.id = st.expense_id
         LEFT JOIN \`groups\` linked_group ON linked_group.id = linked_expense.group_id
         WHERE ${where}`,
        [workspaceId, workspaceId, ...parameters]
      );
      const records = await q(
        `SELECT DATE_FORMAT(st.created_at, '%Y-%m-%d') AS date,
                COALESCE(g.name, linked_group.name, 'Workspace') AS group_name,
                st.note AS description, '' AS category,
                payer.name AS paid_by, payee.name AS payee,
                CONCAT(payer.name, ' → ', payee.name) AS participants,
                st.amount AS total_amount,
                CASE WHEN st.payer_id = ? OR st.payee_id = ? THEN st.amount ELSE 0 END AS personal_share,
                'INR' AS currency, 'Recorded' AS settlement_status,
                st.id AS record_id
         FROM settlements st
         JOIN people payer ON payer.id = st.payer_id AND payer.workspace_id = ?
         JOIN people payee ON payee.id = st.payee_id AND payee.workspace_id = ?
         LEFT JOIN \`groups\` g ON g.id = st.group_id
         LEFT JOIN expenses linked_expense ON linked_expense.id = st.expense_id
         LEFT JOIN \`groups\` linked_group ON linked_group.id = linked_expense.group_id
         WHERE ${where}
         ORDER BY st.created_at DESC, st.id DESC
         LIMIT ? OFFSET ?`,
        [req.account.person_id, req.account.person_id, workspaceId, workspaceId, ...parameters, limit + 1, offset]
      );
      return res.json({
        reportType,
        records: records.slice(0, limit),
        totalRecords: Number(count[0]?.total_records || 0),
        hasMore: records.length > limit,
        totals: {
          total_amount: Number(count[0]?.total_amount || 0),
          personal_share: 0,
        },
      });
    }

    const { where, parameters } = buildExpenseReportFilter({
      workspaceId, groupId, memberId, category, startDate, endDate,
    });
    const [count] = await q(
      `SELECT COUNT(*) AS total_records, COALESCE(SUM(e.amount), 0) AS total_amount,
              COALESCE(SUM((SELECT s.amount FROM splits s
                            WHERE s.expense_id = e.id AND s.person_id = ?
                            LIMIT 1)), 0) AS personal_share
       FROM expenses e JOIN \`groups\` g ON g.id = e.group_id
       WHERE ${where}`,
      [memberId || req.account.person_id, ...parameters]
    );
    const personalMemberId = memberId || req.account.person_id;
    let records;
    if (reportType === 'member') {
      const memberParticipantFilter = memberId === null ? '' : 'AND s.person_id = ?';
      const memberParameters = memberId === null ? parameters : [...parameters, memberId];
      const [memberCount] = await q(
        `SELECT COUNT(*) AS total_records, COALESCE(SUM(s.amount), 0) AS personal_share
         FROM expenses e
         JOIN \`groups\` g ON g.id = e.group_id
         JOIN splits s ON s.expense_id = e.id
         WHERE ${where} ${memberParticipantFilter}`,
        memberParameters
      );
      const [memberTotals] = await q(
        `SELECT COALESCE(SUM(report_expense.amount), 0) AS total_amount
         FROM (
           SELECT DISTINCT e.id, e.amount
           FROM expenses e
           JOIN \`groups\` g ON g.id = e.group_id
           JOIN splits s ON s.expense_id = e.id
           WHERE ${where} ${memberParticipantFilter}
         ) report_expense`,
        memberParameters
      );
      count[0] = { ...memberCount[0], total_amount: memberTotals[0]?.total_amount || 0 };
      records = await q(
        `SELECT DATE_FORMAT(e.created_at, '%Y-%m-%d') AS date,
                g.name AS group_name, e.title AS description, e.category,
                payer.name AS paid_by, participant.name AS participant,
                (SELECT GROUP_CONCAT(CONCAT(other_participant.name, ' (', FORMAT(other_split.amount, 2), ')')
                   ORDER BY other_participant.name SEPARATOR ', ')
                 FROM splits other_split JOIN people other_participant
                   ON other_participant.id = other_split.person_id AND other_participant.workspace_id = ?
                 WHERE other_split.expense_id = e.id) AS participants,
                e.amount AS total_amount, s.amount AS personal_share,
                CASE WHEN e.paid_by = participant.id THEN e.amount ELSE 0 END AS paid_amount,
                COALESCE((SELECT SUM(GREATEST(0, other_split.amount - COALESCE(
                    (SELECT SUM(st.amount) FROM settlements st
                     WHERE st.expense_id = e.id AND st.payer_id = other_split.person_id AND st.payee_id = e.paid_by), 0)))
                  FROM splits other_split WHERE other_split.expense_id = e.id
                    AND other_split.person_id <> e.paid_by), 0) AS outstanding_amount,
                COALESCE((SELECT SUM(st.amount) FROM settlements st WHERE st.expense_id = e.id), 0) AS settled_amount,
                'INR' AS currency, 'Recorded' AS settlement_status,
                e.id AS expense_id, participant.id AS member_id
         FROM expenses e
         JOIN \`groups\` g ON g.id = e.group_id
         JOIN splits s ON s.expense_id = e.id
         JOIN people participant ON participant.id = s.person_id AND participant.workspace_id = ?
         JOIN people payer ON payer.id = e.paid_by AND payer.workspace_id = ?
         WHERE ${where} ${memberParticipantFilter}
         ORDER BY participant.name, e.created_at DESC, e.id DESC
         LIMIT ? OFFSET ?`,
        [workspaceId, workspaceId, workspaceId, ...memberParameters, limit + 1, offset]
      );
      records = records.map(record => ({
        ...record,
        total_amount: Number(record.total_amount || 0),
        personal_share: Number(record.personal_share || 0),
        paid_amount: Number(record.paid_amount || 0),
        settlement_status: Number(record.outstanding_amount) <= 0
          ? 'Settled'
          : Number(record.settled_amount) > 0 ? 'Partially settled' : 'Unpaid',
      }));
    } else {
      records = await q(
        `SELECT DATE_FORMAT(e.created_at, '%Y-%m-%d') AS date,
                DATE_FORMAT(e.created_at, '%Y-%m') AS month,
                g.name AS group_name, e.title AS description, e.category,
                payer.name AS paid_by,
                (SELECT GROUP_CONCAT(CONCAT(participant.name, ' (', FORMAT(s.amount, 2), ')')
                   ORDER BY participant.name SEPARATOR ', ')
                 FROM splits s JOIN people participant
                   ON participant.id = s.person_id AND participant.workspace_id = ?
                 WHERE s.expense_id = e.id) AS participants,
                e.amount AS total_amount,
                COALESCE((SELECT s.amount FROM splits s WHERE s.expense_id = e.id AND s.person_id = ? LIMIT 1), 0) AS personal_share,
                COALESCE((SELECT SUM(GREATEST(0, s.amount - COALESCE(
                    (SELECT SUM(st.amount) FROM settlements st
                     WHERE st.expense_id = e.id AND st.payer_id = s.person_id AND st.payee_id = e.paid_by), 0)))
                  FROM splits s WHERE s.expense_id = e.id AND s.person_id <> e.paid_by), 0) AS outstanding_amount,
                COALESCE((SELECT SUM(st.amount) FROM settlements st WHERE st.expense_id = e.id), 0) AS settled_amount,
                'INR' AS currency, e.id AS expense_id
         FROM expenses e
         JOIN \`groups\` g ON g.id = e.group_id
         JOIN people payer ON payer.id = e.paid_by AND payer.workspace_id = ?
         WHERE ${where}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ? OFFSET ?`,
        [workspaceId, personalMemberId, workspaceId, ...parameters, limit + 1, offset]
      );
      records = records.map(record => {
        const settled = Number(record.settled_amount || 0);
        return {
          ...record,
          total_amount: Number(record.total_amount || 0),
          personal_share: Number(record.personal_share || 0),
          outstanding_amount: Number(record.outstanding_amount || 0),
          settlement_status: Number(record.outstanding_amount) <= 0
            ? 'Settled'
            : settled > 0 ? 'Partially settled' : 'Unpaid',
        };
      });
    }

    let breakdown = [];
    if (reportType === 'monthly') {
      breakdown = await q(
        `SELECT DATE_FORMAT(e.created_at, '%Y-%m') AS period,
                COUNT(*) AS expense_count, SUM(e.amount) AS total_amount,
                COALESCE(SUM((SELECT s.amount FROM splits s
                              WHERE s.expense_id = e.id AND s.person_id = ?
                              LIMIT 1)), 0) AS personal_share
         FROM expenses e JOIN \`groups\` g ON g.id = e.group_id
         WHERE ${where}
         GROUP BY DATE_FORMAT(e.created_at, '%Y-%m')
         ORDER BY period DESC`,
        [personalMemberId, ...parameters]
      );
    } else if (reportType === 'group') {
      breakdown = await q(
        `SELECT g.id AS group_id, g.name AS group_name,
                COUNT(*) AS expense_count, SUM(e.amount) AS total_amount,
                COALESCE(SUM((SELECT s.amount FROM splits s
                              WHERE s.expense_id = e.id AND s.person_id = ?
                              LIMIT 1)), 0) AS personal_share
         FROM expenses e JOIN \`groups\` g ON g.id = e.group_id
         WHERE ${where}
         GROUP BY g.id, g.name
         ORDER BY total_amount DESC, g.name`,
        [personalMemberId, ...parameters]
      );
    } else if (reportType === 'member') {
      const memberParticipantFilter = memberId === null ? '' : 'AND s.person_id = ?';
      const memberParameters = memberId === null ? parameters : [...parameters, memberId];
      breakdown = await q(
        `SELECT participant.id AS member_id, participant.name AS member_name,
                COUNT(DISTINCT e.id) AS expense_count, SUM(s.amount) AS share_amount,
                COALESCE(SUM(CASE WHEN e.paid_by = participant.id THEN e.amount ELSE 0 END), 0) AS paid_amount
         FROM expenses e
         JOIN \`groups\` g ON g.id = e.group_id
         JOIN splits s ON s.expense_id = e.id
         JOIN people participant ON participant.id = s.person_id AND participant.workspace_id = ?
         WHERE ${where} ${memberParticipantFilter}
         GROUP BY participant.id, participant.name
         ORDER BY share_amount DESC, participant.name`,
        [workspaceId, ...memberParameters]
      );
    }

    res.json({
      reportType,
      records: records.slice(0, limit),
      totalRecords: Number(count[0]?.total_records || 0),
      hasMore: records.length > limit,
      breakdown,
      totals: {
        total_amount: Number(count[0]?.total_amount || 0),
        personal_share: Number(count[0]?.personal_share || 0),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not generate this report.' });
  }
});

app.patch('/api/expenses/:expenseId/category', async (req, res) => {
  const expenseId = Number(req.params.expenseId);
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
  if (!Number.isInteger(expenseId) || expenseId <= 0 ||
      !category || category.length > 100) {
    return res.status(400).json({ error: 'Choose a valid expense category.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [expenses] = await connection.execute(
      `SELECT e.id, e.group_id, e.category FROM expenses e
       JOIN \`groups\` g ON g.id = e.group_id AND g.workspace_id = ?
       WHERE e.id = ? FOR UPDATE`,
      [req.account.workspace_id, expenseId]
    );
    if (!expenses.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Expense not found.' });
    }
    if (expenses[0].category === category) {
      await connection.commit();
      return res.json({ ok: true, message: 'Expense category is unchanged.' });
    }
    await connection.execute('UPDATE expenses SET category = ? WHERE id = ?', [category, expenseId]);
    await notifyGroupMembers(connection, req.account.workspace_id, expenses[0].group_id, {
      type: 'expense_updated',
      title: 'Expense updated',
      message: `The category for expense ${expenseId} was changed to ${category}.`,
      targetType: 'expense',
      targetId: expenseId,
      dedupeKey: `expense-updated:${expenseId}:${crypto.randomUUID()}`,
    }, req.account.id);
    await connection.commit();
    res.json({ ok: true, message: 'Expense category updated.' });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Expense update rollback failed', rollbackError);
      }
    }
    console.error(error);
    res.status(500).json({ error: 'Could not update this expense category.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/expenses/:expenseId/settle', async (req, res) => {
  const expenseId = Number(req.params.expenseId);
  const legacyPersonIds = Array.isArray(req.body?.personIds) ? req.body.personIds.map(Number) : null;
  const requestedPayments = Array.isArray(req.body?.payments)
    ? req.body.payments.map(payment => ({
      personId: Number(payment?.personId),
      amountCents: Math.round(Number(payment?.amount) * 100)
    }))
    : null;
  const personIds = requestedPayments
    ? requestedPayments.map(payment => payment.personId)
    : legacyPersonIds || [];
  if (!Number.isInteger(expenseId) || expenseId <= 0 ||
      !personIds.length || personIds.length > 500 ||
      personIds.some(id => !Number.isInteger(id) || id <= 0) ||
      new Set(personIds).size !== personIds.length ||
      (requestedPayments && requestedPayments.some(payment =>
        !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 || payment.amountCents > 999999999999
      ))) {
    return res.status(400).json({ error: 'Select at least one valid expense share to settle.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [expenses] = await connection.execute(
      `SELECT e.id, e.paid_by, e.group_id, e.title, g.name AS group_name
       FROM expenses e
       JOIN \`groups\` g ON g.id = e.group_id AND g.workspace_id = ?
       JOIN people payer ON payer.id = e.paid_by AND payer.workspace_id = g.workspace_id
       WHERE e.id = ? FOR UPDATE`,
      [req.account.workspace_id, expenseId]
    );
    const expense = expenses[0];
    if (!expense) {
      await connection.rollback();
      return res.status(404).json({ error: 'Expense not found.' });
    }
    if (personIds.includes(expense.paid_by)) {
      await connection.rollback();
      return res.status(400).json({ error: 'The person who paid the expense has no share to settle with themselves.' });
    }

    const [shares] = await connection.execute(
      `SELECT s.person_id, s.amount,
              COALESCE((SELECT SUM(st.amount) FROM settlements st
                        WHERE st.expense_id = s.expense_id
                          AND st.payer_id = s.person_id AND st.payee_id = ?), 0) AS settled_amount
       FROM splits s
       JOIN people p ON p.id = s.person_id AND p.workspace_id = ?
       WHERE s.expense_id = ? AND s.person_id IN (${personIds.map(() => '?').join(',')})
       FOR UPDATE`,
      [expense.paid_by, req.account.workspace_id, expenseId, ...personIds]
    );
    if (shares.length !== personIds.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'One or more selected users do not share this expense.' });
    }

    const amounts = shares.map(share => {
      const personId = Number(share.person_id);
      const outstandingCents = Math.round((Number(share.amount) - Number(share.settled_amount)) * 100);
      const payment = requestedPayments?.find(item => item.personId === personId);
      return {
        personId,
        outstandingCents,
        cents: payment ? payment.amountCents : outstandingCents
      };
    });
    if (amounts.some(share => share.outstandingCents <= 0 || share.cents > share.outstandingCents)) {
      await connection.rollback();
      return res.status(409).json({ error: 'A payment exceeds the remaining amount for an expense share. Refresh and try again.' });
    }
    const balances = await getWorkspaceBalances(req.account.workspace_id, connection);
    const balanceCents = new Map(balances.map(person => [person.id, Math.round(Number(person.balance) * 100)]));
    const totalCents = amounts.reduce((total, share) => total + share.cents, 0);
    if (amounts.some(share => (balanceCents.get(share.personId) || 0) < share.cents) ||
        (balanceCents.get(expense.paid_by) || 0) > -totalCents) {
      await connection.rollback();
      return res.status(409).json({ error: 'One or more shares are already covered by recorded settlements. Refresh your balances and try again.' });
    }

    for (const share of amounts) {
      const [settlement] = await connection.execute(
        `INSERT INTO settlements(payer_id, payee_id, expense_id, amount, note)
         VALUES(?, ?, ?, ?, 'Expense settlement')`,
        [share.personId, expense.paid_by, expenseId, share.cents / 100]
      );
      await notifyPeople(connection, req.account.workspace_id, [share.personId, expense.paid_by], {
        type: 'settlement_recorded',
        title: 'Settlement recorded',
        message: `A share of the expense was settled in ${expense.group_name}.`,
        targetType: 'expense',
        targetId: expenseId,
        dedupeKey: `settlement-recorded:${settlement.insertId}`,
      }, req.account.id);
    }
    await connection.commit();
    res.status(201).json({ ok: true, count: amounts.length });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    res.status(500).json({ error: 'Could not settle the selected expense shares.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/settlements/bulk', async (req, res) => {
  const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];
  if (!payments.length || payments.length > 500) {
    return res.status(400).json({ error: 'No valid suggested payments were provided.' });
  }
  const normalizedPayments = payments.map(payment => {
    const payerId = Number(payment?.payerId);
    const payeeId = Number(payment?.payeeId);
    const amountCents = Math.round(Number(payment?.amount) * 100);
    return { payerId, payeeId, amountCents };
  });
  const paymentPairs = normalizedPayments.map(payment => `${payment.payerId}:${payment.payeeId}`);
  if (normalizedPayments.some(payment =>
    !Number.isInteger(payment.payerId) || payment.payerId <= 0 ||
    !Number.isInteger(payment.payeeId) || payment.payeeId <= 0 ||
    payment.payerId === payment.payeeId ||
    !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 ||
    payment.amountCents > 999999999999
  ) || new Set(paymentPairs).size !== paymentPairs.length) {
    return res.status(400).json({ error: 'Suggested payments must contain unique pairs of users and positive amounts.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute(
      'SELECT id FROM people WHERE workspace_id = ? FOR UPDATE',
      [req.account.workspace_id]
    );
    const balances = await getWorkspaceBalances(req.account.workspace_id, connection);
    const netCents = new Map(balances.map(person => [person.id, Math.round(Number(person.balance) * 100)]));
    const userBalance = netCents.get(req.account.person_id);
    if (!userBalance) {
      await connection.rollback();
      return res.status(409).json({ error: 'Your balance is already clear. Refresh and try again.' });
    }
    for (const payment of normalizedPayments) {
      if (!netCents.has(payment.payerId) || !netCents.has(payment.payeeId)) {
        await connection.rollback();
        return res.status(400).json({ error: 'All suggested payments must be between users in your workspace.' });
      }
      if (payment.payerId !== req.account.person_id && payment.payeeId !== req.account.person_id) {
        await connection.rollback();
        return res.status(400).json({ error: 'Each suggested payment must be part of clearing your balance.' });
      }
      if (userBalance > 0
        ? payment.payerId !== req.account.person_id || payment.payeeId === req.account.person_id
        : payment.payeeId !== req.account.person_id || payment.payerId === req.account.person_id) {
        await connection.rollback();
        return res.status(409).json({ error: 'Balances changed. Refresh the suggested payments and try again.' });
      }
      if (netCents.get(payment.payerId) <= 0 || netCents.get(payment.payeeId) >= 0 ||
          payment.amountCents > Math.min(netCents.get(payment.payerId), -netCents.get(payment.payeeId))) {
        await connection.rollback();
        return res.status(409).json({ error: 'Balances changed. Refresh the suggested payments and try again.' });
      }
      netCents.set(payment.payerId, netCents.get(payment.payerId) - payment.amountCents);
      netCents.set(payment.payeeId, netCents.get(payment.payeeId) + payment.amountCents);
    }
    if (netCents.get(req.account.person_id) !== 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'Suggested payments do not clear your full balance. Refresh and try again.' });
    }

    for (const payment of normalizedPayments) {
      const [settlement] = await connection.execute(
        `INSERT INTO settlements(payer_id, payee_id, amount, note)
         VALUES(?, ?, ?, 'Personal balance settlement')`,
        [payment.payerId, payment.payeeId, payment.amountCents / 100]
      );
      await notifyPeople(connection, req.account.workspace_id, [payment.payerId, payment.payeeId], {
        type: 'settlement_recorded',
        title: 'Settlement recorded',
        message: 'A payment was recorded to clear a personal balance.',
        targetType: 'settlement',
        targetId: settlement.insertId,
        dedupeKey: `settlement-recorded:${settlement.insertId}`,
      }, req.account.id);
    }
    await connection.commit();
    res.status(201).json({ ok: true, count: normalizedPayments.length });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    res.status(500).json({ error: 'Could not record payments to clear your balance.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/people', async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 255) {
    return res.status(400).json({ error: 'A name of 1 to 255 characters is required.' });
  }

  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  try {
    const [existingPerson] = await q(
      `SELECT id FROM people
       WHERE workspace_id = ? AND LOWER(TRIM(name)) = LOWER(?)
       ORDER BY id LIMIT 1`,
      [req.account.workspace_id, name.trim()]
    );
    if (existingPerson) {
      return res.status(409).json({ error: 'A user with this name already exists in your workspace.' });
    }
    const result = await q(
      'INSERT INTO people(workspace_id, name, initials) VALUES(?, ?, ?)',
      [req.account.workspace_id, name.trim(), initials]
    );
    const [person] = await q(
      'SELECT id, name, initials, color FROM people WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(person);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create this person.' });
  }
});

app.delete('/api/people/:id', async (req, res) => {
  const personId = Number(req.params.id);
  if (!Number.isInteger(personId) || personId <= 0) {
    return res.status(400).json({ error: 'User ID must be a positive integer.' });
  }
  if (personId === req.account.person_id) {
    return res.status(400).json({ error: 'You cannot delete yourself from this workspace.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [people] = await connection.execute(
      `SELECT p.id, a.id AS primary_account_id, wm.account_id AS member_account_id
       FROM people p
       LEFT JOIN accounts a ON a.person_id = p.id
       LEFT JOIN workspace_members wm
         ON wm.person_id = p.id AND wm.workspace_id = p.workspace_id
       WHERE p.id = ? AND p.workspace_id = ?
       FOR UPDATE`,
      [personId, req.account.workspace_id]
    );
    const person = people[0];
    if (!person) {
      await connection.rollback();
      return res.status(404).json({ error: 'This user was not found in your workspace.' });
    }
    if (person.primary_account_id) {
      await connection.rollback();
      return res.status(409).json({
        error: 'This user owns an account and cannot be deleted from the workspace user list.'
      });
    }

    const [references] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM expenses WHERE paid_by = ?) AS paid_expenses,
         (SELECT COUNT(*) FROM splits WHERE person_id = ?) AS expense_splits,
         (SELECT COUNT(*) FROM settlements WHERE payer_id = ? OR payee_id = ?) AS settlements`,
      [personId, personId, personId, personId]
    );
    const history = references[0];
    if (Number(history.paid_expenses) || Number(history.expense_splits) || Number(history.settlements)) {
      await connection.rollback();
      return res.status(409).json({
        error: 'This user has expense or settlement history and cannot be deleted.'
      });
    }

    if (person.member_account_id) {
      await connection.execute(
        'DELETE FROM auth_sessions WHERE account_id = ? AND workspace_id = ?',
        [person.member_account_id, req.account.workspace_id]
      );
      await connection.execute(
        'DELETE FROM workspace_members WHERE account_id = ? AND workspace_id = ?',
        [person.member_account_id, req.account.workspace_id]
      );
    }
    await connection.execute(
      'DELETE FROM people WHERE id = ? AND workspace_id = ?',
      [personId, req.account.workspace_id]
    );
    await connection.commit();
    res.json({ ok: true, message: 'User deleted from this workspace.' });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        error: 'This user has expense or settlement history and cannot be deleted.'
      });
    }
    console.error(error);
    res.status(500).json({ error: 'Could not delete this user.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/expenses', async (req, res) => {
  const { groupId, title, amount, paidBy, category = 'Other', participants } = req.body || {};
  const normalizedGroupId = Number(groupId);
  const normalizedPaidBy = Number(paidBy);
  const amountCents = Math.round(Number(amount) * 100);
  const participantIds = Array.isArray(participants) ? participants.map(Number) : [];
  if (!Number.isInteger(normalizedGroupId) || normalizedGroupId <= 0 ||
      typeof title !== 'string' || !title.trim() ||
      typeof category !== 'string' || !category.trim() || category.length > 100 ||
      !Number.isFinite(Number(amount)) || !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 || amountCents > 999999999999 ||
      !Number.isInteger(normalizedPaidBy) || normalizedPaidBy <= 0 ||
      !Array.isArray(participants) || !participantIds.length ||
      participantIds.some(id => !Number.isInteger(id) || id <= 0) ||
      new Set(participantIds).size !== participantIds.length) {
    return res.status(400).json({ error: 'Add a title, positive amount, group, and participants.' });
  }

  let connection;
  let inTransaction = false;
  try {
    const [groups, members] = await Promise.all([
      q(
        'SELECT id FROM `groups` WHERE id = ? AND workspace_id = ?',
        [normalizedGroupId, req.account.workspace_id]
      ),
      q(
        `SELECT gm.person_id AS id FROM group_members gm
         JOIN people p ON p.id = gm.person_id AND p.workspace_id = ?
         JOIN \`groups\` g ON g.id = gm.group_id AND g.workspace_id = ?
         WHERE gm.group_id = ? AND gm.person_id IN (${[normalizedPaidBy, ...participantIds].map(() => '?').join(',')})`,
        [req.account.workspace_id, req.account.workspace_id, normalizedGroupId, normalizedPaidBy, ...participantIds]
      )
    ]);
    if (!groups.length || members.length !== new Set([normalizedPaidBy, ...participantIds]).size) {
      return res.status(400).json({ error: 'Choose a group member as payer and participants.' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const [expense] = await connection.execute(
      'INSERT INTO expenses(group_id, title, amount, paid_by, category) VALUES(?, ?, ?, ?, ?)',
      [normalizedGroupId, title.trim(), amountCents / 100, normalizedPaidBy, category]
    );
    const baseShare = Math.floor(amountCents / participantIds.length);
    const remainder = amountCents % participantIds.length;
    for (const [index, personId] of participantIds.entries()) {
      await connection.execute(
        'INSERT INTO splits(expense_id, person_id, amount) VALUES(?, ?, ?)',
        [expense.insertId, personId, (baseShare + (index < remainder ? 1 : 0)) / 100]
      );
    }
    await notifyGroupMembers(connection, req.account.workspace_id, normalizedGroupId, {
      type: 'expense_created',
      title: 'New expense',
      message: `${title.trim()} was added to the group.`,
      targetType: 'expense',
      targetId: expense.insertId,
      dedupeKey: `expense-created:${expense.insertId}`,
    }, req.account.id);
    await connection.commit();
    inTransaction = false;
    res.status(201).json({ ok: true, id: expense.insertId });
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Expense rollback failed', rollbackError);
      }
    }
    console.error(error);
    res.status(500).json({ error: 'Could not save this expense.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/groups', async (req, res) => {
  const { name, icon = 'users', color = '#e9ddf2', memberIds = [] } = req.body || {};
  const normalizedMemberIds = Array.isArray(memberIds) ? memberIds.map(Number) : null;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 255 ||
      !normalizedMemberIds ||
      normalizedMemberIds.some(id => !Number.isInteger(id) || id <= 0) ||
      new Set(normalizedMemberIds).size !== normalizedMemberIds.length) {
    return res.status(400).json({ error: 'Provide a group name and valid, unique member IDs.' });
  }

  let connection;
  let inTransaction = false;
  try {
    if (normalizedMemberIds.length) {
      const people = await q(
        `SELECT id FROM people WHERE workspace_id = ?
         AND id IN (${normalizedMemberIds.map(() => '?').join(',')})`,
        [req.account.workspace_id, ...normalizedMemberIds]
      );
      if (people.length !== normalizedMemberIds.length) {
        return res.status(400).json({ error: 'Choose existing users for this group.' });
      }
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const [result] = await connection.execute(
      'INSERT INTO `groups`(workspace_id, name, icon, color) VALUES(?, ?, ?, ?)',
      [req.account.workspace_id, name.trim(), icon, color]
    );
    for (const personId of normalizedMemberIds) {
      await connection.execute(
        'INSERT INTO group_members(group_id, person_id) VALUES(?, ?)',
        [result.insertId, personId]
      );
    }
    await notifyPeople(connection, req.account.workspace_id, normalizedMemberIds, {
      type: 'member_joined',
      title: 'You were added to a group',
      message: `You are now a member of ${name.trim()}.`,
      targetType: 'group',
      targetId: result.insertId,
      dedupeKey: `group-created-membership:${result.insertId}`,
    }, req.account.id);
    await connection.commit();
    inTransaction = false;
    const [group] = await q('SELECT * FROM `groups` WHERE id = ?', [result.insertId]);
    res.status(201).json(group);
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Group rollback failed', rollbackError);
      }
    }
    console.error(error);
    res.status(500).json({ error: 'Could not create this group.' });
  } finally {
    connection?.release();
  }
});

app.put('/api/groups/:groupId/members', async (req, res) => {
  const groupId = Number(req.params.groupId);
  const { personIds } = req.body || {};
  const memberIds = Array.isArray(personIds) ? personIds.map(Number) : null;
  if (!Number.isInteger(groupId) || groupId <= 0 ||
      !memberIds ||
      memberIds.some(id => !Number.isInteger(id) || id <= 0) ||
      new Set(memberIds).size !== memberIds.length) {
    return res.status(400).json({ error: 'Provide a valid group ID and unique user IDs.' });
  }

  let connection;
  let inTransaction = false;
  try {
    const [groups, people] = await Promise.all([
      q('SELECT id FROM `groups` WHERE id = ? AND workspace_id = ?', [groupId, req.account.workspace_id]),
      memberIds.length
        ? q(
          `SELECT id, name FROM people WHERE workspace_id = ? AND id IN (${memberIds.map(() => '?').join(',')})`,
          [req.account.workspace_id, ...memberIds]
        )
        : Promise.resolve([])
    ]);
    if (!groups.length) return res.status(404).json({ error: 'Group not found.' });
    if (people.length !== memberIds.length) {
      return res.status(400).json({ error: 'Choose existing users for this group.' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const [groupRows] = await connection.execute(
      'SELECT id, name FROM `groups` WHERE id = ? AND workspace_id = ? FOR UPDATE',
      [groupId, req.account.workspace_id]
    );
    if (!groupRows.length) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({ error: 'Group not found.' });
    }
    const [oldMembers] = await connection.execute(
      'SELECT person_id FROM group_members WHERE group_id = ?',
      [groupId]
    );
    const oldMemberIds = new Set(oldMembers.map(member => member.person_id));
    await connection.execute('DELETE FROM group_members WHERE group_id = ?', [groupId]);
    for (const personId of memberIds) {
      await connection.execute(
        'INSERT INTO group_members(group_id, person_id) VALUES(?, ?)',
        [groupId, personId]
      );
    }
    const addedMembers = people.filter(person => !oldMemberIds.has(person.id));
    for (const person of addedMembers) {
      await notifyGroupMembers(connection, req.account.workspace_id, groupId, {
        type: 'member_joined',
        title: 'A member joined a group',
        message: `${person.name} joined ${groupRows[0].name}.`.slice(0, 500),
        targetType: 'group',
        targetId: groupId,
        dedupeKey: `group-member-joined:${groupId}:${person.id}:${crypto.randomUUID()}`,
      }, req.account.id);
    }
    await connection.commit();
    inTransaction = false;
    res.json({ ok: true, memberIds });
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Group member update rollback failed', rollbackError);
      }
    }
    console.error(error);
    res.status(500).json({ error: 'Could not update this group’s members.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/settlements', async (req, res) => {
  const { payerId, payeeId, amount, groupId, note = 'Settlement' } = req.body || {};
  const normalizedPayerId = Number(payerId);
  const normalizedPayeeId = Number(payeeId);
  const normalizedGroupId = groupId === undefined || groupId === null ? null : Number(groupId);
  const amountCents = Math.round(Number(amount) * 100);
  if (!Number.isInteger(normalizedPayerId) || normalizedPayerId <= 0 ||
      !Number.isInteger(normalizedPayeeId) || normalizedPayeeId <= 0 ||
      normalizedPayerId === normalizedPayeeId ||
      (normalizedGroupId !== null && (!Number.isInteger(normalizedGroupId) || normalizedGroupId <= 0)) ||
      !Number.isFinite(Number(amount)) || !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 || amountCents > 999999999999 ||
      typeof note !== 'string' || !note.trim() || note.length > 255) {
    return res.status(400).json({ error: 'Choose two people and a positive amount.' });
  }
  let connection;
  try {
    const people = await q(
      'SELECT id FROM people WHERE workspace_id = ? AND id IN (?, ?)',
      [req.account.workspace_id, normalizedPayerId, normalizedPayeeId]
    );
    if (people.length !== 2) {
      return res.status(400).json({ error: 'Choose two users from your workspace.' });
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let settlementId;
    if (normalizedGroupId !== null) {
      const [groupRows] = await connection.execute(
        'SELECT id FROM `groups` WHERE id = ? AND workspace_id = ? FOR UPDATE',
        [normalizedGroupId, req.account.workspace_id]
      );
      if (!groupRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'Group not found.' });
      }
      const groupBalances = await getWorkspaceGroupBalances(req.account.workspace_id, connection);
      const payerBalance = groupBalances.find(person =>
        person.group_id === normalizedGroupId && person.id === normalizedPayerId
      );
      const payeeBalance = groupBalances.find(person =>
        person.group_id === normalizedGroupId && person.id === normalizedPayeeId
      );
      if (!payerBalance || !payeeBalance) {
        await connection.rollback();
        return res.status(400).json({ error: 'Both users must be members of this group.' });
      }
      const payerCents = Math.round(Number(payerBalance.balance) * 100);
      const payeeCents = Math.round(Number(payeeBalance.balance) * 100);
      if (!validateGroupSettlement(payerCents, payeeCents, amountCents)) {
        await connection.rollback();
        return res.status(409).json({ error: 'The group balance changed. Refresh and try again.' });
      }
      const [settlement] = await connection.execute(
        'INSERT INTO settlements(payer_id, payee_id, amount, group_id, note) VALUES(?, ?, ?, ?, ?)',
        [normalizedPayerId, normalizedPayeeId, amountCents / 100, normalizedGroupId, note.trim()]
      );
      settlementId = settlement.insertId;
    } else {
      const [settlement] = await connection.execute(
        'INSERT INTO settlements(payer_id, payee_id, amount, note) VALUES(?, ?, ?, ?)',
        [normalizedPayerId, normalizedPayeeId, amountCents / 100, note.trim()]
      );
      settlementId = settlement.insertId;
    }
    await notifyPeople(connection, req.account.workspace_id, [normalizedPayerId, normalizedPayeeId], {
      type: 'settlement_recorded',
      title: 'Settlement recorded',
      message: normalizedGroupId === null
        ? 'A personal balance settlement was recorded.'
        : 'A group balance settlement was recorded.',
      targetType: normalizedGroupId === null ? 'settlement' : 'group',
      targetId: normalizedGroupId === null ? settlementId : normalizedGroupId,
      dedupeKey: `settlement-recorded:${settlementId}`,
    }, req.account.id);
    await connection.commit();
    res.status(201).json({ ok: true });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Group settlement rollback failed', rollbackError);
      }
    }
    console.error(error);
    res.status(500).json({ error: 'Could not save this settlement.' });
  } finally {
    connection?.release();
  }
});

app.use((error, _req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  }
  return next(error);
});

const port = process.env.PORT || 5000;
init()
  .then(() => {
    void runDueRecurringExpenses();
    const recurringInterval = setInterval(() => { void runDueRecurringExpenses(); }, 60 * 1000);
    recurringInterval.unref();
    void runSettlementReminders();
    const reminderInterval = setInterval(() => { void runSettlementReminders(); }, 15 * 60 * 1000);
    reminderInterval.unref();
    void runBudgetAlerts();
    const budgetAlertInterval = setInterval(() => { void runBudgetAlerts(); }, 60 * 1000);
    budgetAlertInterval.unref();
    app.listen(port, '0.0.0.0', () => console.log(`GroupBuk API listening on ${port}`));
  })
  .catch(error => {
    console.error('Database startup failed', error);
    process.exit(1);
  });
