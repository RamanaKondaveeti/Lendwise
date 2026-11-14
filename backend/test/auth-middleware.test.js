const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiAuthGate, createRequireAuth, getSessionToken } = require('../src/auth-middleware');

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
  assert.deepEqual(req.auth, { accountId: 4, email: undefined, personId: 12 });
});

test('account-only identity is accepted by account routes but cannot access legacy workspace APIs', async () => {
  const requireAuth = async (req, _res, next) => {
    req.account = { id: 7, email: 'member@example.test', person_id: 19, workspace_id: null };
    req.auth = { accountId: 7, email: 'member@example.test', personId: 19 };
    return next();
  };
  const gate = createApiAuthGate({ requireAuth });
  const accountResponse = response();
  let accountContinued = false;
  gate({ path: '/account/groups', method: 'GET' }, accountResponse, () => { accountContinued = true; });
  assert.equal(accountContinued, true);

  const legacyResponse = response();
  let legacyContinued = false;
  gate({ path: '/groups', method: 'GET' }, legacyResponse, () => { legacyContinued = true; });
  assert.equal(legacyContinued, false);
  assert.equal(legacyResponse.statusCode, 403);
  assert.match(legacyResponse.body.error, /legacy workspace membership/);
});

test('session cookie parsing matches the cookie name exactly', () => {
  assert.equal(getSessionToken({ headers: { cookie: 'not_lendwise_session=wrong; lendwise_session=right' } }), 'right');
  assert.equal(getSessionToken({ headers: { cookie: 'lendwise_session_extra=wrong' } }), '');
});
