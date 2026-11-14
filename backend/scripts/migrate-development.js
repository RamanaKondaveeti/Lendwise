const path = require('node:path');
const mysql = require('mysql2/promise');
const { assertDevelopmentTarget, runMigrations } = require('../src/migration-runner');

async function main() {
  const target = {
    nodeEnv: process.env.NODE_ENV,
    allowMigrations: process.env.ALLOW_DEVELOPMENT_MIGRATIONS,
    databaseName: process.env.DB_NAME,
    databaseUser: process.env.DB_USER,
    expectedServer: process.env.GROUPBUK_MIGRATION_EXPECTED_SERVER,
    databaseMarker: process.env.GROUPBUK_MIGRATION_DB_MARKER,
  };
  assertDevelopmentTarget(target);
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: target.databaseName,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 2,
    multipleStatements: false,
  });
  try {
    const result = await runMigrations({
      pool,
      migrationsDirectory: path.resolve(__dirname, '../db/migrations'),
      ...target,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
