const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

const app = express();
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
app.use(cors());
app.use(express.json());

const q = async (text, params = []) => {
  const [result] = await pool.execute(text, params);
  return result;
};

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  for (const statement of schema.split(';').map(part => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }

  const [count] = await q('SELECT COUNT(*) AS n FROM people');
  if (Number(count.n) !== 0) return;

  const people = [
    ['Alex Morgan', 'AM', '#d7efe2'],
    ['Maya Chen', 'MC', '#f4d8bf'],
    ['Leo Park', 'LP', '#d6e1f4'],
    ['Nina Patel', 'NP', '#f1d6e3'],
    ['Sam Rivera', 'SR', '#e8e2bd']
  ];
  for (const person of people) {
    await q('INSERT INTO people(name, initials, color) VALUES(?, ?, ?)', person);
  }

  const groupIds = [];
  for (const group of [
    ['Weekend in the woods', 'mountain', '#dcebdd'],
    ['Flat 4B', 'house', '#eee0cf'],
    ['The usuals', 'users', '#e9ddf2']
  ]) {
    const result = await q('INSERT INTO `groups`(name, icon, color) VALUES(?, ?, ?)', group);
    groupIds.push(result.insertId);
  }

  const ids = (await q('SELECT id FROM people ORDER BY id')).map(person => person.id);
  await q(
    `INSERT INTO expenses(group_id, title, amount, paid_by, category, created_at)
     VALUES
       (?, 'Cabin groceries', 186.40, ?, 'Shopping', NOW() - INTERVAL 2 DAY),
       (?, 'Gas for the drive', 72.00, ?, 'Transport', NOW() - INTERVAL 3 DAY)`,
    [groupIds[0], ids[1], groupIds[0], ids[2]]
  );
  await q(
    `INSERT INTO expenses(group_id, title, amount, paid_by, category, created_at)
     VALUES(?, 'Internet - November', 64.99, ?, 'Utilities', NOW() - INTERVAL 1 DAY)`,
    [groupIds[1], ids[3]]
  );
  await q(
    `INSERT INTO expenses(group_id, title, amount, paid_by, category, created_at)
     VALUES(?, 'Dinner at Momo House', 124.50, ?, 'Food & drink', NOW() - INTERVAL 5 HOUR)`,
    [groupIds[2], ids[1]]
  );

  const expenses = await q('SELECT id, group_id, amount FROM expenses');
  for (const expense of expenses) {
    const participants = expense.group_id === groupIds[0]
      ? ids.slice(0, 4)
      : expense.group_id === groupIds[1]
        ? ids.slice(0, 3)
        : ids.slice(0, 4);
    const each = Number(expense.amount) / participants.length;
    for (const personId of participants) {
      await q('INSERT INTO splits(expense_id, person_id, amount) VALUES(?, ?, ?)', [
        expense.id,
        personId,
        each
      ]);
    }
  }
  await q(
    "INSERT INTO settlements(payer_id, payee_id, amount, note) VALUES(?, ?, 38.50, 'Coffee catch-up')",
    [ids[0], ids[1]]
  );
}

app.get('/api/health', async (_req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get('/api/summary', async (_req, res) => {
  try {
    const people = await q('SELECT id, name, initials, color FROM people ORDER BY id');
    const groups = await q(
      `SELECT g.id, g.name, g.icon, g.color, COUNT(DISTINCT e.id) AS expenses,
              COALESCE(SUM(e.amount), 0) AS total
       FROM \`groups\` g
       LEFT JOIN expenses e ON e.group_id = g.id
       GROUP BY g.id
       ORDER BY g.id`
    );
    const activity = await q(
      `SELECT e.id, e.title, e.amount, e.category, e.created_at, p.name AS payer,
              p.initials, p.color, g.name AS group_name
       FROM expenses e
       JOIN people p ON p.id = e.paid_by
       JOIN \`groups\` g ON g.id = e.group_id
       ORDER BY e.created_at DESC
       LIMIT 12`
    );
    const net = await q(
      `SELECT p.id, p.name, p.initials, p.color,
              COALESCE((SELECT SUM(s.amount) FROM splits s JOIN expenses e ON e.id = s.expense_id WHERE s.person_id = p.id), 0)
              - COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.paid_by = p.id), 0)
              + COALESCE((SELECT SUM(amount) FROM settlements WHERE payee_id = p.id), 0)
              - COALESCE((SELECT SUM(amount) FROM settlements WHERE payer_id = p.id), 0) AS balance
       FROM people p
       ORDER BY p.id`
    );
    res.json({ people, groups, activity, balances: net, currentUserId: people[0]?.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load your expense data.' });
  }
});

app.post('/api/expenses', async (req, res) => {
  const { groupId, title, amount, paidBy, category = 'Other', participants } = req.body;
  if (!groupId || !title || !Number.isFinite(Number(amount)) || Number(amount) <= 0 ||
      !Array.isArray(participants) || !participants.length) {
    return res.status(400).json({ error: 'Add a title, positive amount, group, and participants.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [expense] = await connection.execute(
      'INSERT INTO expenses(group_id, title, amount, paid_by, category) VALUES(?, ?, ?, ?, ?)',
      [groupId, title, amount, paidBy, category]
    );
    const each = Number(amount) / participants.length;
    for (const personId of participants) {
      await connection.execute(
        'INSERT INTO splits(expense_id, person_id, amount) VALUES(?, ?, ?)',
        [expense.insertId, personId, each]
      );
    }
    await connection.commit();
    res.status(201).json({ ok: true, id: expense.insertId });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ error: 'Could not save this expense.' });
  } finally {
    connection.release();
  }
});

app.post('/api/groups', async (req, res) => {
  const { name, icon = 'users', color = '#e9ddf2' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Group name is required.' });
  try {
    const result = await q('INSERT INTO `groups`(name, icon, color) VALUES(?, ?, ?)', [
      name.trim(),
      icon,
      color
    ]);
    const [group] = await q('SELECT * FROM `groups` WHERE id = ?', [result.insertId]);
    res.status(201).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create this group.' });
  }
});

app.post('/api/settlements', async (req, res) => {
  const { payerId, payeeId, amount, note = 'Settlement' } = req.body;
  if (!payerId || !payeeId || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Choose two people and a positive amount.' });
  }
  try {
    await q(
      'INSERT INTO settlements(payer_id, payee_id, amount, note) VALUES(?, ?, ?, ?)',
      [payerId, payeeId, amount, note]
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not save this settlement.' });
  }
});

const port = process.env.PORT || 5000;
init()
  .then(() => app.listen(port, '0.0.0.0', () => console.log(`Lendwise API listening on ${port}`)))
  .catch(error => {
    console.error('Database startup failed', error);
    process.exit(1);
  });
