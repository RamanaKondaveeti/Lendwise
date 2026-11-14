const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  assertDevelopmentTarget,
  detectMigrationCompatibility,
  runMigrations,
  splitSqlStatements,
} = require('../src/migration-runner');

test('migration runner requires explicit development/test authorization and rejects production database names', () => {
  assert.throws(() => assertDevelopmentTarget({
    nodeEnv: 'production', allowMigrations: 'true', databaseName: 'groupbuk',
    databaseUser: 'groupbuk_test', expectedServer: 'localtest', databaseMarker: 'x'.repeat(32),
  }), /NODE_ENV/);
  assert.throws(() => assertDevelopmentTarget({
    nodeEnv: 'test', allowMigrations: 'false', databaseName: 'groupbuk_test',
    databaseUser: 'groupbuk_test', expectedServer: 'localtest', databaseMarker: 'x'.repeat(32),
  }), /ALLOW_DEVELOPMENT_MIGRATIONS/);
  assert.throws(() => assertDevelopmentTarget({
    nodeEnv: 'development', allowMigrations: 'true', databaseName: 'groupbuk_prod',
    databaseUser: 'groupbuk_test', expectedServer: 'localtest', databaseMarker: 'x'.repeat(32),
  }), /non-production/);
  assert.throws(() => assertDevelopmentTarget({
    nodeEnv: 'test', allowMigrations: 'true', databaseName: 'groupbuk_test',
    databaseUser: 'production_admin', expectedServer: 'localtest', databaseMarker: 'x'.repeat(32),
  }), /dedicated test/);
  assert.doesNotThrow(() => assertDevelopmentTarget({
    nodeEnv: 'test', allowMigrations: 'true', databaseName: 'groupbuk_restored_test',
    databaseUser: 'groupbuk_integration_test', expectedServer: 'localtest', databaseMarker: 'x'.repeat(32),
  }));
});

test('migration SQL splitter skips empty statements', () => {
  assert.deepEqual(splitSqlStatements('-- one\nSELECT 1;; SELECT 2;'), [
    '-- one\nSELECT 1', 'SELECT 2',
  ]);
});

test('migration runner tracks checksums and never repeats applied migrations', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'groupbuk-migrations-'));
  await fs.writeFile(path.join(directory, '001_test.migration.sql'), 'CREATE TABLE sample (id INT);');
  const state = new Map();
  let appliedStatements = 0;
  const pool = {
    async query(sql) {
      if (sql.startsWith('CREATE TABLE sample')) appliedStatements += 1;
      if (sql.startsWith('SELECT DATABASE()')) return [[{
        database_name: 'groupbuk_restored_test', server_name: 'localtest', read_only: 0,
      }], []];
      return [[], []];
    },
    async execute(sql, params = []) {
      if (sql.includes("TABLE_NAME = 'groupbuk_integration_guard'")) return [[{ TABLE_NAME: 'groupbuk_integration_guard' }], []];
      if (sql.startsWith('SELECT marker_hash')) return [[{
        marker_hash: require('node:crypto').createHash('sha256').update('x'.repeat(32)).digest('hex'),
        database_name: 'groupbuk_restored_test', server_name: 'localtest',
      }], []];
      if (sql.startsWith('SELECT checksum')) return [[state.has(params[0]) ? state.get(params[0]) : undefined].filter(Boolean), []];
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        state.set(params[0], { checksum: params[1], status: 'running' });
      } else if (sql.startsWith('UPDATE schema_migrations SET status = \'applied\'')) {
        state.get(params[0]).status = 'applied';
      } else if (sql.startsWith('UPDATE schema_migrations SET status = \'failed\'')) {
        state.get(params[0]).status = 'failed';
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const params = {
    pool, migrationsDirectory: directory, nodeEnv: 'test',
    allowMigrations: 'true', databaseName: 'groupbuk_restored_test',
    databaseUser: 'groupbuk_integration_test', expectedServer: 'localtest', databaseMarker: 'x'.repeat(32),
  };

  try {
    assert.deepEqual(await runMigrations(params), [{ version: '001_test', status: 'applied' }]);
    assert.equal(state.get('001_test').status, 'applied');
    const statementsAfterFirstRun = appliedStatements;
    const applied = await runMigrations(params);
    assert.deepEqual(applied, [{ version: '001_test', status: 'skipped' }]);
    assert.equal(appliedStatements, statementsAfterFirstRun);
    await fs.writeFile(path.join(directory, '001_test.migration.sql'), 'CREATE TABLE changed (id INT);');
    await assert.rejects(() => runMigrations(params), /was modified/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('startup detects legacy schema and blocks untracked or incomplete Phase C schema', async () => {
  const legacyPool = { async execute(sql) { return [sql.includes('schema_migrations') || sql.includes('TABLE_NAME IN') || sql.includes("TABLE_NAME = 'workspace_invitations'") ? [] : [], []]; } };
  assert.deepEqual(await detectMigrationCompatibility(legacyPool), {
    mode: 'legacy', groupAccountArchitectureEnabled: false,
  });

  let call = 0;
  const partialPool = {
    async execute() {
      call += 1;
      if (call === 1) return [[{ 1: 1 }], []];
      if (call === 2) return [[{ TABLE_NAME: 'group_accounts' }], []];
      if (call === 3) return [[], []];
      return [[], []];
    },
  };
  await assert.rejects(() => detectMigrationCompatibility(partialPool), /without an applied migration record/);
});
