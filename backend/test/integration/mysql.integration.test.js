const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const backendDir = path.resolve(__dirname, '../..');
const configPath = path.join(backendDir, '.env.integration');
const integrationWorkspacePattern = 'Integration Test %';
const integrationEmailPattern = 'gb-it-%@example.invalid';
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
let db;
let appProcess;
let baseUrl;
let config;
let runWorkspacePrefix;
let requestIp = 10;

function databaseLockName() {
  const nameHash = crypto.createHash('sha256').update(config.DB_NAME).digest('hex').slice(0, 56);
  return `gb-it:${nameHash}`;
}

function failClosed(message) {
  throw new Error(`Integration safety check refused to run: ${message}`);
}

function loadIntegrationConfig() {
  if (!fs.existsSync(configPath)) {
    failClosed('backend/.env.integration is missing; create it from .env.integration.example. The regular .env is never used.');
  }
  const values = dotenv.parse(fs.readFileSync(configPath));
  const required = [
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'GROUPBUK_INTEGRATION_EXPECTED_SERVER', 'GROUPBUK_INTEGRATION_DB_MARKER',
  ];
  for (const key of required) {
    if (!values[key]) failClosed(`${key} must be set in backend/.env.integration.`);
  }
  if (values.GROUPBUK_INTEGRATION_ALLOW_DESTRUCTIVE !== 'YES_I_CREATED_AN_ISOLATED_DATABASE') {
    failClosed('explicit destructive-test opt-in is missing.');
  }
  if (!/^groupbuk(?:_[a-z0-9]+)*_test$/.test(values.DB_NAME.toLowerCase())) {
    failClosed('DB_NAME must have the dedicated groupbuk_*_test naming pattern.');
  }
  if (!/integration.*test|test.*integration/i.test(values.DB_USER)) {
    failClosed('DB_USER must be a dedicated integration-test MySQL account.');
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(values.GROUPBUK_INTEGRATION_EXPECTED_SERVER)) {
    failClosed('expected MySQL server identity has an invalid format.');
  }
  if (values.GROUPBUK_INTEGRATION_DB_MARKER.length < 32) {
    failClosed('the database marker must be a unique random value of at least 32 characters.');
  }
  const port = Number(values.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) failClosed('DB_PORT is invalid.');
  return { ...values, DB_PORT: String(port) };
}

async function rowsInTable(tableName) {
  const [[row]] = await db.query(`SELECT COUNT(*) AS row_count FROM \`${tableName}\``);
  return Number(row.row_count);
}

async function deleteIntegrationWorkspaces(namePattern) {
  const [workspaces] = await db.execute('SELECT id FROM workspaces WHERE name LIKE ?', [namePattern]);
  const workspaceIds = workspaces.map(row => Number(row.id));
  if (!workspaceIds.length) return;
  const slots = ids => ids.map(() => '?').join(',');
  const [people] = await db.execute(
    `SELECT id FROM people WHERE workspace_id IN (${slots(workspaceIds)})`, workspaceIds
  );
  const [groups] = await db.execute(
    `SELECT id FROM \`groups\` WHERE workspace_id IN (${slots(workspaceIds)})`, workspaceIds
  );
  const [accounts] = await db.execute(
    `SELECT id FROM accounts WHERE workspace_id IN (${slots(workspaceIds)})`, workspaceIds
  );
  const [expenses] = await db.execute(
    `SELECT e.id FROM expenses e JOIN \`groups\` g ON g.id = e.group_id
     WHERE g.workspace_id IN (${slots(workspaceIds)})`, workspaceIds
  );
  const personIds = people.map(row => Number(row.id));
  const groupIds = groups.map(row => Number(row.id));
  const accountIds = accounts.map(row => Number(row.id));
  const expenseIds = expenses.map(row => Number(row.id));
  const inClause = ids => ids.length ? `(${slots(ids)})` : '(NULL)';
  await db.beginTransaction();
  try {
    await db.execute(
      `DELETE FROM settlements WHERE payer_id IN ${inClause(personIds)} OR payee_id IN ${inClause(personIds)}
       OR group_id IN ${inClause(groupIds)} OR expense_id IN ${inClause(expenseIds)}`,
      [...personIds, ...personIds, ...groupIds, ...expenseIds]
    );
    await db.execute(`DELETE FROM group_activity WHERE group_id IN ${inClause(groupIds)}`, groupIds);
    await db.execute(
      `DELETE FROM notifications WHERE workspace_id IN ${inClause(workspaceIds)} OR account_id IN ${inClause(accountIds)}`,
      [...workspaceIds, ...accountIds]
    );
    await db.execute(
      `DELETE FROM idempotency_requests WHERE workspace_id IN ${inClause(workspaceIds)} OR account_id IN ${inClause(accountIds)}`,
      [...workspaceIds, ...accountIds]
    );
    await db.execute(`DELETE FROM auth_sessions WHERE account_id IN ${inClause(accountIds)}`, accountIds);
    await db.execute(`DELETE FROM email_tokens WHERE account_id IN ${inClause(accountIds)}`, accountIds);
    await db.execute(`DELETE FROM notification_preferences WHERE account_id IN ${inClause(accountIds)}`, accountIds);
    await db.execute(`DELETE FROM workspace_invitations WHERE workspace_id IN ${inClause(workspaceIds)}`, workspaceIds);
    await db.execute(`DELETE FROM recurring_expenses WHERE workspace_id IN ${inClause(workspaceIds)}`, workspaceIds);
    await db.execute(`DELETE FROM budgets WHERE workspace_id IN ${inClause(workspaceIds)}`, workspaceIds);
    await db.execute(`DELETE FROM trips WHERE group_id IN ${inClause(groupIds)}`, groupIds);
    await db.execute(`DELETE FROM expenses WHERE group_id IN ${inClause(groupIds)}`, groupIds);
    await db.execute(`DELETE FROM group_members WHERE group_id IN ${inClause(groupIds)}`, groupIds);
    await db.execute(`DELETE FROM \`groups\` WHERE id IN ${inClause(groupIds)}`, groupIds);
    await db.execute(`DELETE FROM workspace_members WHERE workspace_id IN ${inClause(workspaceIds)}`, workspaceIds);
    await db.execute(`DELETE FROM accounts WHERE id IN ${inClause(accountIds)}`, accountIds);
    await db.execute(`DELETE FROM people WHERE id IN ${inClause(personIds)}`, personIds);
    await db.execute(`DELETE FROM workspaces WHERE id IN ${inClause(workspaceIds)}`, workspaceIds);
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  }
}

