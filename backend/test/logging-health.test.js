const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const {
  createRequestId,
  logError,
  requestContext,
  requestObservability,
  writeLog,
} = require('../src/logger');
const { createHealthHandlers } = require('../src/health');
const { createApiAuthGate, createRequireAuth } = require('../src/auth-middleware');

test('request IDs accept safe values and replace malformed or injectable values', () => {
  assert.equal(createRequestId('request-123456'), 'request-123456');
  for (const invalid of ['short', 'inject\nforged=true', 'x'.repeat(65), undefined]) {
    const id = createRequestId(invalid);
    assert.match(id, /^[0-9a-f-]{36}$/);
  }
});

test('structured logs include only allowlisted fields and never serialize error messages', () => {
  let line;
  const result = writeLog('error', 'database_query_failed', {
    requestId: 'request-123456',
    errorCode: 'ER_ACCESS_DENIED_ERROR',
    secret: 'must-not-appear',
    body: { amount: 1234.5 },
  }, value => { line = value; });
  assert.equal(result.requestId, 'request-123456');
  assert.equal(result.errorCode, 'ER_ACCESS_DENIED_ERROR');
  assert.equal('secret' in result, false);
  assert.equal('body' in result, false);
  assert.equal(line.includes('must-not-appear'), false);
  assert.equal(line.includes('1234.5'), false);

  const original = console.log;
  try {
    console.log = value => { line = value; };
    logError('application_error', new Error('password=hunter2 session=private-token'));
  } finally {
    console.log = original;
  }
  assert.equal(line.includes('hunter2'), false);
  assert.equal(line.includes('private-token'), false);
});

test('request middleware propagates correlation IDs, logs route templates, and adds IDs to errors', () => {
  const req = {
    method: 'GET',
    path: '/api/groups/123?secret=value',
    baseUrl: '',
    route: { path: '/api/groups/:groupId' },
    get: name => name.toLowerCase() === 'x-request-id' ? 'request-123456' : undefined,
  };
  const res = new EventEmitter();
  res.statusCode = 404;
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.json = body => { res.body = body; return res; };
  const originalLog = console.log;
  const lines = [];
  try {
    console.log = value => lines.push(JSON.parse(value));
    requestObservability(req, res, () => {
      assert.equal(requestContext.getStore().requestId, 'request-123456');
    });
    res.json({ error: 'Not found.' });
    res.emit('finish');
  } finally {
    console.log = originalLog;
  }
  assert.equal(res.headers['X-Request-ID'], 'request-123456');
  assert.equal(res.body.requestId, 'request-123456');
  assert.equal(lines[0].route, '/api/groups/:groupId');
  assert.equal(lines[0].requestId, 'request-123456');
  assert.equal(JSON.stringify(lines).includes('secret=value'), false);
});

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('liveness does not require MySQL and readiness reports dependency failure safely', async () => {
  let checks = 0;
  const handlers = createHealthHandlers({
    checkDatabase: async () => { checks += 1; throw Object.assign(new Error('secret SQL detail'), { code: 'ETIMEDOUT' }); },
    logger: () => {},
  });
  const live = response();
  handlers.live({}, live);
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.body, { ok: true });
  assert.equal(checks, 0);

  const ready = response();
  await handlers.ready({}, ready);
  assert.equal(ready.statusCode, 503);
  assert.deepEqual(ready.body, { ok: false });
  assert.equal(JSON.stringify(ready.body).includes('secret'), false);
});

test('readiness returns success when database connectivity succeeds', async () => {
  const handlers = createHealthHandlers({ checkDatabase: async () => [1] });
  const ready = response();
  await handlers.ready({}, ready);
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.body, { ok: true });
});

test('all health paths are public before the API auth gate while protected APIs still require a session', async () => {
  const app = express();
  let readinessChecks = 0;
  const health = createHealthHandlers({ checkDatabase: async () => { readinessChecks += 1; } });
  const requireAuth = createRequireAuth({ lookupAccount: async () => null, clearSessionCookie() {} });

  // Match production ordering: the global /api gate is mounted before these routes.
  app.use('/api', createApiAuthGate({ requireAuth }));
  app.get('/api/health/live', health.live);
  app.get('/api/health/ready', health.ready);
  app.get('/api/health', health.ready);
  app.get('/api/expenses', (_req, res) => res.json({ ok: true }));
  app.post('/api/invitations/preview', (_req, res) => res.json({ ok: true }));

  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/api/health/live', '/api/health/ready', '/api/health']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `${path} should not require a session`);
      assert.deepEqual(await response.json(), { ok: true });
    }
    assert.equal(readinessChecks, 2, 'liveness must not query MySQL');

    const invitationPreviewResponse = await fetch(`${base}/api/invitations/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'opaque-bearer-token' }),
    });
    assert.equal(invitationPreviewResponse.status, 200, 'invitation links remain usable without an account session');

    const protectedResponse = await fetch(`${base}/api/expenses`);
    assert.equal(protectedResponse.status, 401);
    assert.deepEqual(await protectedResponse.json(), { error: 'Sign in to continue.' });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('two trusted reverse proxies preserve the client IP and ignore spoofed forwarded entries', async () => {
  const app = express();
  app.set('trust proxy', 2);
  app.get('/api/ip', (req, res) => res.json({ ip: req.ip }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ip`, {
      // Simulate a client-supplied fake address followed by the actual client
      // and host-proxy addresses appended by the two trusted proxy layers.
      headers: { 'X-Forwarded-For': '198.51.100.99, 203.0.113.7, 172.20.0.4' },
    });
    assert.deepEqual(await response.json(), { ip: '203.0.113.7' });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
