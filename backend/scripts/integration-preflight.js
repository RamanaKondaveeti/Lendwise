const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const configPath = path.resolve(__dirname, '../.env.integration');
const expectedDatabasePattern = /^groupbuk(?:_[a-z0-9]+)*_test$/i;

function report(stage, status, detail) {
  process.stdout.write(`${stage}: ${status}${detail ? ` — ${detail}` : ''}\n`);
}

function loadConfig() {
  if (!fs.existsSync(configPath)) throw new Error('backend/.env.integration is missing.');
  const config = dotenv.parse(fs.readFileSync(configPath));
  if (!expectedDatabasePattern.test(config.DB_NAME || '')) throw new Error('DB_NAME must match the dedicated groupbuk_*_test pattern.');
  if (!/test|integration/i.test(config.DB_USER || '')) throw new Error('DB_USER must be a dedicated integration-test account.');
  if (config.GROUPBUK_INTEGRATION_ALLOW_DESTRUCTIVE !== 'YES_I_CREATED_AN_ISOLATED_DATABASE') {
    throw new Error('The explicit disposable-test database opt-in is missing.');
  }
  if (!config.GROUPBUK_INTEGRATION_EXPECTED_SERVER || !config.GROUPBUK_INTEGRATION_DB_MARKER ||
      config.GROUPBUK_INTEGRATION_DB_MARKER.length < 32) {
    throw new Error('Expected server identity or test database marker is missing/invalid.');
  }
  if (!Number.isInteger(Number(config.DB_PORT)) || Number(config.DB_PORT) < 1 || Number(config.DB_PORT) > 65535) {
    throw new Error('DB_PORT is invalid.');
  }
  return config;
}

function checkTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let finished = false;
    const finish = (callback, error) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      callback(error);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(resolve));
    socket.once('timeout', () => finish(reject, Object.assign(new Error('TCP connection timed out.'), { code: 'ETIMEDOUT' })));
    socket.once('error', error => finish(reject, error));
  });
}