async function verifyAndLockDatabase() {
  db = await mysql.createConnection({
    host: config.DB_HOST,
    port: Number(config.DB_PORT),
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    connectTimeout: 5000,
    multipleStatements: false,
  });
  const [[identity]] = await db.query(
    'SELECT DATABASE() AS database_name, @@hostname AS server_name, @@global.read_only AS read_only'
  );
  if (identity.database_name !== config.DB_NAME) failClosed('connected database name did not match DB_NAME.');
  if (identity.server_name !== config.GROUPBUK_INTEGRATION_EXPECTED_SERVER) {
    failClosed('connected MySQL server did not match GROUPBUK_INTEGRATION_EXPECTED_SERVER.');
  }
  if (Number(identity.read_only)) failClosed('the selected MySQL server is read-only.');
  const [[lock]] = await db.query('SELECT GET_LOCK(?, 0) AS acquired', [databaseLockName()]);
  if (Number(lock.acquired) !== 1) failClosed('another integration test run holds the database lock.');

  const markerHash = crypto.createHash('sha256').update(config.GROUPBUK_INTEGRATION_DB_MARKER).digest('hex');
  const [markerTables] = await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'groupbuk_integration_guard' AND TABLE_TYPE = 'BASE TABLE'`,
    [config.DB_NAME]
  );
  const [appTables] = await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> 'groupbuk_integration_guard'`,
    [config.DB_NAME]
  );

  if (markerTables.length) {
    const [[marker]] = await db.query('SELECT * FROM groupbuk_integration_guard WHERE id = 1');
    if (!marker || marker.marker_hash !== markerHash || marker.database_name !== config.DB_NAME ||
        marker.server_name !== identity.server_name) {
      failClosed('the database safety marker does not match this dedicated test configuration.');
    }
    const [[badWorkspace]] = await db.query(
      'SELECT id FROM workspaces WHERE name NOT LIKE ? LIMIT 1', [integrationWorkspacePattern]
    ).catch(() => [[null]]);
    const [[badAccount]] = await db.query(
      'SELECT id FROM accounts WHERE email NOT LIKE ? LIMIT 1', [integrationEmailPattern]
    ).catch(() => [[null]]);
    if (badWorkspace || badAccount) failClosed('non-integration application data exists in the target database.');
  } else {
    for (const { TABLE_NAME: tableName } of appTables) {
      if (await rowsInTable(tableName)) {
        failClosed('the target schema contains data but has no integration-test safety marker.');
      }
    }
    await db.query(
      `CREATE TABLE groupbuk_integration_guard (
        id TINYINT NOT NULL PRIMARY KEY,
        marker_hash CHAR(64) NOT NULL,
        database_name VARCHAR(64) NOT NULL,
        server_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`
    );
    await db.execute(
      'INSERT INTO groupbuk_integration_guard(id, marker_hash, database_name, server_name) VALUES(1, ?, ?, ?)',
      [markerHash, config.DB_NAME, identity.server_name]
    );
  }

  // Prior interrupted test runs are safe to remove only after the marker and test-only row checks pass.
  if (appTables.some(table => table.TABLE_NAME === 'workspaces')) {
    await deleteIntegrationWorkspaces(integrationWorkspacePattern);
  }
}

