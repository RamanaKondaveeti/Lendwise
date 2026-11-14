const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MIGRATION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(160) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  status ENUM('running', 'applied', 'failed') NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TIMESTAMP NULL,
  failure_code VARCHAR(64) NULL
)`;

function assertDevelopmentTarget({ nodeEnv, allowMigrations, databaseName, databaseUser, expectedServer, databaseMarker }) {
  const normalizedDbName = String(databaseName || '').trim().toLowerCase();
  if (!['development', 'test'].includes(nodeEnv) || allowMigrations !== 'true') {
    throw new Error('Migrations require NODE_ENV=development or test and ALLOW_DEVELOPMENT_MIGRATIONS=true.');
  }
  if (!normalizedDbName || /(prod|production|live)/i.test(normalizedDbName)) {
    throw new Error('Migrations require a clearly non-production DB_NAME.');
  }
  if (!/test|integration/i.test(databaseUser || '')) {
    throw new Error('Migrations require a dedicated test/integration DB_USER.');
  }
  if (!expectedServer || !/^[A-Za-z0-9._:-]{1,128}$/.test(expectedServer)) {
    throw new Error('Migrations require GROUPBUK_MIGRATION_EXPECTED_SERVER.');
  }
  if (typeof databaseMarker !== 'string' || databaseMarker.length < 32) {
    throw new Error('Migrations require a database marker with at least 32 characters.');
  }
}

function splitSqlStatements(sql) {
  return sql.split(';').map(statement => statement.trim()).filter(Boolean);
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function runMigrations(options) {
  const { pool, migrationsDirectory } = options;
  assertDevelopmentTarget(options);
  await verifyMigrationDatabaseTarget(pool, options);
  await pool.query(MIGRATION_TABLE_SQL);

  const files = (await fs.readdir(migrationsDirectory))
    .filter(file => /^\d+_.+\.migration\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const results = [];

  for (const file of files) {
    const version = file.replace(/\.migration\.sql$/, '');
    const sql = await fs.readFile(path.join(migrationsDirectory, file), 'utf8');
    const digest = checksum(sql);
    const [rows] = await pool.execute(
      'SELECT checksum, status FROM schema_migrations WHERE version = ?',
      [version]
    );
    const prior = rows[0];
    if (prior?.status === 'applied') {
      if (prior.checksum !== digest) throw new Error(`Applied migration ${version} was modified; refusing to continue.`);
      results.push({ version, status: 'skipped' });
      continue;
    }
    if (prior) {
      throw new Error(`Migration ${version} is ${prior.status}; inspect and restore or repair the test database before retrying.`);
    }

    await pool.execute(
      `INSERT INTO schema_migrations(version, checksum, status) VALUES(?, ?, 'running')`,
      [version, digest]
    );
    try {
      for (const statement of splitSqlStatements(sql)) await pool.query(statement);
      await pool.execute(
        `UPDATE schema_migrations SET status = 'applied', applied_at = UTC_TIMESTAMP(), failure_code = NULL
         WHERE version = ? AND status = 'running'`,
        [version]
      );
      results.push({ version, status: 'applied' });
    } catch (error) {
      await pool.execute(
        `UPDATE schema_migrations SET status = 'failed', failure_code = 'statement_failed'
         WHERE version = ? AND status = 'running'`,
        [version]
      );
      throw new Error(`Migration ${version} failed after a possible partial MySQL DDL application; automatic retry is blocked.`, { cause: error });
    }
  }
  return results;
}

async function verifyMigrationDatabaseTarget(pool, { databaseName, expectedServer, databaseMarker }) {
  const [[identity]] = await pool.query(
    'SELECT DATABASE() AS database_name, @@hostname AS server_name, @@global.read_only AS read_only'
  );
  if (!identity || identity.database_name !== databaseName || identity.server_name !== expectedServer || Number(identity.read_only)) {
    throw new Error('Migration target identity does not match the explicitly approved test database and server.');
  }
  const [guardTables] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'groupbuk_integration_guard' AND TABLE_TYPE = 'BASE TABLE'`
  );
  if (!guardTables.length) throw new Error('Migration target is missing the pre-provisioned GroupBuk test database guard.');
  const [[guard]] = await pool.execute(
    'SELECT marker_hash, database_name, server_name FROM groupbuk_integration_guard WHERE id = 1'
  );
  const markerHash = crypto.createHash('sha256').update(databaseMarker).digest('hex');
  if (!guard || guard.marker_hash !== markerHash || guard.database_name !== databaseName || guard.server_name !== expectedServer) {
    throw new Error('Migration target safety marker did not match the requested test database.');
  }
}

async function getMigrationStatus(pool, version) {
  const [rows] = await pool.execute(
    'SELECT checksum, status, applied_at FROM schema_migrations WHERE version = ?',
    [version]
  );
  return rows[0] || null;
}

async function detectMigrationCompatibility(pool, version = '002_group_account_architecture') {
  const [ledgerTable] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'`
  );
  const [newTables] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('group_accounts', 'group_invitations', 'settlement_history_participants')`
  );
  const [newColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_invitations'
       AND COLUMN_NAME = 'legacy_disabled_at'`
  );
  const [ownershipColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'groups'
       AND COLUMN_NAME IN ('owner_account_id', 'ownership_status')`
  );
  const hasNewObjects = newTables.length > 0 || newColumns.length > 0 || ownershipColumns.length > 0;
  if (!ledgerTable.length) {
    if (hasNewObjects) throw new Error('Untracked Phase C schema objects exist; startup is blocked for migration repair.');
    return { mode: 'legacy', groupAccountArchitectureEnabled: false };
  }

  const status = await getMigrationStatus(pool, version);
  if (!status && hasNewObjects) throw new Error('Phase C schema exists without an applied migration record; startup is blocked.');
  if (status && status.status !== 'applied') {
    throw new Error(`Required migration ${version} is ${status.status}; startup is blocked pending repair.`);
  }
  if (status) {
    const expectedTables = new Set(['group_accounts', 'group_invitations', 'settlement_history_participants']);
    for (const row of newTables) expectedTables.delete(row.TABLE_NAME);
    const actualOwnershipColumns = new Set(ownershipColumns.map(row => row.COLUMN_NAME));
    const missingOwnershipColumns = ['owner_account_id', 'ownership_status']
      .filter(column => !actualOwnershipColumns.has(column))
      .map(column => `groups.${column}`);
    if (expectedTables.size || !newColumns.length || missingOwnershipColumns.length) {
      throw new Error(`Required schema for ${version} is incomplete; missing: ${[
        ...expectedTables,
        ...(!newColumns.length ? ['workspace_invitations.legacy_disabled_at'] : []),
        ...missingOwnershipColumns,
      ].join(', ')}.`);
    }
  }
  return { mode: status ? 'group-account-v1' : 'legacy', groupAccountArchitectureEnabled: Boolean(status) };
}

module.exports = {
  assertDevelopmentTarget,
  detectMigrationCompatibility,
  getMigrationStatus,
  runMigrations,
  splitSqlStatements,
  verifyMigrationDatabaseTarget,
};
