const test = require('node:test');
const assert = require('node:assert/strict');
const { claimIdempotency, findIdempotencyReplay, readIdempotencyKey, saveIdempotentResponse } = require('../src/idempotency');

function memoryExecutor() {
  const rows = new Map();
  return {
    rows,
    async execute(sql, params) {
      if (sql.startsWith('INSERT INTO idempotency_requests')) {
        const [accountId, workspaceId, operation, keyHash, payloadHash] = params;
        const id = `${accountId}:${workspaceId}:${operation}:${keyHash}`;
        if (rows.has(id)) {
          const error = new Error('Duplicate idempotency key');
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        rows.set(id, { account_id: accountId, workspace_id: workspaceId, operation, key_hash: keyHash, payload_hash: payloadHash, response_status: null, response_body: null });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT payload_hash')) {
        const [accountId, workspaceId, operation, keyHash] = params;
        const row = rows.get(`${accountId}:${workspaceId}:${operation}:${keyHash}`);
        return [row ? [{ ...row }] : []];
      }
      if (sql.startsWith('UPDATE idempotency_requests')) {
        const [status, body, accountId, workspaceId, operation, keyHash] = params;
        const row = rows.get(`${accountId}:${workspaceId}:${operation}:${keyHash}`);
        if (row) Object.assign(row, { response_status: status, response_body: body });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

const request = (executor, overrides = {}) => claimIdempotency(executor, {
  accountId: 10,
  workspaceId: 4,
  operation: 'POST /api/expenses',
  key: 'request-1',
  payload: { amount: 10, title: 'Dinner' },
  ...overrides,
});

test('same key and payload replays the original successful response', async () => {
  const db = memoryExecutor();
  const first = await request(db);
  await saveIdempotentResponse(db, first, 201, { ok: true, id: 55 });
  assert.deepEqual(await request(db), { kind: 'replay', status: 201, body: { ok: true, id: 55 } });
  assert.deepEqual(await findIdempotencyReplay(db, {
    accountId: 10, workspaceId: 4, operation: 'POST /api/expenses', key: 'request-1',
    payload: { title: 'Dinner', amount: 10 },
  }), { kind: 'replay', status: 201, body: { ok: true, id: 55 } });
});

test('same key with a different payload conflicts', async () => {
  const db = memoryExecutor();
  const first = await request(db);
  await saveIdempotentResponse(db, first, 201, { ok: true, id: 55 });
  assert.equal((await request(db, { payload: { amount: 12, title: 'Dinner' } })).kind, 'conflict');
});

test('different keys create separate operations and account scope isolates users', async () => {
  const db = memoryExecutor();
  assert.equal((await request(db)).kind, 'new');
  assert.equal((await request(db, { key: 'request-2' })).kind, 'new');
  assert.equal((await request(db, { accountId: 11 })).kind, 'new');
  assert.equal((await request(db, { workspaceId: 5 })).kind, 'new');
});

test('concurrent same-key claims cannot both become new claims', async () => {
  const db = memoryExecutor();
  const results = await Promise.all([request(db), request(db)]);
  assert.equal(results.filter(result => result.kind === 'new').length, 1);
  assert.equal(results.filter(result => result.kind === 'incomplete').length, 1);
});

test('failed transaction can roll back the claim so the same key can retry', async () => {
  const db = memoryExecutor();
  const claim = await request(db);
  db.rows.delete(`${claim.accountId}:${claim.workspaceId}:${claim.operation}:${claim.keyHash}`);
  assert.equal((await request(db)).kind, 'new');
});

test('requests without a key remain legacy non-idempotent operations', async () => {
  const db = memoryExecutor();
  assert.deepEqual(await request(db, { key: null }), { kind: 'new', enabled: false });
  assert.deepEqual(await request(db, { key: null }), { kind: 'new', enabled: false });
});

test('key parser accepts absent keys and rejects malformed keys', () => {
  assert.deepEqual(readIdempotencyKey({ get: () => undefined }), { key: null });
  assert.ok(readIdempotencyKey({ get: () => 'bad key' }).error);
  assert.deepEqual(readIdempotencyKey({ get: () => 'valid-key' }), { key: 'valid-key' });
});