async function reservePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

function childEnvironment(port) {
  const allowedSystem = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'];
  const env = Object.fromEntries(allowedSystem.filter(key => process.env[key]).map(key => [key, process.env[key]]));
  return {
    ...env,
    NODE_ENV: 'test',
    GROUPBUK_INTEGRATION_TEST: 'true',
    PORT: String(port),
    APP_URL: 'http://127.0.0.1',
    COOKIE_SECURE: 'false',
    DB_HOST: config.DB_HOST,
    DB_PORT: config.DB_PORT,
    DB_NAME: config.DB_NAME,
    DB_USER: config.DB_USER,
    DB_PASSWORD: config.DB_PASSWORD,
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  };
}

async function startApplication() {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  appProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: backendDir,
    env: childEnvironment(port),
    stdio: 'ignore',
    windowsHide: true,
  });
  const started = Date.now();
  while (Date.now() - started < 60000) {
    if (appProcess.exitCode !== null) failClosed('the application exited during isolated test startup.');
    try {
      const response = await fetch(`${baseUrl}/api/health/ready`, { signal: AbortSignal.timeout(1500) });
      if (response.status === 200) return;
    } catch { /* wait for schema initialization and server startup */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  failClosed('the application did not become ready against the isolated test database.');
}

async function stopApplication() {
  if (!appProcess || appProcess.exitCode !== null) return;
  const child = appProcess;
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill('SIGTERM');
  });
  appProcess = null;
}

async function cleanupRun() {
  if (!db) return;
  try {
    if (runWorkspacePrefix) {
      await deleteIntegrationWorkspaces(`${runWorkspacePrefix}%`);
    }
  } finally {
    await db.query('SELECT RELEASE_LOCK(?)', [databaseLockName()]).catch(() => {});
    await db.end().catch(() => {});
    db = null;
  }
}

async function api(route, { method = 'GET', cookie, body, key } = {}) {
  const headers = {
    Accept: 'application/json',
    'X-Forwarded-For': `192.0.2.${requestIp++ % 250 + 1}`,
  };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  const cookies = response.headers.getSetCookie?.() || [];
  return {
    status: response.status,
    body: payload,
    cookie: cookies.map(value => value.split(';', 1)[0]).find(value => value.startsWith('lendwise_session=')) || null,
  };
}

function expectStatus(result, expected, label) {
  assert.equal(result.status, expected, `${label}: ${JSON.stringify(result.body)}`);
}

async function createAccount(name, email, password) {
  const result = await api('/api/auth/signup', {
    method: 'POST', body: { name, email, password },
  });
  expectStatus(result, 201, 'signup');
  assert.ok(result.cookie, 'signup should create a session cookie');
  return { ...result.body, cookie: result.cookie, email, password };
}

async function balanceRows(groupId) {
  const [rows] = await db.execute(
    `SELECT p.id,
       COALESCE((SELECT SUM(s.amount) FROM splits s JOIN expenses e ON e.id = s.expense_id
                 WHERE e.group_id = ? AND e.voided_at IS NULL AND s.person_id = p.id), 0)
       - COALESCE((SELECT SUM(e.amount) FROM expenses e
                   WHERE e.group_id = ? AND e.voided_at IS NULL AND e.paid_by = p.id), 0)
       + COALESCE((SELECT SUM(st.amount) FROM settlements st JOIN expenses e ON e.id = st.expense_id
                   WHERE e.group_id = ? AND st.payee_id = p.id AND e.voided_at IS NULL), 0)
       - COALESCE((SELECT SUM(st.amount) FROM settlements st JOIN expenses e ON e.id = st.expense_id
                   WHERE e.group_id = ? AND st.payer_id = p.id AND e.voided_at IS NULL), 0)
       + COALESCE((SELECT SUM(st.amount) FROM settlements st WHERE st.group_id = ? AND st.payee_id = p.id), 0)
       - COALESCE((SELECT SUM(st.amount) FROM settlements st WHERE st.group_id = ? AND st.payer_id = p.id), 0) AS balance
     FROM people p JOIN group_members gm ON gm.person_id = p.id
     WHERE gm.group_id = ? ORDER BY p.id`,
    [groupId, groupId, groupId, groupId, groupId, groupId, groupId]
  );
  return rows.map(row => ({ id: Number(row.id), cents: Math.round(Number(row.balance) * 100) }));
}

async function waitForRecurringExpense(templateId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [[occurrence]] = await db.execute(
      'SELECT expense_id FROM recurring_expense_occurrences WHERE template_id = ? ORDER BY id DESC LIMIT 1',
      [templateId]
    );
    if (occurrence?.expense_id) return Number(occurrence.expense_id);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('The scheduled recurring-expense worker did not generate the due occurrence in time.');
}

