const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

const scrypt = promisify(crypto.scrypt);
const passwordHashOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
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

function derivePasswordHash(password, salt) {
  return scrypt(password, salt, 64, passwordHashOptions);
}

const sessionCookieName = 'lendwise_session';
const sessionDurationSeconds = 7 * 24 * 60 * 60;

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

async function createSession(accountId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(
    `INSERT INTO auth_sessions(token_hash, account_id, expires_at)
     VALUES(?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 604800 SECOND))`,
    [hashSessionToken(token), accountId]
  );
  setSessionCookie(res, token);
}

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  for (const statement of schema.split(';').map(part => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  await q('DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP()');
}

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedName || normalizedName.length > 255 ||
      normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Enter a name, valid email, and password between 8 and 128 characters.' });
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
    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const [person] = await connection.execute(
      'INSERT INTO people(name, initials) VALUES(?, ?)',
      [normalizedName, initials]
    );
    const [account] = await connection.execute(
      'INSERT INTO accounts(email, password_salt, password_hash, person_id) VALUES(?, ?, ?, ?)',
      [normalizedEmail, salt, passwordHash.toString('hex'), person.insertId]
    );
    const token = crypto.randomBytes(32).toString('base64url');
    await connection.execute(
      `INSERT INTO auth_sessions(token_hash, account_id, expires_at)
       VALUES(?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 604800 SECOND))`,
      [hashSessionToken(token), account.insertId]
    );
    await connection.commit();
    inTransaction = false;
    setSessionCookie(res, token);
    res.status(201).json({
      id: account.insertId,
      email: normalizedEmail,
      name: normalizedName,
      personId: person.insertId
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

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      typeof password !== 'string' || !password.length || password.length > 128) {
    return res.status(400).json({ error: 'Enter a valid email and password.' });
  }

  try {
    const [account] = await q(
      `SELECT a.id, a.email, a.password_salt, a.password_hash, a.person_id, p.name
       FROM accounts a JOIN people p ON p.id = a.person_id
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

    await createSession(account.id, res);
    res.json({
      id: account.id,
      email: account.email,
      name: account.name,
      personId: account.person_id
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
      `SELECT a.id, a.email, a.person_id, p.name
       FROM auth_sessions s
       JOIN accounts a ON a.id = s.account_id
       JOIN people p ON p.id = a.person_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`,
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
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  return requireAuth(req, res, next);
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    id: req.account.id,
    email: req.account.email,
    name: req.account.name,
    personId: req.account.person_id
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get('/api/summary', async (req, res) => {
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
      currentUserId: req.account.person_id
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
