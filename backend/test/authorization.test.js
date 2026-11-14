const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasGroupMembership,
  hasAccountGroupMembership,
  hasGroupAdministrationAccess,
} = require('../src/authorization');

function executorWithMembership(rows, expectedParameters) {
  return {
    async execute(sql, params) {
      assert.match(sql, /JOIN group_members gm/);
      assert.match(sql, /g\.workspace_id = \?/);
      assert.deepEqual(params, expectedParameters);
      return [rows ? [{ id: 7 }] : []];
    },
  };
}

test('allows a current member of a group in the active workspace', async () => {
  assert.equal(await hasGroupMembership(executorWithMembership(true, [12, 7, 3]), 7, {
    person_id: 12, workspace_id: 3,
  }), true);
});

test('denies nonmembers and group IDs that do not resolve in the active workspace', async () => {
  assert.equal(await hasGroupMembership(executorWithMembership(false, [12, 7, 3]), 7, {
    person_id: 12, workspace_id: 3,
  }), false);
});

function accountGroupExecutor(rows, expectedSql, expectedParameters) {
  return {
    async execute(sql, params) {
      assert.match(sql, expectedSql);
      assert.doesNotMatch(sql, /workspace_id/);
      assert.deepEqual(params, expectedParameters);
      return [rows ? [{ 1: 1 }] : []];
    },
  };
}

test('account group authorization uses direct group membership without workspace scope', async () => {
  assert.equal(await hasAccountGroupMembership(
    accountGroupExecutor(true, /FROM group_accounts/, [8, 23]), 8, 23
  ), true);
  assert.equal(await hasAccountGroupMembership(
    accountGroupExecutor(false, /FROM group_accounts/, [8, 24]), 8, 24
  ), false);
});

test('group administration requires an explicitly assigned owner or admin role', async () => {
  const query = /owner_account_id = \? OR ga\.role = 'admin'/;
  assert.equal(await hasGroupAdministrationAccess(
    accountGroupExecutor(true, query, [23, 8, 23]), 8, 23
  ), true);
  assert.equal(await hasGroupAdministrationAccess(
    accountGroupExecutor(false, query, [24, 8, 24]), 8, 24
  ), false);
});