test('database-backed GroupBuk workflows on a guarded isolated MySQL database', {
  timeout: 240000,
}, async t => {
  config = loadIntegrationConfig();
  try {
    await verifyAndLockDatabase();
    await startApplication();
    runWorkspacePrefix = `Integration Test ${runId}`;
    let primary;
    let second;

    await t.test('registration, login, logout, expiry, and password reset persist to MySQL', async () => {
      primary = await createAccount(`${runWorkspacePrefix} Owner`, `gb-it-${runId}-owner@example.invalid`, 'integration-pass-123');
      const protectedBefore = await api('/api/summary');
      expectStatus(protectedBefore, 401, 'unauthenticated summary');
      expectStatus(await api('/api/auth/me', { cookie: primary.cookie }), 200, 'authenticated session');
      expectStatus(await api('/api/summary', { cookie: 'lendwise_session=invalid-integration-token' }), 401, 'invalid session');
      expectStatus(await api('/api/auth/logout', { method: 'POST', cookie: primary.cookie }), 200, 'logout');
      expectStatus(await api('/api/auth/me', { cookie: primary.cookie }), 401, 'logged-out session');

      let login = await api('/api/auth/login', {
        method: 'POST', body: { email: primary.email, password: primary.password },
      });
      expectStatus(login, 200, 'login');
      assert.ok(login.cookie);
      const token = decodeURIComponent(login.cookie.slice('lendwise_session='.length));
      await db.execute('UPDATE auth_sessions SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE token_hash = ?', [crypto.createHash('sha256').update(token).digest('hex')]);
      expectStatus(await api('/api/auth/me', { cookie: login.cookie }), 401, 'expired session');

      const resetToken = `integration-reset-${crypto.randomBytes(20).toString('hex')}`;
      await db.execute(
        `INSERT INTO email_tokens(token_hash, account_id, token_type, expires_at)
         SELECT SHA2(?, 256), id, 'password_reset', UTC_TIMESTAMP() + INTERVAL 10 MINUTE
         FROM accounts WHERE email = ?`, [resetToken, primary.email]
      );
      expectStatus(await api('/api/auth/reset-password', {
        method: 'POST', body: { token: resetToken, password: 'integration-reset-pass-456' },
      }), 200, 'password reset');
      login = await api('/api/auth/login', {
        method: 'POST', body: { email: primary.email, password: 'integration-reset-pass-456' },
      });
      expectStatus(login, 200, 'login after reset');
      primary.cookie = login.cookie;
      primary.password = 'integration-reset-pass-456';
      second = await createAccount(`${runWorkspacePrefix} Guest`, `gb-it-${runId}-guest@example.invalid`, 'integration-pass-789');
    });

    await t.test('group membership, expense persistence/idempotency, edits, settlements, analytics, reports, trips, recurring execution, and IDOR', async () => {
      const groupResult = await api('/api/groups', {
        method: 'POST', cookie: primary.cookie,
        body: { name: `${runWorkspacePrefix} Group`, memberIds: [primary.personId] },
      });
      expectStatus(groupResult, 201, 'group creation');
      const groupId = groupResult.body.id;
      const personResult = await api('/api/people', {
        method: 'POST', cookie: primary.cookie, body: { name: `${runWorkspacePrefix} Participant` },
      });
      expectStatus(personResult, 201, 'participant creation');
      const participantId = personResult.body.id;
      expectStatus(await api(`/api/groups/${groupId}/members`, {
        method: 'PUT', cookie: primary.cookie, body: { personIds: [primary.personId, participantId] },
      }), 200, 'add group member');
      expectStatus(await api(`/api/groups/${groupId}/members`, {
        method: 'PUT', cookie: primary.cookie, body: { personIds: [primary.personId] },
      }), 200, 'remove group member');
      const [[removedParticipant]] = await db.execute(
        'SELECT COUNT(*) AS count FROM group_members WHERE group_id = ? AND person_id = ?',
        [groupId, participantId]
      );
      assert.equal(Number(removedParticipant.count), 0, 'removed participant membership must not persist');
      expectStatus(await api(`/api/groups/${groupId}/trips`, { cookie: primary.cookie }), 200,
        'remaining group member can still list group trips');
      const deniedNonmember = await api('/api/expenses', {
        method: 'POST', cookie: primary.cookie,
        body: { groupId, title: 'Invalid membership expense', amount: 10, paidBy: primary.personId, participants: [participantId] },
      });
      expectStatus(deniedNonmember, 400, 'nonmember expense participant');
      expectStatus(await api(`/api/groups/${groupId}/members`, {
        method: 'PUT', cookie: primary.cookie, body: { personIds: [primary.personId, participantId] },
      }), 200, 'restore group member');
      const [[restoredParticipant]] = await db.execute(
        'SELECT COUNT(*) AS count FROM group_members WHERE group_id = ? AND person_id = ?',
        [groupId, participantId]
      );
      assert.equal(Number(restoredParticipant.count), 1, 'restored participant membership must persist exactly once');

      const groupBudgetBody = {
        name: `${runWorkspacePrefix} Group Budget`, budgetType: 'group', groupId,
        amount: 250, currency: 'INR', period: 'monthly',
        startDate: new Date().toISOString().slice(0, 10), endDate: null, alertThresholds: [80, 100],
      };
      const groupBudget = await api('/api/budgets', {
        method: 'POST', cookie: primary.cookie, body: groupBudgetBody,
      });
      expectStatus(groupBudget, 201, 'group budget creation by restored member');
      expectStatus(await api(`/api/budgets/${groupBudget.body.id}`, {
        method: 'PUT', cookie: primary.cookie, body: { ...groupBudgetBody, name: `${runWorkspacePrefix} Group Budget Updated` },
      }), 200, 'group budget update by restored member');

      const authenticatedIdentity = await api('/api/auth/me', { cookie: primary.cookie });
      expectStatus(authenticatedIdentity, 200, 'authenticated identity after membership restore');
      assert.equal(Number(authenticatedIdentity.body.personId), Number(primary.personId),
        'the active session must resolve to the primary account person ID');
      assert.equal(Number(authenticatedIdentity.body.workspaceId), Number(primary.workspaceId),
        'the active session must resolve to the primary account workspace ID');
      const [[tripAccess]] = await db.execute(
        `SELECT a.person_id AS account_person_id, a.workspace_id AS account_workspace_id,
                wm.person_id AS session_person_id, s.workspace_id AS session_workspace_id,
                g.workspace_id AS group_workspace_id, gm.person_id AS member_person_id
         FROM accounts a
         JOIN auth_sessions s ON s.account_id = a.id
         JOIN workspace_members wm ON wm.account_id = a.id AND wm.workspace_id = s.workspace_id
         JOIN \`groups\` g ON g.id = ?
         LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.person_id = wm.person_id
         WHERE a.id = ? AND s.expires_at > UTC_TIMESTAMP()
         ORDER BY s.created_at DESC LIMIT 1`,
        [groupId, primary.id]
      );
      assert.ok(tripAccess, 'the primary account must have an active session and a workspace row');
      assert.equal(Number(tripAccess.account_person_id), Number(authenticatedIdentity.body.personId));
      assert.equal(Number(tripAccess.session_person_id), Number(authenticatedIdentity.body.personId));
      assert.equal(Number(tripAccess.account_workspace_id), Number(authenticatedIdentity.body.workspaceId));
      assert.equal(Number(tripAccess.session_workspace_id), Number(authenticatedIdentity.body.workspaceId));
      assert.equal(Number(tripAccess.group_workspace_id), Number(authenticatedIdentity.body.workspaceId));
      assert.equal(Number(tripAccess.member_person_id), Number(authenticatedIdentity.body.personId),
        'the authenticated person must be a member of the group after membership restore');
      const [[tripRouteAuthorization]] = await db.execute(
        `SELECT g.id FROM \`groups\` g JOIN group_members gm ON gm.group_id = g.id
         WHERE g.id = ? AND g.workspace_id = ? AND gm.person_id = ?`,
        [groupId, authenticatedIdentity.body.workspaceId, authenticatedIdentity.body.personId]
      );
      assert.ok(tripRouteAuthorization,
        'the exact group membership query used by the trip routes must match this authenticated identity');
      expectStatus(await api(`/api/groups/${groupId}/activity`, { cookie: primary.cookie }), 200,
        'authenticated group membership through the activity API');
      expectStatus(await api(`/api/groups/${groupId}/trips`, { cookie: primary.cookie }), 200,
        'group trip membership authorization immediately after membership restore');

      const foreignGroup = await api(`/api/groups/${groupId}/activity`, { cookie: second.cookie });
      expectStatus(foreignGroup, 404, 'cross-workspace group activity');
      expectStatus(await api(`/api/reports?type=expense&groupId=${groupId}`, { cookie: second.cookie }), 404, 'cross-workspace report');
      expectStatus(await api('/api/settlements', {
        method: 'POST', cookie: second.cookie, key: `it-foreign-settlement-${runId}`,
        body: { payerId: primary.personId, payeeId: participantId, amount: 1, groupId, note: 'Must not cross workspace' },
      }), 400, 'cross-workspace settlement creation');

      const tripStart = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const tripEnd = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const identityImmediatelyBeforeTrip = await api('/api/auth/me', { cookie: primary.cookie });
      expectStatus(identityImmediatelyBeforeTrip, 200, 'authenticated identity after cross-workspace requests');
      assert.equal(Number(identityImmediatelyBeforeTrip.body.personId), Number(authenticatedIdentity.body.personId));
      assert.equal(Number(identityImmediatelyBeforeTrip.body.workspaceId), Number(authenticatedIdentity.body.workspaceId));
      const [[tripAuthorizationImmediatelyBeforeTrip]] = await db.execute(
        `SELECT g.id FROM \`groups\` g JOIN group_members gm ON gm.group_id = g.id
         WHERE g.id = ? AND g.workspace_id = ? AND gm.person_id = ?`,
        [groupId, identityImmediatelyBeforeTrip.body.workspaceId, identityImmediatelyBeforeTrip.body.personId]
      );
      assert.ok(tripAuthorizationImmediatelyBeforeTrip,
        'group membership must still satisfy the exact trip authorization query after cross-workspace requests');
      expectStatus(await api(`/api/groups/${groupId}/trips`, { cookie: primary.cookie }), 200,
        'group trip membership authorization after cross-workspace requests');
      const tripResult = await api(`/api/groups/${groupId}/trips`, {
        method: 'POST', cookie: primary.cookie,
        body: { name: `${runWorkspacePrefix} Trip`, startDate: tripStart, endDate: tripEnd, budgetAmount: 1000, status: 'planned' },
      });
      expectStatus(tripResult, 201, 'trip creation');
      const tripId = tripResult.body.id;
      expectStatus(await api(`/api/trips/${tripId}`, { cookie: second.cookie }), 404, 'cross-workspace trip');
      expectStatus(await api(`/api/trips/${tripId}`, { cookie: primary.cookie }), 200, 'trip read');
      expectStatus(await api(`/api/trips/${tripId}`, {
        method: 'PUT', cookie: primary.cookie, body: { status: 'completed' },
      }), 200, 'trip status update');
      const tripExpense = await api('/api/expenses', {
        method: 'POST', cookie: primary.cookie, key: `it-trip-expense-${runId}`,
        body: {
          groupId, tripId, title: `${runWorkspacePrefix} Trip Expense`, amount: 18,
          paidBy: primary.personId, participants: [primary.personId, participantId],
        },
      });
      expectStatus(tripExpense, 201, 'trip expense creation');
      const tripList = await api(`/api/groups/${groupId}/trips`, { cookie: primary.cookie });
      expectStatus(tripList, 200, 'group trip listing');
      assert.ok(tripList.body.some(row => Number(row.id) === Number(tripId) && Number(row.expense_count) === 1));

      const expenseBody = {
        groupId, title: `${runWorkspacePrefix} Dinner`, amount: 100, paidBy: primary.personId,
        participants: [primary.personId, participantId],
      };
      expectStatus(await api('/api/expenses', {
        method: 'POST', cookie: primary.cookie,
        body: { ...expenseBody, title: `${runWorkspacePrefix} Invalid precision`, amount: 1.001 },
      }), 400, 'expense amount finer than one paise');
      const key = `it-expense-${runId}`;
      const duplicateResults = await Promise.all([
        api('/api/expenses', { method: 'POST', cookie: primary.cookie, body: expenseBody, key }),
        api('/api/expenses', { method: 'POST', cookie: primary.cookie, body: expenseBody, key }),
      ]);
      for (const result of duplicateResults) expectStatus(result, 201, 'concurrent idempotent expense creation');
      assert.equal(duplicateResults[0].body.id, duplicateResults[1].body.id);
      const expenseId = duplicateResults[0].body.id;
      const [[expenseCount]] = await db.execute('SELECT COUNT(*) AS count FROM expenses WHERE id = ?', [expenseId]);
      assert.equal(Number(expenseCount.count), 1, 'duplicate requests must persist exactly one expense');
      const changedPayload = await api('/api/expenses', {
        method: 'POST', cookie: primary.cookie, body: { ...expenseBody, amount: 101 }, key,
      });
      expectStatus(changedPayload, 409, 'idempotency payload mismatch');
      const [[splitTotal]] = await db.execute('SELECT SUM(amount) AS total FROM splits WHERE expense_id = ?', [expenseId]);
      assert.equal(Math.round(Number(splitTotal.total) * 100), 10000, 'persisted splits must conserve expense cents');
      const splitCases = [
        { method: 'exact', amount: 10, participants: [{ personId: primary.personId, amount: 4 }, { personId: participantId, amount: 6 }] },
        { method: 'percentage', amount: 10, participants: [{ personId: primary.personId, percentage: 25 }, { personId: participantId, percentage: 75 }] },
        { method: 'shares', amount: 10, participants: [{ personId: primary.personId, shares: 1 }, { personId: participantId, shares: 3 }] },
        { method: 'itemwise', amount: 10, items: [{ itemName: 'Integration item', quantity: 1, unitPrice: 10, allocationMethod: 'exact', participants: [{ personId: primary.personId, amount: 4 }, { personId: participantId, amount: 6 }] }] },
      ];
      for (const [index, splitCase] of splitCases.entries()) {
        const splitResult = await api('/api/expenses', {
          method: 'POST', cookie: primary.cookie, key: `it-split-${index}-${runId}`,
          body: {
            groupId, title: `${runWorkspacePrefix} ${splitCase.method}`, amount: splitCase.amount,
            paidBy: primary.personId, splitMethod: splitCase.method,
            participants: splitCase.participants, items: splitCase.items,
          },
        });
        expectStatus(splitResult, 201, `${splitCase.method} persisted split`);
        const [[total]] = await db.execute('SELECT SUM(amount) AS total FROM splits WHERE expense_id = ?', [splitResult.body.id]);
        assert.equal(Math.round(Number(total.total) * 100), 1000, `${splitCase.method} split total must equal expense amount`);
      }
      const concurrentDistinct = await api('/api/expenses', {
        method: 'POST', cookie: primary.cookie, body: { ...expenseBody, title: `${runWorkspacePrefix} Separate` }, key: `it-expense-other-${runId}`,
      });
      expectStatus(concurrentDistinct, 201, 'different idempotency key');
      assert.notEqual(concurrentDistinct.body.id, expenseId);

      expectStatus(await api(`/api/expenses/${expenseId}`, {
        method: 'PUT', cookie: primary.cookie,
        body: { title: 'Invalid precision edit', amount: 100.001, paidBy: primary.personId, category: 'Food', splitMethod: 'equal', participants: [primary.personId, participantId] },
      }), 400, 'expense edit amount finer than one paise');
      const updated = await api(`/api/expenses/${expenseId}`, {
        method: 'PUT', cookie: primary.cookie,
        body: { title: `${runWorkspacePrefix} Dinner edited`, amount: 120, paidBy: primary.personId, category: 'Food', splitMethod: 'equal', participants: [primary.personId, participantId] },
      });
      expectStatus(updated, 200, 'expense edit');
      const partialBody = { payments: [{ personId: participantId, amount: 20 }] };
      expectStatus(await api(`/api/expenses/${expenseId}/settle`, {
        method: 'POST', cookie: primary.cookie,
        body: { payments: [{ personId: participantId, amount: 1.001 }] },
      }), 400, 'settlement amount finer than one paise');
      const settleKey = `it-expense-settle-${runId}`;
      const settlements = await Promise.all([
        api(`/api/expenses/${expenseId}/settle`, { method: 'POST', cookie: primary.cookie, body: partialBody, key: settleKey }),
        api(`/api/expenses/${expenseId}/settle`, { method: 'POST', cookie: primary.cookie, body: partialBody, key: settleKey }),
      ]);
      for (const result of settlements) expectStatus(result, 201, 'expense settlement idempotency');
      const [[expenseSettlementCount]] = await db.execute('SELECT COUNT(*) AS count FROM settlements WHERE expense_id = ?', [expenseId]);
      assert.equal(Number(expenseSettlementCount.count), 1);

      const overSettlement = await api(`/api/expenses/${expenseId}/settle`, {
        method: 'POST', cookie: primary.cookie,
        body: { payments: [{ personId: participantId, amount: 100 }] }, key: `it-expense-over-${runId}`,
      });
      expectStatus(overSettlement, 409, 'expense share over-settlement');
      expectStatus(await api(`/api/expenses/${expenseId}`, {
        method: 'PUT', cookie: second.cookie,
        body: { title: 'IDOR edit', amount: 120, paidBy: primary.personId, category: 'Food', splitMethod: 'equal', participants: [primary.personId, participantId] },
      }), 404, 'cross-workspace modification');
      expectStatus(await api(`/api/expenses/${expenseId}`, {
        method: 'PUT', cookie: primary.cookie,
        body: { title: 'Below settled amount', amount: 30, paidBy: primary.personId, category: 'Food', splitMethod: 'equal', participants: [primary.personId, participantId] },
      }), 409, 'edit below settled allocation');

      const groupSettlementBody = {
        payerId: participantId, payeeId: primary.personId, amount: 10, groupId,
        note: 'Integration partial settlement',
      };
      expectStatus(await api('/api/settlements', {
        method: 'POST', cookie: primary.cookie,
        body: { ...groupSettlementBody, amount: 1.001 },
      }), 400, 'group settlement amount finer than one paise');
      const groupSettlementKey = `it-group-settlement-${runId}`;
      const groupSettlementResults = await Promise.all([
        api('/api/settlements', { method: 'POST', cookie: primary.cookie, body: groupSettlementBody, key: groupSettlementKey }),
        api('/api/settlements', { method: 'POST', cookie: primary.cookie, body: groupSettlementBody, key: groupSettlementKey }),
      ]);
      for (const result of groupSettlementResults) expectStatus(result, 201, 'concurrent idempotent group settlement');
      const [[groupSettlementCount]] = await db.execute(
        'SELECT COUNT(*) AS count FROM settlements WHERE group_id = ? AND note = ?',
        [groupId, 'Integration partial settlement']
      );
      assert.equal(Number(groupSettlementCount.count), 1, 'duplicate group settlement requests must persist once');
      const distinctOver = await api('/api/settlements', {
        method: 'POST', cookie: primary.cookie,
        body: { ...groupSettlementBody, amount: 1000 }, key: `it-group-over-${runId}`,
      });
      expectStatus(distinctOver, 409, 'group over-settlement');

      const linkedVoid = await api(`/api/expenses/${expenseId}`, { method: 'DELETE', cookie: primary.cookie });
      expectStatus(linkedVoid, 409, 'void expense with settlement history');
      const voidExpense = await api('/api/expenses', {
        method: 'POST', cookie: primary.cookie,
        body: { ...expenseBody, title: `${runWorkspacePrefix} Void`, amount: 30 }, key: `it-expense-void-${runId}`,
      });
      expectStatus(voidExpense, 201, 'create voidable expense');
      expectStatus(await api(`/api/expenses/${voidExpense.body.id}`, { method: 'DELETE', cookie: primary.cookie }), 200, 'void expense');
      const [[voided]] = await db.execute('SELECT voided_at FROM expenses WHERE id = ?', [voidExpense.body.id]);
      assert.ok(voided.voided_at, 'void must persist without deleting history');

      const balances = await balanceRows(groupId);
      assert.equal(balances.reduce((sum, row) => sum + row.cents, 0), 0, 'group balances must reconcile exactly in cents');

      const summary = await api('/api/summary', { cookie: primary.cookie });
      expectStatus(summary, 200, 'dashboard summary');
      const summaryGroup = summary.body.groups.find(group => Number(group.id) === Number(groupId));
      assert.ok(summaryGroup, 'dashboard must persist and return the created group');
      const apiBalances = summaryGroup.balance_people.map(row => ({ id: Number(row.id), cents: Math.round(Number(row.balance) * 100) }));
      assert.deepEqual(apiBalances, balances, 'API financial balances must match independently queried MySQL balances');
      expectStatus(await api(`/api/groups/${groupId}/analytics`, { cookie: primary.cookie }), 200, 'group analytics');
      expectStatus(await api(`/api/trips/${tripId}/analytics`, { cookie: primary.cookie }), 200, 'trip analytics');
      const report = await api(`/api/reports?type=expense&groupId=${groupId}`, { cookie: primary.cookie });
      expectStatus(report, 200, 'expense report');
      assert.ok(report.body.records.some(row => row.id === expenseId || row.expense_id === expenseId));
      assert.ok(!report.body.records.some(row => row.id === voidExpense.body.id || row.expense_id === voidExpense.body.id), 'voided expense is excluded from report totals');
      expectStatus(await api(`/api/groups/${groupId}/activity`, { cookie: primary.cookie }), 200, 'group activity');

      const recurringStart = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const recurringBody = {
        title: `${runWorkspacePrefix} Recurring`, description: '', category: 'Food', groupId,
        paidBy: primary.personId, amount: 12, exchangeRateToInr: 1, currency: 'INR',
        frequency: 'weekly', splitMethod: 'equal', variableAmount: false, startDate: recurringStart,
        participants: [{ personId: primary.personId }, { personId: participantId }],
      };
      expectStatus(await api('/api/recurring-expenses', {
        method: 'POST', cookie: primary.cookie, body: { ...recurringBody, amount: 12.001 },
      }), 400, 'recurring expense amount finer than one paise');
      const recurring = await api('/api/recurring-expenses', {
        method: 'POST', cookie: primary.cookie,
        body: recurringBody,
      });
      expectStatus(recurring, 201, 'recurring expense template');
      await db.execute('UPDATE recurring_expenses SET next_occurrence_date = UTC_DATE() - INTERVAL 1 DAY WHERE id = ?', [recurring.body.id]);
      const generatedExpenseId = await waitForRecurringExpense(recurring.body.id, Number(process.env.INTEGRATION_RECURRING_WAIT_MS || 70000));
      const [[generated]] = await db.execute('SELECT title, amount FROM expenses WHERE id = ?', [generatedExpenseId]);
      assert.equal(generated.title, `${runWorkspacePrefix} Recurring`);
      assert.equal(Math.round(Number(generated.amount) * 100), 1200);
      await db.execute("UPDATE recurring_expenses SET status = 'completed' WHERE id = ?", [recurring.body.id]);
      expectStatus(await api(`/api/recurring-expenses/${recurring.body.id}/status`, {
        method: 'PATCH', cookie: primary.cookie, body: { status: 'active' },
      }), 409, 'completed recurring expense cannot be resumed');
    });
  } finally {
    await stopApplication();
    await cleanupRun();
  }
});
