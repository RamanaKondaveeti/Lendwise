const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
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

async function sendVerification(account) {
  const token = await createEmailToken(account.id, 'verification');
  await sendEmail({
    to: account.email,
    subject: 'Verify your Lendwise email',
    text: `Verify your email address: ${appUrl}/?verify=${encodeURIComponent(token)}`
  });
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
  await ensureColumn('people', 'workspace_id', 'INT NULL');
  await ensureColumn('groups', 'workspace_id', 'INT NULL');
  await ensureColumn('accounts', 'workspace_id', 'INT NULL');
  await ensureColumn('accounts', 'email_verified_at', 'DATETIME NULL');
  await ensureColumn('auth_sessions', 'workspace_id', 'INT NULL');

  const [legacyAccounts] = await q(
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
    const [workspace] = await q("INSERT INTO workspaces(name) VALUES('Legacy workspace')");
    await q('UPDATE people SET workspace_id = ? WHERE workspace_id IS NULL', [workspace.insertId]);
    await q('UPDATE `groups` SET workspace_id = ? WHERE workspace_id IS NULL', [workspace.insertId]);
  }
  await q(
    `UPDATE auth_sessions s JOIN accounts a ON a.id = s.account_id
     SET s.workspace_id = a.workspace_id WHERE s.workspace_id IS NULL`
  );

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
  if (!emailIsConfigured()) {
    return res.status(503).json({ error: 'Account email is unavailable. Please contact the workspace administrator.' });
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
        `SELECT id, workspace_id, email FROM workspace_invitations
         WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
        [hashSessionToken(invitationToken)]
      );
      const invitation = invitations[0];
      if (!invitation || invitation.email !== normalizedEmail) {
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
    const [person] = await connection.execute(
      'INSERT INTO people(workspace_id, name, initials) VALUES(?, ?, ?)',
      [workspaceId, normalizedName, initials]
    );
    const [account] = await connection.execute(
      'INSERT INTO accounts(workspace_id, email, password_salt, password_hash, person_id) VALUES(?, ?, ?, ?, ?)',
      [workspaceId, normalizedEmail, salt, passwordHash.toString('hex'), person.insertId]
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
    try {
      await sendVerification({ id: account.insertId, email: normalizedEmail });
    } catch (emailError) {
      console.error('Signup verification email delivery failed', emailError);
      return res.status(201).json({
        verificationRequired: true,
        emailDeliveryFailed: true,
        message: 'Your account was created, but the verification email could not be sent. Ask an administrator to check email settings.'
      });
    }
    res.status(201).json({
      verificationRequired: true,
      email: normalizedEmail,
      message: 'Check your email for a verification link.'
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

app.post('/api/auth/verify-email', authRateLimit, async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== 'string' || token.length < 20 || token.length > 128) {
    return res.status(400).json({ error: 'Verification link is invalid or expired.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [tokens] = await connection.execute(
      `SELECT t.account_id, a.workspace_id
       FROM email_tokens t JOIN accounts a ON a.id = t.account_id
       WHERE t.token_hash = ? AND t.token_type = 'verification'
         AND t.expires_at > UTC_TIMESTAMP() FOR UPDATE`,
      [hashSessionToken(token)]
    );
    const verification = tokens[0];
    if (!verification) {
      await connection.rollback();
      return res.status(400).json({ error: 'Verification link is invalid or expired.' });
    }
    await connection.execute(
      'UPDATE accounts SET email_verified_at = UTC_TIMESTAMP() WHERE id = ?',
      [verification.account_id]
    );
    await connection.execute(
      'DELETE FROM email_tokens WHERE account_id = ? AND token_type = ?',
      [verification.account_id, 'verification']
    );
    const sessionToken = crypto.randomBytes(32).toString('base64url');
    await connection.execute(
      `INSERT INTO auth_sessions(token_hash, account_id, workspace_id, expires_at)
       VALUES(?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
      [hashSessionToken(sessionToken), verification.account_id, verification.workspace_id, sessionDurationSeconds]
    );
    await connection.commit();
    setSessionCookie(res, sessionToken);
    res.json({ ok: true });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    res.status(500).json({ error: 'Could not verify your email.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/auth/resend-verification', authRateLimit, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  try {
    const [account] = await q(
      'SELECT id, email, email_verified_at FROM accounts WHERE email = ?',
      [email]
    );
    if (account && !account.email_verified_at) {
      await sendVerification(account);
    }
    res.json({ message: 'If that account needs verification, a link will be sent.' });
  } catch (error) {
    console.error('Verification email delivery failed', error);
    res.json({ message: 'If that account needs verification, a link will be sent.' });
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
          subject: 'Reset your Lendwise password',
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
              a.workspace_id, a.email_verified_at, p.name
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

    if (!account.email_verified_at) {
      return res.status(403).json({ error: 'Verify your email before signing in.', verificationRequired: true });
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
        `SELECT a.id, a.email, a.person_id, s.workspace_id, p.name
       FROM auth_sessions s
       JOIN accounts a ON a.id = s.account_id
       JOIN people p ON p.id = a.person_id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
           AND a.workspace_id = s.workspace_id AND p.workspace_id = a.workspace_id
           AND a.email_verified_at IS NOT NULL`,
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
  if (req.path === '/health' || req.path.startsWith('/auth/') || req.path.startsWith('/invitations/')) return next();
  return requireAuth(req, res, next);
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    id: req.account.id,
    email: req.account.email,
    name: req.account.name,
    personId: req.account.person_id,
    workspaceId: req.account.workspace_id
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

app.get('/api/invitations/:token', async (req, res) => {
  const token = req.params.token;
  if (!token || token.length > 128) {
    return res.status(400).json({ error: 'Invitation link is invalid or expired.' });
  }
  try {
    const [invitation] = await q(
      `SELECT i.email, w.name AS workspace_name
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

app.post('/api/invitations', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!emailIsConfigured()) {
    return res.status(503).json({ error: 'Workspace invitations are unavailable until email delivery is configured.' });
  }
  try {
    const [existingAccount] = await q('SELECT id FROM accounts WHERE email = ?', [email]);
    if (existingAccount) {
      return res.status(202).json({ message: 'If the address can be invited, an invitation email will arrive shortly.' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    await q(
      `INSERT INTO workspace_invitations(workspace_id, email, token_hash, invited_by, expires_at)
       VALUES(?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))`,
      [req.account.workspace_id, email, hashSessionToken(token), req.account.id]
    );
    const inviteUrl = `${appUrl}/?invite=${encodeURIComponent(token)}`;
    try {
      await sendEmail({
        to: email,
        subject: 'You are invited to Lendwise',
        text: `${req.account.name} invited you to join their Lendwise workspace. Create your account: ${inviteUrl}`
      });
    } catch (emailError) {
      console.error('Workspace invitation email delivery failed', emailError);
      await q('DELETE FROM workspace_invitations WHERE token_hash = ?', [hashSessionToken(token)]);
      return res.status(503).json({ error: 'Could not send this invitation. Please try again later.' });
    }
    res.status(201).json({ message: 'Invitation email sent.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create this invitation.' });
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
    const net = await q(
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
       FROM people p
       WHERE p.workspace_id = ?
       ORDER BY p.id`,
      [workspaceId]
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
       JOIN people p ON p.id = e.paid_by AND p.workspace_id = ?
       JOIN \`groups\` g ON g.id = e.group_id
       WHERE g.workspace_id = ? ${groupId === null ? '' : 'AND e.group_id = ?'}
       ORDER BY e.created_at DESC, e.id DESC`,
      groupId === null
        ? [req.account.workspace_id, req.account.workspace_id]
        : [req.account.workspace_id, req.account.workspace_id, groupId]
    );
    res.json(expenses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load expenses.' });
  }
});

app.post('/api/people', async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 255) {
    return res.status(400).json({ error: 'A name of 1 to 255 characters is required.' });
  }

  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  try {
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
          `SELECT id FROM people WHERE workspace_id = ? AND id IN (${memberIds.map(() => '?').join(',')})`,
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
  const { payerId, payeeId, amount, note = 'Settlement' } = req.body || {};
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
    const people = await q(
      'SELECT id FROM people WHERE workspace_id = ? AND id IN (?, ?)',
      [req.account.workspace_id, normalizedPayerId, normalizedPayeeId]
    );
    if (people.length !== 2) {
      return res.status(400).json({ error: 'Choose two users from your workspace.' });
    }
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
  .then(() => app.listen(port, '0.0.0.0', () => console.log(`Lendwise API listening on ${port}`)))
  .catch(error => {
    console.error('Database startup failed', error);
    process.exit(1);
  });
