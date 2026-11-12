const test = require('node:test');
const assert = require('node:assert/strict');
const { hasGroupMembership } = require('../src/authorization');

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