async function runPreflight(config = loadConfig()) {
  report('Config', 'PASS', `database=${config.DB_NAME}, dedicated test user configured`);
  let addresses;
  try {
    addresses = net.isIP(config.DB_HOST)
      ? [{ address: config.DB_HOST, family: net.isIP(config.DB_HOST) }]
      : await dns.lookup(config.DB_HOST, { all: true });
    report('DNS', 'PASS', `${config.DB_HOST} resolved`);
  } catch (error) {
    report('DNS', 'FAIL', `${config.DB_HOST} (${error.code || 'lookup_failed'})`);
    report('TCP', 'BLOCKED', 'host did not resolve');
    return false;
  }
  if (!net.isIP(config.GROUPBUK_INTEGRATION_EXPECTED_SERVER)) {
    try {
      await dns.lookup(config.GROUPBUK_INTEGRATION_EXPECTED_SERVER, { all: true });
      report('Expected identity DNS', 'INFO', `${config.GROUPBUK_INTEGRATION_EXPECTED_SERVER} resolves; SQL hostname equality is still required`);
    } catch (error) {
      report('Expected identity DNS', 'INFO', `${config.GROUPBUK_INTEGRATION_EXPECTED_SERVER} is not resolvable here (${error.code || 'lookup_failed'}); SQL hostname equality is checked after authentication`);
    }
  }

  try {
    await checkTcp(addresses[0].address, config.DB_PORT);
    report('TCP', 'PASS', `${addresses[0].address}:${config.DB_PORT}`);
  } catch (error) {
    report('TCP', 'FAIL', `${error.code || 'connection_failed'} at ${addresses[0].address}:${config.DB_PORT}`);
    report('Authentication', 'BLOCKED', 'TCP connection unavailable');
    report('Database', 'BLOCKED', 'TCP connection unavailable');
    report('Server identity', 'BLOCKED', 'TCP connection unavailable');
    report('Safety marker', 'BLOCKED', 'TCP connection unavailable');
    report('Read/write permission', 'BLOCKED', 'no database session opened');
    return false;
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: config.DB_HOST,
      port: Number(config.DB_PORT),
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      connectTimeout: 3000,
      multipleStatements: false,
    });
    report('Authentication', 'PASS', 'dedicated test account authenticated');
  } catch (error) {
    if (error.code === 'ER_ACCESS_DENIED_ERROR') report('Authentication', 'FAIL', 'MySQL rejected the dedicated test account');
    else if (error.code === 'ER_BAD_DB_ERROR') report('Database', 'FAIL', 'configured test database does not exist or is not accessible');
    else report('MySQL handshake', 'FAIL', error.code || 'connection_failed');
    report('Server identity', 'BLOCKED', 'no authenticated SQL session');
    report('Safety marker', 'BLOCKED', 'no authenticated SQL session');
    report('Read/write permission', 'BLOCKED', 'no authenticated SQL session');
    return false;
  }

  try {
    const [[identity]] = await connection.query(
      'SELECT DATABASE() AS database_name, @@hostname AS server_name, @@global.read_only AS read_only'
    );
    if (identity.database_name !== config.DB_NAME || identity.server_name !== config.GROUPBUK_INTEGRATION_EXPECTED_SERVER || Number(identity.read_only)) {
      report('Server identity', 'FAIL', 'database, expected hostname, or writable-state check did not match');
      return false;
    }
    report('Server identity', 'PASS', `${identity.database_name} on expected server; read_only=0`);

    const [[table]] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'groupbuk_integration_guard' AND TABLE_TYPE = 'BASE TABLE'`
    );
    if (!table) {
      report('Safety marker', 'FAIL', 'groupbuk_integration_guard is missing; refusing any write check');
      return false;
    }
    const [[marker]] = await connection.query(
      'SELECT marker_hash, database_name, server_name FROM groupbuk_integration_guard WHERE id = 1'
    );
    const expectedHash = crypto.createHash('sha256').update(config.GROUPBUK_INTEGRATION_DB_MARKER).digest('hex');
    if (!marker || marker.marker_hash !== expectedHash || marker.database_name !== config.DB_NAME || marker.server_name !== identity.server_name) {
      report('Safety marker', 'FAIL', 'pre-provisioned test marker did not match; refusing any write check');
      return false;
    }
    report('Safety marker', 'PASS', 'dedicated integration database marker matched');

    const temporaryTable = `gb_connectivity_${crypto.randomBytes(6).toString('hex')}`;
    try {
      await connection.query(`CREATE TEMPORARY TABLE \`${temporaryTable}\` (id INT PRIMARY KEY, marker VARCHAR(32))`);
      await connection.execute(`INSERT INTO \`${temporaryTable}\` (id, marker) VALUES (1, 'probe')`);
      const [[probe]] = await connection.query(`SELECT marker FROM \`${temporaryTable}\` WHERE id = 1`);
      if (probe?.marker !== 'probe') throw Object.assign(new Error('temporary table read did not match'), { code: 'PROBE_MISMATCH' });
      await connection.query(`DROP TEMPORARY TABLE \`${temporaryTable}\``);
      report('Read/write permission', 'PASS', 'temporary table probe created, inserted, read, and dropped');
      return true;
    } catch (error) {
      report('Read/write permission', 'FAIL', error.code || 'temporary_table_probe_failed');
      return false;
    }
  } catch (error) {
    report('Database verification', 'FAIL', error.code || 'verification_query_failed');
    return false;
  } finally {
    await connection.end().catch(() => {});
  }
}

if (require.main === module) {
  runPreflight().then(ok => { if (!ok) process.exitCode = 1; }).catch(error => {
    report('Preflight', 'FAIL', error.message);
    process.exitCode = 1;
  });
}

module.exports = { checkTcp, loadConfig, runPreflight };
