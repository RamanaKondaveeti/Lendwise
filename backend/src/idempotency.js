const crypto = require('crypto');

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function readIdempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return { key: null };
  if (typeof key !== 'string' || key.length < 1 || key.length > 200 || /[^\x21-\x7e]/.test(key)) {
    return { error: 'Idempotency-Key must contain 1 to 200 printable ASCII characters.' };
  }
  return { key };
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function findIdempotencyReplay(executor, { accountId, workspaceId, operation, key, payload }) {
  if (!key) return null;
  const keyHash = digest(key);
  const payloadHash = digest(stableJson(payload));
  const [rows] = await executor.execute(
    'SELECT payload_hash, response_status, response_body FROM idempotency_requests WHERE account_id = ? AND workspace_id = ? AND operation = ? AND key_hash = ?',
    [accountId, workspaceId, operation, keyHash]
  );
  if (!rows.length) return null;
  if (rows[0].payload_hash !== payloadHash) return { kind: 'conflict' };
  if (rows[0].response_status === null || rows[0].response_body === null) return { kind: 'incomplete' };
  const body = typeof rows[0].response_body === 'string' ? JSON.parse(rows[0].response_body) : rows[0].response_body;
  return { kind: 'replay', status: Number(rows[0].response_status), body };
}

async function claimIdempotency(executor, { accountId, workspaceId, operation, key, payload }) {
  if (!key) return { kind: 'new', enabled: false };
  const keyHash = digest(key);
  const payloadHash = digest(stableJson(payload));
  try {
    await executor.execute('INSERT INTO idempotency_requests(account_id, workspace_id, operation, key_hash, payload_hash) VALUES(?, ?, ?, ?, ?)',
      [accountId, workspaceId, operation, keyHash, payloadHash]);
    return { kind: 'new', enabled: true, keyHash, accountId, workspaceId, operation };
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const [rows] = await executor.execute('SELECT payload_hash, response_status, response_body FROM idempotency_requests WHERE account_id = ? AND workspace_id = ? AND operation = ? AND key_hash = ? FOR UPDATE',
      [accountId, workspaceId, operation, keyHash]);
    if (!rows.length) throw error;
    const saved = rows[0];
    if (saved.payload_hash !== payloadHash) return { kind: 'conflict' };
    if (saved.response_status === null || saved.response_body === null) return { kind: 'incomplete' };
    const body = typeof saved.response_body === 'string' ? JSON.parse(saved.response_body) : saved.response_body;
    return { kind: 'replay', status: Number(saved.response_status), body };
  }
}

async function saveIdempotentResponse(executor, claim, status, body) {
  if (!claim.enabled) return;
  await executor.execute('UPDATE idempotency_requests SET response_status = ?, response_body = ? WHERE account_id = ? AND workspace_id = ? AND operation = ? AND key_hash = ?',
    [status, JSON.stringify(body), claim.accountId, claim.workspaceId, claim.operation, claim.keyHash]);
}

module.exports = { claimIdempotency, findIdempotencyReplay, readIdempotencyKey, saveIdempotentResponse, stableJson };
