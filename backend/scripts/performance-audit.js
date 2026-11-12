#!/usr/bin/env node
// Read-only schema/index and query-plan snapshot for the configured MySQL database.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const mysql = require('mysql2/promise');

const queries = [
  ['expense group feed',
    'EXPLAIN SELECT id, created_at FROM expenses WHERE group_id = 0 AND voided_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 100'],
  ['trip expense analytics',
    'EXPLAIN SELECT id, created_at FROM expenses WHERE trip_id = 0 AND voided_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 100'],
  ['notification page',
    'EXPLAIN SELECT id, created_at FROM notifications WHERE account_id = 0 ORDER BY created_at DESC, id DESC LIMIT 26'],
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectTimeout: 5000,
  });
  try {
    const [version] = await connection.query('SELECT VERSION() AS version');
    console.log(`MySQL version: ${version[0].version}`);
    for (const table of ['expenses', 'splits', 'settlements', 'notifications', 'group_activity']) {
      const [indexes] = await connection.query(`SHOW INDEX FROM \`${table}\``);
      console.log(`Indexes ${table}: ${indexes.map(index => `${index.Key_name}[${index.Seq_in_index}:${index.Column_name}]`).join(', ') || '(none)'}`);
    }
    for (const [label, sql] of queries) {
      const [plan] = await connection.query(sql);
      console.log(`EXPLAIN ${label}: ${JSON.stringify(plan.map(({ id, select_type, table, type, possible_keys, key, rows, Extra }) => ({ id, select_type, table, type, possible_keys, key, rows, Extra })))}`);
    }
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(error.code)
    ? error.code
    : error.name || 'Error';
  console.error(`Performance audit could not connect or query MySQL (${code}).`);
  process.exitCode = 1;
});
