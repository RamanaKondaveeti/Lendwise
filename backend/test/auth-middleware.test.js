const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequireAuth, getSessionToken } = require('../src/auth-middleware');

function response() {
  return {
    statusCode: 200,
    body: null,
    cleared: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('missing session cookie is rejected', async () => {
  let lookedUp = false;
  const middleware = createRequireAuth({ lookupAccount: async () => { lookedUp = true; }, clearSessionCookie() {} });
  const res = response();
  await middleware({ headers: {} }, res, () => assert.fail('next must not run'));
  assert.equal(res.statusCode, 401);
  assert.equal(lookedUp, false);
});

test('invalid and expired session tokens are rejected and cleared', async () => {
  for (const token of ['invalid-token', 'expired-token']) {
    let cleared = false;
    const middleware = createRequireAuth({ lookupAccount: async () => null, clearSessionCookie: () => { cleared = true; } });
    const res = response();
    await middleware({ headers: { cookie: `lendwise_session=${token}` } }, res, () => assert.fail('next must not run'));
    assert.equal(res.statusCode, 401);
    assert.equal(cleared, true);
  }
});

test('valid authenticated session reaches the protected handler with its account', async () => {
  const account = { id: 4, person_id: 12, workspace_id: 3 };
  const middleware = createRequireAuth({ lookupAccount: async token => token === 'valid-token' ? account : null, clearSessionCookie() {} });
  const req = { headers: { cookie: 'other=x; lendwise_session=valid-token' } };
  const res = response();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.account, account);
});

test('session cookie parsing matches the cookie name exactly', () => {
  assert.equal(getSessionToken({ headers: { cookie: 'not_lendwise_session=wrong; lendwise_session=right' } }), 'right');
  assert.equal(getSessionToken({ headers: { cookie: 'lendwise_session_extra=wrong' } }), '');
});
