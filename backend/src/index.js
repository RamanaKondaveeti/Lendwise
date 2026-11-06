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
    const members = await q(
      `SELECT gm.group_id, p.id, p.name, p.initials, p.color
       FROM group_members gm
       JOIN people p ON p.id = gm.person_id
       ORDER BY p.name, p.id`
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
    const activity = await q(
      `SELECT e.id, e.title, e.amount, e.category, e.created_at, p.name AS payer,
              p.initials, p.color, g.name AS group_name
       FROM expenses e
       JOIN people p ON p.id = e.paid_by
       JOIN \`groups\` g ON g.id = e.group_id
       ORDER BY e.created_at DESC
       LIMIT 12`
    );
    const [activityCount] = await q('SELECT COUNT(*) AS count FROM expenses');
    const net = await q(
      `SELECT p.id, p.name, p.initials, p.color,
              COALESCE((SELECT SUM(s.amount) FROM splits s JOIN expenses e ON e.id = s.expense_id WHERE s.person_id = p.id), 0)
              - COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.paid_by = p.id), 0)
              + COALESCE((SELECT SUM(amount) FROM settlements WHERE payee_id = p.id), 0)
              - COALESCE((SELECT SUM(amount) FROM settlements WHERE payer_id = p.id), 0) AS balance
       FROM people p
       ORDER BY p.id`
    );
    res.json({
      people,
      groups,
      activity,
      activityCount: Number(activityCount.count),
      balances: net,
      currentUserId: people[0]?.id
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load your expense data.' });
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
       JOIN people p ON p.id = e.paid_by
       JOIN \`groups\` g ON g.id = e.group_id
       ${groupId === null ? '' : 'WHERE e.group_id = ?'}
       ORDER BY e.created_at DESC, e.id DESC`,
      groupId === null ? [] : [groupId]
    );
    res.json(expenses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load expenses.' });
  }
});

app.post('/api/people', async (req, res) => {
  const { name } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 255) {
    return res.status(400).json({ error: 'A name of 1 to 255 characters is required.' });
  }

  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  try {
    const result = await q(
      'INSERT INTO people(name, initials) VALUES(?, ?)',
      [name.trim(), initials]
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

app.post('/api/expenses', async (req, res) => {
  const { groupId, title, amount, paidBy, category = 'Other', participants } = req.body;
  const normalizedGroupId = Number(groupId);
  const normalizedPaidBy = Number(paidBy);
  const amountCents = Math.round(Number(amount) * 100);
  const participantIds = Array.isArray(participants) ? participants.map(Number) : [];
  if (!Number.isInteger(normalizedGroupId) || normalizedGroupId <= 0 ||
      typeof title !== 'string' || !title.trim() ||
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
      q('SELECT id FROM `groups` WHERE id = ?', [normalizedGroupId]),
      q(
        `SELECT person_id AS id FROM group_members
         WHERE group_id = ? AND person_id IN (${[normalizedPaidBy, ...participantIds].map(() => '?').join(',')})`,
        [normalizedGroupId, normalizedPaidBy, ...participantIds]
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
  const { name, icon = 'users', color = '#e9ddf2', memberIds = [] } = req.body;
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
        `SELECT id FROM people WHERE id IN (${normalizedMemberIds.map(() => '?').join(',')})`,
        normalizedMemberIds
      );
      if (people.length !== normalizedMemberIds.length) {
        return res.status(400).json({ error: 'Choose existing users for this group.' });
      }
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const [result] = await connection.execute(
      'INSERT INTO `groups`(name, icon, color) VALUES(?, ?, ?)',
      [name.trim(), icon, color]
    );
    for (const personId of normalizedMemberIds) {
      await connection.execute(
        'INSERT INTO group_members(group_id, person_id) VALUES(?, ?)',
        [result.insertId, personId]
      );
    }
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
  const { personIds } = req.body;
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
      q('SELECT id FROM `groups` WHERE id = ?', [groupId]),
      memberIds.length
        ? q(`SELECT id FROM people WHERE id IN (${memberIds.map(() => '?').join(',')})`, memberIds)
        : Promise.resolve([])
    ]);
    if (!groups.length) return res.status(404).json({ error: 'Group not found.' });
    if (people.length !== memberIds.length) {
      return res.status(400).json({ error: 'Choose existing users for this group.' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    await connection.execute('DELETE FROM group_members WHERE group_id = ?', [groupId]);
    for (const personId of memberIds) {
      await connection.execute(
        'INSERT INTO group_members(group_id, person_id) VALUES(?, ?)',
        [groupId, personId]
      );
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
  const { payerId, payeeId, amount, note = 'Settlement' } = req.body;
  const normalizedPayerId = Number(payerId);
  const normalizedPayeeId = Number(payeeId);
  const amountCents = Math.round(Number(amount) * 100);
  if (!Number.isInteger(normalizedPayerId) || normalizedPayerId <= 0 ||
      !Number.isInteger(normalizedPayeeId) || normalizedPayeeId <= 0 ||
      normalizedPayerId === normalizedPayeeId ||
      !Number.isFinite(Number(amount)) || !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 || amountCents > 999999999999 ||
      typeof note !== 'string' || !note.trim() || note.length > 255) {
    return res.status(400).json({ error: 'Choose two people and a positive amount.' });
  }
  try {
    await q(
      'INSERT INTO settlements(payer_id, payee_id, amount, note) VALUES(?, ?, ?, ?)',
      [normalizedPayerId, normalizedPayeeId, amountCents / 100, note.trim()]
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
